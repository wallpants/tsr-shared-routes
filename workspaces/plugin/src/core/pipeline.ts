import path from "node:path";
import type { SharedRoutesConfig } from "../config";
import { discoverMounts } from "./discover";
import { helperPathFor, renderHelper } from "./emit-helper";
import { renderRuntimeModule, runtimeModulePath, runtimeSpecifierFor } from "./emit-runtime";
import { decideWrite, renderWrapper } from "./emit-wrapper";
import { SharedRoutesError } from "./errors";
import { atomicWrite, isOwned, maskedHash, readIfExists } from "./fsio";
import { updateGitignore } from "./gitignore";
import type { EscapeLintFile } from "./lint-escapes";
import { collectRouteFiles, lintRelativeEscapes } from "./lint-escapes";
import type { Manifest, ManifestFileEntry } from "./manifest";
import { cleanupStale, readManifest, writeManifest } from "./manifest";
import { buildPlan } from "./plan";
import { computeRouteIdLiteral } from "./route-id";
import { hasRouteExport } from "./scaffold";
import { TSR_CONFIG_FILE, ensureTsrConfig } from "./tsr-config";

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
   /** Mid-edit states (unfilled mount files, missing `Route` exports) — informational. */
   incomplete: Array<string>;
   /** Root-relative posix paths of user files populated with boilerplate this pass. */
   scaffolded: Array<string>;
   /** Absolute paths of every source dir involved in the plan (sorted). */
   sourceRoots: Array<string>;
   /** Absolute paths of every wrapper target dir (sorted). */
   targetDirs: Array<string>;
   /**
    * Absolute source file path → absolute wrapper paths generated from it.
    * The vite plugin uses this to pull wrapper modules into the same HMR
    * batch as their source, so the re-created Route instance is re-patched
    * before React re-renders.
    */
   wrappersBySource: Record<string, Array<string>>;
   /**
    * Relative-escape lint findings (also included in `errors`). Kept separate
    * so the vite plugin can broadcast them to the browser console.
    */
   lintWarnings: Array<string>;
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
 * Full codegen pass: discover mounts → scan source subtrees → plan → compute
 * route-id literals (wrapper AND home ids) → render wrappers + `.gen`
 * siblings → diff/adopt → atomic writes → stale cleanup → manifest →
 * gitignore. Validation errors are raised before the first generated-file
 * write (scaffolding of byte-empty mount files is the one additive mutation
 * allowed earlier; empty ROUTE files are the stock generator's job now).
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
   const literalFor = (filePath: string): string =>
      computeRouteIdLiteral(path.relative(routesDir, filePath).split(path.sep).join("/"), {
         indexToken: config.indexToken,
         routeToken: config.routeToken,
      });

   // 1-2. Discover + plan (throws only in strict mode / on global conflicts).
   const discovery = discoverMounts(routesDir, { lenient, scaffold });
   const plan = buildPlan(config, discovery.mounts, { lenient });
   const warnings = [...discovery.warnings, ...plan.warnings];
   const incomplete = [...discovery.incomplete];
   const scaffolded = [...discovery.scaffolded];
   const skippedMounts = discovery.skipped.length + plan.skippedMounts;

   const sourceContent = new Map<string, string | undefined>();
   const readSource = (filePath: string): string | undefined => {
      if (!sourceContent.has(filePath)) sourceContent.set(filePath, readIfExists(filePath));
      return sourceContent.get(filePath);
   };

   // 3. Compute literals. Each planned wrapper's literal is one of its source
   //    file's mount ids; the source file's own (home) literal is another —
   //    both derived by the same function, so there is exactly one id
   //    derivation path. Ids are grouped per source file: home id first, then
   //    wrapper ids in plan order.
   const literals = plan.files.map((file) => ({
      file,
      routeIdLiteral: literalFor(file.targetPath),
   }));
   const mountIdsBySource = new Map<string, Array<string>>();
   for (const { file, routeIdLiteral } of literals) {
      let ids = mountIdsBySource.get(file.sourceFilePath);
      if (ids === undefined) {
         ids = [literalFor(file.sourceFilePath)];
         mountIdsBySource.set(file.sourceFilePath, ids);
      }
      ids.push(routeIdLiteral);
   }

   // 4. Render desired wrapper content.
   const desired = literals.map(({ file, routeIdLiteral }) => {
      const content = renderWrapper({
         kind: file.kind,
         routeIdLiteral,
         targetPath: file.targetPath,
         sharedFilePath: file.sourceFilePath,
         mountIds: mountIdsBySource.get(file.sourceFilePath) ?? [],
         runtimeSpecifier: runtimeSpecifierFor(file.targetPath, runtimePath),
         sourceLabel: rel(file.sourceFilePath),
         mountLabel: rel(file.mountFilePath),
         banner: config.banner,
      });
      return { file, routeIdLiteral, content };
   });

   // 4b. `.gen` siblings: one per mounted SOURCE route file (non-lazy),
   //     parameterized by that file's full id union (home id included).
   //     Computed from the FULL plan, before the Route-export gate: the
   //     sibling must exist even while its source file is still being
   //     authored, so an `import { shared } from './x.gen'` the user adds
   //     early always resolves.
   const desiredHelpers = [...mountIdsBySource.entries()]
      .filter(([sourceFilePath]) =>
         plan.files.some(
            (file) => file.sourceFilePath === sourceFilePath && file.kind === "wrapper",
         ),
      )
      .map(([sourceFilePath, mountIds]) => {
         const helperPath = helperPathFor(sourceFilePath);
         return {
            helperPath,
            sourceFilePath,
            content: renderHelper({
               mountIds,
               sourceLabel: rel(sourceFilePath),
               runtimeSpecifier: runtimeSpecifierFor(helperPath, runtimePath),
               banner: config.banner,
            }),
         };
      })
      .sort((a, b) => a.helperPath.localeCompare(b.helperPath));

   // 4c. Runtime module: a single `sharedRoutes.gen.ts` next to the routes
   //     directory — the user-land home of the shared-route machinery
   //     (module augmentation of '@tanstack/react-router' binds to the app's
   //     copy — see emit-runtime.ts). Present only while a mount exists.
   const desiredRuntimes =
      plan.sourceRoots.length > 0
         ? [{ runtimePath, content: renderRuntimeModule(config.banner) }]
         : [];

   // 4d. Route-export gate: a wrapper imports `Route` from its source file,
   //     so emitting it before that export exists would break the route tree
   //     on every save while the file is authored (the stock generator
   //     scaffolds empty source files; until then they export nothing). Such
   //     wrappers are deferred: not written this pass, but still desired
   //     (protected from cleanup) — the source file EXISTS, it is just not
   //     finished yet.
   const emitted: typeof desired = [];
   const notedUnready = new Set<string>();
   for (const entry of desired) {
      const code = readSource(entry.file.sourceFilePath) ?? "";
      if (hasRouteExport(code)) {
         emitted.push(entry);
      } else if (!notedUnready.has(entry.file.sourceFilePath)) {
         notedUnready.add(entry.file.sourceFilePath);
         incomplete.push(
            `${rel(entry.file.sourceFilePath)} does not export \`Route\` yet — wrapper not generated`,
         );
      }
   }

   // 4e. Relative-escape lint: warn about '.'-prefixed `to` literals in
   //     mounted source files that resolve to a route under SOME mounts but
   //     not all — the union types are ANY-mount for escapes, so these
   //     typecheck yet not-found at runtime under the mounts they miss.
   const routeIdSet = new Set<string>(literals.map((entry) => entry.routeIdLiteral));
   for (const routeFile of collectRouteFiles(routesDir, config.routeFileIgnorePrefix)) {
      routeIdSet.add(literalFor(routeFile));
   }
   const lintFiles: Array<EscapeLintFile> = [];
   for (const [sourceFilePath, baseIds] of mountIdsBySource) {
      const code = readSource(sourceFilePath);
      if (code !== undefined) lintFiles.push({ label: rel(sourceFilePath), code, baseIds });
   }
   const lintWarnings = lintRelativeEscapes(lintFiles, routeIdSet);
   warnings.push(...lintWarnings);

   // 5. Ownership pre-check on every emitted target before any write happens.
   const existingByPath = new Map<string, string | undefined>();
   for (const { file } of emitted) {
      const existing = readIfExists(file.targetPath);
      if (existing !== undefined && !isOwned(existing)) {
         throw new SharedRoutesError(
            "UNOWNED_TARGET_FILE",
            `refusing to overwrite ${rel(file.targetPath)}\nThis file exists but was not generated by tsr-shared-routes.\n→ Remove the file, or remove/rename the mount ${rel(file.mountFilePath)}.`,
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
            `refusing to overwrite ${rel(generated)}\nThis file exists but was not generated by tsr-shared-routes.\n→ Remove the file (the \`.gen\` name is reserved for generated files).`,
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
   // `.gen` siblings and runtime modules hold no route-id literal for the
   // stock generator to correct, so a plain byte compare replaces the masked
   // diff.
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

   // 7. Stale cleanup (manifest ∪ banner scan, banner re-confirmed at unlink).
   //    Source roots are banner-scanned for stale `.gen` siblings but never
   //    pruned — they are user directories this tool did not create. Deferred
   //    wrappers count as desired: their source file exists, so they are not
   //    stale. While any mount is skipped (mid-edit), cleanup is held
   //    entirely: files of a temporarily broken mount must survive until it
   //    is valid again.
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
           extraScanDirs: plan.sourceRoots,
           desiredPaths,
           dryRun: check,
        });

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
            source: rel(file.sourceFilePath),
            hash: maskedHash(finalContent.get(file.targetPath) ?? ""),
         })),
         ...desiredHelpers.map((helper): ManifestFileEntry => ({
            path: rel(helper.helperPath),
            role: "helper",
            source: rel(helper.sourceFilePath),
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
         ...plan.sourceRoots.map((dir) => `${rel(dir)}/**/*.gen.*`),
         ...desiredRuntimes.map((runtime) => rel(runtime.runtimePath)),
      ],
      dryRun: check,
   });

   // 10. tsr.config.json: while any mount file exists, its
   //     routeFileIgnorePattern must cover *.mount.ts files and the `.gen`
   //     siblings (both live inside the routes directory) — that file is
   //     read by both the tsr CLI and TanStack's vite plugin, so this is the
   //     one place the pattern needs to live.
   if (discovery.mounts.length > 0 || discovery.skipped.length > 0) {
      const tsrUpdate = ensureTsrConfig(root, check);
      if (tsrUpdate.changed) written.push(TSR_CONFIG_FILE);
      if (tsrUpdate.warning !== undefined) warnings.push(tsrUpdate.warning);
   }

   const wrappersBySource: Record<string, Array<string>> = {};
   for (const file of plan.files) {
      (wrappersBySource[file.sourceFilePath] ??= []).push(file.targetPath);
   }

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
      sourceRoots: plan.sourceRoots,
      targetDirs: plan.targetDirs,
      wrappersBySource,
      lintWarnings,
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
