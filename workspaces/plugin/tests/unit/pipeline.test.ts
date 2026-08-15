import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BANNER_SENTINEL } from "../../src/config";
import { SharedRoutesError } from "../../src/core/errors";
import { replaceRouteIdLiteral } from "../../src/core/fsio";
import { GITIGNORE_BLOCK_START } from "../../src/core/gitignore";
import { MOUNT_IGNORE_PATTERN } from "../../src/core/ignore-pattern";
import { readManifest } from "../../src/core/manifest";
import { checkPipeline, runPipeline } from "../../src/core/pipeline";
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

function makeFixture(): string {
   const root = makeTmpDir();
   writeTree(root, {
      "src/routes/help/route.tsx": stockRouteSource("/help"),
      "src/routes/help/$topicId.tsx": stockRouteSource("/help/$topicId"),
      "src/routes/help/chart.lazy.tsx": stockLazyRouteSource("/help/chart"),
      "src/routes/help/-notes.ts": "export const notes = 1\n",
      "src/routes/help/styles.css": "body {}\n",
      "src/routes/inventory/help.mount.ts": mountFileSource("../help"),
      "src/routes/finances/help.mount.ts": mountFileSource("../help"),
   });
   return root;
}

// `.gen.tsx` union-view siblings: route files only — the standalone
// chart.lazy.tsx gets none. `sharedRoutes.gen.ts` is the single runtime
// module every generated file imports, emitted next to the routes directory.
const HELPERS = ["src/routes/help/$topicId.gen.tsx", "src/routes/help/route.gen.tsx"];
const RUNTIME = "src/sharedRoutes.gen.ts";

const GENERATED = [
   "src/routes/finances/help/$topicId.tsx",
   "src/routes/finances/help/chart.lazy.tsx",
   "src/routes/finances/help/route.tsx",
   ...HELPERS,
   "src/routes/inventory/help/$topicId.tsx",
   "src/routes/inventory/help/chart.lazy.tsx",
   "src/routes/inventory/help/route.tsx",
   RUNTIME,
];

