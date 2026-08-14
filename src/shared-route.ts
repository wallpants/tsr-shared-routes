import type {
  AnyContext,
  AnyRoute,
  FileBaseRouteOptions,
  FileRoutesByPath,
  Register,
  ResolveParams,
  RouteApi,
  UpdatableRouteOptions,
  UseNavigateResult,
} from "@tanstack/react-router";
import { Link, useMatch, useNavigate, useRouter } from "@tanstack/react-router";
import * as React from "react";

/**
 * The complete `createSharedRoute` type + runtime machinery, generic over the
 * union of mount file paths. Generated `<name>.gen.tsx` helpers instantiate
 * {@link makeCreateSharedRoute} with their file's concrete mount union; the
 * package-level placeholder instantiates it with no mounts. One
 * implementation — the placeholder can never drift from the generated one.
 */

// Graceful degradation: resolves per-key, falls back before the wrappers /
// routeTree.gen.ts exist so helpers never hard-error during scaffold.
type EntryOf<K extends string> = K extends keyof FileRoutesByPath
  ? FileRoutesByPath[K]
  : {
      id: K;
      path: string;
      fullPath: K;
      parentRoute: AnyRoute;
      preLoaderRoute: never;
    };

type MountEntry<TMountPaths extends string> = EntryOf<TMountPaths>;
type MountParent<TMountPaths extends string> = MountEntry<TMountPaths>["parentRoute"];
type MountId<TMountPaths extends string> = MountEntry<TMountPaths>["id"];
type MountPath<TMountPaths extends string> = MountEntry<TMountPaths>["path"];
type MountFullPath<TMountPaths extends string> = MountEntry<TMountPaths>["fullPath"];

export type SharedRouteOptions<
  TMountPaths extends string,
  TSearchValidator,
  TParams,
  TRouteContextFn,
  TBeforeLoadFn,
  TLoaderDeps extends Record<string, any>,
  TLoaderFn,
  TSSR,
  TMiddlewares,
  THandlers,
> = FileBaseRouteOptions<
  Register,
  MountParent<TMountPaths>,
  MountId<TMountPaths>,
  MountPath<TMountPaths>,
  TSearchValidator,
  TParams,
  TLoaderDeps,
  TLoaderFn,
  AnyContext,
  TRouteContextFn,
  TBeforeLoadFn,
  AnyContext,
  TSSR,
  TMiddlewares,
  THandlers
> &
  UpdatableRouteOptions<
    MountParent<TMountPaths>,
    MountId<TMountPaths>,
    MountFullPath<TMountPaths>,
    TParams,
    TSearchValidator,
    TLoaderFn,
    TLoaderDeps,
    AnyContext,
    TRouteContextFn,
    TBeforeLoadFn
  >;

export interface SharedRoute<
  TMountPaths extends string,
  TSearchValidator,
  TParams,
  TRouteContextFn,
  TBeforeLoadFn,
  TLoaderDeps extends Record<string, any>,
  TLoaderFn,
  TSSR,
  TMiddlewares,
  THandlers,
> {
  options: SharedRouteOptions<
    TMountPaths,
    TSearchValidator,
    TParams,
    TRouteContextFn,
    TBeforeLoadFn,
    TLoaderDeps,
    TLoaderFn,
    TSSR,
    TMiddlewares,
    THandlers
  >;
  /** Phantom generics consumed by the generated wrappers. Never materialized. */
  "~types": {
    searchValidator: TSearchValidator;
    params: TParams;
    routeContextFn: TRouteContextFn;
    beforeLoadFn: TBeforeLoadFn;
    loaderDeps: TLoaderDeps;
    loaderFn: TLoaderFn;
    ssr: TSSR;
    middlewares: TMiddlewares;
    handlers: THandlers;
  };
  useMatch: RouteApi<MountId<TMountPaths>>["useMatch"];
  useRouteContext: RouteApi<MountId<TMountPaths>>["useRouteContext"];
  useSearch: RouteApi<MountId<TMountPaths>>["useSearch"];
  useParams: RouteApi<MountId<TMountPaths>>["useParams"];
  useLoaderDeps: RouteApi<MountId<TMountPaths>>["useLoaderDeps"];
  useLoaderData: RouteApi<MountId<TMountPaths>>["useLoaderData"];
  useNavigate: () => UseNavigateResult<MountFullPath<TMountPaths>>;
  Link: RouteApi<MountId<TMountPaths>>["Link"];
}

