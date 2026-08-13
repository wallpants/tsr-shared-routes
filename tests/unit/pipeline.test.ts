import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BANNER_SENTINEL } from "../../src/config";
import { SharedRoutesError } from "../../src/core/errors";
import { replaceRouteIdLiteral } from "../../src/core/fsio";
import { GITIGNORE_BLOCK_START } from "../../src/core/gitignore";
import { readManifest } from "../../src/core/manifest";
import { checkPipeline, runPipeline } from "../../src/core/pipeline";
import { exists, makeConfig, makeTmpDir, mountFileSource, readFile, writeTree } from "../helpers";

function makeFixture(): string {
  const root = makeTmpDir();
  writeTree(root, {
    "src/routes/inventory/providers.mount.ts": mountFileSource("../../shared/providers"),
    "src/routes/finances/providers.mount.ts": mountFileSource("../../shared/providers"),
    "src/shared/providers/index.tsx": "export const shared = {} as any\n",
    "src/shared/providers/$providerId.tsx": "export const shared = {} as any\n",
    "src/shared/providers/chart.lazy.tsx": "export const sharedLazy = {} as any\n",
    "src/shared/providers/-helpers.ts": "export const helper = 1\n",
    "src/shared/providers/notes.css": "body {}\n",
  });
  return root;
}

const WRAPPERS = [
  "src/routes/finances/providers/$providerId.tsx",
  "src/routes/finances/providers/chart.lazy.tsx",
  "src/routes/finances/providers/index.tsx",
  "src/routes/inventory/providers/$providerId.tsx",
  "src/routes/inventory/providers/chart.lazy.tsx",
  "src/routes/inventory/providers/index.tsx",
];

