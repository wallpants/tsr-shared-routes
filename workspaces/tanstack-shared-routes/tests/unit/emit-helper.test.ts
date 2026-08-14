import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_BANNER } from "../../src/config";
import { helperPathFor, renderHelper } from "../../src/core/emit-helper";

describe("helperPathFor", () => {
  it("replaces the route extension with .gen.tsx, keeping the directory", () => {
    expect(helperPathFor(path.join("/p", "shared", "providers", "$providerId.tsx"))).toBe(
      path.join("/p", "shared", "providers", "$providerId.gen.tsx"),
    );
    expect(helperPathFor(path.join("/p", "shared", "index.ts"))).toBe(
      path.join("/p", "shared", "index.gen.tsx"),
    );
    expect(helperPathFor(path.join("/p", "shared", "stats.overview.tsx"))).toBe(
      path.join("/p", "shared", "stats.overview.gen.tsx"),
    );
  });
});

describe("renderHelper", () => {
  const spec = {
    mountIds: ["/inventory/providers/$providerId", "/finances/providers/$providerId"],
    sourceLabel: "src/shared/providers/$providerId.tsx",
    runtimeSpecifier: "./__shared-routes.gen",
    banner: DEFAULT_BANNER,
  };

  it("renders a 2-mount helper with the expected ids, banner, and comments", () => {
    const content = renderHelper(spec);
    expect(content.startsWith(`${DEFAULT_BANNER}\n`)).toBe(true);
    expect(content).toContain("/* eslint-disable */");
    expect(content).toContain("// source: src/shared/providers/$providerId.tsx");
    expect(content).toContain(
      "// mounts: /inventory/providers/$providerId, /finances/providers/$providerId",
    );
    expect(content).toContain(
      'type MountFilePaths = "/inventory/providers/$providerId" | "/finances/providers/$providerId";',
    );
    expect(content).toContain('"/inventory/providers/$providerId",');
    expect(content).toContain('"/finances/providers/$providerId",');
    // all machinery lives in the package; the helper only instantiates it
    expect(content).toContain('import { makeCreateSharedRoute } from "./__shared-routes.gen";');
    expect(content).toContain(
      "export const createSharedRoute = makeCreateSharedRoute<MountFilePaths>(",
    );
    // error message names the extensionless source path
    expect(content).toContain('"src/shared/providers/$providerId",');
  });

  it("renders a single-literal union for a single mount", () => {
    const content = renderHelper({ ...spec, mountIds: ["/inventory/providers/$providerId"] });
    expect(content).toContain('type MountFilePaths = "/inventory/providers/$providerId";');
    expect(content).toContain("// mounts: /inventory/providers/$providerId\n");
  });

  it("dedupes mount ids defensively", () => {
    const content = renderHelper({
      ...spec,
      mountIds: ["/inventory/providers/$providerId", "/inventory/providers/$providerId"],
    });
    expect(content).toContain('type MountFilePaths = "/inventory/providers/$providerId";');
  });

  it("is deterministic (same spec, same bytes)", () => {
    expect(renderHelper(spec)).toBe(renderHelper(spec));
  });
});