/** The call signature of a per-file `createSharedRoute` factory. */
export interface CreateSharedRoute<TMountPaths extends string> {
  <
    TSearchValidator = undefined,
    TParams = ResolveParams<MountPath<TMountPaths>>,
    TRouteContextFn = AnyContext,
    TBeforeLoadFn = AnyContext,
    TLoaderDeps extends Record<string, any> = {},
    TLoaderFn = undefined,
    TSSR = unknown,
    const TMiddlewares = unknown,
    THandlers = undefined,
  >(
    options: SharedRouteOptions<
      TMountPaths,
      TSearchValidator,
      TParams,
      TRouteContextFn,
      TBeforeLoadFn,
      TLoaderDeps,
      TLoaderFn,
      TSSR,
      TMiddlewares,
      THandlers
    >,
  ): SharedRoute<
    TMountPaths,
    TSearchValidator,
    TParams,
    TRouteContextFn,
    TBeforeLoadFn,
    TLoaderDeps,
    TLoaderFn,
    TSSR,
    TMiddlewares,
    THandlers
  >;
}

/**
 * Builds the `createSharedRoute` factory for one shared route file.
 *
 * `mountIds` are the file's route ids under every mount of its shared dir
 * (empty for the package-level placeholder). `sourcePath` names the file in
 * error messages. Hooks resolve which mount the component is currently
 * rendered under — nearest match, then a static walk up the route tree to the
 * closest ancestor whose id is a mount id — so they also work in components
 * rendered by descendant routes of the shared root.
 */
export function makeCreateSharedRoute<TMountPaths extends string>(
  mountIds: ReadonlyArray<string>,
  sourcePath?: string,
): CreateSharedRoute<TMountPaths> {
  const MOUNT_IDS: ReadonlySet<string> = new Set(mountIds);
  const label = sourcePath === undefined ? "this shared route file" : JSON.stringify(sourcePath);

  const useMountRouteId = (): string => {
    if (MOUNT_IDS.size === 0) {
      // Thrown before any React hook runs so the message survives non-React
      // call sites too (placeholder: the file is not mounted anywhere yet).
      throw new Error(
        `tanstack-shared-routes: ${label} is not mounted anywhere yet. ` +
          "Create a `*.mount.ts` file pointing at its directory — the codegen then " +
          "generates a typed `.gen` helper and retargets this import to it.",
      );
    }
    const nearestRouteId = useMatch({
      strict: false,
      select: (m) => m.routeId,
    });
    const router = useRouter();
    let route: AnyRoute | undefined =
      nearestRouteId === undefined ? undefined : (router.routesById as any)[nearestRouteId];
    while (route && !MOUNT_IDS.has(route.id)) route = route.parentRoute;
    if (!route) {
      throw new Error(
        `tanstack-shared-routes: hooks of ${label} must be used under one of its mounts: ` +
          [...MOUNT_IDS].join(", "),
      );
    }
    return route.id;
  };

  const useMountFullPath = (): string => {
    const id = useMountRouteId();
    const router = useRouter();
    return (router.routesById as any)[id].fullPath;
  };

  return ((options: any) =>
    ({
      options,
      useMatch: (opts?: any) => {
        const from = useMountRouteId();
        return useMatch({ ...opts, from } as any);
      },
      useRouteContext: (opts?: any) => {
        const from = useMountRouteId();
        return useMatch({
          from,
          select: (m: any) => (opts?.select ? opts.select(m.context) : m.context),
        } as any);
      },
      useSearch: (opts?: any) => {
        const from = useMountRouteId();
        return useMatch({
          ...opts,
          from,
          select: (m: any) => (opts?.select ? opts.select(m.search) : m.search),
        } as any);
      },
      useParams: (opts?: any) => {
        const from = useMountRouteId();
        return useMatch({
          ...opts,
          from,
          select: (m: any) => (opts?.select ? opts.select(m._strictParams) : m._strictParams),
        } as any);
      },
      useLoaderDeps: (opts?: any) => {
        const from = useMountRouteId();
        return useMatch({
          ...opts,
          from,
          select: (m: any) => (opts?.select ? opts.select(m.loaderDeps) : m.loaderDeps),
        } as any);
      },
      useLoaderData: (opts?: any) => {
        const from = useMountRouteId();
        return useMatch({
          ...opts,
          from,
          select: (m: any) => (opts?.select ? opts.select(m.loaderData) : m.loaderData),
        } as any);
      },
      useNavigate: () => {
        const fullPath = useMountFullPath();
        return useNavigate({ from: fullPath });
      },
      Link: React.forwardRef(function SharedLink(props: any, ref: any) {
        const fullPath = useMountFullPath();
        return React.createElement(Link, { ref, from: fullPath, ...props });
      }),
    }) as any) as CreateSharedRoute<TMountPaths>;
}
