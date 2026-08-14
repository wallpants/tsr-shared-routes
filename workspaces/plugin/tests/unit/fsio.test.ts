import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BANNER_SENTINEL, DEFAULT_BANNER } from "../../src/config";
import {
   ROUTE_ID_MASK,
   atomicWrite,
   extractRouteIdLiteral,
   isOwned,
   maskRouteIdLiteral,
   maskedHash,
   readIfExists,
   replaceRouteIdLiteral,
} from "../../src/core/fsio";
import { makeTmpDir } from "../helpers";

describe("isOwned", () => {
   it("accepts content starting with the banner sentinel", () => {
      expect(isOwned(`${BANNER_SENTINEL}\nrest`)).toBe(true);
      expect(isOwned(`${DEFAULT_BANNER}\nrest`)).toBe(true);
   });

   it("rejects anything else", () => {
      expect(isOwned("")).toBe(false);
      expect(isOwned("// some other comment\n")).toBe(false);
      expect(isOwned(`\n${BANNER_SENTINEL}`)).toBe(false);
   });
});

describe("maskRouteIdLiteral", () => {
   it("masks createFileRoute literals", () => {
      const content = `export const Route = createFileRoute('/a/b')({})`;
      expect(maskRouteIdLiteral(content)).toBe(
         `export const Route = createFileRoute('${ROUTE_ID_MASK}')({})`,
      );
   });

   it("masks createLazyFileRoute literals and double quotes", () => {
      const content = `export const Route = createLazyFileRoute("/a/chart")(sharedLazy)`;
      expect(maskRouteIdLiteral(content)).toBe(
         `export const Route = createLazyFileRoute("${ROUTE_ID_MASK}")(sharedLazy)`,
      );
   });

   it("only masks the first call", () => {
      const content = `createFileRoute('/one')\ncreateFileRoute('/two')`;
      expect(maskRouteIdLiteral(content)).toBe(
         `createFileRoute('${ROUTE_ID_MASK}')\ncreateFileRoute('/two')`,
      );
   });

   it("leaves content without a route call untouched", () => {
      expect(maskRouteIdLiteral("const x = 1")).toBe("const x = 1");
   });

   it("makes contents differing only in the literal compare equal", () => {
      const a = `createFileRoute('/inventory/providers/')({ ...shared.options })`;
      const b = `createFileRoute('/finances/providers/')({ ...shared.options })`;
      expect(maskRouteIdLiteral(a)).toBe(maskRouteIdLiteral(b));
      expect(maskedHash(a)).toBe(maskedHash(b));
   });
});

describe("extract/replace route id literal", () => {
   it("round-trips", () => {
      const content = `createFileRoute('/a/$id')({})`;
      expect(extractRouteIdLiteral(content)).toBe("/a/$id");
      expect(replaceRouteIdLiteral(content, "/b/$id")).toBe(`createFileRoute('/b/$id')({})`);
   });

   it("returns undefined when no call exists", () => {
      expect(extractRouteIdLiteral("nothing here")).toBeUndefined();
   });
});

describe("atomicWrite", () => {
   it("creates parent directories and writes content", () => {
      const dir = makeTmpDir();
      const target = path.join(dir, "deep", "nested", "file.tsx");
      atomicWrite(target, "hello");
      expect(fs.readFileSync(target, "utf8")).toBe("hello");
   });

   it("overwrites existing files and leaves no temp files behind", () => {
      const dir = makeTmpDir();
      const target = path.join(dir, "file.tsx");
      atomicWrite(target, "one");
      atomicWrite(target, "two");
      expect(fs.readFileSync(target, "utf8")).toBe("two");
      expect(fs.readdirSync(dir)).toEqual(["file.tsx"]);
   });
});

describe("readIfExists", () => {
   it("returns undefined for missing files and content otherwise", () => {
      const dir = makeTmpDir();
      expect(readIfExists(path.join(dir, "nope.txt"))).toBeUndefined();
      fs.writeFileSync(path.join(dir, "yes.txt"), "content");
      expect(readIfExists(path.join(dir, "yes.txt"))).toBe("content");
   });
});
