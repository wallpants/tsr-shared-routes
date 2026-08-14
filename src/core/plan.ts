import { determineInitialRoutePath } from "@tanstack/router-generator";
import fs from "node:fs";
import path from "node:path";
import type { SharedRoutesConfig } from "../config";
import type { DiscoveredMount } from "./discover";
import { classifyMountFile, MOUNT_FILE_RE, scaffoldEmptyMountFile } from "./discover";
import { SharedRoutesError } from "./errors";
import { scanSharedDir } from "./scan-shared";

/** Belt-and-braces guard against runaway nested-mount recursion. */
export const MAX_MOUNT_DEPTH = 32;

export interface PlannedFile {
  /** Absolute path of the wrapper file to generate. */
  targetPath: string;
  kind: "wrapper" | "wrapper-lazy";
  /** Absolute path of the original shared route file the wrapper imports. */
  sharedFilePath: string;
  /** Absolute path of the mount file responsible for this wrapper. */
  mountFilePath: string;
  /** Route path of the mount's target dir (e.g. `/inventory/providers`). */
  mountRoutePathPrefix: string;
}

export interface Plan {
  files: Array<PlannedFile>;
  /** Absolute paths of every expansion dir (top-level and nested targets). */
  targetDirs: Array<string>;
  /** Absolute paths of every shared dir involved (deduped). */
  sharedRoots: Array<string>;
  warnings: Array<string>;
  /** Incomplete-state notes (mid-edit mount files); CLI display only. */
  incomplete: Array<string>;
  /** Absolute paths of nested mount files scaffolded this pass. */
  scaffolded: Array<string>;
  /**
   * Mounts left out of this plan (incomplete, or failed in lenient mode).
   * Non-zero puts the pipeline's stale cleanup on hold: files generated for a
   * temporarily broken mount must survive until it is valid (or gone) again.
   */
  skippedMounts: number;
}

export interface PlanOptions {
  /** Per-mount errors become warnings + skips instead of aborting the plan. */
  lenient?: boolean;
  /** Populate byte-empty nested mount files with the boilerplate scaffold. */
  scaffold?: boolean;
}