describe("runPipeline", () => {
   it("writes all wrappers with correct literals, banner, patch, and imports", () => {
      const root = makeFixture();
      const summary = runPipeline(makeConfig(root));
      expect(summary.written).toEqual([...GENERATED, "tsr.config.json"]);
      expect(summary.adopted).toEqual([]);
      expect(summary.deleted).toEqual([]);
      expect(summary.unchanged).toBe(0);
      expect(summary.errors).toEqual([]);

      const wrapper = readFile(path.join(root, "src/routes/inventory/help/route.tsx"));
      expect(wrapper.startsWith(BANNER_SENTINEL)).toBe(true);
      expect(wrapper).toContain("createFileRoute('/inventory/help')");
      expect(wrapper).toContain("import { Route as shared } from '../../help/route'");
      expect(wrapper).toContain(
         "patchSharedHooks(shared, ['/help', '/finances/help', '/inventory/help'])",
      );
      expect(wrapper).toContain("import { patchSharedHooks } from '../../../sharedRoutes.gen'");
      expect(wrapper).toContain("type T = SourceRouteTypes<typeof shared>");
      expect(wrapper).toContain(
         "// source: src/routes/help/route.tsx (mount: src/routes/inventory/help.mount.ts)",
      );

      const lazy = readFile(path.join(root, "src/routes/finances/help/chart.lazy.tsx"));
      expect(lazy).toContain("import { Route as sharedLazy } from '../../help/chart.lazy'");
      expect(lazy).toContain(
         "patchSharedHooks(sharedLazy, ['/help/chart', '/finances/help/chart', '/inventory/help/chart'])",
      );
      expect(lazy).toContain("const { id: _id, ...lazyOptions } = sharedLazy.options");
      expect(lazy).toContain("createLazyFileRoute('/finances/help/chart')(lazyOptions)");

      // ignored/helper files are not mirrored
      expect(exists(path.join(root, "src/routes/inventory/help/-notes.ts"))).toBe(false);
      expect(exists(path.join(root, "src/routes/inventory/help/styles.css"))).toBe(false);

      const manifest = readManifest(path.join(root, ".tanstack/shared-routes/manifest.json"));
      expect(manifest).toBeDefined();
      expect(manifest!.files.map((f) => f.path).sort()).toEqual(GENERATED);
      expect(manifest!.dirs).toContain("src/routes/inventory/help");
      expect(manifest!.dirs).not.toContain("src/routes/help");
      for (const genPath of [...HELPERS, RUNTIME]) {
         const role = manifest!.files.find((f) => f.path === genPath)?.role;
         expect(role).toBe(genPath === RUNTIME ? "runtime" : "helper");
      }
   });

   it("emits .gen siblings with the home id plus every mount's id", () => {
      const root = makeFixture();
      runPipeline(makeConfig(root));

      const sibling = readFile(path.join(root, "src/routes/help/$topicId.gen.tsx"));
      expect(sibling.startsWith(BANNER_SENTINEL)).toBe(true);
      expect(sibling).toContain("// source: src/routes/help/$topicId.tsx");
      expect(sibling).toContain(
         "// mounts: /help/$topicId, /finances/help/$topicId, /inventory/help/$topicId",
      );
      expect(sibling).toContain(
         'type MountFilePaths = "/help/$topicId" | "/finances/help/$topicId" | "/inventory/help/$topicId";',
      );
      expect(sibling).toContain('"src/routes/help/$topicId"'); // error-message path

      const layoutSibling = readFile(path.join(root, "src/routes/help/route.gen.tsx"));
      expect(layoutSibling).toContain(
         'type MountFilePaths = "/help" | "/finances/help" | "/inventory/help";',
      );
      // the standalone lazy source file gets no sibling
      expect(exists(path.join(root, "src/routes/help/chart.gen.tsx"))).toBe(false);
      expect(exists(path.join(root, "src/routes/help/chart.lazy.gen.tsx"))).toBe(false);
   });

   it("single-mount source file gets a home-plus-mount union", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/help/$topicId.tsx": stockRouteSource("/help/$topicId"),
         "src/routes/inventory/help.mount.ts": mountFileSource("../help"),
      });
      runPipeline(makeConfig(root));
      const sibling = readFile(path.join(root, "src/routes/help/$topicId.gen.tsx"));
      expect(sibling).toContain(
         'type MountFilePaths = "/help/$topicId" | "/inventory/help/$topicId";',
      );
      expect(sibling).toContain("// mounts: /help/$topicId, /inventory/help/$topicId\n");
   });

   it("aggregates overlapping sources: a mounted subtree of a mounted subtree unions all ids", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/help/route.tsx": stockRouteSource("/help"),
         "src/routes/help/guides/faq.tsx": stockRouteSource("/help/guides/faq"),
         "src/routes/inventory/help.mount.ts": mountFileSource("../help"),
         "src/routes/settings/guides.mount.ts": mountFileSource("../help/guides"),
      });
      runPipeline(makeConfig(root));

      // faq.tsx is covered by BOTH mounts: via /inventory/help (outer mirror)
      // and via /settings/guides (direct) — plus its home id.
      const sibling = readFile(path.join(root, "src/routes/help/guides/faq.gen.tsx"));
      expect(sibling).toContain(
         'type MountFilePaths = "/help/guides/faq" | "/inventory/help/guides/faq" | "/settings/guides/faq";',
      );
      // both wrappers exist and each carries the full id set in its patch call
      const outer = readFile(path.join(root, "src/routes/inventory/help/guides/faq.tsx"));
      const direct = readFile(path.join(root, "src/routes/settings/guides/faq.tsx"));
      const patchLine =
         "patchSharedHooks(shared, ['/help/guides/faq', '/inventory/help/guides/faq', '/settings/guides/faq'])";
      expect(outer).toContain(patchLine);
      expect(direct).toContain(patchLine);
      // route.tsx is only covered by the outer mount
      const layoutSibling = readFile(path.join(root, "src/routes/help/route.gen.tsx"));
      expect(layoutSibling).toContain('type MountFilePaths = "/help" | "/inventory/help";');
   });

   it("second run writes nothing", () => {
      const root = makeFixture();
      runPipeline(makeConfig(root));
      const before = GENERATED.map((w) => readFile(path.join(root, w)));

      const summary = runPipeline(makeConfig(root));
      expect(summary.written).toEqual([]);
      expect(summary.adopted).toEqual([]);
      expect(summary.deleted).toEqual([]);
      expect(summary.unchanged).toBe(GENERATED.length);
      expect(GENERATED.map((w) => readFile(path.join(root, w)))).toEqual(before);
   });

   it("adopts a generator-corrected literal without writing", () => {
      const root = makeFixture();
      runPipeline(makeConfig(root));

      // Simulate the stock generator rewriting the literal on disk.
      const wrapperPath = path.join(root, "src/routes/inventory/help/route.tsx");
      const corrected = replaceRouteIdLiteral(readFile(wrapperPath), "/inventory/help/corrected");
      fs.writeFileSync(wrapperPath, corrected);

      const summary = runPipeline(makeConfig(root));
      expect(summary.adopted).toEqual(["src/routes/inventory/help/route.tsx"]);
      expect(summary.written).toEqual([]);
      expect(readFile(wrapperPath)).toBe(corrected); // untouched: generator is the authority
   });

   it("cleans up wrappers AND the stale .gen sibling when their source file disappears", () => {
      const root = makeFixture();
      runPipeline(makeConfig(root));

      fs.rmSync(path.join(root, "src/routes/help/$topicId.tsx"));
      const summary = runPipeline(makeConfig(root));
      expect(summary.deleted).toEqual([
         "src/routes/finances/help/$topicId.tsx",
         "src/routes/help/$topicId.gen.tsx",
         "src/routes/inventory/help/$topicId.tsx",
      ]);
      expect(exists(path.join(root, "src/routes/inventory/help/$topicId.tsx"))).toBe(false);
      expect(exists(path.join(root, "src/routes/help/$topicId.gen.tsx"))).toBe(false);
      expect(exists(path.join(root, "src/routes/inventory/help/route.tsx"))).toBe(true);
   });

   it("cleans up everything when a mount is removed, pruning its dir and re-rendering siblings", () => {
      const root = makeFixture();
      runPipeline(makeConfig(root));

      fs.rmSync(path.join(root, "src/routes/finances/help.mount.ts"));
      const summary = runPipeline(makeConfig(root));
      expect(summary.deleted).toEqual([
         "src/routes/finances/help/$topicId.tsx",
         "src/routes/finances/help/chart.lazy.tsx",
         "src/routes/finances/help/route.tsx",
      ]);
      expect(exists(path.join(root, "src/routes/finances/help"))).toBe(false);
      expect(exists(path.join(root, "src/routes/finances"))).toBe(true);

      // Siblings shrink to home + the surviving mount; the surviving mount's
      // wrappers shrink their patch id list; the runtime module is
      // mount-independent and stays byte-identical.
      expect(summary.written).toEqual([
         "src/routes/help/$topicId.gen.tsx",
         "src/routes/help/route.gen.tsx",
         "src/routes/inventory/help/$topicId.tsx",
         "src/routes/inventory/help/chart.lazy.tsx",
         "src/routes/inventory/help/route.tsx",
      ]);
      const sibling = readFile(path.join(root, "src/routes/help/$topicId.gen.tsx"));
      expect(sibling).toContain(
         'type MountFilePaths = "/help/$topicId" | "/inventory/help/$topicId";',
      );
      expect(sibling).not.toContain("/finances/help/$topicId");
   });

   it("survives a lost manifest via banner scan", () => {
      const root = makeFixture();
      runPipeline(makeConfig(root));
      fs.rmSync(path.join(root, ".tanstack"), { recursive: true });
      fs.rmSync(path.join(root, "src/routes/help/chart.lazy.tsx"));

      const summary = runPipeline(makeConfig(root));
      expect(summary.deleted).toEqual([
         "src/routes/finances/help/chart.lazy.tsx",
         "src/routes/inventory/help/chart.lazy.tsx",
      ]);
   });

   it("refuses to overwrite an unowned target file, writing nothing at all", () => {
      const root = makeFixture();
      const userFile = path.join(root, "src/routes/inventory/help/route.tsx");
      writeTree(root, { "src/routes/inventory/help/route.tsx": "// my own route\n" });

      let error: unknown;
      try {
         runPipeline(makeConfig(root));
      } catch (caught) {
         error = caught;
      }
      expect(error).toBeInstanceOf(SharedRoutesError);
      expect((error as SharedRoutesError).code).toBe("UNOWNED_TARGET_FILE");
      expect((error as SharedRoutesError).message).toContain("help.mount.ts");

      // No wrapper was written anywhere and the user file is untouched.
      expect(readFile(userFile)).toBe("// my own route\n");
      expect(exists(path.join(root, "src/routes/finances/help"))).toBe(false);
      expect(exists(path.join(root, "src/routes/inventory/help/$topicId.tsx"))).toBe(false);
   });

   it("check mode reports pending work without touching the filesystem", () => {
      const root = makeFixture();
      const summary = checkPipeline(makeConfig(root));
      expect(summary.written).toEqual([...GENERATED, "tsr.config.json"]);
      for (const file of [...GENERATED, "tsr.config.json"]) {
         expect(exists(path.join(root, file))).toBe(false);
      }
      expect(exists(path.join(root, ".tanstack"))).toBe(false);

      // After a real run, check mode reports a clean state.
      runPipeline(makeConfig(root));
      const clean = checkPipeline(makeConfig(root));
      expect(clean.written).toEqual([]);
      expect(clean.deleted).toEqual([]);
      expect(clean.unchanged).toBe(GENERATED.length);
   });

   it("check mode reports pending deletions without deleting", () => {
      const root = makeFixture();
      runPipeline(makeConfig(root));
      fs.rmSync(path.join(root, "src/routes/help/$topicId.tsx"));

      const summary = checkPipeline(makeConfig(root));
      expect(summary.deleted).toEqual([
         "src/routes/finances/help/$topicId.tsx",
         "src/routes/help/$topicId.gen.tsx",
         "src/routes/inventory/help/$topicId.tsx",
      ]);
      expect(exists(path.join(root, "src/routes/inventory/help/$topicId.tsx"))).toBe(true);
      expect(exists(path.join(root, "src/routes/help/$topicId.gen.tsx"))).toBe(true);
   });

   it("refuses to overwrite an unowned .gen.tsx sibling file", () => {
      const root = makeFixture();
      writeTree(root, { "src/routes/help/route.gen.tsx": "// hand-written\n" });

      let error: unknown;
      try {
         runPipeline(makeConfig(root));
      } catch (caught) {
         error = caught;
      }
      expect(error).toBeInstanceOf(SharedRoutesError);
      expect((error as SharedRoutesError).code).toBe("UNOWNED_TARGET_FILE");
      expect((error as SharedRoutesError).message).toContain("route.gen.tsx");
      expect(readFile(path.join(root, "src/routes/help/route.gen.tsx"))).toBe("// hand-written\n");
   });

   it("maintains the managed .gitignore block when enabled, removes it when disabled", () => {
      const root = makeFixture();
      runPipeline(makeConfig(root, { gitignore: true }));
      const gitignore = readFile(path.join(root, ".gitignore"));
      expect(gitignore).toContain(GITIGNORE_BLOCK_START);
      expect(gitignore).toContain("src/routes/inventory/help/");
      expect(gitignore).toContain("src/routes/finances/help/");
      expect(gitignore).toContain("src/routes/help/**/*.gen.*");
      expect(gitignore).toContain("src/sharedRoutes.gen.ts");

      runPipeline(makeConfig(root, { gitignore: false }));
      expect(readFile(path.join(root, ".gitignore"))).not.toContain(GITIGNORE_BLOCK_START);
   });

   it("runs cleanly on a project with no mounts", () => {
      const root = makeTmpDir();
      writeTree(root, { "src/routes/index.tsx": stockRouteSource("/") });
      const summary = runPipeline(makeConfig(root));
      expect(exists(path.join(root, "tsr.config.json"))).toBe(false);
      expect(summary).toEqual({
         written: [],
         adopted: [],
         deleted: [],
         unchanged: 0,
         errors: [],
         incomplete: [],
         scaffolded: [],
         sourceRoots: [],
         targetDirs: [],
         wrappersBySource: {},
      });
   });
});

