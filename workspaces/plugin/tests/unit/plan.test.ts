import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverMounts } from "../../src/core/discover";
import { SharedRoutesError } from "../../src/core/errors";
import { buildPlan } from "../../src/core/plan";
import { makeConfig, makeTmpDir, mountFileSource, stockRouteSource, writeTree } from "../helpers";

function planFor(root: string, options: { lenient?: boolean } = {}) {
   const config = makeConfig(root);
   const discovery = discoverMounts(path.join(root, "src", "routes"), {
      lenient: options.lenient ?? false,
   });
   return buildPlan(config, discovery.mounts, options);
}

function expectPlanError(root: string, code: string): SharedRoutesError {
   try {
      planFor(root);
   } catch (error) {
      expect(error).toBeInstanceOf(SharedRoutesError);
      expect((error as SharedRoutesError).code).toBe(code);
      return error as SharedRoutesError;
   }
   throw new Error("expected buildPlan to throw");
}

describe("buildPlan", () => {
   it("maps a mounted visible subtree to wrapper files under the target dir", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/help/route.tsx": stockRouteSource("/help"),
         "src/routes/help/$topicId.tsx": stockRouteSource("/help/$topicId"),
         "src/routes/help/chart.lazy.tsx": "",
         "src/routes/inventory/help.mount.ts": mountFileSource("../help"),
      });
      const plan = planFor(root);
      const routesDir = path.join(root, "src", "routes");
      expect(plan.targetDirs).toEqual([path.join(routesDir, "inventory", "help")]);
      expect(plan.sourceRoots).toEqual([path.join(routesDir, "help")]);
      expect(plan.skippedMounts).toBe(0);
      expect(plan.files).toEqual([
         {
            targetPath: path.join(routesDir, "inventory", "help", "$topicId.tsx"),
            kind: "wrapper",
            sourceFilePath: path.join(routesDir, "help", "$topicId.tsx"),
            sourceRoot: path.join(routesDir, "help"),
            mountFilePath: path.join(routesDir, "inventory", "help.mount.ts"),
         },
         {
            targetPath: path.join(routesDir, "inventory", "help", "chart.lazy.tsx"),
            kind: "wrapper-lazy",
            sourceFilePath: path.join(routesDir, "help", "chart.lazy.tsx"),
            sourceRoot: path.join(routesDir, "help"),
            mountFilePath: path.join(routesDir, "inventory", "help.mount.ts"),
         },
         {
            targetPath: path.join(routesDir, "inventory", "help", "route.tsx"),
            kind: "wrapper",
            sourceFilePath: path.join(routesDir, "help", "route.tsx"),
            sourceRoot: path.join(routesDir, "help"),
            mountFilePath: path.join(routesDir, "inventory", "help.mount.ts"),
         },
      ]);
   });

   it("allows overlapping sources: a mount may target a subtree of another mount's source", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/help/route.tsx": stockRouteSource("/help"),
         "src/routes/help/guides/faq.tsx": stockRouteSource("/help/guides/faq"),
         "src/routes/inventory/help.mount.ts": mountFileSource("../help"),
         "src/routes/settings/guides.mount.ts": mountFileSource("../help/guides"),
      });
      const plan = planFor(root);
      const routesDir = path.join(root, "src", "routes");
      expect(plan.sourceRoots).toEqual([
         path.join(routesDir, "help"),
         path.join(routesDir, "help", "guides"),
      ]);
      const faqTargets = plan.files
         .filter((file) => file.sourceFilePath.endsWith("faq.tsx"))
         .map((file) => file.targetPath)
         .sort();
      expect(faqTargets).toEqual([
         path.join(routesDir, "inventory", "help", "guides", "faq.tsx"),
         path.join(routesDir, "settings", "guides", "faq.tsx"),
      ]);
   });

   it("rejects __root and index-token mount names", () => {
      for (const name of ["__root", "index"]) {
         const root = makeTmpDir();
         writeTree(root, {
            "src/routes/help/route.tsx": stockRouteSource("/help"),
            [`src/routes/${name}.mount.ts`]: mountFileSource("./help"),
         });
         expectPlanError(root, "INVALID_MOUNT_NAME");
      }
   });

   it("rejects mount names starting with the ignore prefix", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/help/route.tsx": stockRouteSource("/help"),
         "src/routes/-help.mount.ts": mountFileSource("./help"),
      });
      expectPlanError(root, "INVALID_MOUNT_NAME");
   });

   it("warns on a mount named after the route token", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/help/index.tsx": stockRouteSource("/help/"),
         "src/routes/sub/route.mount.ts": mountFileSource("../help"),
      });
      const plan = planFor(root);
      expect(plan.warnings.some((warning) => warning.includes("route token"))).toBe(true);
   });

   it("rejects a missing source directory", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/inventory/help.mount.ts": mountFileSource("../help"),
      });
      expectPlanError(root, "SOURCE_DIR_NOT_FOUND");
   });

   it("rejects a source directory outside the routes directory", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/shared/help/route.tsx": stockRouteSource("/help"),
         "src/routes/inventory/help.mount.ts": mountFileSource("../../shared/help"),
      });
      expectPlanError(root, "SOURCE_DIR_OUTSIDE_ROUTES");
   });

   it("rejects mounting the routes directory itself", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/index.tsx": stockRouteSource("/"),
         "src/routes/sub/all.mount.ts": mountFileSource(".."),
      });
      expectPlanError(root, "SOURCE_DIR_IS_ROUTES_ROOT");
   });

   it("rejects overlapping target dirs", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/help/route.tsx": stockRouteSource("/help"),
         "src/routes/inventory/help.mount.ts": mountFileSource("../help"),
         "src/routes/inventory/help/deep.mount.ts": mountFileSource("../../help"),
      });
      expectPlanError(root, "TARGET_OVERLAP");
   });

   it("rejects a mount whose target lies inside a mounted source subtree", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/help/route.tsx": stockRouteSource("/help"),
         "src/routes/docs/intro.tsx": stockRouteSource("/docs/intro"),
         "src/routes/inventory/help.mount.ts": mountFileSource("../help"),
         // this mount's target dir (src/routes/help/docs) is inside the
         // mounted source subtree src/routes/help
         "src/routes/help/docs.mount.ts": mountFileSource("../docs"),
      });
      expectPlanError(root, "TARGET_INSIDE_SOURCE");
   });

   it("rejects a mount whose source lies inside another mount's target dir", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/help/route.tsx": stockRouteSource("/help"),
         "src/routes/inventory/help.mount.ts": mountFileSource("../help"),
         "src/routes/inventory/help/.keep": "",
         // sources generated output: src/routes/inventory/help is mount 1's target
         "src/routes/copy.mount.ts": mountFileSource("./inventory/help"),
      });
      expectPlanError(root, "SOURCE_INSIDE_TARGET");
   });

   it("lenient mode skips a broken mount, keeps the rest, and counts the skip", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/help/route.tsx": stockRouteSource("/help"),
         "src/routes/inventory/help.mount.ts": mountFileSource("../help"),
         "src/routes/finances/missing.mount.ts": mountFileSource("../does-not-exist"),
      });
      expect(() => planFor(root)).toThrow(SharedRoutesError); // strict
      const plan = planFor(root, { lenient: true });
      expect(plan.skippedMounts).toBe(1);
      expect(plan.warnings).toHaveLength(1);
      expect(plan.targetDirs).toEqual([path.join(root, "src", "routes", "inventory", "help")]);
      expect(plan.files).toHaveLength(1);
   });

   it("containment conflicts abort the plan even in lenient mode", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/help/route.tsx": stockRouteSource("/help"),
         "src/routes/a/help.mount.ts": mountFileSource("../help"),
         "src/routes/a/help/deep.mount.ts": mountFileSource("../../help"),
      });
      expect(() => planFor(root, { lenient: true })).toThrow(SharedRoutesError);
   });
});
