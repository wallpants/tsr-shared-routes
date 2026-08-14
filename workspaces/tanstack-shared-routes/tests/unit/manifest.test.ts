import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_BANNER } from "../../src/config";
import { maskedHash } from "../../src/core/fsio";
import type { Manifest } from "../../src/core/manifest";
import { bannerScan, cleanupStale, readManifest, writeManifest } from "../../src/core/manifest";
import { exists, makeTmpDir, readFile, writeTree } from "../helpers";

const OWNED = `${DEFAULT_BANNER}\n// source: x\nexport const Route = {}\n`;
const UNOWNED = `export const Route = {}\n`;

function manifestFor(root: string, files: Array<string>, dirs: Array<string>): Manifest {
  return {
    version: 1,
    files: files.map((file) => ({ path: file, role: "wrapper", hash: maskedHash(OWNED) })),
    dirs,
  };
}

describe("readManifest / writeManifest", () => {
  it("round-trips atomically", () => {
    const root = makeTmpDir();
    const manifestPath = path.join(root, ".tanstack", "shared-routes", "manifest.json");
    const manifest = manifestFor(root, ["src/routes/a/index.tsx"], ["src/routes/a"]);
    writeManifest(manifestPath, manifest);
    expect(readManifest(manifestPath)).toEqual(manifest);
  });

  it("returns undefined for missing, corrupt, or wrong-shape manifests", () => {
    const root = makeTmpDir();
    expect(readManifest(path.join(root, "missing.json"))).toBeUndefined();
    writeTree(root, {
      "corrupt.json": "not json {",
      "wrong-version.json": JSON.stringify({ version: 2, files: [], dirs: [] }),
      "wrong-shape.json": JSON.stringify({ version: 1, files: "x", dirs: [] }),
    });
    expect(readManifest(path.join(root, "corrupt.json"))).toBeUndefined();
    expect(readManifest(path.join(root, "wrong-version.json"))).toBeUndefined();
    expect(readManifest(path.join(root, "wrong-shape.json"))).toBeUndefined();
  });
});

describe("bannerScan", () => {
  it("collects only banner-owned files, skipping dot-files", () => {
    const root = makeTmpDir();
    writeTree(root, {
      "a/owned.tsx": OWNED,
      "a/deep/owned2.tsx": OWNED,
      "a/user.tsx": UNOWNED,
      "a/.tmp-file": OWNED,
    });
    expect(bannerScan([path.join(root, "a")]).sort()).toEqual([
      path.join(root, "a", "deep", "owned2.tsx"),
      path.join(root, "a", "owned.tsx"),
    ]);
  });

  it("tolerates missing dirs", () => {
    expect(bannerScan([path.join(makeTmpDir(), "nope")])).toEqual([]);
  });
});

describe("cleanupStale", () => {
  it("deletes stale owned files and prunes empty dirs", () => {
    const root = makeTmpDir();
    const targetDir = path.join(root, "src", "routes", "a");
    writeTree(root, {
      "src/routes/a/keep.tsx": OWNED,
      "src/routes/a/stale.tsx": OWNED,
      "src/routes/a/sub/stale2.tsx": OWNED,
    });
    const manifest = manifestFor(
      root,
      ["src/routes/a/keep.tsx", "src/routes/a/stale.tsx", "src/routes/a/sub/stale2.tsx"],
      ["src/routes/a", "src/routes/a/sub"],
    );
    const { deleted } = cleanupStale({
      root,
      manifest,
      currentTargetDirs: [targetDir],
      desiredPaths: new Set([path.join(targetDir, "keep.tsx")]),
    });
    expect(deleted).toEqual([
      path.join(targetDir, "stale.tsx"),
      path.join(targetDir, "sub", "stale2.tsx"),
    ]);
    expect(exists(path.join(targetDir, "keep.tsx"))).toBe(true);
    expect(exists(path.join(targetDir, "stale.tsx"))).toBe(false);
    expect(exists(path.join(targetDir, "sub"))).toBe(false);
    expect(exists(targetDir)).toBe(true);
  });

  it("removes a whole target dir once no files are desired in it", () => {
    const root = makeTmpDir();
    const targetDir = path.join(root, "src", "routes", "a");
    writeTree(root, { "src/routes/a/stale.tsx": OWNED });
    cleanupStale({
      root,
      manifest: manifestFor(root, ["src/routes/a/stale.tsx"], ["src/routes/a"]),
      currentTargetDirs: [],
      desiredPaths: new Set(),
    });
    expect(exists(targetDir)).toBe(false);
    expect(exists(path.join(root, "src", "routes"))).toBe(true);
  });

  it("never deletes files without the banner, even when listed in the manifest", () => {
    const root = makeTmpDir();
    writeTree(root, { "src/routes/a/user.tsx": UNOWNED });
    const { deleted } = cleanupStale({
      root,
      manifest: manifestFor(root, ["src/routes/a/user.tsx"], ["src/routes/a"]),
      currentTargetDirs: [],
      desiredPaths: new Set(),
    });
    expect(deleted).toEqual([]);
    expect(readFile(path.join(root, "src", "routes", "a", "user.tsx"))).toBe(UNOWNED);
    // dir survives because it still holds the user file
    expect(exists(path.join(root, "src", "routes", "a"))).toBe(true);
  });

  it("handles a lost manifest via banner scan of current target dirs", () => {
    const root = makeTmpDir();
    const targetDir = path.join(root, "src", "routes", "a");
    writeTree(root, {
      "src/routes/a/stale.tsx": OWNED,
      "src/routes/a/user.tsx": UNOWNED,
    });
    const { deleted } = cleanupStale({
      root,
      manifest: undefined,
      currentTargetDirs: [targetDir],
      desiredPaths: new Set(),
    });
    expect(deleted).toEqual([path.join(targetDir, "stale.tsx")]);
    expect(exists(path.join(targetDir, "user.tsx"))).toBe(true);
  });

  it("dryRun reports deletions without touching the filesystem", () => {
    const root = makeTmpDir();
    const targetDir = path.join(root, "src", "routes", "a");
    writeTree(root, { "src/routes/a/stale.tsx": OWNED });
    const { deleted } = cleanupStale({
      root,
      manifest: undefined,
      currentTargetDirs: [targetDir],
      desiredPaths: new Set(),
      dryRun: true,
    });
    expect(deleted).toEqual([path.join(targetDir, "stale.tsx")]);
    expect(exists(path.join(targetDir, "stale.tsx"))).toBe(true);
  });

  it("tolerates manifest entries whose files are already gone", () => {
    const root = makeTmpDir();
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    const { deleted } = cleanupStale({
      root,
      manifest: manifestFor(root, ["src/routes/a/gone.tsx"], ["src/routes/a"]),
      currentTargetDirs: [],
      desiredPaths: new Set(),
    });
    expect(deleted).toEqual([]);
  });
});
