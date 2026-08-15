/**
 * Declares that the route subtree at `sourceDirectory` should be mounted at
 * the location of the `*.mount.ts` file containing this call.
 *
 * `sourceDirectory` must be a **string literal** path, relative to the mount
 * file, pointing at a directory inside the routes directory whose route files
 * are plain stock TanStack route files. Mount files are never executed — the
 * plugin statically parses them — so the argument cannot be computed.
 *
 * Example — `src/routes/inventory/help.mount.ts`:
 * ```ts
 * import { mount } from 'tsr-shared-routes'
 * export default mount('../help')
 * ```
 * mounts the `src/routes/help/` subtree at `/inventory/help`.
 */
export function mount(sourceDirectory: string): MountDeclaration {
   // Runtime no-op: mount files are statically parsed by the plugin and are
   // excluded from the app bundle via TanStack Router's routeFileIgnorePattern.
   return { [MOUNT_BRAND]: sourceDirectory };
}

export const MOUNT_BRAND = Symbol.for("tsr-shared-routes.mount");

export interface MountDeclaration {
   [MOUNT_BRAND]: string;
}

export type { SharedRoute, SourceRouteTypes } from "./shared-route";