describe("runPipeline mid-edit DX", () => {
   it("scaffolds byte-empty mount files (route files are the stock generator's job)", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/help/route.tsx": stockRouteSource("/help"),
         "src/routes/help/empty.tsx": "",
         "src/routes/inventory/help.mount.ts": mountFileSource("../help"),
         "src/routes/finances/reviews.mount.ts": "",
      });
      const summary = runPipeline(makeConfig(root), { lenient: true });

      expect(summary.scaffolded).toEqual(["src/routes/finances/reviews.mount.ts"]);
      expect(readFile(path.join(root, "src/routes/finances/reviews.mount.ts"))).toContain(
         "export default mount('')",
      );
      // the empty ROUTE file is untouched — its wrapper is deferred, its
      // sibling exists already
      expect(readFile(path.join(root, "src/routes/help/empty.tsx"))).toBe("");
      expect(exists(path.join(root, "src/routes/inventory/help/empty.tsx"))).toBe(false);
      expect(exists(path.join(root, "src/routes/help/empty.gen.tsx"))).toBe(true);
      expect(exists(path.join(root, "src/routes/inventory/help/route.tsx"))).toBe(true);
      expect(summary.incomplete.some((n) => n.includes("reviews.mount.ts"))).toBe(true);
      expect(summary.incomplete.some((n) => n.includes("does not export `Route`"))).toBe(true);
   });

   it("check mode never scaffolds", () => {
      const root = makeTmpDir();
      writeTree(root, { "src/routes/reviews.mount.ts": "" });
      const summary = runPipeline(makeConfig(root), { check: true });
      expect(summary.scaffolded).toEqual([]);
      expect(readFile(path.join(root, "src/routes/reviews.mount.ts"))).toBe("");
   });

   it("defers the wrapper until the source file exports `Route`, but emits the sibling", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/help/$topicId.tsx": "// authoring in progress\n",
         "src/routes/inventory/help.mount.ts": mountFileSource("../help"),
      });
      const summary = runPipeline(makeConfig(root), { lenient: true });

      expect(exists(path.join(root, "src/routes/inventory/help/$topicId.tsx"))).toBe(false);
      expect(exists(path.join(root, "src/routes/help/$topicId.gen.tsx"))).toBe(true);
      expect(summary.incomplete.some((n) => n.includes("does not export `Route`"))).toBe(true);

      // export appears → wrapper lands
      writeTree(root, {
         "src/routes/help/$topicId.tsx": stockRouteSource("/help/$topicId"),
      });
      runPipeline(makeConfig(root), { lenient: true });
      expect(exists(path.join(root, "src/routes/inventory/help/$topicId.tsx"))).toBe(true);
   });

   it("keeps an existing wrapper when its source file goes temporarily invalid", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/help/$topicId.tsx": stockRouteSource("/help/$topicId"),
         "src/routes/inventory/help.mount.ts": mountFileSource("../help"),
      });
      runPipeline(makeConfig(root), { lenient: true });
      const wrapper = path.join(root, "src/routes/inventory/help/$topicId.tsx");
      expect(exists(wrapper)).toBe(true);

      // export vanishes mid-edit: wrapper survives (cleanup keys on file-gone)
      writeTree(root, { "src/routes/help/$topicId.tsx": "// half-typed refactor\n" });
      const summary = runPipeline(makeConfig(root), { lenient: true });
      expect(exists(wrapper)).toBe(true);
      expect(summary.deleted).toEqual([]);

      // file actually deleted: wrapper + sibling cleaned up
      fs.rmSync(path.join(root, "src/routes/help/$topicId.tsx"));
      const afterDelete = runPipeline(makeConfig(root), { lenient: true });
      expect(exists(wrapper)).toBe(false);
      expect(afterDelete.deleted).toContain("src/routes/help/$topicId.gen.tsx");
   });

   it("holds cleanup while a mount file is incomplete or invalid, resumes after", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/help/route.tsx": stockRouteSource("/help"),
         "src/routes/inventory/help.mount.ts": mountFileSource("../help"),
      });
      runPipeline(makeConfig(root), { lenient: true });
      const wrapper = path.join(root, "src/routes/inventory/help/route.tsx");
      expect(exists(wrapper)).toBe(true);

      // mount file broken mid-edit: generated files survive, one short warning
      writeTree(root, { "src/routes/inventory/help.mount.ts": "garbage ((((" });
      const broken = runPipeline(makeConfig(root), { lenient: true });
      expect(exists(wrapper)).toBe(true);
      expect(broken.deleted).toEqual([]);
      expect(broken.errors.some((w) => w.includes("skipping invalid mount file"))).toBe(true);

      // strict mode still throws for the same state
      expect(() => runPipeline(makeConfig(root))).toThrow(SharedRoutesError);

      // mount healed: back to normal, nothing stale
      writeTree(root, {
         "src/routes/inventory/help.mount.ts": mountFileSource("../help"),
      });
      const healed = runPipeline(makeConfig(root), { lenient: true });
      expect(healed.deleted).toEqual([]);
      expect(exists(wrapper)).toBe(true);

      // mount file gone: generated tree cleaned up
      fs.rmSync(path.join(root, "src/routes/inventory/help.mount.ts"));
      runPipeline(makeConfig(root), { lenient: true });
      expect(exists(wrapper)).toBe(false);
      expect(exists(path.join(root, "src/routes/help/route.gen.tsx"))).toBe(false);
   });

   it("skips a broken mount in lenient mode without losing the healthy ones", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/help/route.tsx": stockRouteSource("/help"),
         "src/routes/inventory/help.mount.ts": mountFileSource("../help"),
         "src/routes/finances/reviews.mount.ts": mountFileSource("../missing-dir"),
      });
      const summary = runPipeline(makeConfig(root), { lenient: true });
      expect(exists(path.join(root, "src/routes/inventory/help/route.tsx"))).toBe(true);
      expect(summary.errors.some((w) => w.includes("reviews.mount.ts"))).toBe(true);
      expect(() => runPipeline(makeConfig(root))).toThrow(SharedRoutesError); // strict still throws
   });

   it("follows a source rename: old wrapper and sibling cleaned, new ones created", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/help/chart.tsx": stockRouteSource("/help/chart"),
         "src/routes/inventory/help.mount.ts": mountFileSource("../help"),
      });
      runPipeline(makeConfig(root));

      fs.renameSync(
         path.join(root, "src/routes/help/chart.tsx"),
         path.join(root, "src/routes/help/graph.tsx"),
      );
      const summary = runPipeline(makeConfig(root));
      expect(summary.deleted).toContain("src/routes/help/chart.gen.tsx");
      expect(summary.deleted).toContain("src/routes/inventory/help/chart.tsx");
      expect(exists(path.join(root, "src/routes/help/graph.gen.tsx"))).toBe(true);
      expect(exists(path.join(root, "src/routes/inventory/help/graph.tsx"))).toBe(true);
   });
});

