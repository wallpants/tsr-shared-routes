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
 * Placeholder shape returned by the package-level {@link createSharedRoute}.
 * Loosely typed on purpose: without a mount there is no route tree to type
 * against, so hooks return `unknown` and options are unconstrained.
 */
export interface PlaceholderSharedRoute<TOptions> {
  options: TOptions;
  /** Phantom slot consumed by generated wrappers; never materialized. */
  "~types": Record<string, unknown>;
  useMatch: (options?: unknown) => unknown;
  useRouteContext: (options?: unknown) => unknown;
  useSearch: (options?: unknown) => unknown;
  useParams: (options?: unknown) => unknown;
  useLoaderDeps: (options?: unknown) => unknown;
  useLoaderData: (options?: unknown) => unknown;
  useNavigate: () => (options?: unknown) => unknown;
  Link: (props?: unknown) => never;
}

/**
 * Placeholder factory for shared route files whose directory is not mounted
 * anywhere yet. It exists so authoring can start before the first mount —
 * `import { createSharedRoute } from 'tanstack-shared-routes'` always
 * resolves. Once a mount points at the directory, the codegen generates the
 * fully typed `<name>.gen.tsx` sibling and retargets this import to it (and
 * back, should the last mount disappear).
 *
 * Loosely typed by design: params, search, loader data, and navigation can
 * only be typed against the generated route tree, which needs at least one
 * mount. Mount first when you want full types while authoring.
 */
export function createSharedRoute<TOptions extends object>(
  options: TOptions,
): PlaceholderSharedRoute<TOptions> {
  const hook = (): never => {
    throw new Error(
      "tanstack-shared-routes: this shared route file is not mounted anywhere yet. " +
        "Create a `*.mount.ts` file pointing at its directory — the codegen then " +
        "generates a typed `.gen` helper and retargets this import to it.",
    );
  };
  return {
    options,
    "~types": {},
    useMatch: hook,
    useRouteContext: hook,
    useSearch: hook,
    useParams: hook,
    useLoaderDeps: hook,
    useLoaderData: hook,
    useNavigate: hook,
    Link: hook,
  };
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