/** True when `child` is inside (or equal to) `parent`. Both absolute. */
function isWithin(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function routePrefixForDir(relDir: string): string {
  const posixRel = relDir.split(path.sep).join("/");
  if (posixRel === "" || posixRel === ".") return "";
  return determineInitialRoutePath(posixRel).routePath;
}

function mountName(mountFilePath: string): string {
  return path.basename(mountFilePath).replace(MOUNT_FILE_RE, "");
}

/** First line of a (potentially multi-line accepted-form) error message. */
function firstLine(message: string): string {
  return message.split("\n", 1)[0] ?? message;
}

function validateMountName(
  mountFilePath: string,
  config: SharedRoutesConfig,
  warnings: Array<string>,
): void {
  const name = mountName(mountFilePath);
  if (name === "__root") {
    throw new SharedRoutesError(
      "INVALID_MOUNT_NAME",
      `__root.mount.ts is not supported (${mountFilePath}): the root route cannot be a mount target.`,
    );
  }
  if (name === config.indexToken) {
    throw new SharedRoutesError(
      "INVALID_MOUNT_NAME",
      `${path.basename(mountFilePath)} is not supported (${mountFilePath}): mounting at the parent path itself is unsupported in v1. Use a pathless layout or a route group instead.`,
    );
  }
  if (config.routeFileIgnorePrefix !== "" && name.startsWith(config.routeFileIgnorePrefix)) {
    throw new SharedRoutesError(
      "INVALID_MOUNT_NAME",
      `mount file name ${path.basename(mountFilePath)} starts with the route-file ignore prefix ${JSON.stringify(config.routeFileIgnorePrefix)} (${mountFilePath}): the generated directory would be ignored by the TanStack Router generator. Rename the mount file.`,
    );
  }
  if (name === config.routeToken) {
    warnings.push(
      `mount file ${mountFilePath} is named after the route token ${JSON.stringify(config.routeToken)} — this is almost certainly a mistake.`,
    );
  }
}

interface ChainEntry {
  mountFilePath: string;
  sharedDirReal: string;
}

/**
 * Builds the desired-file map for all discovered mounts. Pure planning: reads
 * the filesystem but never mutates it, and raises every validation error
 * before the pipeline writes anything.
 */
export function buildPlan(
  config: SharedRoutesConfig,
  mounts: Array<DiscoveredMount>,
  options: PlanOptions = {},
): Plan {
  const { lenient = false, scaffold = false } = options;
  const routesDir = path.resolve(config.root, config.routesDirectory);
  const files: Array<PlannedFile> = [];
  const targetDirs: Array<string> = [];
  const sharedRoots: Array<string> = [];
  const warnings: Array<string> = [];
  const incomplete: Array<string> = [];
  const scaffolded: Array<string> = [];
  let skippedMounts = 0;

  /**
   * Lenient-mode error boundary around one mount's whole expansion: on
   * failure, everything the subtree contributed is rolled back and the mount
   * is skipped with a one-line warning instead of aborting the plan.
   */
  const attempt = (mountFilePath: string, run: () => void): void => {
    if (!lenient) {
      run();
      return;
    }
    const snapshot = {
      files: files.length,
      targetDirs: targetDirs.length,
      sharedRoots: sharedRoots.length,
    };
    try {
      run();
    } catch (error) {
      if (!(error instanceof SharedRoutesError)) throw error;
      files.length = snapshot.files;
      targetDirs.length = snapshot.targetDirs;
      sharedRoots.length = snapshot.sharedRoots;
      skippedMounts++;
      warnings.push(`skipping mount ${mountFilePath}: ${firstLine(error.message)}`);
    }
  };

  // 1. Mount-name validation + top-level target mapping.
  const topLevel: Array<DiscoveredMount & { targetDir: string }> = [];
  for (const mount of mounts) {
    attempt(mount.mountFilePath, () => {
      validateMountName(mount.mountFilePath, config, warnings);
      topLevel.push({ ...mount, targetDir: mount.mountFilePath.replace(MOUNT_FILE_RE, "") });
    });
  }

  // 2. Overlap validation among top-level targets (equal or nested targets).
  for (let i = 0; i < topLevel.length; i++) {
    for (let j = i + 1; j < topLevel.length; j++) {
      const a = topLevel[i]!;
      const b = topLevel[j]!;
      if (isWithin(a.targetDir, b.targetDir) || isWithin(b.targetDir, a.targetDir)) {
        throw new SharedRoutesError(
          "TARGET_OVERLAP",
          `mounts ${a.mountFilePath} and ${b.mountFilePath} generate overlapping directories (${a.targetDir} and ${b.targetDir}). Each mount must own an independent directory.`,
        );
      }
    }
  }

  const resolveSharedDir = (
    mountFilePath: string,
    sharedDirRelative: string,
  ): { sharedDir: string; sharedDirReal: string } => {
    const sharedDir = path.resolve(path.dirname(mountFilePath), sharedDirRelative);
    let stat: fs.Stats | undefined;
    try {
      stat = fs.statSync(sharedDir);
    } catch {
      stat = undefined;
    }
    if (stat === undefined || !stat.isDirectory()) {
      throw new SharedRoutesError(
        "SHARED_DIR_NOT_FOUND",
        `shared directory not found: mount ${mountFilePath} references ${JSON.stringify(sharedDirRelative)}, which resolves to ${sharedDir} — not an existing directory.`,
      );
    }
    const sharedDirReal = fs.realpathSync(sharedDir);
    const routesDirReal = fs.existsSync(routesDir) ? fs.realpathSync(routesDir) : routesDir;
    if (isWithin(routesDirReal, sharedDirReal)) {
      // Colocation is allowed when some path component between the routes
      // directory and the shared dir (the shared dir's own basename counts)
      // starts with `routeFileIgnorePrefix`: the stock generator filters such
      // directory names out before recursing (getRouteNodes.ts dirent filter),
      // so the whole subtree is invisible to it and cannot be double-scanned.
      const components = path
        .relative(routesDirReal, sharedDirReal)
        .split(path.sep)
        .filter(Boolean);
      const ignoredByGenerator =
        config.routeFileIgnorePrefix !== "" &&
        components.some((component) => component.startsWith(config.routeFileIgnorePrefix));
      if (!ignoredByGenerator) {
        const suggestion =
          config.routeFileIgnorePrefix === ""
            ? `move it outside ${routesDir}`
            : `move it outside ${routesDir}, or nest it under a directory whose name starts with ${JSON.stringify(config.routeFileIgnorePrefix)} (e.g. ${path.join(path.dirname(sharedDir), config.routeFileIgnorePrefix + path.basename(sharedDir))}) so the generator ignores it`;
        throw new SharedRoutesError(
          "SHARED_DIR_INSIDE_ROUTES",
          `shared directory ${sharedDir} (from mount ${mountFilePath}) is inside the routes directory ${routesDir}. The TanStack Router generator would double-scan it — ${suggestion}.`,
        );
      }
    }
    if (isWithin(sharedDirReal, routesDirReal)) {
      throw new SharedRoutesError(
        "SHARED_DIR_CONTAINS_ROUTES",
        `shared directory ${sharedDir} (from mount ${mountFilePath}) contains the routes directory ${routesDir}. This would recursively mount the routes tree into itself.`,
      );
    }
    return { sharedDir, sharedDirReal };
  };

  // 3. Recursive expansion with cycle detection (realpath DFS; GRAY = on the
  //    current path, implicitly BLACK when popped — re-expanding a finished
  //    shared dir under another mount is legal and required).
  const gray = new Set<string>();

  const expand = (
    sharedDir: string,
    sharedDirReal: string,
    targetDir: string,
    mountFilePath: string,
    chain: Array<ChainEntry>,
  ): void => {
    if (chain.length >= MAX_MOUNT_DEPTH) {
      throw new SharedRoutesError(
        "MOUNT_DEPTH_EXCEEDED",
        `nested mounts exceed the maximum depth of ${MAX_MOUNT_DEPTH} (last mount: ${mountFilePath}).`,
      );
    }
    if (gray.has(sharedDirReal)) {
      const cycleStart = chain.findIndex((entry) => entry.sharedDirReal === sharedDirReal);
      const cycleChain = [
        ...chain.slice(cycleStart === -1 ? 0 : cycleStart),
        { mountFilePath, sharedDirReal },
      ];
      const rel = (p: string): string => path.relative(config.root, p) || ".";
      throw new SharedRoutesError(
        "MOUNT_CYCLE",
        `mount cycle detected:\n${cycleChain
          .map((entry) => `  ${rel(entry.sharedDirReal)} (via ${rel(entry.mountFilePath)})`)
          .join(" →\n")} →\n  ${rel(sharedDirReal)} (already on this mount chain)`,
      );
    }

    gray.add(sharedDirReal);
    try {
      const scan = scanSharedDir(sharedDir, {
        routeFileIgnorePrefix: config.routeFileIgnorePrefix,
      });
      const prefix = routePrefixForDir(path.relative(routesDir, targetDir));

      for (const routeFile of scan.routeFiles) {
        files.push({
          targetPath: path.join(targetDir, ...routeFile.relPath.split("/")),
          kind: routeFile.lazy ? "wrapper-lazy" : "wrapper",
          sharedFilePath: path.join(sharedDir, ...routeFile.relPath.split("/")),
          mountFilePath,
          mountRoutePathPrefix: prefix,
        });
      }

      for (const nested of scan.nestedMounts) {
        const code = fs.readFileSync(nested.mountFilePath, "utf8");
        if (scaffold && scaffoldEmptyMountFile(nested.mountFilePath, code)) {
          scaffolded.push(nested.mountFilePath);
          skippedMounts++;
          incomplete.push(`mount file ${nested.mountFilePath} is waiting for its shared-dir path`);
          continue;
        }
        const classified = classifyMountFile(code, nested.mountFilePath);
        if (classified.kind === "incomplete") {
          skippedMounts++;
          incomplete.push(`mount file ${nested.mountFilePath} is waiting for its shared-dir path`);
          continue;
        }
        if (classified.kind === "invalid") {
          if (!lenient) throw classified.error;
          skippedMounts++;
          warnings.push(
            `skipping invalid mount file ${nested.mountFilePath} (run \`tanstack-shared-routes generate\` for details)`,
          );
          continue;
        }
        attempt(nested.mountFilePath, () => {
          validateMountName(nested.mountFilePath, config, warnings);
          const resolved = resolveSharedDir(nested.mountFilePath, classified.sharedDirRelative);
          const nestedTargetDir = path.join(targetDir, ...nested.relTargetDir.split("/"));
          expand(
            resolved.sharedDir,
            resolved.sharedDirReal,
            nestedTargetDir,
            nested.mountFilePath,
            [...chain, { mountFilePath, sharedDirReal }],
          );
        });
      }
    } finally {
      gray.delete(sharedDirReal);
    }

    targetDirs.push(targetDir);
    sharedRoots.push(sharedDir);
  };

  for (const mount of topLevel) {
    attempt(mount.mountFilePath, () => {
      const resolved = resolveSharedDir(mount.mountFilePath, mount.sharedDirRelative);
      expand(resolved.sharedDir, resolved.sharedDirReal, mount.targetDir, mount.mountFilePath, []);
    });
  }

  // 4. No two planned files may claim the same target path (e.g. a shared dir
  //    containing both a physical `x/` subtree and an `x.mount.ts`).
  const byTarget = new Map<string, PlannedFile>();
  for (const file of files) {
    const existing = byTarget.get(file.targetPath);
    if (existing !== undefined) {
      throw new SharedRoutesError(
        "TARGET_COLLISION",
        `two shared sources produce the same generated file ${file.targetPath}:\n  ${existing.sharedFilePath} (mount: ${existing.mountFilePath})\n  ${file.sharedFilePath} (mount: ${file.mountFilePath})`,
      );
    }
    byTarget.set(file.targetPath, file);
  }

  files.sort((a, b) => a.targetPath.localeCompare(b.targetPath));
  targetDirs.sort();
  return {
    files,
    targetDirs,
    sharedRoots: [...new Set(sharedRoots)].sort(),
    warnings,
    incomplete,
    scaffolded,
    skippedMounts,
  };
}
