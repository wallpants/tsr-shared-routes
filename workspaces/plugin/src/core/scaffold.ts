/**
 * Readiness gate for wrapper emission. Source route files are plain stock
 * TanStack route files, so empty files are scaffolded by the STOCK generator
 * (not us); this module only answers "does the source export `Route` yet?" —
 * a wrapper is deferred until it does, mirroring the mid-edit DX of mount
 * files.
 */

/** True when the file exports `Route` (const/let/var/function or export list). */
export function hasRouteExport(code: string): boolean {
   return exportsName(code, "Route");
}

/**
 * Cheap static check for a named export. Regex on purpose: this gates wrapper
 * emission during watch runs, where an AST parse per source file per pass
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
