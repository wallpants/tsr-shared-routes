import fs from "node:fs";
import path from "node:path";
import { isMountFile } from "./discover";
import { SharedRoutesError } from "./errors";

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
 * ordinary visible route directories; the only extra rule is that they must
 * not contain mount files (nested mounts are unsupported).
 */
export function scanSourceDir(sourceDir: string, options: ScanOptions): ScanResult {
   const { routeFileIgnorePrefix } = options;
   const routeFiles: Array<SourceRouteFile> = [];

   const walk = (relDir: string): void => {
      const fullDir = path.join(sourceDir, relDir);
      for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
         const name = entry.name;
         if (name.startsWith(".")) continue;
         if (routeFileIgnorePrefix !== "" && name.startsWith(routeFileIgnorePrefix)) continue;
         if (name === "node_modules") continue;
         const relPath = relDir === "" ? name : `${relDir}/${name}`;

         if (entry.isDirectory()) {
            walk(relPath);
            continue;
         }
         if (!entry.isFile()) continue;

         if (isMountFile(name)) {
            throw new SharedRoutesError(
               "NESTED_MOUNT_UNSUPPORTED",
               `mount files inside a mounted subtree are not supported: ${path.join(sourceDir, relPath)}. Move the mount file outside the mounted subtree.`,
            );
         }
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
         routeFiles.push({ relPath, lazy: lastSegment === "lazy" });
      }
   };

   walk("");
   routeFiles.sort((a, b) => a.relPath.localeCompare(b.relPath));
   return { routeFiles };
}
