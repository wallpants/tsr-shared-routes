import { parseAst } from "@tanstack/router-utils";
import path from "node:path";

/** The package name the placeholder createSharedRoute is imported from. */
const PACKAGE_NAME = "tanstack-shared-routes";

/**
 * Import-specifier rewriting for shared route files. Mirrors the stock
 * generator's habit of correcting `createFileRoute('<id>')` literals in user
 * files: the pipeline retargets the `createSharedRoute` import between the
 * package placeholder (no mounts yet) and the generated `.gen` sibling (first
 * mount exists), and repoints a stale `.gen` specifier left behind by a file
 * rename — the module specifier is the only thing ever touched.
 */

/** A relative specifier pointing at a generated `.gen` helper. */
const RELATIVE_GEN_RE = /^\.\.?\/.*\.gen(\.(t|j)sx?)?$/;

function helperSpecifier(sharedFilePath: string): string {
  const base = path.basename(sharedFilePath).replace(/\.(tsx|ts|jsx|js)$/, "");
  return `./${base}.gen`;
}

/**
 * Finds the import declaration whose source satisfies `matchesSource` and
 * whose specifiers include `createSharedRoute` (possibly aliased), and
 * returns the code with that declaration's module specifier replaced by
 * `toSource`. Returns undefined when there is nothing to rewrite (no such
 * import, parse failure, or the specifier already points at `toSource`).
 */
function retargetImport(
  code: string,
  matchesSource: (source: string) => boolean,
  toSource: string,
): string | undefined {
  let ast: ReturnType<typeof parseAst>;
  try {
    ast = parseAst({ code, filename: "shared-file.tsx" });
  } catch {
    return undefined; // mid-edit syntax error — leave the file alone
  }
  for (const statement of ast.program.body) {
    if (statement.type !== "ImportDeclaration") continue;
    const source = statement.source.value;
    if (source === toSource || !matchesSource(source)) continue;
    const hasFactory = statement.specifiers.some(
      (specifier) =>
        specifier.type === "ImportSpecifier" &&
        (specifier.imported.type === "Identifier"
          ? specifier.imported.name
          : specifier.imported.value) === "createSharedRoute",
    );
    if (!hasFactory) continue;
    const { start, end } = statement.source;
    if (start == null || end == null) return undefined;
    const quote = code[start] === '"' ? '"' : "'";
    return `${code.slice(0, start)}${quote}${toSource}${quote}${code.slice(end)}`;
  }
  return undefined;
}

/**
 * Package placeholder (or a stale `.gen` specifier after a rename) →
 * generated helper (`./<base>.gen`), applied when the helper exists.
 * Undefined = no change needed. A shared file has no reason to import
 * `createSharedRoute` from another file's helper (each helper is
 * file-specific), so any non-own `.gen` specifier is safely retargeted.
 */
export function rewriteToHelper(code: string, sharedFilePath: string): string | undefined {
  return retargetImport(
    code,
    (source) => source === PACKAGE_NAME || RELATIVE_GEN_RE.test(source),
    helperSpecifier(sharedFilePath),
  );
}

/**
 * Generated helper → package placeholder, applied when the last mount of a
 * shared dir disappears and its helpers are cleaned up — un-mounting must
 * never leave a red import behind. Undefined = no change needed.
 */
export function rewriteToPackage(code: string): string | undefined {
  return retargetImport(code, (source) => RELATIVE_GEN_RE.test(source), PACKAGE_NAME);
}
