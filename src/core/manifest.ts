import fs from "node:fs";
import path from "node:path";
import { atomicWrite, isOwned, readIfExists } from "./fsio";

export interface ManifestFileEntry {
  /** Root-relative posix path of the generated file. */
  path: string;
  role: "wrapper" | "helper";
  /** Root-relative posix path of the responsible mount file. */
  mount?: string;
  /** Root-relative posix path of the shared source file. */
  source?: string;
  /** sha256 of the content with the route-id literal masked. */
  hash: string;
}

export interface Manifest {
  version: 1;
  files: Array<ManifestFileEntry>;
  /** Root-relative posix paths of directories created by this tool. */
  dirs: Array<string>;
}

export function emptyManifest(): Manifest {
  return { version: 1, files: [], dirs: [] };
}

/**
 * Reads the manifest. A missing, unreadable, or structurally invalid manifest
 * returns `undefined` — the manifest is a cache, never a source of truth
 * (banner scanning covers a lost manifest).
 */
export function readManifest(manifestPath: string): Manifest | undefined {
  const raw = readIfExists(manifestPath);
  if (raw === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as { version?: unknown }).version !== 1 ||
      !Array.isArray((parsed as { files?: unknown }).files) ||
      !Array.isArray((parsed as { dirs?: unknown }).dirs)
    ) {
      return undefined;
    }
    return parsed as Manifest;
  } catch {
    return undefined;
  }
}

export function writeManifest(manifestPath: string, manifest: Manifest): void {
  atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Recursively collects files under `dirs` whose content starts with the banner sentinel. */
export function bannerScan(dirs: Array<string>): Array<string> {
  const owned: Array<string> = [];
  const walk = (dir: string): void => {
    let entries: Array<fs.Dirent>;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // dir vanished or is unreadable — nothing to scan
    }
    for (const entry of entries) {
      if (entry.name === "node_modules") continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile() && !entry.name.startsWith(".")) {
        const content = readIfExists(fullPath);
        if (content !== undefined && isOwned(content)) owned.push(fullPath);
      }
    }
  };
  for (const dir of dirs) walk(dir);
  return owned;
}

export interface CleanupOptions {
  /** Absolute project root manifest paths resolve against. */
  root: string;
  /** Previous manifest, if any (lost manifest → banner scan still cleans). */
  manifest: Manifest | undefined;
  /** Absolute paths of the current run's target dirs. */
  currentTargetDirs: Array<string>;
  /**
   * Additional dirs banner-scanned for stale generated files (e.g. shared
   * roots holding `.gen` helpers) but NEVER pruned — not created by this tool.
   */
  extraScanDirs?: Array<string>;
  /** Absolute paths of every file the current run wants on disk. */
  desiredPaths: Set<string>;
  /** When true, report what would be deleted without touching the FS. */
  dryRun?: boolean;
}

export interface CleanupResult {
  /** Absolute paths of deleted (or would-be deleted) files. */
  deleted: Array<string>;
}

/**
 * Deletes generated files that are no longer desired.
 *
 * stale = (manifest files ∪ banner-scan of known target dirs) − desired.
 * A file is only ever unlinked after re-reading it at unlink time and
 * confirming the ownership banner — a lost manifest or a user file sitting at
 * a recorded path is never deleted. Afterwards, directories we created are
 * pruned bottom-up when empty.
 */
export function cleanupStale(options: CleanupOptions): CleanupResult {
  const {
    root,
    manifest,
    currentTargetDirs,
    extraScanDirs = [],
    desiredPaths,
    dryRun = false,
  } = options;

  const manifestDirs = (manifest?.dirs ?? []).map((dir) => path.resolve(root, dir));
  const knownDirs = [...new Set([...manifestDirs, ...currentTargetDirs])];

  const candidates = new Set<string>(bannerScan([...new Set([...knownDirs, ...extraScanDirs])]));
  for (const entry of manifest?.files ?? []) {
    candidates.add(path.resolve(root, entry.path));
  }

  const deleted: Array<string> = [];
  for (const candidate of candidates) {
    if (desiredPaths.has(candidate)) continue;
    // Re-confirm ownership at unlink time; never delete a file we do not own.
    const content = readIfExists(candidate);
    if (content === undefined || !isOwned(content)) continue;
    deleted.push(candidate);
    if (!dryRun) fs.rmSync(candidate, { force: true });
  }

  if (!dryRun) pruneEmptyDirs(knownDirs, desiredPaths);

  deleted.sort();
  return { deleted };
}

/**
 * Removes now-empty directories among the ones this tool created: every known
 * target dir plus its subdirectories, deepest first. `rmdir` is only applied
 * to empty dirs, so a dir holding any user (or still-desired) file survives.
 */
function pruneEmptyDirs(knownDirs: Array<string>, desiredPaths: Set<string>): void {
  const allDirs = new Set<string>();
  const collect = (dir: string): void => {
    let entries: Array<fs.Dirent>;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    allDirs.add(dir);
    for (const entry of entries) {
      if (entry.isDirectory()) collect(path.join(dir, entry.name));
    }
  };
  for (const dir of knownDirs) collect(dir);

  const desiredDirs = new Set<string>();
  for (const filePath of desiredPaths) {
    let dir = path.dirname(filePath);
    while (!desiredDirs.has(dir) && dir !== path.dirname(dir)) {
      desiredDirs.add(dir);
      dir = path.dirname(dir);
    }
  }

  const byDepthDesc = [...allDirs].sort((a, b) => b.length - a.length);
  for (const dir of byDepthDesc) {
    if (desiredDirs.has(dir)) continue;
    try {
      fs.rmdirSync(dir); // fails unless empty — exactly what we want
    } catch {
      // not empty or already gone: keep it
    }
  }
}
