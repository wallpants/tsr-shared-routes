import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverMounts } from "../../src/core/discover";
import type { SharedRoutesErrorCode } from "../../src/core/errors";
import { SharedRoutesError } from "../../src/core/errors";
import { buildPlan } from "../../src/core/plan";
import { makeConfig, makeTmpDir, mountFileSource, writeTree } from "../helpers";

function planFor(root: string, overrides = {}) {
   const config = makeConfig(root, overrides);
   const { mounts } = discoverMounts(path.join(root, "src", "routes"));
   return buildPlan(config, mounts);
}

function expectPlanError(root: string, code: SharedRoutesErrorCode): SharedRoutesError {
   try {
      planFor(root);
   } catch (error) {
      expect(error).toBeInstanceOf(SharedRoutesError);
      expect((error as SharedRoutesError).code).toBe(code);
      return error as SharedRoutesError;
   }
   throw new Error(`expected buildPlan to throw ${code}`);
}

describe("buildPlan mapping", () => {
   it("maps mount files to target dirs and shared files to planned wrappers", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/inventory/providers.mount.ts": mountFileSource("../../shared/providers"),
         "src/routes/finances/providers.mount.ts": mountFileSource("../../shared/providers"),
         "src/shared/providers/index.tsx": "",
         "src/shared/providers/$providerId.tsx": "",
         "src/shared/providers/chart.lazy.tsx": "",
         "src/shared/providers/-helpers.ts": "",
      });
      const plan = planFor(root);

      const finTarget = path.join(root, "src", "routes", "finances", "providers");
      const invTarget = path.join(root, "src", "routes", "inventory", "providers");
      expect(plan.targetDirs).toEqual([finTarget, invTarget]);
      expect(plan.sharedRoots).toEqual([path.join(root, "src", "shared", "providers")]);
      expect(plan.warnings).toEqual([]);

      expect(plan.files).toHaveLength(6);
      const lazy = plan.files.find((f) => f.targetPath === path.join(invTarget, "chart.lazy.tsx"));
      expect(lazy).toMatchObject({
         kind: "wrapper-lazy",
         sharedFilePath: path.join(root, "src", "shared", "providers", "chart.lazy.tsx"),
         mountFilePath: path.join(root, "src", "routes", "inventory", "providers.mount.ts"),
         mountRoutePathPrefix: "/inventory/providers",
      });
      const index = plan.files.find((f) => f.targetPath === path.join(finTarget, "index.tsx"));
      expect(index).toMatchObject({ kind: "wrapper", mountRoutePathPrefix: "/finances/providers" });
   });

   it("handles dot-flat mount names", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/inventory.providers.mount.ts": mountFileSource("../shared"),
         "src/shared/index.tsx": "",
      });
      const plan = planFor(root);
      expect(plan.targetDirs).toEqual([path.join(root, "src", "routes", "inventory.providers")]);
      expect(plan.files[0]!.mountRoutePathPrefix).toBe("/inventory/providers");
   });

   it("expands nested mounts under the outer target, importing innermost files", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/inventory/providers.mount.ts": mountFileSource("../../shared/providers"),
         "src/shared/providers/index.tsx": "",
         "src/shared/providers/reviews.mount.ts": mountFileSource("../reviews"),
         "src/shared/reviews/index.tsx": "",
         "src/shared/reviews/$reviewId.tsx": "",
      });
      const plan = planFor(root);
      const outer = path.join(root, "src", "routes", "inventory", "providers");
      expect(plan.targetDirs).toEqual([outer, path.join(outer, "reviews")]);
      const nested = plan.files.find(
         (f) => f.targetPath === path.join(outer, "reviews", "$reviewId.tsx"),
      );
      expect(nested).toMatchObject({
         sharedFilePath: path.join(root, "src", "shared", "reviews", "$reviewId.tsx"),
         mountFilePath: path.join(root, "src", "shared", "providers", "reviews.mount.ts"),
         mountRoutePathPrefix: "/inventory/providers/reviews",
      });
   });

   it("warns when a mount is named after the route token", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/route.mount.ts": mountFileSource("../shared"),
         "src/shared/index.tsx": "",
      });
      const plan = planFor(root);
      expect(plan.warnings).toHaveLength(1);
      expect(plan.warnings[0]).toContain("route token");
   });
});

