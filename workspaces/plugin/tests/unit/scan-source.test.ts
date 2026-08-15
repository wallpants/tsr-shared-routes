import { describe, expect, it } from "vitest";
import { SharedRoutesError } from "../../src/core/errors";
import { scanSourceDir } from "../../src/core/scan-source";
import { makeTmpDir, mountFileSource, writeTree } from "../helpers";

const OPTS = { routeFileIgnorePrefix: "-" };

function expectScanError(dir: string, code: string): void {
   try {
      scanSourceDir(dir, OPTS);
   } catch (error) {
      expect(error).toBeInstanceOf(SharedRoutesError);
      expect((error as SharedRoutesError).code).toBe(code);
      return;
   }
   throw new Error("expected scanSourceDir to throw");
}

describe("scanSourceDir", () => {
   it("classifies route files, lazy files, and skips everything else", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "index.tsx": "",
         "$providerId.tsx": "",
         "chart.lazy.tsx": "",
         "sub/detail.ts": "",
         "sub/page.jsx": "",
         "plain.js": "",
         "a.b.tsx": "",
         "-helpers.ts": "",
         "-ignored-dir/inside.tsx": "",
         ".hidden.tsx": "",
         ".hidden-dir/inside.tsx": "",
         "index.gen.tsx": "",
         "$providerId.gen.ts": "",
         "styles.css": "",
         "readme.md": "",
      });
      const result = scanSourceDir(root, OPTS);
      expect(result.routeFiles).toEqual([
         { relPath: "$providerId.tsx", lazy: false },
         { relPath: "a.b.tsx", lazy: false },
         { relPath: "chart.lazy.tsx", lazy: true },
         { relPath: "index.tsx", lazy: false },
         { relPath: "plain.js", lazy: false },
         { relPath: "sub/detail.ts", lazy: false },
         { relPath: "sub/page.jsx", lazy: false },
      ]);
   });

   it("respects a custom ignore prefix", () => {
      const root = makeTmpDir();
      writeTree(root, { "_skip.tsx": "", "keep.tsx": "" });
      const result = scanSourceDir(root, { routeFileIgnorePrefix: "_" });
      expect(result.routeFiles).toEqual([{ relPath: "keep.tsx", lazy: false }]);
   });

   it("detects dot-flat lazy names but not dot-flat statics", () => {
      const root = makeTmpDir();
      writeTree(root, { "a.b.lazy.tsx": "", "a.lazy.b.tsx": "" });
      const result = scanSourceDir(root, OPTS);
      expect(result.routeFiles).toEqual([
         { relPath: "a.b.lazy.tsx", lazy: true },
         { relPath: "a.lazy.b.tsx", lazy: false },
      ]);
   });

   it("hard-errors on mount files inside the subtree (nested mounts unsupported)", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "index.tsx": "",
         "reviews.mount.ts": mountFileSource("../reviews"),
      });
      expectScanError(root, "NESTED_MOUNT_UNSUPPORTED");

      const nested = makeTmpDir();
      writeTree(nested, { "sub/inner.mount.js": mountFileSource("../../inner") });
      expectScanError(nested, "NESTED_MOUNT_UNSUPPORTED");
   });

   it("hard-errors on __root files at any depth", () => {
      const root = makeTmpDir();
      writeTree(root, { "__root.tsx": "" });
      expectScanError(root, "ROOT_IN_SHARED_DIR");

      const nested = makeTmpDir();
      writeTree(nested, { "sub/__root.lazy.tsx": "" });
      expectScanError(nested, "ROOT_IN_SHARED_DIR");
   });

   it("hard-errors on legacy suffixes", () => {
      for (const suffix of [
         "component",
         "errorComponent",
         "notFoundComponent",
         "pendingComponent",
         "loader",
      ]) {
         const root = makeTmpDir();
         writeTree(root, { [`detail.${suffix}.tsx`]: "" });
         expectScanError(root, "LEGACY_SUFFIX");
      }
   });

   it("hard-errors on .vue files", () => {
      const root = makeTmpDir();
      writeTree(root, { "page.vue": "" });
      expectScanError(root, "UNSUPPORTED_FILE_TYPE");
   });
});
