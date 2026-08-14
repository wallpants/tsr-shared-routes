import fs from "node:fs";
import path from "node:path";

/**
 * Boilerplate written into byte-empty route files discovered inside a mounted
 * shared directory. The `.gen` helper is generated in the same pipeline pass
 * (it depends only on the file name and the mount set, never on content), so
 * the scaffolded import resolves immediately and the file is valid from birth
 * — the wrapper can be emitted without ever passing through a broken state.
 */
export function sharedRouteScaffold(sharedFilePath: string): string {
  const base = path.basename(sharedFilePath).replace(/\.(tsx|ts|jsx|js)$/, "");
  return `import { createSharedRoute } from './${base}.gen'\n\nexport const shared = createSharedRoute({})\n`;
}

/** Boilerplate for byte-empty `.lazy` route files (no helper involved). */
export function sharedLazyScaffold(): string {
  return `import type { LazyRouteOptions } from '@tanstack/react-router'\n\nexport const sharedLazy = {} satisfies LazyRouteOptions\n`;
}

/**
 * Writes `content` into `filePath` when the file is byte-empty (or
 * whitespace-only). Returns true when scaffolded. Never touches a file with
 * content — scaffolding is strictly additive.
 */
export function scaffoldIfEmpty(filePath: string, existing: string, content: string): boolean {
  if (existing.trim() !== "") return false;
  fs.writeFileSync(filePath, content, "utf8");
  return true;
}

/** True when the file exports `shared` (const/let/var/function or export list). */
export function hasSharedExport(code: string): boolean {
  return exportsName(code, "shared");
}

/** True when the file exports `sharedLazy`. */
export function hasSharedLazyExport(code: string): boolean {
  return exportsName(code, "sharedLazy");
}

/**
 * Cheap static check for a named export. Regex on purpose: this gates wrapper
 * emission during watch runs, where an AST parse per shared file per pass
 * would be pure overhead. Covers `export const|let|var|function|class <name>`
 * and `export { ..., <name>, ... }` (aliased re-exports included).
 */
function exportsName(code: string, name: string): boolean {
  const direct = new RegExp(`\\bexport\\s+(?:const|let|var|function|class)\\s+${name}\\b`);
  if (direct.test(code)) return true;
  const listRe = /\bexport\s*\{([^}]*)\}/g;
  for (let match = listRe.exec(code); match !== null; match = listRe.exec(code)) {
    const entries = match[1]!.split(",");
    for (const entry of entries) {
      const parts = entry.split(/\s+as\s+/);
      const exported = (parts[1] ?? parts[0] ?? "").trim();
      if (exported === name) return true;
    }
  }
  return false;
}
