import { parseAst } from "@tanstack/router-utils";
import fs from "node:fs";
import path from "node:path";
import { isMountFile } from "./discover";
import { GEN_FILE_RE } from "./scan-source";

/**
 * Relative-escape lint. A relative navigation target inside a mounted subtree
 * is safe when it stays in the subtree (every mount mirrors it) or resolves
 * to a route that exists under EVERY mount. The type system only enforces
 * ANY-mount validity (a union `from` distributes), so a target valid under
 * one mount but missing under another typechecks yet not-founds at runtime.
 * This lint restores ALL-mount checking at codegen time for string-literal
 * `to` targets ('.'-prefixed) found in mounted source files.
 *
 * Resolution mirrors the verified stock runtime semantics: '..' pops one real
 * path segment (clamped at the root), and a trailing index slash is NOT a
 * segment. Pathless (`_layout`) and route-group (`(group)`) segments carry no
 * path.
 */

const ROUTE_EXT_RE = /\.(tsx|ts|jsx|js)$/;

export interface EscapeLintFile {
   /** Source file path as shown in warnings (root-relative, posix). */
   label: string;
   /** File contents (a file that fails to parse is skipped silently). */
   code: string;
   /** The file's route ids under every mount, home first. */
   baseIds: Array<string>;
}

/** Route id → navigable path: no trailing index slash, no pathless/group segments. */
export function idToPath(id: string): string {
   const segments = id
      .split("/")
      .filter(Boolean)
      .filter((segment) => !segment.startsWith("_"))
      .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")));
   return `/${segments.join("/")}`;
}

/** Stock runtime relative resolution: '.' keeps, '..' pops (clamped at root). */
export function resolveRelative(basePath: string, to: string): string {
   const segments = basePath.split("/").filter(Boolean);
   for (const part of to.split("/")) {
      if (part === "" || part === ".") continue;
      if (part === "..") segments.pop();
      else segments.push(part);
   }
   return `/${segments.join("/")}`;
}

/** All string literals used as relative `to` values ('.'-prefixed), deduped. */
export function collectRelativeToLiterals(
   code: string,
   filename: string,
): Array<string> | undefined {
   let ast: ReturnType<typeof parseAst>;
   try {
      ast = parseAst({ code, filename });
   } catch {
      return undefined; // mid-edit syntax error: nothing to lint this pass
   }
   const literals = new Set<string>();
   const isRelative = (value: unknown): value is string =>
      typeof value === "string" && value.startsWith(".");

   const visit = (node: unknown): void => {
      if (Array.isArray(node)) {
         for (const item of node) visit(item);
         return;
      }
      if (node === null || typeof node !== "object") return;
      const n = node as Record<string, any>;
      if (typeof n["type"] !== "string") return;

      if (
         n["type"] === "ObjectProperty" &&
         n["computed"] !== true &&
         (n["key"]?.name === "to" || n["key"]?.value === "to") &&
         n["value"]?.type === "StringLiteral" &&
         isRelative(n["value"].value)
      ) {
         literals.add(n["value"].value);
      }
      if (n["type"] === "JSXAttribute" && n["name"]?.name === "to") {
         const value = n["value"];
         const literal =
            value?.type === "StringLiteral"
               ? value
               : value?.type === "JSXExpressionContainer" &&
                   value.expression?.type === "StringLiteral"
                 ? value.expression
                 : undefined;
         if (literal !== undefined && isRelative(literal.value)) literals.add(literal.value);
      }

      for (const key of Object.keys(n)) {
         if (key === "loc" || key === "leadingComments" || key === "trailingComments") continue;
         visit(n[key]);
      }
   };
   visit(ast.program.body);
   return [...literals];
}

/**
 * Recursively collects every route file under `routesDirectory` (mount files,
 * `.gen` siblings, ignore-prefixed and dot entries excluded) so the lint can
 * check resolved targets against the app's full route table. Wrapper files on
 * disk are route files too and are included naturally.
 */
export function collectRouteFiles(
   routesDirectory: string,
   routeFileIgnorePrefix: string,
): Array<string> {
   const found: Array<string> = [];
   const walk = (dir: string): void => {
      let entries: Array<fs.Dirent>;
      try {
         entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
         return;
      }
      for (const entry of entries) {
         const name = entry.name;
         if (name.startsWith(".") || name === "node_modules") continue;
         if (routeFileIgnorePrefix !== "" && name.startsWith(routeFileIgnorePrefix)) continue;
         const fullPath = path.join(dir, name);
         if (entry.isDirectory()) {
            walk(fullPath);
            continue;
         }
         if (!entry.isFile()) continue;
         if (isMountFile(name) || GEN_FILE_RE.test(name)) continue;
         if (!ROUTE_EXT_RE.test(name)) continue;
         const base = name.replace(ROUTE_EXT_RE, "");
         if (base === "__root" || base.startsWith("__root.")) continue;
         found.push(fullPath);
      }
   };
   walk(routesDirectory);
   return found.sort();
}

/**
 * Lints the given mounted source files. Warns only on MIXED validity — a
 * target valid under every mount is fine, and one valid under no mount is the
 * type checker's job (ANY-mount union typing already rejects it).
 */
export function lintRelativeEscapes(
   files: Array<EscapeLintFile>,
   allRouteIds: Iterable<string>,
): Array<string> {
   const pathSet = new Set<string>(["/"]);
   for (const id of allRouteIds) pathSet.add(idToPath(id));

   const warnings: Array<string> = [];
   for (const file of files) {
      const literals = collectRelativeToLiterals(file.code, path.basename(file.label));
      if (literals === undefined) continue;
      for (const to of literals) {
         const results = file.baseIds.map((baseId) => {
            const resolved = resolveRelative(idToPath(baseId), to);
            return { baseId, resolved, valid: pathSet.has(resolved) };
         });
         const missing = results.filter((result) => !result.valid);
         if (missing.length === 0 || missing.length === results.length) continue;
         const describe = (entries: typeof results): string =>
            entries.map((entry) => `${entry.baseId} (→ ${entry.resolved})`).join(", ");
         warnings.push(
            `${file.label}: relative target '${to}' does not exist under every mount — missing under ${describe(missing)}; exists under ${describe(results.filter((result) => result.valid))}. Make it exist under every mount or use an absolute path.`,
         );
      }
   }
   return warnings;
}
