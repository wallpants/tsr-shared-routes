import fs from "node:fs";
import path from "node:path";
import type { SharedRoutesConfig } from "../config";
import { discoverMounts } from "./discover";
import { helperPathFor, renderHelper } from "./emit-helper";
import { renderRuntimeModule, runtimeModulePath, runtimeSpecifierFor } from "./emit-runtime";
import { decideWrite, renderWrapper } from "./emit-wrapper";
import { SharedRoutesError } from "./errors";
import { atomicWrite, isOwned, maskedHash, readIfExists } from "./fsio";
import { updateGitignore } from "./gitignore";
import type { Manifest, ManifestFileEntry } from "./manifest";
import { cleanupStale, readManifest, writeManifest } from "./manifest";
import { buildPlan } from "./plan";
import { rewriteToHelper, rewriteToPackage } from "./rewrite-imports";
import { computeRouteIdLiteral } from "./route-id";
import {
  hasSharedExport,
  hasSharedLazyExport,
  scaffoldIfEmpty,
  sharedLazyScaffold,
  sharedRouteScaffold,
} from "./scaffold";

export interface PipelineSummary {
  /** Root-relative posix paths written (or that would be written in check mode). */
  written: Array<string>;
  /** Files whose on-disk literal was adopted (generator authority) — nothing written. */
  adopted: Array<string>;
  /** Stale generated files deleted (or that would be deleted in check mode). */
  deleted: Array<string>;
  /** Desired files already byte-identical on disk. */
  unchanged: number;
  /** Non-fatal problems (hard failures throw SharedRoutesError instead). */
  errors: Array<string>;
  /** Mid-edit states (unfilled mount files, missing `shared` exports) — informational. */
  incomplete: Array<string>;
  /** Root-relative posix paths of user files populated with boilerplate this pass. */
  scaffolded: Array<string>;
  /** Root-relative posix paths of shared files whose factory import was retargeted. */
  rewritten: Array<string>;
  /** Absolute paths of every shared dir involved in the plan (sorted). */
  sharedRoots: Array<string>;
  /** Absolute paths of every wrapper target dir (sorted). */
  targetDirs: Array<string>;
}

export interface PipelineOptions {
  /** Report what WOULD change without writing anything (CLI --check). */
  check?: boolean;
  /**
   * Dev-server mode: per-mount problems become warnings + skips instead of
   * aborting the whole pass, and stale cleanup is held while any mount is
   * skipped (a temporarily broken mount must not lose its generated files).
   */
  lenient?: boolean;
}

/**
 * Full codegen pass: discover mounts → scan shared dirs → plan → scaffold →
 * compute route-id literals → render wrappers → diff/adopt → atomic writes →
 * import retargeting → stale cleanup → manifest → gitignore. Validation
 * errors are raised before the first generated-file write (scaffolding of
 * byte-empty user files is the one additive mutation allowed earlier).
 */
