import fs from "node:fs";
import path from "node:path";
import { isMountFile } from "./discover";
import { SharedRoutesError } from "./errors";

/** Stock route-file extensions, minus `.vue` (unsupported in v1, hard error). */
const ROUTE_EXT_RE = /\.(tsx|ts|jsx|js)$/;
const VUE_EXT_RE = /\.vue$/;
/** Our own generated helper siblings — never mirrored. */
const GEN_FILE_RE = /\.gen\.(t|j)sx?$/;
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

export interface SharedRouteFile {
  /** Path relative to the shared dir, posix separators. */
  relPath: string;
  /** True when the file base name ends with `.lazy` (before the extension). */
  lazy: boolean;
}

export interface NestedMount {
  /** Absolute path of the nested `*.mount.ts` file inside the shared dir. */
  mountFilePath: string;
  /** Target dir relative to the OUTER mount's target dir, posix (mount path minus `.mount.ts`). */
  relTargetDir: string;
}

export interface ScanResult {
  routeFiles: Array<SharedRouteFile>;
  nestedMounts: Array<NestedMount>;
}

export interface ScanOptions {
  /** Names starting with this prefix are skipped (stock default `-`). */
  routeFileIgnorePrefix: string;
}

/**
 * Scans a shared directory recursively, classifying entries exactly like the
 * stock generator's physical scan would classify their mirrored wrappers.
 */
export function scanSharedDir(sharedDir: string, options: ScanOptions): ScanResult {
  const { routeFileIgnorePrefix } = options;
  const routeFiles: Array<SharedRouteFile> = [];
  const nestedMounts: Array<NestedMount> = [];

  const walk = (relDir: string): void => {
    const fullDir = path.join(sharedDir, relDir);
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
        nestedMounts.push({
          mountFilePath: path.join(sharedDir, relPath),
          relTargetDir: relPath.replace(/\.mount\.(t|j)s$/, ""),
        });
        continue;
      }
      if (GEN_FILE_RE.test(name)) continue;
      if (VUE_EXT_RE.test(name)) {
        throw new SharedRoutesError(
          "UNSUPPORTED_FILE_TYPE",
          `.vue route files are not supported: ${path.join(sharedDir, relPath)}`,
        );
      }
      if (!ROUTE_EXT_RE.test(name)) continue; // css, md, assets, …

      const base = name.replace(ROUTE_EXT_RE, "");
      if (base === "__root" || base.startsWith("__root.")) {
        throw new SharedRoutesError(
          "ROOT_IN_SHARED_DIR",
          `a shared directory cannot contain a __root route file (a second root route cannot exist): ${path.join(sharedDir, relPath)}`,
        );
      }
      const segments = base.split(SPLIT_RE);
      const lastSegment = segments[segments.length - 1] ?? "";
      if (LEGACY_SUFFIXES.has(lastSegment)) {
        throw new SharedRoutesError(
          "LEGACY_SUFFIX",
          `the deprecated \`.${lastSegment}\` route-file suffix cannot be mounted (it does not export \`Route\`): ${path.join(sharedDir, relPath)}.\nMigrate it to the \`.lazy\` suffix instead.`,
        );
      }
      routeFiles.push({ relPath, lazy: lastSegment === "lazy" });
    }
  };

  walk("");
  routeFiles.sort((a, b) => a.relPath.localeCompare(b.relPath));
  nestedMounts.sort((a, b) => a.relTargetDir.localeCompare(b.relTargetDir));
  return { routeFiles, nestedMounts };
}
