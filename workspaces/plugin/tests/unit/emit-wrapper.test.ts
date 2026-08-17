import { describe, expect, it } from "vitest";
import { DEFAULT_BANNER } from "../../src/config";
import { computeImportPath, decideWrite, renderWrapper } from "../../src/core/emit-wrapper";
import { replaceRouteIdLiteral } from "../../src/core/fsio";

const BASE = {
   routeIdLiteral: "/inventory/help/$topicId",
   targetPath: "/proj/src/routes/inventory/help/$topicId.tsx",
   sharedFilePath: "/proj/src/routes/help/$topicId.tsx",
   mountIds: ["/help/$topicId", "/inventory/help/$topicId"],
   runtimeSpecifier: "../../../sharedRoutes.gen",
   sourceLabel: "src/routes/help/$topicId.tsx",
   mountLabel: "src/routes/inventory/help.mount.ts",
   banner: DEFAULT_BANNER,
} as const;

describe("computeImportPath", () => {
   it("computes a posix, extensionless, dot-prefixed path", () => {
      expect(
         computeImportPath(
            "/proj/src/routes/inventory/help/$topicId.tsx",
            "/proj/src/routes/help/$topicId.tsx",
         ),
      ).toBe("../../help/$topicId");
   });

   it("keeps the index and .lazy name parts", () => {
      expect(computeImportPath("/proj/routes/a/index.tsx", "/proj/routes/help/index.tsx")).toBe(
         "../help/index",
      );
      expect(
         computeImportPath("/proj/routes/a/chart.lazy.tsx", "/proj/routes/help/chart.lazy.tsx"),
      ).toBe("../help/chart.lazy");
   });

   it("prefixes ./ for sibling-level paths", () => {
      expect(computeImportPath("/proj/routes/a/x.tsx", "/proj/routes/a/help/x.tsx")).toBe(
         "./help/x",
      );
   });
});

describe("renderWrapper", () => {
   it("renders the spike-shaped non-lazy wrapper (patch + extracted generics + spread)", () => {
      const content = renderWrapper({ ...BASE, kind: "wrapper", mountIds: [...BASE.mountIds] });
      expect(content).toBe(
         `${DEFAULT_BANNER}
/* eslint-disable */
// source: src/routes/help/$topicId.tsx (mount: src/routes/inventory/help.mount.ts)
import type { Register } from "@tanstack/react-router"
import { createFileRoute } from "@tanstack/react-router"
import type { SourceRouteTypes } from "../../../sharedRoutes.gen"
import { patchSharedHooks } from "../../../sharedRoutes.gen"
import { Route as shared } from "../../help/$topicId"

patchSharedHooks(shared, ["/help/$topicId", "/inventory/help/$topicId"])

type T = SourceRouteTypes<typeof shared>

const { id: _id, path: _path, getParentRoute: _getParentRoute, ...sourceOptions } = shared.options as any

export const Route = createFileRoute("/inventory/help/$topicId")<
  Register,
  T["searchValidator"],
  T["params"],
  T["routeContextFn"],
  T["beforeLoadFn"],
  T["loaderDeps"],
  T["loaderFn"],
  unknown,
  T["ssr"],
  T["middlewares"],
  T["handlers"]
>({ ...sourceOptions })
`,
      );
   });

   it("renders the lazy wrapper: patch + id-stripped options spread", () => {
      const content = renderWrapper({
         ...BASE,
         kind: "wrapper-lazy",
         routeIdLiteral: "/inventory/help/chart",
         targetPath: "/proj/src/routes/inventory/help/chart.lazy.tsx",
         sharedFilePath: "/proj/src/routes/help/chart.lazy.tsx",
         mountIds: ["/help/chart", "/inventory/help/chart"],
         sourceLabel: "src/routes/help/chart.lazy.tsx",
      });
      expect(content).toBe(
         `${DEFAULT_BANNER}
/* eslint-disable */
// source: src/routes/help/chart.lazy.tsx (mount: src/routes/inventory/help.mount.ts)
import { createLazyFileRoute } from "@tanstack/react-router"
import { patchSharedHooks } from "../../../sharedRoutes.gen"
import { Route as sharedLazy } from "../../help/chart.lazy"

patchSharedHooks(sharedLazy, ["/help/chart", "/inventory/help/chart"])

const { id: _id, ...lazyOptions } = sharedLazy.options

export const Route = createLazyFileRoute("/inventory/help/chart")({ ...lazyOptions })
`,
      );
   });

   it("dedupes mount ids defensively", () => {
      const content = renderWrapper({
         ...BASE,
         kind: "wrapper",
         mountIds: ["/help/$topicId", "/help/$topicId", "/inventory/help/$topicId"],
      });
      expect(content).toContain(
         'patchSharedHooks(shared, ["/help/$topicId", "/inventory/help/$topicId"])',
      );
   });
});

describe("decideWrite", () => {
   const desired = renderWrapper({ ...BASE, kind: "wrapper", mountIds: [...BASE.mountIds] });

   it("writes when the file is missing", () => {
      expect(decideWrite(undefined, desired)).toEqual({ action: "write", content: desired });
   });

   it("skips when byte-identical", () => {
      expect(decideWrite(desired, desired)).toEqual({ action: "skip", content: desired });
   });

   it("adopts the on-disk literal when only the literal differs (writes nothing)", () => {
      const corrected = replaceRouteIdLiteral(desired, "/generator/corrected");
      const decision = decideWrite(corrected, desired);
      expect(decision.action).toBe("adopt");
      expect(decision.content).toBe(corrected);
   });

   it("rewrites structural changes but keeps the on-disk literal", () => {
      const onDisk = replaceRouteIdLiteral(desired, "/generator/corrected").replace(
         "src/routes/help/$topicId.tsx",
         "src/old-location/$topicId.tsx",
      );
      const decision = decideWrite(onDisk, desired);
      expect(decision.action).toBe("write");
      expect(decision.content).toContain('createFileRoute("/generator/corrected")');
      expect(decision.content).toContain("src/routes/help/$topicId.tsx");
   });
});
