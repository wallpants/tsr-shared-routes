import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyMountFile,
  discoverMountFiles,
  discoverMounts,
  isMountFile,
  MOUNT_SCAFFOLD,
  parseMountFile,
  scaffoldEmptyMountFile,
} from "../../src/core/discover";
import { SharedRoutesError } from "../../src/core/errors";
import { makeTmpDir, mountFileSource, writeTree } from "../helpers";

function expectParseError(code: string): SharedRoutesError {
  try {
    parseMountFile(code, "/x/routes/a.mount.ts");
  } catch (error) {
    expect(error).toBeInstanceOf(SharedRoutesError);
    expect((error as SharedRoutesError).code).toBe("MOUNT_PARSE_ERROR");
    return error as SharedRoutesError;
  }
  throw new Error("expected parseMountFile to throw");
}

describe("isMountFile", () => {
  it("matches .mount.ts and .mount.js only", () => {
    expect(isMountFile("providers.mount.ts")).toBe(true);
    expect(isMountFile("providers.mount.js")).toBe(true);
    expect(isMountFile("providers.mount.tsx")).toBe(false);
    expect(isMountFile("providers.ts")).toBe(false);
    expect(isMountFile("mount.ts")).toBe(false);
  });
});

describe("parseMountFile", () => {
  it("accepts the canonical form", () => {
    expect(parseMountFile(mountFileSource("../../shared/providers"), "a.mount.ts")).toBe(
      "../../shared/providers",
    );
  });

  it("accepts a renamed import", () => {
    const code = `import { mount as m } from 'tsr-shared-routes'\nexport default m('./shared')\n`;
    expect(parseMountFile(code, "a.mount.ts")).toBe("./shared");
  });

  it("accepts double quotes, semicolons, and comments", () => {
    const code = [
      "// mounts the shared providers tree",
      `import { mount } from "tsr-shared-routes";`,
      "/* block comment */",
      `export default mount("../shared"); // trailing`,
      "",
    ].join("\n");
    expect(parseMountFile(code, "a.mount.ts")).toBe("../shared");
  });

  it("rejects a template literal argument (even without expressions)", () => {
    const error = expectParseError(
      "import { mount } from 'tsr-shared-routes'\nexport default mount(`./shared`)\n",
    );
    expect(error.message).toContain("template literal");
    expect(error.message).toContain("export default mount(");
  });

  it("rejects a variable argument", () => {
    expectParseError(
      "import { mount } from 'tsr-shared-routes'\nconst dir = './shared'\nexport default mount(dir)\n",
    );
  });

  it("rejects a computed argument", () => {
    expectParseError(
      "import { mount } from 'tsr-shared-routes'\nexport default mount('./sh' + 'ared')\n",
    );
  });

  it("rejects a missing import", () => {
    const error = expectParseError("export default mount('./shared')\n");
    expect(error.message).toContain("tsr-shared-routes");
  });

  it("rejects an import from another module", () => {
    expectParseError("import { mount } from 'other-package'\nexport default mount('./shared')\n");
  });

  it("rejects a default import", () => {
    expectParseError(
      "import mount from 'tsr-shared-routes'\nexport default mount('./shared')\n",
    );
  });

  it("rejects a missing default export", () => {
    expectParseError("import { mount } from 'tsr-shared-routes'\nmount('./shared')\n");
  });

  it("rejects calling something other than the mount import", () => {
    expectParseError(
      "import { mount } from 'tsr-shared-routes'\nconst other = mount\nexport default other('./shared')\n",
    );
  });

  it("rejects extra arguments", () => {
    expectParseError(
      "import { mount } from 'tsr-shared-routes'\nexport default mount('./shared', {})\n",
    );
  });

  it("rejects unparseable files", () => {
    expectParseError("this is not typescript ((((");
  });
});

