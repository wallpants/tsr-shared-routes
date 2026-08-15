import { describe, expect, it } from "vitest";
import { hasRouteExport } from "../../src/core/scaffold";
import { stockLazyRouteSource, stockRouteSource } from "../helpers";

describe("hasRouteExport", () => {
   it("detects the stock export forms", () => {
      expect(hasRouteExport(stockRouteSource("/help"))).toBe(true);
      expect(hasRouteExport(stockLazyRouteSource("/help"))).toBe(true);
      expect(hasRouteExport("export let Route = x\n")).toBe(true);
      expect(hasRouteExport("export function Route() {}\n")).toBe(true);
      expect(hasRouteExport("const R = 1\nexport { R as Route }\n")).toBe(true);
      expect(hasRouteExport("export { Route }\n")).toBe(true);
   });

   it("rejects files without a Route export", () => {
      expect(hasRouteExport("")).toBe(false);
      expect(hasRouteExport("export const route = 1\n")).toBe(false);
      expect(hasRouteExport("export const RouteThing = 1\n")).toBe(false);
      expect(hasRouteExport("const Route = 1\n")).toBe(false);
      expect(hasRouteExport("export { Route as Other }\n")).toBe(false);
   });
});
