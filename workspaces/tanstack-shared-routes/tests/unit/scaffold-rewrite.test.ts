import { describe, expect, it } from "vitest";
import { rewriteToHelper, rewriteToPackage } from "../../src/core/rewrite-imports";
import { hasSharedExport, hasSharedLazyExport } from "../../src/core/scaffold";
import { createSharedRoute } from "../../src/index";

describe("hasSharedExport / hasSharedLazyExport", () => {
  it("detects the common export forms", () => {
    expect(hasSharedExport("export const shared = createSharedRoute({})\n")).toBe(true);
    expect(hasSharedExport("export function shared() {}\n")).toBe(true);
    expect(hasSharedExport("const shared = 1\nexport { shared }\n")).toBe(true);
    expect(hasSharedExport("const s = 1\nexport { s as shared }\n")).toBe(true);
    expect(hasSharedLazyExport("export const sharedLazy = {}\n")).toBe(true);
  });

  it("rejects near-misses", () => {
    expect(hasSharedExport("")).toBe(false);
    expect(hasSharedExport("const shared = 1\n")).toBe(false);
    expect(hasSharedExport("export const sharedThing = 1\n")).toBe(false);
    expect(hasSharedExport("export const sharedLazy = {}\n")).toBe(false);
    expect(hasSharedLazyExport("export const shared = {}\n")).toBe(false);
  });
});

describe("rewriteToHelper / rewriteToPackage", () => {
  const filePath = "/proj/src/shared/providers/$providerId.tsx";

  it("retargets only the module specifier, preserving everything else", () => {
    const code =
      "import { z } from 'zod'\nimport { createSharedRoute } from \"tanstack-shared-routes\";\n\nexport const shared = createSharedRoute({})\n";
    const next = rewriteToHelper(code, filePath);
    expect(next).toBe(
      "import { z } from 'zod'\nimport { createSharedRoute } from \"./$providerId.gen\";\n\nexport const shared = createSharedRoute({})\n",
    );
  });

  it("supports aliased specifiers and is a no-op when already retargeted", () => {
    const aliased =
      "import { createSharedRoute as make } from 'tanstack-shared-routes'\nexport const shared = make({})\n";
    expect(rewriteToHelper(aliased, filePath)).toContain("from './$providerId.gen'");
    const done = "import { createSharedRoute } from './$providerId.gen'\n";
    expect(rewriteToHelper(done, filePath)).toBeUndefined();
  });

  it("retargets a stale .gen specifier left behind by a rename", () => {
    const stale =
      "import { createSharedRoute } from './oldName.gen'\nexport const shared = createSharedRoute({})\n";
    expect(rewriteToHelper(stale, filePath)).toContain("from './$providerId.gen'");
    // non-.gen relative imports are never touched
    const sibling = "import { createSharedRoute } from './factory'\n";
    expect(rewriteToHelper(sibling, filePath)).toBeUndefined();
  });

  it("leaves unrelated imports and broken files alone", () => {
    expect(rewriteToHelper("import { mount } from 'tanstack-shared-routes'\n", filePath)).toBe(
      undefined,
    );
    expect(rewriteToHelper("not valid ts ((((", filePath)).toBeUndefined();
  });

  it("rewriteToPackage points any .gen specifier back at the package", () => {
    const code = "import { createSharedRoute } from './$providerId.gen'\n";
    expect(rewriteToPackage(code)).toBe(
      "import { createSharedRoute } from 'tanstack-shared-routes'\n",
    );
    expect(rewriteToPackage("import { createSharedRoute } from './other.gen'\n")).toBe(
      "import { createSharedRoute } from 'tanstack-shared-routes'\n",
    );
    expect(rewriteToPackage("import { createSharedRoute } from './factory'\n")).toBeUndefined();
  });
});

describe("placeholder createSharedRoute", () => {
  it("stores options and throws a helpful error from every hook", () => {
    const options = { loader: () => 1 };
    const shared = createSharedRoute(options);
    expect(shared.options).toBe(options);
    expect(() => shared.useParams()).toThrow(/not mounted anywhere yet/);
    expect(() => shared.useLoaderData()).toThrow(/\*\.mount\.ts/);
  });
});
