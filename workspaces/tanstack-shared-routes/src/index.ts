/**
 * Declares that the shared route directory at `sharedDirectory` should be
 * mounted at the location of the `*.mount.ts` file containing this call.
 *
 * `sharedDirectory` must be a **string literal** path, relative to the mount
 * file. Mount files are never executed — the plugin statically parses them —
 * so the argument cannot be computed.
 *
 * Example — `src/routes/inventory/providers.mount.ts`:
 * ```ts
 * import { mount } from 'tanstack-shared-routes'
 * export default mount('../../shared/providers')
 * ```
 * mounts `src/shared/providers/` at `/inventory/providers`.
 */
export function mount(sharedDirectory: string): MountDeclaration {
  // Runtime no-op: mount files are statically parsed by the plugin and are
  // excluded from the app bundle via TanStack Router's routeFileIgnorePattern.
  return { [MOUNT_BRAND]: sharedDirectory };
}

export const MOUNT_BRAND = Symbol.for("tanstack-shared-routes.mount");

export interface MountDeclaration {
  [MOUNT_BRAND]: string;
}

export { makeCreateSharedRoute } from "./shared-route";
export type { CreateSharedRoute, SharedRoute, SharedRouteOptions } from "./shared-route";
import { makeCreateSharedRoute } from "./shared-route";

/**
 * Placeholder factory for shared route files whose directory is not mounted
 * anywhere yet. It exists so authoring can start before the first mount —
 * `import { createSharedRoute } from 'tanstack-shared-routes'` always
 * resolves, with the same option typing the generated helpers provide. Once a
 * mount points at the directory, the codegen generates the `<name>.gen.tsx`
 * sibling and retargets this import to it (and back, should the last mount
 * disappear).
 *
 * Mount-dependent types (params from the path, mount-aware hooks and
 * navigation) need the generated route tree, so they only tighten once the
 * first mount exists. Mount first when you want full types while authoring.
 */
export const createSharedRoute = makeCreateSharedRoute<string>([]);
