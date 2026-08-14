import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CliIO } from "../../src/cli";
import { main } from "../../src/cli";
import { exists, makeTmpDir, mountFileSource, readFile, writeTree } from "../helpers";

function makeFixture(): string {
  const root = makeTmpDir();
  writeTree(root, {
    "src/routes/inventory/providers.mount.ts": mountFileSource("../../shared/providers"),
    "src/shared/providers/index.tsx": "export const shared = {} as any\n",
    "src/shared/providers/$providerId.tsx": "export const shared = {} as any\n",
  });
  return root;
}

function makeIO(): CliIO & { logs: Array<string>; errors: Array<string> } {
  const logs: Array<string> = [];
  const errors: Array<string> = [];
  return {
    logs,
    errors,
    log: (message) => logs.push(message),
    error: (message) => errors.push(message),
  };
}

describe("cli main", () => {
  it("generate writes wrappers and reports them", () => {
    const root = makeFixture();
    const io = makeIO();
    const code = main(["generate", "--root", root], io);
    expect(code).toBe(0);
    expect(exists(path.join(root, "src/routes/inventory/providers/index.tsx"))).toBe(true);
    expect(io.logs).toContain("wrote src/routes/inventory/providers/$providerId.tsx");
    expect(io.logs).toContain("wrote src/shared/providers/$providerId.gen.tsx");
    expect(io.logs.at(-1)).toBe("done: 5 written, 0 deleted, 0 unchanged");
  });

  it("--check on a dirty project prints would-be changes and exits 1 without writing", () => {
    const root = makeFixture();
    const io = makeIO();
    const code = main(["generate", "--check", "--root", root], io);
    expect(code).toBe(1);
    expect(io.logs).toContain("would write src/routes/inventory/providers/index.tsx");
    expect(exists(path.join(root, "src/routes/inventory/providers/index.tsx"))).toBe(false);
  });

  it("--check on a clean project exits 0", () => {
    const root = makeFixture();
    expect(main(["generate", "--root", root], makeIO())).toBe(0);
    const io = makeIO();
    const code = main(["generate", "--check", "--root", root], io);
    expect(code).toBe(0);
    expect(io.logs).toContain("clean: 5 generated file(s) up to date");
  });

  it("honors shared-routes.config.json at the root", () => {
    const root = makeTmpDir();
    writeTree(root, {
      "shared-routes.config.json": JSON.stringify({ routesDirectory: "./app/routes" }),
      "app/routes/inventory/providers.mount.ts": mountFileSource("../../shared/providers"),
      "app/shared/providers/index.tsx": "export const shared = {} as any\n",
    });
    const io = makeIO();
    expect(main(["generate", "--root", root], io)).toBe(0);
    expect(exists(path.join(root, "app/routes/inventory/providers/index.tsx"))).toBe(true);
  });

  it("reports an unparsable config file and exits 1", () => {
    const root = makeFixture();
    writeTree(root, { "shared-routes.config.json": "{ not json" });
    const io = makeIO();
    expect(main(["generate", "--root", root], io)).toBe(1);
    expect(io.errors[0]).toContain("shared-routes.config.json");
  });

  it("reports pipeline errors with the fix message and exits 1", () => {
    const root = makeFixture();
    writeTree(root, {
      "src/routes/inventory/providers/index.tsx": "// my own route\n",
    });
    const io = makeIO();
    expect(main(["generate", "--root", root], io)).toBe(1);
    expect(io.errors[0]).toContain("refusing to overwrite");
    expect(readFile(path.join(root, "src/routes/inventory/providers/index.tsx"))).toBe(
      "// my own route\n",
    );
  });

  it("rejects unknown commands and options with usage", () => {
    const io = makeIO();
    expect(main(["frobnicate"], io)).toBe(1);
    expect(io.errors[0]).toContain("Usage:");

    const io2 = makeIO();
    expect(main(["generate", "--frobnicate"], io2)).toBe(1);
    expect(io2.errors[0]).toContain("Usage:");

    const io3 = makeIO();
    expect(main([], io3)).toBe(1);
    expect(io3.logs[0]).toContain("Usage:");

    const io4 = makeIO();
    expect(main(["--help"], io4)).toBe(0);
    expect(io4.logs[0]).toContain("Usage:");
  });
});
