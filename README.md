# tanstack-shared-routes

Mount a shared directory of TanStack Router file-based route files at multiple paths. A small codegen companion. The stock TanStack Router / Start generator keeps doing all the real work, no patched packages. It solves the long-standing "reuse a subtree of file routes under several parents" problem ([TanStack/router#1108](https://github.com/TanStack/router/discussions/1108)): you write each route file once in a shared directory, declare where it mounts, and every mount gets real, fully typed routes in the generated route tree.

## Quick start

```sh
bun add tanstack-shared-routes
```

Add the plugin **before** `tanstackStart()` (or `tanstackRouter()`), and tell the stock generator to ignore mount files:

```ts
// vite.config.ts
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { routeFileIgnorePattern } from "tanstack-shared-routes";
import { sharedRoutes } from "tanstack-shared-routes/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    sharedRoutes(),
    tanstackStart({
      router: { routeFileIgnorePattern },
    }),
  ],
});
```

(`routeFileIgnorePattern` is the exported constant `"\\.mount\\.(ts|js)$"` — import it instead of retyping the regex.)

## Your first shared routes

Run _vite_ to get the codegen running:

```sh
vite dev
```

Create a directory inside your `routes` dir, where you will define your `shared` routes. You can have as many shared directories as you want.

For this example we create `src/routes/-providers/` (the name of this directory doesn't affect mounting paths).

Since TanStack requires Routes to be mounted somewhere to be added to the generated route tree and provide types, you need to specify at least _one_ mounting point.

```ts
// src/routes/inventory/providers.mount.ts  →  mounts at /inventory/providers
import { mount } from "tanstack-shared-routes";
export default mount("../-providers");
```

You then create your first shared route `src/routes/-providers/route.tsx`. The generator will add the following contents when you create the file:

```tsx
// src/routes/-providers/route.tsx — scaffolded for you
import { createSharedRoute } from "./route.gen";

export const shared = createSharedRoute({});
```

The generator then also creates a `__shared-routes.gen.tsx` file _per shared directory_ and a `*.gen.tsx` _per route_ inside the shared directory.

You'll also find a `providers` directory at `src/routes/inventory/providers/*` where your shared routes will be mounted.

All generated files are automatically removed if you either delete the `*.mount.ts` file or you delete any of the route files inside your shared directory.

By default, all generated files are _gitignored_, you can disable that in the plugin config. Running `vite build` will generate them again when you want to run in production.

```tsx
// src/routes/-providers/route.tsx — define your route
import { createSharedRoute } from "./route.gen";
import { createServerFn } from "@tanstack/react-start";

const loader = createServerFn({ method: "GET" }).handler(() => ({ hello: "world" }));

export const shared = createSharedRoute({
  loader: () => loader(),
  component: MyComponent,
});

// I highly recommend you use *.lazy.tsx (more below)
function MyComponent() {
  // fully typed useLoaderData, useLoaderDeps, useParams, useSearch, useNavigate
  const params = shared.useParams();
  const search = shared.useSearch();
  const loaderData = shared.useLoaderData();
  const loaderDeps = shared.useLoaderDeps();

  return (
    <div>
      <p>Hello {loaderData.hello}</p>
    </div>
  );
}
```

A second mount file is all it takes to mount the same directory somewhere else:

```ts
// src/routes/finances/providers.mount.ts  →  same shared dir, second mount
import { mount } from "tanstack-shared-routes";

export default mount("../-providers");
```

One authoring rule: the route export **must be named `shared`** (generated wrappers import exactly that name; other exports are yours to use freely).

Prefer one-shot codegen? `npx tanstack-shared-routes generate` runs the same pipeline without a dev server.

### Authoring before mounting

`import { createSharedRoute } from "tanstack-shared-routes"` always resolves — the package exports a placeholder factory, so you can sketch shared route files before any mount exists. It is the same implementation the `.gen` helpers use, instantiated with an empty mount set, and it types as much as is knowable without a route tree: option keys are checked, the `validateSearch` → `loaderDeps` → `loader` inference chains work, and the data hooks are typed from the file's own options — `useLoaderData()` returns your loader's type, `useSearch()` your schema's output, `useParams()` your `params.parse` result. What only appears after the first mount: params derived from the file's path, anything **inherited from parent routes** (their search schemas, params, context), and navigation targets — those live in the generated route tree. The moment a mount points at the directory, the codegen generates the `.gen` siblings and **retargets your imports to them automatically** (and back to the package, should the last mount disappear) — the same kind of in-place correction the stock generator applies to `createFileRoute` path literals when you move a file.

### What are the `.gen` files?

`route.gen.tsx` and friends are **generated by this tool**, right next to each shared route file — you never write or edit them (they carry the same ownership banner as the wrappers and are cleaned up with them). Each one exports the `createSharedRoute` for that specific file, contributing only what is file-specific — the union of the file's route ids under every mount:

```tsx
// src/shared/providers/$providerId.gen.tsx  (GENERATED)
import { makeCreateSharedRoute } from "./__shared-routes.gen";

type MountFilePaths = "/finances/providers/$providerId" | "/inventory/providers/$providerId";

export const createSharedRoute = makeCreateSharedRoute<MountFilePaths>(
  ["/finances/providers/$providerId", "/inventory/providers/$providerId"],
  "src/shared/providers/$providerId",
);
```

The `makeCreateSharedRoute` machinery they share lives in `__shared-routes.gen.tsx`, generated once per shared directory. It is emitted **into your project** rather than imported from the package for the same reason the stock generator emits `routeTree.gen.ts` into your app: `routeTree.gen.ts` registers your route tree by augmenting `@tanstack/react-router` via `declare module`, and module augmentation binds to one resolved copy of that module — your app's.

## How it works

For every route file in a mounted shared directory, the plugin generates a tiny wrapper file at the mount location inside your routes tree (`src/routes/inventory/providers/$providerId.tsx` → `createFileRoute('/inventory/providers/$providerId')({ ...shared.options })`). The stock generator then scans those wrappers like any other route file and builds the route tree — routing, loaders, SSR, and typing all remain 100% stock.

Next to each shared route file, the plugin also generates a `<name>.gen.tsx` helper exporting the typed `createSharedRoute` for that file. The helper knows the file's route ids under _every_ mount, so:

- **Types** are the union across mounts — params, search, loader data, and relative navigation are checked against all mounts at once.
- **Hooks** (`useLoaderData`, `useParams`, `useSearch`, `useNavigate`, `Link`, …) resolve the actual mount at runtime (nearest match, walking up to the closest mount id) and pass it as `from`, so one component instance behaves correctly under whichever mount rendered it.

Generated files carry an ownership banner, are tracked in a manifest (`.tanstack/shared-routes/manifest.json`), and are cleaned up automatically when a shared file or mount disappears. The pipeline never overwrites a file it does not own.

## Multiple shared dirs and colocated layout

Any number of shared directories and mounts work — each `*.mount.ts` points at one shared dir, and shared dirs may themselves contain nested `*.mount.ts` files (expanded recursively under every outer mount). Shared dirs normally live outside the routes directory (e.g. `src/shared/…`), but you can colocate them inside it under a directory whose name starts with the route-file ignore prefix, which the stock generator skips:

```
src/routes/inventory/
├── -shared/providers/      # originals, invisible to the generator
│   ├── index.tsx
│   └── $providerId.tsx
├── providers.mount.ts      # mount('./-shared/providers')
└── providers/              # generated wrappers
```

## Relative navigation semantics

Within the shared subtree, relative navigation is strictly typed: `to: '.'`, `to: '..'`, `to: './$providerId'` resolve against the current mount, and typos or invalid search/params are compile errors. Two stock behaviors to know:

- **Index routes**: escaping the subtree from an index route needs `'../..'` — one `'..'` only strips the index segment. This is stock TanStack semantics, unchanged.
- **Escaping the subtree**: a relative target that leaves the shared subtree must be valid under **all** mounts, and it resolves to a different route per mount — union semantics. `navigate({ to: '../..' })` from `/inventory/providers/` and `/finances/providers/` lands on `/inventory` or `/finances` respectively, and typechecks only because both exist.

Absolute paths into or out of mounts are simply stock-typed routes — they work from anywhere.

## `.lazy.tsx` route files

Wrappers of non-lazy shared routes import the shared file directly, so their components are **not** auto code-split (the splitter can't see through the `{ ...shared.options }` spread). For heavy UI, use the stock `.lazy` split — it works end-to-end:

```tsx
// src/shared/providers/chart.tsx — critical half (stays in the main bundle)
import { createSharedRoute } from "./chart.gen";
export const shared = createSharedRoute({ loader: () => fetchData() });
```

```tsx
// src/shared/providers/chart.lazy.tsx — lazy half (code-split per mount)
import type { LazyRouteOptions } from "@tanstack/react-router";
import { shared } from "./chart";

// MUST BE NAMED `sharedLazy`
export const sharedLazy = { component: Chart } satisfies LazyRouteOptions;

function Chart() {
  const data = shared.useLoaderData();
  // …
}
```

How the two halves connect — the same way as stock TanStack `.lazy` routes, **by filename, not by imports**. `chart.tsx` never references `chart.lazy.tsx`. The tool mirrors both files as wrappers (`…/chart.tsx` and `…/chart.lazy.tsx` at each mount), and the stock generator pairs those wrappers by name and wires the lazy import into the route tree, exactly as it would for hand-written files.

The export names are the contract, mirroring the `shared` rule above:

- a route file exports `const shared` (from `createSharedRoute`) — its wrapper does `import { shared } from …`;
- a `.lazy.tsx` file exports `const sharedLazy` (a plain `LazyRouteOptions` object — lazy options carry no route-specific typing, so no helper is involved) — its wrapper does `import { sharedLazy } from …`.

Nothing else is "picked up": those two named exports are all the generated wrappers consume. A `.lazy.tsx` file gets no `.gen` helper of its own — the base file's helper serves both halves (as `Chart` above shows, the lazy component imports `shared` from the base file for its hooks).

## CLI

```
tanstack-shared-routes generate            # run the codegen pipeline once
tanstack-shared-routes generate --check    # CI drift guard: exit 1 if anything would change
tanstack-shared-routes generate --root x   # project root (default: cwd)
```

The CLI runs only this tool's pipeline — your build runs the stock generator as usual. Optional config file: `shared-routes.config.json` at the project root (same options as the plugin). `--check` matters for CI because the `.gen.tsx` helpers must exist for a bare `tsc` run.

## Configuration

All options are optional (zero config works). Pass them to `sharedRoutes({ … })` or put them in `shared-routes.config.json`.

| Option                        | Default                                                | Description                                                                                                                                |
| ----------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `routesDirectory`             | `./src/routes`                                         | Must match the TanStack Router/Start `routesDirectory`.                                                                                    |
| `gitignore`                   | `true`                                                 | Maintain a managed block in `.gitignore` covering generated files.                                                                         |
| `banner`                      | `// Generated by tanstack-shared-routes. Do not edit.` | First line(s) of generated files; must keep the sentinel prefix.                                                                           |
| `quoteStyle`                  | `single`                                               | Mirror of the stock generator option.                                                                                                      |
| `semicolons`                  | `false`                                                | Mirror of the stock generator option.                                                                                                      |
| `routeFileIgnorePrefix`       | `-`                                                    | Mirror of the stock generator option; also enables colocated shared dirs.                                                                  |
| `indexToken`                  | `index`                                                | Mirror of the stock generator option.                                                                                                      |
| `routeToken`                  | `route`                                                | Mirror of the stock generator option.                                                                                                      |
| `manifestPath`                | `.tanstack/shared-routes/manifest.json`                | Manifest location, relative to the project root.                                                                                           |
| `silenceIgnorePatternWarning` | `false`                                                | Hide the reminder about `routeFileIgnorePattern` when it's configured somewhere the plugin can't see (it only scans the Vite config file). |

## Limitations

- **React only**: generated files and the runtime factory import `@tanstack/react-router`.
- **Code splitting of non-lazy mounted routes**: components of non-lazy shared files are not auto code-split (see the `.lazy.tsx` section for the supported split).
- **Start prerender static inspection**: tooling that statically inspects route files for prerendering sees the wrapper, not the shared file's options.
- **Parent context is typed as the root context**: shared files are parent-agnostic by contract — they can mount under different parents, so `context` in `beforeLoad`/`loader` is typed as the router's root context, not any specific parent's. Absolute-path navigation and hooks are unaffected.

## Type performance

Measured on TypeScript 7.0.2: mounting scales **linearly** at roughly 6k type instantiations per mounted route — cheaper than hand-duplicating the route files themselves (629k vs 651k instantiations for an 80-route tree).

## License

MIT
