import path from "node:path";
import { describe, expect, it } from "vitest";
import {
   collectRelativeToLiterals,
   collectRouteFiles,
   idToPath,
   lintRelativeEscapes,
   resolveRelative,
} from "../../src/core/lint-escapes";
import { makeTmpDir, mountFileSource, writeTree } from "../helpers";

describe("idToPath", () => {
   it("normalizes ids to navigable paths", () => {
      expect(idToPath("/help")).toBe("/help");
      expect(idToPath("/help/")).toBe("/help"); // index slash is not a segment
      expect(idToPath("/")).toBe("/");
      expect(idToPath("/_layout/dashboard")).toBe("/dashboard"); // pathless
      expect(idToPath("/(marketing)/pricing")).toBe("/pricing"); // route group
   });
});

describe("resolveRelative", () => {
   it("mirrors the verified stock runtime semantics", () => {
      expect(resolveRelative("/help/$topicId", "..")).toBe("/help");
      expect(resolveRelative("/help/$topicId", "../..")).toBe("/");
      expect(resolveRelative("/help/$topicId", "../../stock")).toBe("/stock");
      expect(resolveRelative("/help/$topicId", "./notes")).toBe("/help/$topicId/notes");
      expect(resolveRelative("/help/$topicId", ".")).toBe("/help/$topicId");
      // clamped at the root, like the runtime
      expect(resolveRelative("/help", "../../../..")).toBe("/");
      // index base: '..' pops a real segment ('/help/' ≡ '/help' via idToPath)
      expect(resolveRelative(idToPath("/help/"), "..")).toBe("/");
   });
});

describe("collectRelativeToLiterals", () => {
   it("collects '.'-prefixed to literals from calls and JSX, deduped", () => {
      const code = [
         "const a = navigate({ to: '..' })",
         "const b = navigate({ to: '../../stock', search: { q: 1 } })",
         "const c = <shared.Link to='../sibling' />",
         "const d = <Link to={'..'} from='/x' />",
         "const e = <Link to='/absolute' />",
         "const f = navigate({ to: someVariable })",
         "const g = { notTo: '../nope' }",
      ].join("\n");
      expect(collectRelativeToLiterals(code, "probe.tsx")?.sort()).toEqual([
         "..",
         "../../stock",
         "../sibling",
      ]);
   });

   it("returns undefined on a syntax error (mid-edit)", () => {
      expect(collectRelativeToLiterals("const ((((", "broken.tsx")).toBeUndefined();
   });
});

describe("collectRouteFiles", () => {
   it("walks route files, skipping mount/gen/prefixed/__root entries", () => {
      const root = makeTmpDir();
      writeTree(root, {
         "routes/index.tsx": "",
         "routes/__root.tsx": "",
         "routes/help/route.tsx": "",
         "routes/help/route.gen.tsx": "",
         "routes/help/-data.ts": "",
         "routes/inventory/help.mount.ts": mountFileSource("../help"),
         "routes/inventory/help/route.tsx": "",
         "routes/styles.css": "",
      });
      const files = collectRouteFiles(path.join(root, "routes"), "-");
      expect(files.map((file) => path.relative(path.join(root, "routes"), file))).toEqual([
         path.join("help", "route.tsx"),
         "index.tsx",
         path.join("inventory", "help", "route.tsx"),
      ]);
   });
});

describe("lintRelativeEscapes", () => {
   const ALL_IDS = [
      "/",
      "/help",
      "/help/$topicId",
      "/inventory",
      "/inventory/stock",
      "/inventory/help",
      "/inventory/help/$topicId",
   ];

   it("warns on a target valid under some mounts only", () => {
      const warnings = lintRelativeEscapes(
         [
            {
               label: "src/routes/help/$topicId.tsx",
               code: "const go = { to: '../../stock' }",
               baseIds: ["/help/$topicId", "/inventory/help/$topicId"],
            },
         ],
         ALL_IDS,
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("'../../stock'");
      expect(warnings[0]).toContain("missing under /help/$topicId (→ /stock)");
      expect(warnings[0]).toContain("exists under /inventory/help/$topicId (→ /inventory/stock)");
   });

   it("stays silent for isomorphic targets and all-invalid targets", () => {
      const warnings = lintRelativeEscapes(
         [
            {
               label: "src/routes/help/$topicId.tsx",
               // '..' → /help | /inventory/help (both exist); '../..' → / | /inventory
               // (both exist); './tpyo' → invalid under ALL (type checker's job)
               code: "const a = { to: '..' }; const b = { to: '../..' }; const c = { to: './tpyo' }",
               baseIds: ["/help/$topicId", "/inventory/help/$topicId"],
            },
         ],
         ALL_IDS,
      );
      expect(warnings).toEqual([]);
   });

   it("skips files that fail to parse", () => {
      const warnings = lintRelativeEscapes(
         [
            {
               label: "src/routes/help/$topicId.tsx",
               code: "const ((((",
               baseIds: ["/help/$topicId", "/inventory/help/$topicId"],
            },
         ],
         ALL_IDS,
      );
      expect(warnings).toEqual([]);
   });
});