export function runPipeline(
  config: SharedRoutesConfig,
  options: PipelineOptions = {},
): PipelineSummary {
  const check = options.check ?? false;
  const lenient = options.lenient ?? false;
  const scaffold = !check;
  const root = config.root;
  const routesDir = path.resolve(root, config.routesDirectory);
  const runtimePath = runtimeModulePath(routesDir);
  const manifestPath = path.resolve(root, config.manifestPath);
  const rel = (p: string): string => path.relative(root, p).split(path.sep).join("/");

  // 1-2. Discover + plan (throws only in strict mode / on global conflicts).
  const discovery = discoverMounts(routesDir, { lenient, scaffold });
  const plan = buildPlan(config, discovery.mounts, { lenient, scaffold });
  const warnings = [...discovery.warnings, ...plan.warnings];
  const incomplete = [...discovery.incomplete, ...plan.incomplete];
  const scaffolded = [...discovery.scaffolded, ...plan.scaffolded];
  const skippedMounts = discovery.skipped.length + plan.skippedMounts;

  // 3. Scaffold byte-empty shared route files. The `.gen` helper each
  //    scaffold imports is emitted later in this same pass (it depends only
  //    on the file name and the mount set), so scaffolded files are valid
  //    from birth and their wrappers are never deferred.
  const sharedContent = new Map<string, string | undefined>();
  const readShared = (filePath: string): string | undefined => {
    if (!sharedContent.has(filePath)) sharedContent.set(filePath, readIfExists(filePath));
    return sharedContent.get(filePath);
  };
  if (scaffold) {
    for (const file of plan.files) {
      const existing = readShared(file.sharedFilePath);
      if (existing === undefined || existing.trim() !== "") continue;
      const content =
        file.kind === "wrapper-lazy"
          ? sharedLazyScaffold()
          : sharedRouteScaffold(file.sharedFilePath);
      if (scaffoldIfEmpty(file.sharedFilePath, existing, content)) {
        sharedContent.set(file.sharedFilePath, content);
        scaffolded.push(file.sharedFilePath);
      }
    }
  }

  // 4. Compute literals and render desired content.
  const desired = plan.files.map((file) => {
    const wrapperRelPath = path.relative(routesDir, file.targetPath).split(path.sep).join("/");
    const routeIdLiteral = computeRouteIdLiteral(wrapperRelPath, {
      indexToken: config.indexToken,
      routeToken: config.routeToken,
    });
    const content = renderWrapper({
      kind: file.kind,
      routeIdLiteral,
      targetPath: file.targetPath,
      sharedFilePath: file.sharedFilePath,
      sourceLabel: rel(file.sharedFilePath),
      mountLabel: rel(file.mountFilePath),
      banner: config.banner,
    });
    return { file, routeIdLiteral, content };
  });

  // 4b. Helpers: one `<base>.gen.tsx` sibling per shared ROUTE file (non-lazy),
  //     parameterized by that file's route ids under EVERY mount of its shared
  //     dir (nested-mount expansions included — one wrapper per mount, and each
  //     wrapper's already-computed literal IS the mount id). Computed from the
  //     FULL plan, before the shared-export gate: the helper must exist even
  //     while its source file is still being authored.
  const helperMountIds = new Map<string, Array<string>>();
  for (const { file, routeIdLiteral } of desired) {
    if (file.kind !== "wrapper") continue; // lazy shared files need no helper
    const mountIds = helperMountIds.get(file.sharedFilePath) ?? [];
    mountIds.push(routeIdLiteral);
    helperMountIds.set(file.sharedFilePath, mountIds);
  }
  const desiredHelpers = [...helperMountIds.entries()]
    .map(([sharedFilePath, mountIds]) => {
      const helperPath = helperPathFor(sharedFilePath);
      return {
        helperPath,
        sharedFilePath,
        content: renderHelper({
          mountIds,
          sourceLabel: rel(sharedFilePath),
          runtimeSpecifier: runtimeSpecifierFor(helperPath, runtimePath),
          banner: config.banner,
        }),
      };
    })
    .sort((a, b) => a.helperPath.localeCompare(b.helperPath));

  // 4d. Runtime module: a single `sharedRoutes.gen.ts` next to the routes
  //     directory — the user-land home of the createSharedRoute machinery
  //     (module augmentation of '@tanstack/react-router' binds to the app's
  //     copy — see emit-runtime.ts). Present only while a mount exists.
  const desiredRuntimes =
    plan.sharedRoots.length > 0
      ? [{ runtimePath, content: renderRuntimeModule(config.banner) }]
      : [];

  // 4c. Shared-export gate: a wrapper imports `shared` (or `sharedLazy`) from
  //     its source file, so emitting it before that export exists would break
  //     the route tree on every save while the file is authored. Such wrappers
  //     are deferred: not written this pass, but still desired (protected from
  //     cleanup) — the source file EXISTS, it is just not finished yet.
  const emitted: typeof desired = [];
  const notedUnready = new Set<string>();
  for (const entry of desired) {
    const code = readShared(entry.file.sharedFilePath) ?? "";
    const ready =
      entry.file.kind === "wrapper-lazy" ? hasSharedLazyExport(code) : hasSharedExport(code);
    if (ready) {
      emitted.push(entry);
    } else if (!notedUnready.has(entry.file.sharedFilePath)) {
      notedUnready.add(entry.file.sharedFilePath);
      incomplete.push(
        `${rel(entry.file.sharedFilePath)} does not export \`${
          entry.file.kind === "wrapper-lazy" ? "sharedLazy" : "shared"
        }\` yet — wrapper not generated`,
      );
    }
  }

  // 5. Ownership pre-check on every emitted target before any write happens.
  const existingByPath = new Map<string, string | undefined>();
  for (const { file } of emitted) {
    const existing = readIfExists(file.targetPath);
    if (existing !== undefined && !isOwned(existing)) {
      throw new SharedRoutesError(
        "UNOWNED_TARGET_FILE",
        `refusing to overwrite ${rel(file.targetPath)}\nThis file exists but was not generated by tanstack-shared-routes.\n→ Remove the file, or remove/rename the mount ${rel(file.mountFilePath)}.`,
      );
    }
    existingByPath.set(file.targetPath, existing);
  }
  for (const generated of [
    ...desiredHelpers.map((h) => h.helperPath),
    ...desiredRuntimes.map((r) => r.runtimePath),
  ]) {
    const existing = readIfExists(generated);
    if (existing !== undefined && !isOwned(existing)) {
      throw new SharedRoutesError(
        "UNOWNED_TARGET_FILE",
        `refusing to overwrite ${rel(generated)}\nThis file exists but was not generated by tanstack-shared-routes.\n→ Remove the file (the \`.gen\` name is reserved for generated files).`,
      );
    }
    existingByPath.set(generated, existing);
  }

  // 6. Diff, adopt generator-corrected literals, write atomically.
  const written: Array<string> = [];
  const adopted: Array<string> = [];
  let unchanged = 0;
  const finalContent = new Map<string, string>();
  for (const { file, content } of emitted) {
    const decision = decideWrite(existingByPath.get(file.targetPath), content);
    finalContent.set(file.targetPath, decision.content);
    if (decision.action === "write") {
      if (!check) atomicWrite(file.targetPath, decision.content);
      written.push(rel(file.targetPath));
    } else if (decision.action === "adopt") {
      adopted.push(rel(file.targetPath));
    } else {
      unchanged++;
    }
  }
  // Helpers and runtime modules hold no route-id literal for the stock
  // generator to correct, so a plain byte compare replaces the masked diff.
  for (const generated of [
    ...desiredHelpers.map((h) => ({ path: h.helperPath, content: h.content })),
    ...desiredRuntimes.map((r) => ({ path: r.runtimePath, content: r.content })),
  ]) {
    finalContent.set(generated.path, generated.content);
    if (existingByPath.get(generated.path) === generated.content) {
      unchanged++;
    } else {
      if (!check) atomicWrite(generated.path, generated.content);
      written.push(rel(generated.path));
    }
  }

  // 6b. Retarget factory imports: a shared file still importing the package
  //     placeholder gets its specifier pointed at the now-existing `.gen`
  //     sibling (the module specifier is the only thing touched — the same
  //     class of in-place correction the stock generator applies to route-id
  //     literals in user files).
  const rewritten: Array<string> = [];
  if (!check) {
    for (const helper of desiredHelpers) {
      const code = readShared(helper.sharedFilePath);
      if (code === undefined) continue;
      const next = rewriteToHelper(code, helper.sharedFilePath);
      if (next !== undefined) {
        fs.writeFileSync(helper.sharedFilePath, next, "utf8");
        sharedContent.set(helper.sharedFilePath, next);
        rewritten.push(rel(helper.sharedFilePath));
      }
    }
  }

  // 7. Stale cleanup (manifest ∪ banner scan, banner re-confirmed at unlink).
  //    Shared roots are banner-scanned for stale helpers but never pruned —
  //    they are user directories this tool did not create. Deferred wrappers
  //    count as desired: their source file exists, so they are not stale.
  //    While any mount is skipped (mid-edit), cleanup is held entirely: files
  //    of a temporarily broken mount must survive until it is valid again.
  const previousManifest = readManifest(manifestPath);
  const desiredPaths = new Set(desired.map(({ file }) => file.targetPath));
  for (const helper of desiredHelpers) desiredPaths.add(helper.helperPath);
  for (const runtime of desiredRuntimes) desiredPaths.add(runtime.runtimePath);
  const holdCleanup = skippedMounts > 0;
  const { deleted } = holdCleanup
    ? { deleted: [] as Array<string> }
    : cleanupStale({
        root,
        manifest: previousManifest,
        currentTargetDirs: plan.targetDirs,
        extraScanDirs: plan.sharedRoots,
        desiredPaths,
        dryRun: check,
      });

  // 7b. Un-mounting must not leave red imports behind: when a helper was
  //     cleaned up, point the sibling source file's factory import back at
  //     the package placeholder.
  if (!check) {
    for (const deletedPath of deleted) {
      if (!/\.gen\.tsx$/.test(deletedPath)) continue;
      const base = deletedPath.replace(/\.gen\.tsx$/, "");
      for (const ext of [".tsx", ".ts", ".jsx", ".js"]) {
        const sourcePath = `${base}${ext}`;
        const code = readIfExists(sourcePath);
        if (code === undefined) continue;
        const next = rewriteToPackage(code, sourcePath);
        if (next !== undefined) {
          fs.writeFileSync(sourcePath, next, "utf8");
          rewritten.push(rel(sourcePath));
        }
        break;
      }
    }
  }

  // 8. New manifest: desired files + every directory we own. While cleanup is
  //    held, entries for skipped mounts are carried over from the previous
  //    manifest so their files are still tracked once the mount heals.
  if (!check) {
    const isWithin = (parent: string, child: string): boolean => {
      const relPath = path.relative(parent, child);
      return relPath === "" || (!relPath.startsWith("..") && !path.isAbsolute(relPath));
    };
    const dirSet = new Set<string>(plan.targetDirs);
    for (const { file } of desired) {
      let dir = path.dirname(file.targetPath);
      while (plan.targetDirs.some((targetDir) => isWithin(targetDir, dir)) && !dirSet.has(dir)) {
        dirSet.add(dir);
        dir = path.dirname(dir);
      }
    }
    const files: Array<ManifestFileEntry> = [
      ...desired.map(({ file }): ManifestFileEntry => ({
        path: rel(file.targetPath),
        role: "wrapper",
        mount: rel(file.mountFilePath),
        source: rel(file.sharedFilePath),
        hash: maskedHash(finalContent.get(file.targetPath) ?? ""),
      })),
      ...desiredHelpers.map((helper): ManifestFileEntry => ({
        path: rel(helper.helperPath),
        role: "helper",
        source: rel(helper.sharedFilePath),
        hash: maskedHash(helper.content),
      })),
      ...desiredRuntimes.map((runtime): ManifestFileEntry => ({
        path: rel(runtime.runtimePath),
        role: "runtime",
        hash: maskedHash(runtime.content),
      })),
    ];
    const dirs = new Set([...dirSet].map(rel));
    if (holdCleanup && previousManifest !== undefined) {
      carryOverManifest(previousManifest, files, dirs);
    }
    writeManifest(manifestPath, {
      version: 1,
      files,
      dirs: [...dirs].sort(),
    });
  }

  // 9. Managed .gitignore block (removed when the option is off).
  updateGitignore({
    gitignorePath: path.join(root, ".gitignore"),
    enabled: config.gitignore,
    entries: [
      ...plan.targetDirs.map((dir) => `${rel(dir)}/`),
      ...plan.sharedRoots.map((dir) => `${rel(dir)}/**/*.gen.*`),
      ...desiredRuntimes.map((runtime) => rel(runtime.runtimePath)),
    ],
    dryRun: check,
  });

  written.sort();
  adopted.sort();
  return {
    written,
    adopted,
    deleted: deleted.map(rel).sort(),
    unchanged,
    errors: warnings,
    incomplete,
    scaffolded: scaffolded.map(rel).sort(),
    rewritten: rewritten.sort(),
    sharedRoots: plan.sharedRoots,
    targetDirs: plan.targetDirs,
  };
}

/** Merges previous-manifest entries for paths the current pass does not claim. */
function carryOverManifest(
  previous: Manifest,
  files: Array<ManifestFileEntry>,
  dirs: Set<string>,
): void {
  const claimed = new Set(files.map((entry) => entry.path));
  for (const entry of previous.files) {
    if (!claimed.has(entry.path)) files.push(entry);
  }
  for (const dir of previous.dirs) dirs.add(dir);
}

/** Check mode for CI drift guards: returns what WOULD change, writes nothing. */
export function checkPipeline(config: SharedRoutesConfig): PipelineSummary {
  return runPipeline(config, { check: true });
}