describe("buildPlan validation", () => {
   it("rejects __root.mount.ts", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/__root.mount.ts": mountFileSource("../shared"),
         "src/shared/index.tsx": "",
      });
      expectPlanError(root, "INVALID_MOUNT_NAME");
   });

   it("rejects index.mount.ts", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/index.mount.ts": mountFileSource("../shared"),
         "src/shared/index.tsx": "",
      });
      expectPlanError(root, "INVALID_MOUNT_NAME");
   });

   it("rejects mount names starting with the ignore prefix", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/-providers.mount.ts": mountFileSource("../shared"),
         "src/shared/index.tsx": "",
      });
      expectPlanError(root, "INVALID_MOUNT_NAME");
   });

   it("rejects a missing shared dir, naming the mount and the resolved path", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/providers.mount.ts": mountFileSource("../nope"),
      });
      const error = expectPlanError(root, "SHARED_DIR_NOT_FOUND");
      expect(error.message).toContain("providers.mount.ts");
      expect(error.message).toContain(path.join(root, "src", "nope"));
   });

   it("rejects a shared dir inside the routes directory", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/providers.mount.ts": mountFileSource("./shared"),
         "src/routes/shared/index.tsx": "",
      });
      expectPlanError(root, "SHARED_DIR_INSIDE_ROUTES");
   });

   it("rejects a colocated shared dir not under an ignore-prefixed directory", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/inventory/providers.mount.ts": mountFileSource("./shared"),
         "src/routes/inventory/shared/index.tsx": "",
      });
      const error = expectPlanError(root, "SHARED_DIR_INSIDE_ROUTES");
      expect(error.message).toContain('"-"');
   });

   it("accepts a colocated shared dir under an ignore-prefixed directory", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/inventory/providers.mount.ts": mountFileSource("./-shared/providers"),
         "src/routes/inventory/-shared/providers/index.tsx": "",
         "src/routes/inventory/-shared/providers/$providerId.tsx": "",
      });
      const plan = planFor(root);
      const target = path.join(root, "src", "routes", "inventory", "providers");
      expect(plan.targetDirs).toEqual([target]);
      expect(plan.sharedRoots).toEqual([
         path.join(root, "src", "routes", "inventory", "-shared", "providers"),
      ]);
      expect(plan.files.map((f) => f.targetPath).sort()).toEqual([
         path.join(target, "$providerId.tsx"),
         path.join(target, "index.tsx"),
      ]);
   });

   it("accepts a colocated shared dir whose own basename is ignore-prefixed", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/inventory/providers.mount.ts": mountFileSource("./-providers"),
         "src/routes/inventory/-providers/index.tsx": "",
      });
      const plan = planFor(root);
      expect(plan.files).toHaveLength(1);
   });

   it("honors a routeFileIgnorePrefix override for colocated shared dirs", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/inventory/providers.mount.ts": mountFileSource("./~shared/providers"),
         "src/routes/inventory/~shared/providers/index.tsx": "",
      });
      // Default prefix "-": "~shared" is NOT ignored by the generator → error.
      expectPlanError(root, "SHARED_DIR_INSIDE_ROUTES");
      // With the matching override the colocation is legal.
      const plan = planFor(root, { routeFileIgnorePrefix: "~" });
      expect(plan.files).toHaveLength(1);
   });

   it("rejects a shared dir containing the routes directory", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/providers.mount.ts": mountFileSource("../.."),
         "src/shared/index.tsx": "",
      });
      expectPlanError(root, "SHARED_DIR_CONTAINS_ROUTES");
   });

   it("rejects two mounts with the same target dir", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/providers.mount.ts": mountFileSource("../shared"),
         "src/routes/providers.mount.js": mountFileSource("../shared"),
         "src/shared/index.tsx": "",
      });
      expectPlanError(root, "TARGET_OVERLAP");
   });

   it("rejects a target dir nested inside another mount's target dir", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/a.mount.ts": mountFileSource("../shared"),
         "src/routes/a/b.mount.ts": mountFileSource("../../shared"),
         "src/shared/index.tsx": "",
      });
      expectPlanError(root, "TARGET_OVERLAP");
   });

   it("rejects colliding generated files (physical subtree vs nested mount)", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/providers.mount.ts": mountFileSource("../shared/providers"),
         "src/shared/providers/reviews/index.tsx": "",
         "src/shared/providers/reviews.mount.ts": mountFileSource("../reviews"),
         "src/shared/reviews/index.tsx": "",
      });
      expectPlanError(root, "TARGET_COLLISION");
   });

   it("detects mount cycles and prints the chain", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/inventory/providers.mount.ts": mountFileSource("../../sharedA"),
         "src/sharedA/index.tsx": "",
         "src/sharedA/sub.mount.ts": mountFileSource("../sharedB"),
         "src/sharedB/index.tsx": "",
         "src/sharedB/other.mount.ts": mountFileSource("../sharedA"),
      });
      const error = expectPlanError(root, "MOUNT_CYCLE");
      expect(error.message).toContain("mount cycle detected");
      expect(error.message).toContain(path.join("src", "sharedA"));
      expect(error.message).toContain(path.join("src", "sharedB"));
      expect(error.message).toContain("other.mount.ts");
   });

   it("allows the same shared dir under multiple mounts (no false cycle)", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/a.mount.ts": mountFileSource("../shared"),
         "src/routes/b.mount.ts": mountFileSource("../shared"),
         "src/shared/index.tsx": "",
      });
      expect(planFor(root).files).toHaveLength(2);
   });
});
