import { Generator, getConfig } from "@tanstack/router-generator";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { replaceRouteIdLiteral } from "../../src/core/fsio";
import { runPipeline } from "../../src/core/pipeline";
import { exists, makeConfig, makeTmpDir, mountFileSource, readFile, writeTree } from "../helpers";

/**
 * Integration suite: our pipeline emits wrappers, then the REAL
 * @tanstack/router-generator processes them. Steady state must be: generator
 * modifies zero wrapper files, both tools are idempotent, and literal
 * corrections flow generator → pipeline (adoption), never the other way.
 */

const SHARED = "export const shared = {} as any\n";
const SHARED_LAZY = "export const sharedLazy = {} as any\n";

/**
 * Fixture: routes dir with __root + two normal routes; one shared dir with an
 * index, a $param, a dot-flat name, and a .lazy pair; mounted at two points
 * (one plain dir mount, one dot-flat mount).
 */
function makeProject(): string {
  const root = makeTmpDir();
  writeTree(root, {
    "src/routes/__root.tsx": [
      "import { createRootRoute } from '@tanstack/react-router'",
      "export const Route = createRootRoute({})",
      "",
    ].join("\n"),
    "src/routes/index.tsx": [
      "import { createFileRoute } from '@tanstack/react-router'",
      "export const Route = createFileRoute('/')({})",
      "",
    ].join("\n"),
    "src/routes/about.tsx": [
      "import { createFileRoute } from '@tanstack/react-router'",
      "export const Route = createFileRoute('/about')({})",
      "",
    ].join("\n"),
    "src/routes/inventory/providers.mount.ts": mountFileSource("../../shared/providers"),
    "src/routes/admin.providers.mount.ts": mountFileSource("../shared/providers"),
    "src/shared/providers/index.tsx": SHARED,
    "src/shared/providers/$providerId.tsx": SHARED,
    "src/shared/providers/stats.overview.tsx": SHARED,
    "src/shared/providers/chart.tsx": SHARED,
    "src/shared/providers/chart.lazy.tsx": SHARED_LAZY,
    "src/shared/providers/-helpers.ts": "export const helper = 1\n",
  });
  return root;
}

const WRAPPERS = [
  "src/routes/admin.providers/$providerId.tsx",
  "src/routes/admin.providers/chart.lazy.tsx",
  "src/routes/admin.providers/chart.tsx",
  "src/routes/admin.providers/index.tsx",
  "src/routes/admin.providers/stats.overview.tsx",
  "src/routes/inventory/providers/$providerId.tsx",
  "src/routes/inventory/providers/chart.lazy.tsx",
  "src/routes/inventory/providers/chart.tsx",
  "src/routes/inventory/providers/index.tsx",
  "src/routes/inventory/providers/stats.overview.tsx",
];

// `.gen.tsx` typed-helper siblings, route files only (chart.lazy pairs with
// chart.tsx, whose helper covers both).
const HELPERS = [
  "src/shared/providers/$providerId.gen.tsx",
  "src/shared/providers/__shared-routes.gen.tsx",
  "src/shared/providers/chart.gen.tsx",
  "src/shared/providers/index.gen.tsx",
  "src/shared/providers/stats.overview.gen.tsx",
];

const GENERATED = [...WRAPPERS, ...HELPERS];

async function runGenerator(root: string): Promise<void> {
  const config = getConfig(
    {
      target: "react",
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
      routeFileIgnorePattern: "\\.mount\\.(ts|js)$",
      disableLogging: true,
    },
    root,
  );
  await new Generator({ config, root }).run();
}

/** Root-relative posix path → content, for every path in `relPaths` that exists. */
function contentMap(root: string, relPaths: Array<string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const relPath of relPaths) {
    const abs = path.join(root, ...relPath.split("/"));
    if (fs.existsSync(abs)) map.set(relPath, fs.readFileSync(abs, "utf8"));
  }
  return map;
}

function routeTree(root: string): string {
  return readFile(path.join(root, "src/routeTree.gen.ts"));
}

