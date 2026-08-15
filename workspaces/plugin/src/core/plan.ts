import fs from "node:fs";
import path from "node:path";
import type { SharedRoutesConfig } from "../config";
import type { DiscoveredMount } from "./discover";
import { MOUNT_FILE_RE } from "./discover";
import { SharedRoutesError } from "./errors";
import { scanSourceDir } from "./scan-source";

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
 * source); target dirs must be disjoint from each other and from every
 * source subtree.
 */
export function buildPlan(
   config: SharedRoutesConfig,
   mounts: Array<DiscoveredMount>,
   options: PlanOptions = {},
): Plan {
   const { lenient = false } = options;
   const routesDir = path.resolve(config.root, config.routesDirectory);
   const routesDirReal = fs.existsSync(routesDir) ? fs.realpathSync(routesDir) : routesDir;
   const files: Array<PlannedFile> = [];
   const warnings: Array<string> = [];
   let skippedMounts = 0;

   interface ResolvedMount extends DiscoveredMount {
      targetDir: string;
      sourceDir: string;
   }

   /**
    * Lenient-mode error boundary around one mount: on failure everything the
    * mount contributed is rolled back and the mount is skipped with a
    * one-line warning instead of aborting the plan.
    */
   const resolved: Array<ResolvedMount> = [];
   const attempt = (mountFilePath: string, run: () => void): void => {
      if (!lenient) {
         run();
         return;
      }
      const snapshot = { files: files.length, resolved: resolved.length };
      try {
         run();
      } catch (error) {
         if (!(error instanceof SharedRoutesError)) throw error;
         files.length = snapshot.files;
         resolved.length = snapshot.resolved;
         skippedMounts++;
         warnings.push(`skipping mount ${mountFilePath}: ${firstLine(error.message)}`);
      }
   };

   const resolveSourceDir = (mountFilePath: string, sourceDirRelative: string): string => {
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
      return sourceDir;
   };

   // 1. Mount-name validation + per-mount resolution.
   for (const mount of mounts) {
      attempt(mount.mountFilePath, () => {
         validateMountName(mount.mountFilePath, config, warnings);
         const targetDir = mount.mountFilePath.replace(MOUNT_FILE_RE, "");
         const sourceDir = resolveSourceDir(mount.mountFilePath, mount.sourceDirRelative);
         resolved.push({ ...mount, targetDir, sourceDir });
      });
   }

   // 2. Cross-mount containment validation. Targets must be pairwise
   //    disjoint; a target inside any source subtree would be re-mirrored
   //    (recursion); a source inside any target would mount generated output.
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
         // Checked first: when a source EQUALS a target both conditions hold,
         // and "you are mounting generated output" is the actionable message.
         if (isWithin(target.targetDir, source.sourceDir)) {
            throw new SharedRoutesError(
               "SOURCE_INSIDE_TARGET",
               `mount ${source.mountFilePath} targets ${source.sourceDir}, which is inside the generated directory ${target.targetDir} (mount ${target.mountFilePath}). Generated wrappers cannot be mounted.`,
            );
         }
         if (isWithin(source.sourceDir, target.targetDir)) {
            throw new SharedRoutesError(
               "TARGET_INSIDE_SOURCE",
               `mount ${target.mountFilePath} generates ${target.targetDir}, which is inside the mounted source subtree ${source.sourceDir} (mount ${source.mountFilePath}). A mount cannot live inside a mounted subtree.`,
            );
         }
      }
   }

   // 3. Expand each mount by scanning its source subtree.
   const expanded: Array<ResolvedMount> = [];
   for (const mount of resolved) {
      attempt(mount.mountFilePath, () => {
         const scan = scanSourceDir(mount.sourceDir, {
            routeFileIgnorePrefix: config.routeFileIgnorePrefix,
         });
         for (const routeFile of scan.routeFiles) {
            files.push({
               targetPath: path.join(mount.targetDir, ...routeFile.relPath.split("/")),
               kind: routeFile.lazy ? "wrapper-lazy" : "wrapper",
               sourceFilePath: path.join(mount.sourceDir, ...routeFile.relPath.split("/")),
               sourceRoot: mount.sourceDir,
               mountFilePath: mount.mountFilePath,
            });
         }
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
   return {
      files,
      targetDirs: expanded.map((mount) => mount.targetDir).sort(),
      sourceRoots: [...new Set(expanded.map((mount) => mount.sourceDir))].sort(),
      warnings,
      skippedMounts,
   };
}
