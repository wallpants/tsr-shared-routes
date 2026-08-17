import fs from "node:fs";
import path from "node:path";
import { MOUNT_FILE_RE, isMountFile } from "./discover";
import { SharedRoutesError } from "./errors";
import { isOwned, readIfExists } from "./fsio";

/** Stock route-file extensions, minus `.vue` (unsupported, hard error). */
const ROUTE_EXT_RE = /\.(tsx|ts|jsx|js)$/;
const VUE_EXT_RE = /\.vue$/;
/** Our own generated `.gen` siblings — never mirrored. */
export const GEN_FILE_RE = /\.gen\.(t|j)sx?$/;
/** Mirrors the stock generator's dot-flat split (escaped `[.]` is preserved). */
const SPLIT_RE = /(?<!\[)\.(?!\])/g;
/** Deprecated stock suffixes; they don't export `Route` and cannot be wrapped. */
const LEGACY_SUFFIXES = new Set([
   "component",
   "errorComponent",
   "notFoundComponent",
   "pendingComponent",
   "loader",
]);

export interface SourceRouteFile {
   /** Path relative to the source dir, posix separators. */
   relPath: string;
   /** True when the file base name ends with `.lazy` (before the extension). */
   lazy: boolean;
}

export interface ScanResult {
   routeFiles: Array<SourceRouteFile>;
}

export interface ScanOptions {
   /** Names starting with this prefix are skipped (stock default `-`). */
   routeFileIgnorePrefix: string;
}

/**
 * Scans a mounted source subtree recursively, classifying entries exactly
 * like the stock generator's physical scan classifies the source files
 * themselves (and therefore their mirrored wrappers). Source subtrees are
 * ordinary visible route directories and may contain mount files (nested
 * mounts): those are never mirrored — the plan expands them — and neither is
 * anything generated: a directory claimed by a sibling mount file holds that
 * nested mount's wrappers, and a banner-owned file is stale output of a
 * since-removed mount awaiting cleanup.
 */
export function scanSourceDir(sourceDir: string, options: ScanOptions): ScanResult {
   const { routeFileIgnorePrefix } = options;
   const routeFiles: Array<SourceRouteFile> = [];

   const walk = (relDir: string): void => {
      const fullDir = path.join(sourceDir, relDir);
      const entries = fs.readdirSync(fullDir, { withFileTypes: true });
      const nestedTargets = new Set<string>();
      for (const entry of entries) {
         if (entry.isFile() && isMountFile(entry.name)) {
            nestedTargets.add(entry.name.replace(MOUNT_FILE_RE, ""));
         }
      }
      for (const entry of entries) {
         const name = entry.name;
         if (name.startsWith(".")) continue;
         if (routeFileIgnorePrefix !== "" && name.startsWith(routeFileIgnorePrefix)) continue;
         if (name === "node_modules") continue;
         const relPath = relDir === "" ? name : `${relDir}/${name}`;

         if (entry.isDirectory()) {
            if (nestedTargets.has(name)) continue;
            walk(relPath);
            continue;
         }
         if (!entry.isFile()) continue;

         if (isMountFile(name)) continue;
         if (GEN_FILE_RE.test(name)) continue;
         if (VUE_EXT_RE.test(name)) {
            throw new SharedRoutesError(
               "UNSUPPORTED_FILE_TYPE",
               `.vue route files are not supported: ${path.join(sourceDir, relPath)}`,
            );
         }
         if (!ROUTE_EXT_RE.test(name)) continue; // css, md, assets, …

         const base = name.replace(ROUTE_EXT_RE, "");
         if (base === "__root" || base.startsWith("__root.")) {
            throw new SharedRoutesError(
               "ROOT_IN_SHARED_DIR",
               `a mounted subtree cannot contain a __root route file (a second root route cannot exist): ${path.join(sourceDir, relPath)}`,
            );
         }
         const segments = base.split(SPLIT_RE);
         const lastSegment = segments[segments.length - 1] ?? "";
         if (LEGACY_SUFFIXES.has(lastSegment)) {
            throw new SharedRoutesError(
               "LEGACY_SUFFIX",
               `the deprecated \`.${lastSegment}\` route-file suffix cannot be mounted (it does not export \`Route\`): ${path.join(sourceDir, relPath)}.\nMigrate it to the \`.lazy\` suffix instead.`,
            );
         }
         const content = readIfExists(path.join(fullDir, name));
         if (content !== undefined && isOwned(content)) continue;
         routeFiles.push({ relPath, lazy: lastSegment === "lazy" });
      }
   };

   walk("");
   routeFiles.sort((a, b) => a.relPath.localeCompare(b.relPath));
   return { routeFiles };
}