describe("pipeline + real Generator", () => {
  it("emits wrappers the generator accepts verbatim, and both tools are idempotent", async () => {
    const root = makeProject();

    // 1. Pipeline writes exactly the expected wrapper + helper set.
    const summary = runPipeline(makeConfig(root));
    expect(summary.written).toEqual(GENERATED);
    expect(summary.deleted).toEqual([]);
    expect(summary.errors).toEqual([]);
    for (const helper of HELPERS) {
      expect(exists(path.join(root, ...helper.split("/")))).toBe(true);
    }

    // 2. Real generator run: builds the tree, modifies ZERO wrapper files.
    const before = contentMap(root, WRAPPERS);
    expect([...before.keys()]).toEqual(WRAPPERS);
    await runGenerator(root);
    const after = contentMap(root, WRAPPERS);
    expect(after).toEqual(before);

    // 3. The tree contains both mounts' route ids (incl. dot-flat + lazy + index).
    const tree = routeTree(root);
    for (const id of [
      "'/inventory/providers/'",
      "'/inventory/providers/$providerId'",
      "'/inventory/providers/stats/overview'",
      "'/inventory/providers/chart'",
      "'/admin/providers/'",
      "'/admin/providers/$providerId'",
      "'/admin/providers/stats/overview'",
      "'/admin/providers/chart'",
      "'/about'",
    ]) {
      expect(tree).toContain(id);
    }

    // 4. Second pipeline run: nothing to do.
    const second = runPipeline(makeConfig(root));
    expect(second.written).toEqual([]);
    expect(second.adopted).toEqual([]);
    expect(second.deleted).toEqual([]);
    expect(second.unchanged).toBe(GENERATED.length);

    // 5. Second generator run: tree byte-stable.
    await runGenerator(root);
    expect(routeTree(root)).toBe(tree);
  });

  it("deleting a shared route file removes both wrappers and drops the routes from the tree", async () => {
    const root = makeProject();
    runPipeline(makeConfig(root));
    await runGenerator(root);
    expect(routeTree(root)).toContain("'/inventory/providers/$providerId'");

    fs.rmSync(path.join(root, "src/shared/providers/$providerId.tsx"));
    const summary = runPipeline(makeConfig(root));
    expect(summary.deleted).toEqual([
      "src/routes/admin.providers/$providerId.tsx",
      "src/routes/inventory/providers/$providerId.tsx",
      "src/shared/providers/$providerId.gen.tsx",
    ]);

    await runGenerator(root);
    const tree = routeTree(root);
    expect(tree).not.toContain("'/inventory/providers/$providerId'");
    expect(tree).not.toContain("'/admin/providers/$providerId'");
    expect(tree).toContain("'/inventory/providers/'");
  });

  it("expands a nested mount added later and the generator picks it up", async () => {
    const root = makeProject();
    runPipeline(makeConfig(root));
    await runGenerator(root);

    writeTree(root, {
      "src/shared/providers/reviews.mount.ts": mountFileSource("../reviews"),
      "src/shared/reviews/index.tsx": SHARED,
      "src/shared/reviews/$reviewId.tsx": SHARED,
    });
    const summary = runPipeline(makeConfig(root));
    expect(summary.written).toEqual([
      "src/routes/admin.providers/reviews/$reviewId.tsx",
      "src/routes/admin.providers/reviews/index.tsx",
      "src/routes/inventory/providers/reviews/$reviewId.tsx",
      "src/routes/inventory/providers/reviews/index.tsx",
      "src/shared/reviews/$reviewId.gen.tsx",
      "src/shared/reviews/__shared-routes.gen.tsx",
      "src/shared/reviews/index.gen.tsx",
    ]);

    const nestedWrappers = [...WRAPPERS, ...summary.written];
    const before = contentMap(root, nestedWrappers);
    await runGenerator(root);
    expect(contentMap(root, nestedWrappers)).toEqual(before);

    const tree = routeTree(root);
    expect(tree).toContain("'/inventory/providers/reviews/$reviewId'");
    expect(tree).toContain("'/admin/providers/reviews/$reviewId'");
  });

  it("hand-corrupted literal: pipeline adopts, generator fixes on disk, no write war", async () => {
    const root = makeProject();
    runPipeline(makeConfig(root));
    await runGenerator(root);

    const wrapperRel = "src/routes/inventory/providers/stats.overview.tsx";
    const wrapperAbs = path.join(root, ...wrapperRel.split("/"));
    const original = readFile(wrapperAbs);
    const corrupted = replaceRouteIdLiteral(original, "/totally/wrong");
    expect(corrupted).not.toBe(original);
    fs.writeFileSync(wrapperAbs, corrupted);

    // Pipeline treats the on-disk literal as generator authority: ADOPT, no write.
    const adopting = runPipeline(makeConfig(root));
    expect(adopting.adopted).toEqual([wrapperRel]);
    expect(adopting.written).toEqual([]);
    expect(readFile(wrapperAbs)).toBe(corrupted);

    // Generator corrects the literal on disk.
    await runGenerator(root);
    expect(readFile(wrapperAbs)).toBe(original);

    // Further rounds are fully stable: no write war.
    const settled = runPipeline(makeConfig(root));
    expect(settled.written).toEqual([]);
    expect(settled.adopted).toEqual([]);
    const stable = contentMap(root, WRAPPERS);
    const treeBefore = routeTree(root);
    await runGenerator(root);
    runPipeline(makeConfig(root));
    expect(contentMap(root, WRAPPERS)).toEqual(stable);
    expect(routeTree(root)).toBe(treeBefore);
  });

  it("colocated -shared dir: generator ignores the originals, wrappers carry the routes", async () => {
    const root = makeTmpDir();
    writeTree(root, {
      "src/routes/__root.tsx": [
        "import { createRootRoute } from '@tanstack/react-router'",
        "export const Route = createRootRoute({})",
        "",
      ].join("\n"),
      "src/routes/index.tsx": [
        "import { createFileRoute } from '@tanstack/react-router'",
        "export const Route = createFileRoute('/')({})",
        "",
      ].join("\n"),
      "src/routes/inventory/providers.mount.ts": mountFileSource("./-shared/providers"),
      "src/routes/inventory/-shared/providers/index.tsx": SHARED,
      "src/routes/inventory/-shared/providers/$providerId.tsx": SHARED,
    });

    const summary = runPipeline(makeConfig(root));
    expect(summary.written).toEqual([
      "src/routes/inventory/-shared/providers/$providerId.gen.tsx",
      "src/routes/inventory/-shared/providers/__shared-routes.gen.tsx",
      "src/routes/inventory/-shared/providers/index.gen.tsx",
      "src/routes/inventory/providers/$providerId.tsx",
      "src/routes/inventory/providers/index.tsx",
    ]);

    const wrappers = summary.written;
    const before = contentMap(root, wrappers);
    await runGenerator(root);
    expect(contentMap(root, wrappers)).toEqual(before);

    const tree = routeTree(root);
    expect(tree).toContain("'/inventory/providers/'");
    expect(tree).toContain("'/inventory/providers/$providerId'");
    // The colocated originals are invisible to the generator.
    expect(tree).not.toContain("-shared");

    // Wrapper imports reach back into the colocated shared dir.
    const wrapper = readFile(path.join(root, "src/routes/inventory/providers/index.tsx"));
    expect(wrapper).toContain("from '../-shared/providers/index'");

    // Steady state holds here too.
    const second = runPipeline(makeConfig(root));
    expect(second.written).toEqual([]);
    expect(second.unchanged).toBe(5);
  });

  it("removing a mount cleans its wrappers and the generator drops the whole subtree", async () => {
    const root = makeProject();
    runPipeline(makeConfig(root));
    await runGenerator(root);

    fs.rmSync(path.join(root, "src/routes/admin.providers.mount.ts"));
    const summary = runPipeline(makeConfig(root));
    expect(summary.deleted).toEqual([
      "src/routes/admin.providers/$providerId.tsx",
      "src/routes/admin.providers/chart.lazy.tsx",
      "src/routes/admin.providers/chart.tsx",
      "src/routes/admin.providers/index.tsx",
      "src/routes/admin.providers/stats.overview.tsx",
    ]);
    expect(exists(path.join(root, "src/routes/admin.providers"))).toBe(false);

    await runGenerator(root);
    const tree = routeTree(root);
    expect(tree).not.toContain("'/admin/providers/'");
    expect(tree).toContain("'/inventory/providers/'");
  });
});