describe("runPipeline", () => {
  it("writes all wrappers with correct literals, banner, and imports", () => {
    const root = makeFixture();
    const summary = runPipeline(makeConfig(root));
    expect(summary.written).toEqual(WRAPPERS);
    expect(summary.adopted).toEqual([]);
    expect(summary.deleted).toEqual([]);
    expect(summary.unchanged).toBe(0);
    expect(summary.errors).toEqual([]);

    const index = readFile(path.join(root, "src/routes/inventory/providers/index.tsx"));
    expect(index.startsWith(BANNER_SENTINEL)).toBe(true);
    expect(index).toContain("createFileRoute('/inventory/providers/')");
    expect(index).toContain("import { shared } from '../../../shared/providers/index'");
    expect(index).toContain(
      "// source: src/shared/providers/index.tsx (mount: src/routes/inventory/providers.mount.ts)",
    );

    const lazy = readFile(path.join(root, "src/routes/finances/providers/chart.lazy.tsx"));
    expect(lazy).toContain("createLazyFileRoute('/finances/providers/chart')(sharedLazy)");
    expect(lazy).toContain("import { sharedLazy } from '../../../shared/providers/chart.lazy'");

    // ignored/helper files are not mirrored
    expect(exists(path.join(root, "src/routes/inventory/providers/-helpers.ts"))).toBe(false);
    expect(exists(path.join(root, "src/routes/inventory/providers/notes.css"))).toBe(false);

    const manifest = readManifest(path.join(root, ".tanstack/shared-routes/manifest.json"));
    expect(manifest).toBeDefined();
    expect(manifest!.files.map((f) => f.path).sort()).toEqual(WRAPPERS);
    expect(manifest!.dirs).toContain("src/routes/inventory/providers");
  });

  it("second run writes nothing", () => {
    const root = makeFixture();
    runPipeline(makeConfig(root));
    const before = WRAPPERS.map((w) => readFile(path.join(root, w)));

    const summary = runPipeline(makeConfig(root));
    expect(summary.written).toEqual([]);
    expect(summary.adopted).toEqual([]);
    expect(summary.deleted).toEqual([]);
    expect(summary.unchanged).toBe(WRAPPERS.length);
    expect(WRAPPERS.map((w) => readFile(path.join(root, w)))).toEqual(before);
  });

  it("adopts a generator-corrected literal without writing", () => {
    const root = makeFixture();
    runPipeline(makeConfig(root));

    // Simulate the stock generator rewriting the literal on disk.
    const wrapperPath = path.join(root, "src/routes/inventory/providers/index.tsx");
    const corrected = replaceRouteIdLiteral(
      readFile(wrapperPath),
      "/inventory/providers/corrected",
    );
    fs.writeFileSync(wrapperPath, corrected);

    const summary = runPipeline(makeConfig(root));
    expect(summary.adopted).toEqual(["src/routes/inventory/providers/index.tsx"]);
    expect(summary.written).toEqual([]);
    expect(readFile(wrapperPath)).toBe(corrected); // untouched: generator is the authority
  });

  it("cleans up wrappers when their shared file disappears", () => {
    const root = makeFixture();
    runPipeline(makeConfig(root));

    fs.rmSync(path.join(root, "src/shared/providers/$providerId.tsx"));
    const summary = runPipeline(makeConfig(root));
    expect(summary.deleted).toEqual([
      "src/routes/finances/providers/$providerId.tsx",
      "src/routes/inventory/providers/$providerId.tsx",
    ]);
    expect(exists(path.join(root, "src/routes/inventory/providers/$providerId.tsx"))).toBe(false);
    expect(exists(path.join(root, "src/routes/inventory/providers/index.tsx"))).toBe(true);
  });

  it("cleans up everything when a mount is removed, pruning its dir", () => {
    const root = makeFixture();
    runPipeline(makeConfig(root));

    fs.rmSync(path.join(root, "src/routes/finances/providers.mount.ts"));
    const summary = runPipeline(makeConfig(root));
    expect(summary.deleted).toEqual([
      "src/routes/finances/providers/$providerId.tsx",
      "src/routes/finances/providers/chart.lazy.tsx",
      "src/routes/finances/providers/index.tsx",
    ]);
    expect(exists(path.join(root, "src/routes/finances/providers"))).toBe(false);
    expect(exists(path.join(root, "src/routes/finances"))).toBe(true);
  });

  it("survives a lost manifest via banner scan", () => {
    const root = makeFixture();
    runPipeline(makeConfig(root));
    fs.rmSync(path.join(root, ".tanstack"), { recursive: true });
    fs.rmSync(path.join(root, "src/shared/providers/chart.lazy.tsx"));

    const summary = runPipeline(makeConfig(root));
    expect(summary.deleted).toEqual([
      "src/routes/finances/providers/chart.lazy.tsx",
      "src/routes/inventory/providers/chart.lazy.tsx",
    ]);
  });

  it("refuses to overwrite an unowned target file, writing nothing at all", () => {
    const root = makeFixture();
    const userFile = path.join(root, "src/routes/inventory/providers/index.tsx");
    writeTree(root, { "src/routes/inventory/providers/index.tsx": "// my own route\n" });

    let error: unknown;
    try {
      runPipeline(makeConfig(root));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(SharedRoutesError);
    expect((error as SharedRoutesError).code).toBe("UNOWNED_TARGET_FILE");
    expect((error as SharedRoutesError).message).toContain("providers.mount.ts");

    // No wrapper was written anywhere and the user file is untouched.
    expect(readFile(userFile)).toBe("// my own route\n");
    expect(exists(path.join(root, "src/routes/finances/providers"))).toBe(false);
    expect(exists(path.join(root, "src/routes/inventory/providers/$providerId.tsx"))).toBe(false);
  });

  it("check mode reports pending work without touching the filesystem", () => {
    const root = makeFixture();
    const summary = checkPipeline(makeConfig(root));
    expect(summary.written).toEqual(WRAPPERS);
    for (const wrapper of WRAPPERS) {
      expect(exists(path.join(root, wrapper))).toBe(false);
    }
    expect(exists(path.join(root, ".tanstack"))).toBe(false);

    // After a real run, check mode reports a clean state.
    runPipeline(makeConfig(root));
    const clean = checkPipeline(makeConfig(root));
    expect(clean.written).toEqual([]);
    expect(clean.deleted).toEqual([]);
    expect(clean.unchanged).toBe(WRAPPERS.length);
  });

  it("check mode reports pending deletions without deleting", () => {
    const root = makeFixture();
    runPipeline(makeConfig(root));
    fs.rmSync(path.join(root, "src/shared/providers/index.tsx"));

    const summary = checkPipeline(makeConfig(root));
    expect(summary.deleted).toEqual([
      "src/routes/finances/providers/index.tsx",
      "src/routes/inventory/providers/index.tsx",
    ]);
    expect(exists(path.join(root, "src/routes/inventory/providers/index.tsx"))).toBe(true);
  });

  it("maintains the managed .gitignore block when enabled, removes it when disabled", () => {
    const root = makeFixture();
    runPipeline(makeConfig(root, { gitignore: true }));
    const gitignore = readFile(path.join(root, ".gitignore"));
    expect(gitignore).toContain(GITIGNORE_BLOCK_START);
    expect(gitignore).toContain("src/routes/inventory/providers/");
    expect(gitignore).toContain("src/routes/finances/providers/");
    expect(gitignore).toContain("src/shared/providers/**/*.gen.*");

    runPipeline(makeConfig(root, { gitignore: false }));
    expect(readFile(path.join(root, ".gitignore"))).not.toContain(GITIGNORE_BLOCK_START);
  });

  it("expands nested mounts end-to-end", () => {
    const root = makeFixture();
    writeTree(root, {
      "src/shared/providers/reviews.mount.ts": mountFileSource("../reviews"),
      "src/shared/reviews/$reviewId.tsx": "export const shared = {} as any\n",
    });
    runPipeline(makeConfig(root));
    const nested = readFile(
      path.join(root, "src/routes/inventory/providers/reviews/$reviewId.tsx"),
    );
    expect(nested).toContain("createFileRoute('/inventory/providers/reviews/$reviewId')");
    expect(nested).toContain("import { shared } from '../../../../shared/reviews/$reviewId'");
  });

  it("runs cleanly on a project with no mounts", () => {
    const root = makeTmpDir();
    writeTree(root, { "src/routes/index.tsx": "export {}\n" });
    const summary = runPipeline(makeConfig(root));
    expect(summary).toEqual({
      written: [],
      adopted: [],
      deleted: [],
      unchanged: 0,
      errors: [],
      sharedRoots: [],
      targetDirs: [],
    });
  });
});