describe("runPipeline tsr.config.json management", () => {
   it("creates tsr.config.json with the mount+gen ignore pattern, idempotently", () => {
      const root = makeFixture();
      const summary = runPipeline(makeConfig(root));
      expect(summary.written).toContain("tsr.config.json");
      expect(JSON.parse(readFile(path.join(root, "tsr.config.json")))).toEqual({
         routeFileIgnorePattern: MOUNT_IGNORE_PATTERN,
      });
      expect(runPipeline(makeConfig(root)).written).toEqual([]);
   });

   it("extends an existing pattern by alternation, preserving other keys", () => {
      const root = makeFixture();
      writeTree(root, {
         "tsr.config.json": JSON.stringify({
            target: "react",
            routeFileIgnorePattern: "\\.test\\.",
         }),
      });
      runPipeline(makeConfig(root));
      const config = JSON.parse(readFile(path.join(root, "tsr.config.json")));
      expect(config.target).toBe("react");
      const pattern = new RegExp(config.routeFileIgnorePattern as string);
      expect(pattern.test("x.mount.ts")).toBe(true);
      expect(pattern.test("x.gen.tsx")).toBe(true);
      expect(pattern.test("x.test.ts")).toBe(true);
      expect(pattern.test("x.tsx")).toBe(false);
      // idempotent: the merged pattern already covers everything
      expect(runPipeline(makeConfig(root)).written).toEqual([]);
   });

   it("leaves an already-covering pattern untouched", () => {
      const root = makeFixture();
      const content = `${JSON.stringify({ routeFileIgnorePattern: "\\.mount\\.|\\.gen\\." }, null, 2)}\n`;
      writeTree(root, { "tsr.config.json": content });
      const summary = runPipeline(makeConfig(root));
      expect(summary.written).not.toContain("tsr.config.json");
      expect(readFile(path.join(root, "tsr.config.json"))).toBe(content);
   });

   it("warns instead of touching an unparsable tsr.config.json", () => {
      const root = makeFixture();
      writeTree(root, { "tsr.config.json": "{ not json" });
      const summary = runPipeline(makeConfig(root));
      expect(summary.errors.some((w) => w.includes("tsr.config.json"))).toBe(true);
      expect(readFile(path.join(root, "tsr.config.json"))).toBe("{ not json");
   });
});
