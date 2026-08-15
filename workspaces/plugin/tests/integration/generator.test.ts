import fs from "node:fs";
import path from "node:path";
import { Generator, getConfig } from "@tanstack/router-generator";
import { describe, expect, it } from "vitest";
import { replaceRouteIdLiteral } from "../../src/core/fsio";
import { runPipeline } from "../../src/core/pipeline";
import {
   exists,
   makeConfig,
   makeTmpDir,
   mountFileSource,
   readFile,
   stockLazyRouteSource,
   stockRouteSource,
   writeTree,
} from "../helpers";

/**
 * Integration suite: our pipeline emits wrappers + `.gen` siblings over PLAIN
 * STOCK source route files, then the REAL @tanstack/router-generator
 * processes the whole routes dir (sources AND wrappers — the sources are real
 * routes, that is the point of the design). Steady state must be: generator
 * modifies zero generated or source files, `.gen` siblings and mount files
 * are invisible to it (routeFileIgnorePattern via tsr.config.json), both
 * tools are idempotent, and literal corrections flow generator → pipeline
 * (adoption), never the other way.
 */

/**
 * Fixture: routes dir with __root + index; a /help source subtree with a
 * layout (route.tsx), a $param, a dot-flat name, and a .lazy pair; mounted at
 * two points (one plain dir mount, one dot-flat mount).
 */
function makeProject(): string {
   const root = makeTmpDir();
   writeTree(root, {
      "src/routes/__root.tsx": [
         "import { createRootRoute } from '@tanstack/react-router'",
         "export const Route = createRootRoute({})",
         "",
      ].join("\n"),
      "src/routes/index.tsx": stockRouteSource("/"),
      "src/routes/help/route.tsx": stockRouteSource("/help"),
      "src/routes/help/$topicId.tsx": stockRouteSource("/help/$topicId"),
      "src/routes/help/stats.overview.tsx": stockRouteSource("/help/stats/overview"),
      "src/routes/help/chart.tsx": stockRouteSource("/help/chart"),
      "src/routes/help/chart.lazy.tsx": stockLazyRouteSource("/help/chart"),
      "src/routes/help/-notes.ts": "export const notes = 1\n",
      "src/routes/inventory/help.mount.ts": mountFileSource("../help"),
      "src/routes/admin.help.mount.ts": mountFileSource("./help"),
   });
   return root;
}

const SOURCES = [
   "src/routes/help/$topicId.tsx",
   "src/routes/help/chart.lazy.tsx",
   "src/routes/help/chart.tsx",
   "src/routes/help/route.tsx",
   "src/routes/help/stats.overview.tsx",
];

const WRAPPERS = [
   "src/routes/admin.help/$topicId.tsx",
   "src/routes/admin.help/chart.lazy.tsx",
   "src/routes/admin.help/chart.tsx",
   "src/routes/admin.help/route.tsx",
   "src/routes/admin.help/stats.overview.tsx",
   "src/routes/inventory/help/$topicId.tsx",
   "src/routes/inventory/help/chart.lazy.tsx",
   "src/routes/inventory/help/chart.tsx",
   "src/routes/inventory/help/route.tsx",
   "src/routes/inventory/help/stats.overview.tsx",
];

// `.gen.tsx` union-view siblings, route files only (chart.lazy pairs with
// chart.tsx, whose sibling covers both).
const HELPERS = [
   "src/routes/help/$topicId.gen.tsx",
   "src/routes/help/chart.gen.tsx",
   "src/routes/help/route.gen.tsx",
   "src/routes/help/stats.overview.gen.tsx",
];
const RUNTIME = "src/sharedRoutes.gen.ts";

const GENERATED = [
   "src/routes/admin.help/$topicId.tsx",
   "src/routes/admin.help/chart.lazy.tsx",
   "src/routes/admin.help/chart.tsx",
   "src/routes/admin.help/route.tsx",
   "src/routes/admin.help/stats.overview.tsx",
   ...HELPERS,
   "src/routes/inventory/help/$topicId.tsx",
   "src/routes/inventory/help/chart.lazy.tsx",
   "src/routes/inventory/help/chart.tsx",
   "src/routes/inventory/help/route.tsx",
   "src/routes/inventory/help/stats.overview.tsx",
   RUNTIME,
];

