import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_BANNER } from "../../src/config";
import { helperPathFor, renderHelper } from "../../src/core/emit-helper";

describe("helperPathFor", () => {
   it("replaces the route extension with .gen.tsx, keeping the directory", () => {
      expect(helperPathFor(path.join("/p", "routes", "help", "$topicId.tsx"))).toBe(
         path.join("/p", "routes", "help", "$topicId.gen.tsx"),
      );
      expect(helperPathFor(path.join("/p", "routes", "index.ts"))).toBe(
         path.join("/p", "routes", "index.gen.tsx"),
      );
      expect(helperPathFor(path.join("/p", "routes", "stats.overview.tsx"))).toBe(
         path.join("/p", "routes", "stats.overview.gen.tsx"),
      );
   });
});

describe("renderHelper", () => {
   const spec = {
      mountIds: ["/help/$topicId", "/inventory/help/$topicId"],
      sourceLabel: "src/routes/help/$topicId.tsx",
      runtimeSpecifier: "../../sharedRoutes.gen",
      banner: DEFAULT_BANNER,
   };

   it("renders a 2-mount sibling with the expected ids, banner, and comments", () => {
      const content = renderHelper(spec);
      expect(content.startsWith(`${DEFAULT_BANNER}\n`)).toBe(true);
      expect(content).toContain("/* eslint-disable */");
      expect(content).toContain("// source: src/routes/help/$topicId.tsx");
      expect(content).toContain("// mounts: /help/$topicId, /inventory/help/$topicId");
      expect(content).toContain(
         'type MountFilePaths = "/help/$topicId" | "/inventory/help/$topicId";',
      );
      expect(content).toContain('"/help/$topicId",');
      expect(content).toContain('"/inventory/help/$topicId",');
      // all machinery lives in the runtime module; the sibling only instantiates it
      expect(content).toContain('import { makeSharedRoute } from "../../sharedRoutes.gen";');
      expect(content).toContain("export const shared = makeSharedRoute<MountFilePaths>(");
      // error message names the extensionless source path
      expect(content).toContain('"src/routes/help/$topicId",');
   });

   it("renders a single-literal union for a single mount", () => {
      const content = renderHelper({ ...spec, mountIds: ["/help/$topicId"] });
      expect(content).toContain('type MountFilePaths = "/help/$topicId";');
      expect(content).toContain("// mounts: /help/$topicId\n");
   });

   it("dedupes mount ids defensively", () => {
      const content = renderHelper({
         ...spec,
         mountIds: ["/help/$topicId", "/help/$topicId"],
      });
      expect(content).toContain('type MountFilePaths = "/help/$topicId";');
   });

   it("is deterministic (same spec, same bytes)", () => {
      expect(renderHelper(spec)).toBe(renderHelper(spec));
   });
});
