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

/**
 * The `routeFileIgnorePattern` that hides `*.mount.ts` files from the stock
 * TanStack generator. Pass it through your router config so you never
 * mistype the regex:
 * ```ts
 * import { routeFileIgnorePattern } from 'tanstack-shared-routes'
 * tanstackStart({ router: { routeFileIgnorePattern } })
 * ```
 */
export const routeFileIgnorePattern = "\\.mount\\.(ts|js)$";