async function runGenerator(root: string): Promise<void> {
   // No inline routeFileIgnorePattern: the pipeline maintains it in
   // tsr.config.json, which getConfig merges in — exercised here.
   const config = getConfig(
      {
         target: "react",
         routesDirectory: "./src/routes",
         generatedRouteTree: "./src/routeTree.gen.ts",
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

      // 1. Pipeline writes exactly the expected wrapper + sibling set.
      const summary = runPipeline(makeConfig(root));
      expect(summary.written).toEqual([...GENERATED, "tsr.config.json"]);
      expect(summary.deleted).toEqual([]);
      expect(summary.errors).toEqual([]);
      for (const helper of HELPERS) {
         expect(exists(path.join(root, ...helper.split("/")))).toBe(true);
      }

      // 2. Real generator run: builds the tree, modifies ZERO wrapper, sibling
      //    or source files.
      const watched = [...WRAPPERS, ...SOURCES, ...HELPERS];
      const before = contentMap(root, watched);
      expect([...before.keys()]).toEqual(watched);
      await runGenerator(root);
      expect(contentMap(root, watched)).toEqual(before);

      // 3. The tree contains the HOME route ids AND both mounts' ids
      //    (incl. dot-flat + lazy + layout).
      const tree = routeTree(root);
      for (const id of [
         "'/help'",
         "'/help/$topicId'",
         "'/help/stats/overview'",
         "'/help/chart'",
         "'/inventory/help'",
         "'/inventory/help/$topicId'",
         "'/inventory/help/stats/overview'",
         "'/inventory/help/chart'",
         "'/admin/help'",
         "'/admin/help/$topicId'",
         "'/admin/help/stats/overview'",
         "'/admin/help/chart'",
      ]) {
         expect(tree).toContain(id);
      }
      // Mount files and `.gen` siblings are invisible to the generator.
      expect(tree).not.toContain(".gen'");
      expect(tree).not.toContain("mount");

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

   it("deleting a source route file removes wrappers + sibling and drops all its routes", async () => {
      const root = makeProject();
      runPipeline(makeConfig(root));
      await runGenerator(root);
      expect(routeTree(root)).toContain("'/inventory/help/$topicId'");

      fs.rmSync(path.join(root, "src/routes/help/$topicId.tsx"));
      const summary = runPipeline(makeConfig(root));
      expect(summary.deleted).toEqual([
         "src/routes/admin.help/$topicId.tsx",
         "src/routes/help/$topicId.gen.tsx",
         "src/routes/inventory/help/$topicId.tsx",
      ]);

      await runGenerator(root);
      const tree = routeTree(root);
      expect(tree).not.toContain("'/help/$topicId'");
      expect(tree).not.toContain("'/inventory/help/$topicId'");
      expect(tree).not.toContain("'/admin/help/$topicId'");
      expect(tree).toContain("'/inventory/help'");
   });

   it("mounts a subtree of the mounted subtree added later, and the generator picks it up", async () => {
      const root = makeProject();
      runPipeline(makeConfig(root));
      await runGenerator(root);

      writeTree(root, {
         "src/routes/help/guides/faq.tsx": stockRouteSource("/help/guides/faq"),
         "src/routes/settings/guides.mount.ts": mountFileSource("../help/guides"),
      });
      const summary = runPipeline(makeConfig(root));
      // The new source file is mirrored under the two existing mounts AND the
      // new direct mount; its sibling unions all four ids (home included).
      expect(summary.written).toEqual([
         "src/routes/admin.help/guides/faq.tsx",
         "src/routes/help/guides/faq.gen.tsx",
         "src/routes/inventory/help/guides/faq.tsx",
         "src/routes/settings/guides/faq.tsx",
      ]);
      const sibling = readFile(path.join(root, "src/routes/help/guides/faq.gen.tsx"));
      expect(sibling).toContain(
         'type MountFilePaths = "/help/guides/faq" | "/admin/help/guides/faq" | "/inventory/help/guides/faq" | "/settings/guides/faq";',
      );

      const allGenerated = [...WRAPPERS, ...summary.written];
      const before = contentMap(root, allGenerated);
      await runGenerator(root);
      expect(contentMap(root, allGenerated)).toEqual(before);

      const tree = routeTree(root);
      expect(tree).toContain("'/help/guides/faq'");
      expect(tree).toContain("'/inventory/help/guides/faq'");
      expect(tree).toContain("'/admin/help/guides/faq'");
      expect(tree).toContain("'/settings/guides/faq'");
   });

   it("hand-corrupted literal: pipeline adopts, generator fixes on disk, no write war", async () => {
      const root = makeProject();
      runPipeline(makeConfig(root));
      await runGenerator(root);

      const wrapperRel = "src/routes/inventory/help/stats.overview.tsx";
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

   it("removing a mount cleans its wrappers and the generator drops the whole subtree", async () => {
      const root = makeProject();
      runPipeline(makeConfig(root));
      await runGenerator(root);

      fs.rmSync(path.join(root, "src/routes/admin.help.mount.ts"));
      const summary = runPipeline(makeConfig(root));
      expect(summary.deleted).toEqual([
         "src/routes/admin.help/$topicId.tsx",
         "src/routes/admin.help/chart.lazy.tsx",
         "src/routes/admin.help/chart.tsx",
         "src/routes/admin.help/route.tsx",
         "src/routes/admin.help/stats.overview.tsx",
      ]);
      expect(exists(path.join(root, "src/routes/admin.help"))).toBe(false);

      await runGenerator(root);
      const tree = routeTree(root);
      expect(tree).not.toContain("'/admin/help'");
      expect(tree).toContain("'/inventory/help'");
      expect(tree).toContain("'/help'");
   });
});
