import { describe, expect, it } from "vitest";
import { DEFAULT_BANNER } from "../../src/config";
import { computeImportPath, decideWrite, renderWrapper } from "../../src/core/emit-wrapper";
import { replaceRouteIdLiteral } from "../../src/core/fsio";

const BASE = {
   routeIdLiteral: "/inventory/providers/$providerId",
   targetPath: "/proj/src/routes/inventory/providers/$providerId.tsx",
   sharedFilePath: "/proj/src/shared/providers/$providerId.tsx",
   sourceLabel: "src/shared/providers/$providerId.tsx",
   mountLabel: "src/routes/inventory/providers.mount.ts",
   banner: DEFAULT_BANNER,
} as const;

describe("computeImportPath", () => {
   it("computes a posix, extensionless, dot-prefixed path", () => {
      expect(
         computeImportPath(
            "/proj/src/routes/inventory/providers/$providerId.tsx",
            "/proj/src/shared/providers/$providerId.tsx",
         ),
      ).toBe("../../../shared/providers/$providerId");
   });

   it("keeps the index and .lazy name parts", () => {
      expect(computeImportPath("/proj/routes/a/index.tsx", "/proj/shared/index.tsx")).toBe(
         "../../shared/index",
      );
      expect(
         computeImportPath("/proj/routes/a/chart.lazy.tsx", "/proj/shared/chart.lazy.tsx"),
      ).toBe("../../shared/chart.lazy");
   });

   it("prefixes ./ for sibling-level paths", () => {
      expect(computeImportPath("/proj/routes/a/x.tsx", "/proj/routes/a/shared/x.tsx")).toBe(
         "./shared/x",
      );
   });
});

describe("renderWrapper", () => {
   it("renders the spike-shaped non-lazy wrapper", () => {
      const content = renderWrapper({ ...BASE, kind: "wrapper" });
      expect(content).toBe(
         `${DEFAULT_BANNER}
/* eslint-disable */
// source: src/shared/providers/$providerId.tsx (mount: src/routes/inventory/providers.mount.ts)
import type { Register } from '@tanstack/react-router'
import { createFileRoute } from '@tanstack/react-router'
import { shared } from '../../../shared/providers/$providerId'

type T = (typeof shared)['~types']

export const Route = createFileRoute('/inventory/providers/$providerId')<
  Register,
  T['searchValidator'],
  T['params'],
  T['routeContextFn'],
  T['beforeLoadFn'],
  T['loaderDeps'],
  T['loaderFn'],
  unknown,
  T['ssr'],
  T['middlewares'],
  T['handlers']
>({ ...shared.options } as any)
`,
      );
   });

   it("renders the lazy wrapper without type args or Register import", () => {
      const content = renderWrapper({
         ...BASE,
         kind: "wrapper-lazy",
         routeIdLiteral: "/inventory/providers/chart",
         targetPath: "/proj/src/routes/inventory/providers/chart.lazy.tsx",
         sharedFilePath: "/proj/src/shared/providers/chart.lazy.tsx",
         sourceLabel: "src/shared/providers/chart.lazy.tsx",
      });
      expect(content).toBe(
         `${DEFAULT_BANNER}
/* eslint-disable */
// source: src/shared/providers/chart.lazy.tsx (mount: src/routes/inventory/providers.mount.ts)
import { createLazyFileRoute } from '@tanstack/react-router'
import { sharedLazy } from '../../../shared/providers/chart.lazy'

export const Route = createLazyFileRoute('/inventory/providers/chart')(sharedLazy)
`,
      );
   });
});

describe("decideWrite", () => {
   const desired = renderWrapper({ ...BASE, kind: "wrapper" });

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
         "src/shared/providers/$providerId.tsx",
         "src/old-location/$providerId.tsx",
      );
      const decision = decideWrite(onDisk, desired);
      expect(decision.action).toBe("write");
      expect(decision.content).toContain("createFileRoute('/generator/corrected')");
      expect(decision.content).toContain("src/shared/providers/$providerId.tsx");
   });
});
