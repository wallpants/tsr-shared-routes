import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  discoverMountFiles,
  discoverMounts,
  isMountFile,
  parseMountFile,
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
    const code = `import { mount as m } from 'tanstack-shared-routes'\nexport default m('./shared')\n`;
    expect(parseMountFile(code, "a.mount.ts")).toBe("./shared");
  });

  it("accepts double quotes, semicolons, and comments", () => {
    const code = [
      "// mounts the shared providers tree",
      `import { mount } from "tanstack-shared-routes";`,
      "/* block comment */",
      `export default mount("../shared"); // trailing`,
      "",
    ].join("\n");
    expect(parseMountFile(code, "a.mount.ts")).toBe("../shared");
  });

  it("rejects a template literal argument (even without expressions)", () => {
    const error = expectParseError(
      "import { mount } from 'tanstack-shared-routes'\nexport default mount(`./shared`)\n",
    );
    expect(error.message).toContain("template literal");
    expect(error.message).toContain("export default mount(");
  });

  it("rejects a variable argument", () => {
    expectParseError(
      "import { mount } from 'tanstack-shared-routes'\nconst dir = './shared'\nexport default mount(dir)\n",
    );
  });

  it("rejects a computed argument", () => {
    expectParseError(
      "import { mount } from 'tanstack-shared-routes'\nexport default mount('./sh' + 'ared')\n",
    );
  });

  it("rejects a missing import", () => {
    const error = expectParseError("export default mount('./shared')\n");
    expect(error.message).toContain("tanstack-shared-routes");
  });

  it("rejects an import from another module", () => {
    expectParseError("import { mount } from 'other-package'\nexport default mount('./shared')\n");
  });

  it("rejects a default import", () => {
    expectParseError(
      "import mount from 'tanstack-shared-routes'\nexport default mount('./shared')\n",
    );
  });

  it("rejects a missing default export", () => {
    expectParseError("import { mount } from 'tanstack-shared-routes'\nmount('./shared')\n");
  });

  it("rejects calling something other than the mount import", () => {
    expectParseError(
      "import { mount } from 'tanstack-shared-routes'\nconst other = mount\nexport default other('./shared')\n",
    );
  });

  it("rejects extra arguments", () => {
    expectParseError(
      "import { mount } from 'tanstack-shared-routes'\nexport default mount('./shared', {})\n",
    );
  });

  it("rejects an empty string", () => {
    expectParseError("import { mount } from 'tanstack-shared-routes'\nexport default mount('')\n");
  });

  it("rejects unparseable files", () => {
    expectParseError("this is not typescript ((((");
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

    const mounts = discoverMounts(routesDir);
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

  it("returns an empty list for a missing routes directory", () => {
    const root = makeTmpDir();
    expect(discoverMountFiles(path.join(root, "does-not-exist"))).toEqual([]);
  });
});
