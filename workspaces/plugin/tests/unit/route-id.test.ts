import { physicalGetRouteNodes } from "@tanstack/router-generator";
import { describe, expect, it } from "vitest";
import { computeRouteIdLiteral } from "../../src/core/route-id";
import { makeTmpDir, writeTree } from "../helpers";

/**
 * ORACLE TEST: materializes a wrapper-shaped file tree and asserts that our
 * computed literal equals the `routePath` the REAL stock physical scan derives
 * for every file. This pins route-id.ts to stock semantics.
 */

const FIXTURE_FILES = [
   // plain nested files
   "inventory/providers/index.tsx",
   "inventory/providers/$providerId.tsx",
   "inventory/providers/route.tsx",
   "inventory/providers/deep/nested/leaf.tsx",
   // root-level entries
   "index.tsx",
   "$param.tsx",
   "about.tsx",
   // dot-flat names (files and directories)
   "a.b.tsx",
   "a.b/c.tsx",
   "inventory.providers/index.tsx",
   // groups
   "(group)/inside.tsx",
   "(group)/index.tsx",
   // pathless layouts
   "_pathless.tsx",
   "_pathless/inside.tsx",
   "_pathless/index.tsx",
   // lazy
   "inventory/providers/chart.lazy.tsx",
   "inventory/providers/index.lazy.tsx",
   "inventory/providers/$providerId.lazy.tsx",
   "a.b.lazy.tsx",
   // escaped segments
   "escaped/script[.]js.tsx",
   "escaped/[index].tsx",
   // trailing-underscore (un-nesting) names
   "blog_/post.tsx",
] as const;

async function oracleRoutePaths(files: ReadonlyArray<string>): Promise<Map<string, string>> {
   const routesDirectory = makeTmpDir();
   writeTree(routesDirectory, Object.fromEntries(files.map((file) => [file, ""])));
   const { routeNodes } = await physicalGetRouteNodes(
      {
         routesDirectory,
         routeFileIgnorePrefix: "-",
         disableLogging: true,
         indexToken: "index",
         routeToken: "route",
      },
      routesDirectory,
      {
         indexTokenSegmentRegex: /^index$/,
         routeTokenSegmentRegex: /^route$/,
      },
   );
   return new Map(routeNodes.map((node) => [node.filePath, node.routePath ?? "<missing>"]));
}

describe("computeRouteIdLiteral (oracle vs stock physicalGetRouteNodes)", () => {
   it("matches the stock routePath for every fixture file", async () => {
      const oracle = await oracleRoutePaths(FIXTURE_FILES);
      expect(oracle.size).toBe(FIXTURE_FILES.length);
      for (const file of FIXTURE_FILES) {
         const expected = oracle.get(file);
         expect(expected, `oracle missing ${file}`).toBeDefined();
         expect(computeRouteIdLiteral(file), `literal mismatch for ${file}`).toBe(expected);
      }
   });

   it("matches the stock routePath with custom index/route tokens", async () => {
      const files = ["providers/home.tsx", "providers/page.tsx", "providers/other.tsx"];
      const routesDirectory = makeTmpDir();
      writeTree(routesDirectory, Object.fromEntries(files.map((file) => [file, ""])));
      const { routeNodes } = await physicalGetRouteNodes(
         {
            routesDirectory,
            routeFileIgnorePrefix: "-",
            disableLogging: true,
            indexToken: "home",
            routeToken: "page",
         },
         routesDirectory,
         {
            indexTokenSegmentRegex: /^home$/,
            routeTokenSegmentRegex: /^page$/,
         },
      );
      const oracle = new Map(routeNodes.map((node) => [node.filePath, node.routePath]));
      for (const file of files) {
         expect(
            computeRouteIdLiteral(file, { indexToken: "home", routeToken: "page" }),
            `literal mismatch for ${file}`,
         ).toBe(oracle.get(file));
      }
   });

   it("spot-checks the spike literals", () => {
      expect(computeRouteIdLiteral("inventory/providers/index.tsx")).toBe("/inventory/providers/");
      expect(computeRouteIdLiteral("inventory/providers/$providerId.tsx")).toBe(
         "/inventory/providers/$providerId",
      );
      expect(computeRouteIdLiteral("inventory/providers/chart.lazy.tsx")).toBe(
         "/inventory/providers/chart",
      );
   });
});
