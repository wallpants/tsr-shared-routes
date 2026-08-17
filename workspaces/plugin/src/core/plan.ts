import fs from "node:fs";
import path from "node:path";
import type { SharedRoutesConfig } from "../config";
import type { DiscoveredMount } from "./discover";
import { MOUNT_FILE_RE } from "./discover";
import { SharedRoutesError } from "./errors";
import type { ScanResult } from "./scan-source";
import { scanSourceDir } from "./scan-source";

/** Belt-and-braces guard against runaway nested-mount recursion. */
export const MAX_MOUNT_DEPTH = 32;

export interface PlannedFile {
   /** Absolute path of the wrapper file to generate. */
   targetPath: string;
   kind: "wrapper" | "wrapper-lazy";
   /** Absolute path of the original source route file the wrapper imports. */
   sourceFilePath: string;
   /** Absolute path of the source ROOT the file was scanned under. */
   sourceRoot: string;
   /** Absolute path of the mount file responsible for this wrapper. */
   mountFilePath: string;
}

export interface Plan {
   files: Array<PlannedFile>;
   /** Absolute paths of every mount's target dir. */
   targetDirs: Array<string>;
   /** Absolute paths of every source dir involved (deduped). */
   sourceRoots: Array<string>;
   warnings: Array<string>;
   /**
    * Mounts left out of this plan (failed in lenient mode). Non-zero puts the
    * pipeline's stale cleanup on hold: files generated for a temporarily
    * broken mount must survive until it is valid (or gone) again.
    */
   skippedMounts: number;
}

export interface PlanOptions {
   /** Per-mount errors become warnings + skips instead of aborting the plan. */
   lenient?: boolean;
}

