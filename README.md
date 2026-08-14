# tanstack-shared-routes

Mount a shared directory of TanStack Router file-based route files at multiple paths. A small codegen companion — the stock TanStack Router / Start generator keeps doing all the real work, no fork, no patched packages. It solves the long-standing "reuse a subtree of file routes under several parents" problem ([TanStack/router#1108](https://github.com/TanStack/router/discussions/1108)): you write each route file once in a shared directory, declare where it mounts, and every mount gets real, fully typed routes in the generated route tree.

## Quick start

```sh
npm install tanstack-shared-routes
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

The walkthrough assumes `vite dev` is running — the plugin scaffolds and regenerates as you save. **Mount first**: types flow from the generated route tree, so declaring where routes mount before authoring them gives you full typing from the first line (see [Authoring before mounting](#authoring-before-mounting) for the other order).

**1. Declare the mount.** Create an empty `*.mount.ts` file inside your routes directory — the plugin immediately fills in the boilerplate. The file's own name and location decide where the shared directory mounts; you only type the relative path to the shared directory (it's fine if it doesn't exist yet):

```ts
// src/routes/inventory/providers.mount.ts  →  mounts at /inventory/providers
import { mount } from "tanstack-shared-routes";

export default mount("../../shared/providers");
```

A second mount file is all it takes to mount the same directory somewhere else:

```ts
// src/routes/finances/providers.mount.ts  →  same shared dir, second mount
import { mount } from "tanstack-shared-routes";

export default mount("../../shared/providers");
```

**2. Create the shared route files.** Create an empty file in the shared directory using normal route-file names (`index.tsx`, `$providerId.tsx`, `route.tsx`, …). On save, the plugin populates it:

```tsx
// src/shared/providers/$providerId.tsx — scaffolded for you
import { createSharedRoute } from "./$providerId.gen";

export const shared = createSharedRoute({});
```

…and in the same pass generates the `$providerId.gen.tsx` sibling it imports, plus a wrapper route at every mount. Nothing is ever red: the `.gen` helper depends only on the file's name and the mount set, so it exists before you write a single option.

**3. Author with full types.** `createSharedRoute` takes the same options as `createFileRoute`, and the returned `shared` carries typed hooks that resolve the current mount at runtime:

```tsx
// src/shared/providers/$providerId.tsx
import { z } from "zod";
import { createSharedRoute } from "./$providerId.gen";
import { fetchProvider } from "./-data";

export const shared = createSharedRoute({
  validateSearch: z.object({ tab: z.enum(["info", "orders"]).default("info") }),
  loaderDeps: ({ search }) => ({ tab: search.tab }),
  loader: ({ params }) => fetchProvider(params.providerId),
  component: ProviderDetail,
});

function ProviderDetail() {
  const provider = shared.useLoaderData(); // typed from the loader
  const { providerId } = shared.useParams(); // typed from the path
  const { tab } = shared.useSearch(); // typed from the schema
  const navigate = shared.useNavigate(); // relative to the current mount

  return (
    <div>
      <h2>
        {provider.name} ({providerId})
      </h2>
      <shared.Link to="." search={{ tab: "orders" }}>
        Orders
      </shared.Link>
      <button onClick={() => navigate({ to: ".", search: { tab } })}>Refresh</button>
    </div>
  );
}
```

Types compose across files exactly like stock file-based routes: create `$providerId.delete.tsx` next to the file above and its `shared.useParams()` is typed by `$providerId`'s validation.

One authoring rule: the route export **must be named `shared`** (generated wrappers import exactly that name; other exports are yours to use freely).

Prefer one-shot codegen? `npx tanstack-shared-routes generate` runs the same pipeline without a dev server. A working app lives in [`examples/basic-start-app`](examples/basic-start-app).

### Authoring before mounting

`import { createSharedRoute } from "tanstack-shared-routes"` always resolves — the package exports a placeholder factory, so you can sketch shared route files before any mount exists. It is the same implementation the `.gen` helpers use, instantiated with an empty mount set: option keys are checked and the `validateSearch` → `loaderDeps` → `loader` inference chains work, but mount-dependent types (params from the path, hook results, navigation targets) can only come from the generated route tree, which needs at least one mount. The moment a mount points at the directory, the codegen generates the `.gen` siblings and **retargets your imports to them automatically** (and back to the package, should the last mount disappear) — the same kind of in-place correction the stock generator applies to `createFileRoute` path literals when you move a file.

### Mid-edit behavior

The dev pipeline is built so half-finished files never break anything:

- An empty or unfilled mount file (`mount('')`) is simply ignored until you fill in the path; a malformed one logs a single line and is skipped — codegen for everything else continues, and files generated for that mount are kept until it becomes valid (or is deleted).
- A shared route file that doesn't export `shared` yet gets its `.gen` helper but no wrapper — the route appears when the export does. An existing route never disappears because of a mid-edit syntax error.
- Generated files are cleaned up when their **source is gone** (shared file or mount file deleted), never because a file is temporarily invalid.
- The CLI is strict where dev is forgiving: `generate` fails loudly on invalid mount files, and `generate --check` reports any drift for CI.

### What are the `.gen` files?

`$providerId.gen.tsx` and friends are **generated by this tool**, right next to each shared route file — you never write or edit them (they carry the same ownership banner as the wrappers and are cleaned up with them). Each one exports the `createSharedRoute` for that specific file. All the type and runtime machinery lives in the package (`makeCreateSharedRoute`); the generated file contributes only what is file-specific — the union of the file's route ids under every mount:

```tsx
// src/shared/providers/$providerId.gen.tsx  (GENERATED)
import { makeCreateSharedRoute } from "tanstack-shared-routes";

type MountFilePaths = "/finances/providers/$providerId" | "/inventory/providers/$providerId";

export const createSharedRoute = makeCreateSharedRoute<MountFilePaths>(
  ["/finances/providers/$providerId", "/inventory/providers/$providerId"],
  "src/shared/providers/$providerId",
);
```

Options are contextually typed against the union of mounts, and the returned object carries hooks typed via `RouteApi<union of mount ids>` which at runtime resolve the CURRENT mount (nearest match, walked up to the closest mount id) and pass it as `from` — the shared-file equivalent of `Route.useLoaderData()` / `Route.useNavigate()` in a normal route file. That's why the helper must be per-file and generated: it is the one place that knows the full mount set, which is what makes the hooks and relative navigation both strictly typed and runtime-correct under every mount.

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
| `gitignore`                   | `false`                                                | Maintain a managed block in `.gitignore` covering generated files.                                                                         |
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
