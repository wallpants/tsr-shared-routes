import path from "node:path";
import sharedRouteSource from "../shared-route.ts?raw";

/**
 * `__shared-routes.gen.tsx` emission: one per shared ROOT, holding the full
 * `makeCreateSharedRoute` machinery (the verbatim source of the package's
 * `shared-route.ts`). It is generated INTO the user's project on purpose:
 * `routeTree.gen.ts` augments `@tanstack/react-router` via `declare module`,
 * and module augmentation binds to one resolved copy of the module — the
 * app's. Types shipped in this package's `dist` resolve the package's own
 * copy instead (dual instance under `link:`/`file:` installs), which
 * degrades every route-tree-dependent type to `any`. Emitting the machinery
 * as user-land code makes it resolve the app's augmented instance, exactly
 * like the stock generator's `routeTree.gen.ts`.
 */
export const RUNTIME_MODULE_BASENAME = "__shared-routes.gen.tsx";

/** Absolute path of a shared root's runtime module. */
export function runtimeModulePathFor(sharedRoot: string): string {
  return path.join(sharedRoot, RUNTIME_MODULE_BASENAME);
}

/**
 * POSIX, extensionless specifier from a `.gen` helper to the runtime module
 * of its nearest enclosing shared root.
 */
export function runtimeSpecifierFor(helperPath: string, sharedRoot: string): string {
  const relative = path
    .relative(path.dirname(helperPath), runtimeModulePathFor(sharedRoot))
    .split(path.sep)
    .join("/")
    .replace(/\.tsx$/, "");
  return relative.startsWith(".") ? relative : `./${relative}`;
}

/** Renders the runtime module content. */
export function renderRuntimeModule(banner: string): string {
  return `${banner}
/* eslint-disable */
// The createSharedRoute machinery shared by this directory's .gen helpers.
// Generated into your project (not imported from the package) so its types
// resolve YOUR @tanstack/react-router instance — the one routeTree.gen.ts
// augments. See the package README ("What are the .gen files?").
${sharedRouteSource}`;
}