describe("classifyMountFile", () => {
  it("classifies a blank file as incomplete", () => {
    expect(classifyMountFile("", "a.mount.ts")).toEqual({ kind: "incomplete" });
    expect(classifyMountFile("  \n\n", "a.mount.ts")).toEqual({ kind: "incomplete" });
  });

  it("classifies the scaffold's empty-string argument as incomplete", () => {
    const code = "import { mount } from 'tsr-shared-routes'\nexport default mount('')\n";
    expect(classifyMountFile(code, "a.mount.ts")).toEqual({ kind: "incomplete" });
    expect(classifyMountFile(MOUNT_SCAFFOLD, "a.mount.ts")).toEqual({ kind: "incomplete" });
  });

  it("classifies the canonical form as valid", () => {
    expect(classifyMountFile(mountFileSource("../shared"), "a.mount.ts")).toEqual({
      kind: "valid",
      sharedDirRelative: "../shared",
    });
  });

  it("classifies anything else as invalid with the accepted-form error", () => {
    const result = classifyMountFile("export default mount('./x')\n", "a.mount.ts");
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(result.error).toBeInstanceOf(SharedRoutesError);
      expect(result.error.message).toContain("export default mount(");
    }
  });
});

describe("scaffoldEmptyMountFile", () => {
  it("writes the boilerplate into a byte-empty mount file only", () => {
    const root = makeTmpDir();
    writeTree(root, {
      "routes/a.mount.ts": "",
      "routes/b.mount.ts": "// almost empty\n",
    });
    const a = path.join(root, "routes", "a.mount.ts");
    const b = path.join(root, "routes", "b.mount.ts");
    expect(scaffoldEmptyMountFile(a, "")).toBe(true);
    expect(fs.readFileSync(a, "utf8")).toBe(MOUNT_SCAFFOLD);
    expect(scaffoldEmptyMountFile(b, "// almost empty\n")).toBe(false);
    expect(fs.readFileSync(b, "utf8")).toBe("// almost empty\n");
  });
});

describe("discoverMountFiles / discoverMounts", () => {
  it("walks recursively and skips dot-dirs and node_modules", () => {
    const root = makeTmpDir();
    writeTree(root, {
      "routes/inventory/providers.mount.ts": mountFileSource("../../shared"),
      "routes/finances/deep/nested.mount.js": mountFileSource("../../../shared"),
      "routes/.hidden/skipped.mount.ts": mountFileSource("../shared"),
      "routes/node_modules/skipped.mount.ts": mountFileSource("../shared"),
      "routes/regular.tsx": "export {}",
    });
    const routesDir = path.join(root, "routes");
    const found = discoverMountFiles(routesDir);
    expect(found).toEqual([
      path.join(routesDir, "finances", "deep", "nested.mount.js"),
      path.join(routesDir, "inventory", "providers.mount.ts"),
    ]);

    const { mounts, skipped, warnings } = discoverMounts(routesDir);
    expect(skipped).toEqual([]);
    expect(warnings).toEqual([]);
    expect(mounts).toEqual([
      {
        mountFilePath: path.join(routesDir, "finances", "deep", "nested.mount.js"),
        sharedDirRelative: "../../../shared",
      },
      {
        mountFilePath: path.join(routesDir, "inventory", "providers.mount.ts"),
        sharedDirRelative: "../../shared",
      },
    ]);
  });

  it("skips incomplete mount files and, in lenient mode, invalid ones", () => {
    const root = makeTmpDir();
    writeTree(root, {
      "routes/good.mount.ts": mountFileSource("../shared"),
      "routes/blank.mount.ts": "",
      "routes/broken.mount.ts": "not even close ((((",
    });
    const routesDir = path.join(root, "routes");

    expect(() => discoverMounts(routesDir)).toThrow(SharedRoutesError); // strict
    const result = discoverMounts(routesDir, { lenient: true });
    expect(result.mounts.map((m) => path.basename(m.mountFilePath))).toEqual(["good.mount.ts"]);
    expect(result.skipped).toHaveLength(2);
    expect(result.warnings).toHaveLength(1); // broken only — blank is not warned about
    expect(result.incomplete).toHaveLength(1);
  });

  it("scaffolds byte-empty mount files when asked and reports them", () => {
    const root = makeTmpDir();
    writeTree(root, { "routes/new.mount.ts": "" });
    const routesDir = path.join(root, "routes");
    const result = discoverMounts(routesDir, { lenient: true, scaffold: true });
    const mountFile = path.join(routesDir, "new.mount.ts");
    expect(result.scaffolded).toEqual([mountFile]);
    expect(result.mounts).toEqual([]);
    expect(fs.readFileSync(mountFile, "utf8")).toBe(MOUNT_SCAFFOLD);
  });

  it("returns an empty list for a missing routes directory", () => {
    const root = makeTmpDir();
    expect(discoverMountFiles(path.join(root, "does-not-exist"))).toEqual([]);
  });
});