/** True when `child` is inside (or equal to) `parent`. Both absolute. */
function isWithin(parent: string, child: string): boolean {
   const rel = path.relative(parent, child);
   return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
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
         `${path.basename(mountFilePath)} is not supported (${mountFilePath}): mounting at the parent path itself is unsupported. Use a pathless layout or a route group instead.`,
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

/**
 * Builds the desired-file map for all discovered mounts. Pure planning: reads
 * the filesystem but never mutates it, and raises every validation error
 * before the pipeline writes anything.
 *
 * Sources are ordinary VISIBLE route subtrees inside the routes directory —
 * the source files are themselves real routes (the "home mount"). Source
 * subtrees may overlap (a mount may target a subtree of another mount's
 * source), and may contain mount files (nested mounts): a mount whose target
 * lies inside another mount's source is mirrored under every target of the
 * containing mount, recursively, with each wrapper always importing the REAL
 * source route file — never another wrapper. Target dirs must be pairwise
 * disjoint and no source may live inside a target (generated output cannot
 * be mounted).
 */
export function buildPlan(
   config: SharedRoutesConfig,
   mounts: Array<DiscoveredMount>,
   options: PlanOptions = {},
): Plan {
   const { lenient = false } = options;
   const routesDir = path.resolve(config.root, config.routesDirectory);
   const routesDirReal = fs.existsSync(routesDir) ? fs.realpathSync(routesDir) : routesDir;
   const relRoot = (p: string): string => path.relative(config.root, p) || ".";
   const files: Array<PlannedFile> = [];
   const warnings: Array<string> = [];
   const skippedMountFiles = new Set<string>();

   interface ResolvedMount extends DiscoveredMount {
      targetDir: string;
      sourceDir: string;
      /** Realpath of sourceDir — the cycle-detection identity. */
      sourceDirReal: string;
   }

   /**
    * Lenient-mode error boundary around one mount (or one nested expansion of
    * it): on failure everything the attempt contributed is rolled back and
    * the mount is skipped with a one-line warning instead of aborting the
    * plan.
    */
   const resolved: Array<ResolvedMount> = [];
   const expanded: Array<ResolvedMount> = [];
   const attempt = (mountFilePath: string, run: () => void): void => {
      if (!lenient) {
         run();
         return;
      }
      const snapshot = {
         files: files.length,
         resolved: resolved.length,
         expanded: expanded.length,
      };
      try {
         run();
      } catch (error) {
         if (!(error instanceof SharedRoutesError)) throw error;
         files.length = snapshot.files;
         resolved.length = snapshot.resolved;
         expanded.length = snapshot.expanded;
         skippedMountFiles.add(mountFilePath);
         warnings.push(`skipping mount ${mountFilePath}: ${firstLine(error.message)}`);
      }
   };

   const resolveSourceDir = (
      mountFilePath: string,
      sourceDirRelative: string,
   ): { sourceDir: string; sourceDirReal: string } => {
      const sourceDir = path.resolve(path.dirname(mountFilePath), sourceDirRelative);
      let stat: fs.Stats | undefined;
      try {
         stat = fs.statSync(sourceDir);
      } catch {
         stat = undefined;
      }
      if (stat === undefined || !stat.isDirectory()) {
         throw new SharedRoutesError(
            "SOURCE_DIR_NOT_FOUND",
            `source directory not found: mount ${mountFilePath} references ${JSON.stringify(sourceDirRelative)}, which resolves to ${sourceDir} — not an existing directory.`,
         );
      }
      const sourceDirReal = fs.realpathSync(sourceDir);
      if (!isWithin(routesDirReal, sourceDirReal)) {
         throw new SharedRoutesError(
            "SOURCE_DIR_OUTSIDE_ROUTES",
            `source directory ${sourceDir} (from mount ${mountFilePath}) is outside the routes directory ${routesDir}. Mounted subtrees are plain route directories — move it inside the routes directory.`,
         );
      }
      if (sourceDirReal === routesDirReal) {
         throw new SharedRoutesError(
            "SOURCE_DIR_IS_ROUTES_ROOT",
            `mount ${mountFilePath} targets the routes directory itself (${sourceDir}). Mount a subtree, not the whole routes directory.`,
         );
      }
      return { sourceDir, sourceDirReal };
   };

   // 1. Mount-name validation + per-mount resolution.
   for (const mount of mounts) {
      attempt(mount.mountFilePath, () => {
         validateMountName(mount.mountFilePath, config, warnings);
         const targetDir = mount.mountFilePath.replace(MOUNT_FILE_RE, "");
         const source = resolveSourceDir(mount.mountFilePath, mount.sourceDirRelative);
         resolved.push({ ...mount, targetDir, ...source });
      });
   }

   // 2. Cross-mount containment validation. Targets must be pairwise
   //    disjoint, and a source inside any target would mount generated
   //    output. A target inside a source subtree is the NESTED case — legal,
   //    expanded transitively in step 3.
   for (let i = 0; i < resolved.length; i++) {
      for (let j = i + 1; j < resolved.length; j++) {
         const a = resolved[i]!;
         const b = resolved[j]!;
         if (isWithin(a.targetDir, b.targetDir) || isWithin(b.targetDir, a.targetDir)) {
            throw new SharedRoutesError(
               "TARGET_OVERLAP",
               `mounts ${a.mountFilePath} and ${b.mountFilePath} generate overlapping directories (${a.targetDir} and ${b.targetDir}). Each mount must own an independent directory.`,
            );
         }
      }
   }
   for (const target of resolved) {
      for (const source of resolved) {
         if (isWithin(target.targetDir, source.sourceDir)) {
            throw new SharedRoutesError(
               "SOURCE_INSIDE_TARGET",
               `mount ${source.mountFilePath} targets ${source.sourceDir}, which is inside the generated directory ${target.targetDir} (mount ${target.mountFilePath}). Generated wrappers cannot be mounted.`,
            );
         }
      }
   }

   // 3. Expand each mount by scanning its source subtree, then recurse into
   //    nested mounts: every mount whose target dir lies inside this source
   //    subtree is mirrored at the corresponding location under this mount's
   //    target — against the nested mount's REAL source files, never against
   //    its generated wrappers (the scan skips those dirs). Cycles are
   //    detected per expansion chain: re-expanding a source under a different
   //    mount is legal and required, revisiting one on the SAME chain never
   //    terminates.
   const scanCache = new Map<string, ScanResult>();
   const scanOf = (sourceDir: string): ScanResult => {
      let scan = scanCache.get(sourceDir);
      if (scan === undefined) {
         scan = scanSourceDir(sourceDir, { routeFileIgnorePrefix: config.routeFileIgnorePrefix });
         scanCache.set(sourceDir, scan);
      }
      return scan;
   };

   interface ChainEntry {
      mountFilePath: string;
      sourceDirReal: string;
   }

   const expand = (mount: ResolvedMount, targetDir: string, chain: Array<ChainEntry>): void => {
      if (chain.length >= MAX_MOUNT_DEPTH) {
         throw new SharedRoutesError(
            "MOUNT_DEPTH_EXCEEDED",
            `nested mounts exceed the maximum depth of ${MAX_MOUNT_DEPTH} (last mount: ${mount.mountFilePath}).`,
         );
      }
      if (chain.some((entry) => entry.sourceDirReal === mount.sourceDirReal)) {
         const cycleStart = chain.findIndex((entry) => entry.sourceDirReal === mount.sourceDirReal);
         const cycleChain = [
            ...chain.slice(cycleStart),
            { mountFilePath: mount.mountFilePath, sourceDirReal: mount.sourceDirReal },
         ];
         throw new SharedRoutesError(
            "MOUNT_CYCLE",
            `mount cycle detected:\n${cycleChain
               .map(
                  (entry) =>
                     `  ${relRoot(entry.sourceDirReal)} (via ${relRoot(entry.mountFilePath)})`,
               )
               .join(" →\n")} →\n  ${relRoot(mount.sourceDirReal)} (already on this mount chain)`,
         );
      }
      const scan = scanOf(mount.sourceDir);
      for (const routeFile of scan.routeFiles) {
         files.push({
            targetPath: path.join(targetDir, ...routeFile.relPath.split("/")),
            kind: routeFile.lazy ? "wrapper-lazy" : "wrapper",
            sourceFilePath: path.join(mount.sourceDir, ...routeFile.relPath.split("/")),
            sourceRoot: mount.sourceDir,
            mountFilePath: mount.mountFilePath,
         });
      }
      const link: ChainEntry = {
         mountFilePath: mount.mountFilePath,
         sourceDirReal: mount.sourceDirReal,
      };
      // No self-exclusion: a mount whose own target lies inside its source is
      // the tightest cycle and must reach the chain check above.
      for (const nested of resolved) {
         if (!isWithin(mount.sourceDir, nested.targetDir)) continue;
         const nestedTargetDir = path.join(
            targetDir,
            path.relative(mount.sourceDir, nested.targetDir),
         );
         attempt(nested.mountFilePath, () => expand(nested, nestedTargetDir, [...chain, link]));
      }
   };

   for (const mount of resolved) {
      attempt(mount.mountFilePath, () => {
         expand(mount, mount.targetDir, []);
         expanded.push(mount);
      });
   }

   // 4. Belt-and-braces: no two planned files may claim the same target path
   //    (unreachable while targets are pairwise disjoint).
   const byTarget = new Map<string, PlannedFile>();
   for (const file of files) {
      const existing = byTarget.get(file.targetPath);
      if (existing !== undefined) {
         throw new SharedRoutesError(
            "TARGET_COLLISION",
            `two sources produce the same generated file ${file.targetPath}:\n  ${existing.sourceFilePath} (mount: ${existing.mountFilePath})\n  ${file.sourceFilePath} (mount: ${file.mountFilePath})`,
         );
      }
      byTarget.set(file.targetPath, file);
   }

   files.sort((a, b) => a.targetPath.localeCompare(b.targetPath));
   // A nested mount that fails does so once per expansion chain (its own home
   // expansion plus each covering mount's) — dedupe the identical warnings
   // and count each broken mount file once.
   return {
      files,
      targetDirs: expanded.map((mount) => mount.targetDir).sort(),
      sourceRoots: [...new Set(expanded.map((mount) => mount.sourceDir))].sort(),
      warnings: [...new Set(warnings)],
      skippedMounts: skippedMountFiles.size,
   };
}
