# tsr-shared-routes (react only)

## Mount an already-mounted route subtree at multiple paths

A small codegen companion for TanStack Router / Start file-based routing. Your shared routes are **plain stock route files** living at their natural location in the routes tree; a tiny `*.mount.ts` file mounts that subtree at additional paths, and every mount gets real, fully typed routes in the generated route tree. The stock generator keeps doing all the real work — no patched packages. It solves the long-standing "reuse a subtree of file routes under several parents" problem ([TanStack/router#1108](https://github.com/TanStack/router/discussions/1108)).

This is simply codegen to help you create the code you'd have to manually write otherwise to mount a route at different paths. If your editor autohides _.gitignored_ files, then you won't even notice the generated files.

[Take a look at the example.](/workspaces/example/)

I created this mostly because in some projects I have modals which I build as routes that can be mounted in a bunch of different places in my app.

## Quick start

```sh
bun add tsr-shared-routes @tanstack/router-core
```

(`@tanstack/router-core` is a peer dependency — it is already a dependency of `@tanstack/react-router`, but the generated code imports one type from it directly, so strict package managers need it declared.)

Add the plugin **before** `tanstackStart()` (or `tanstackRouter()`):

```ts
// vite.config.ts
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { sharedRoutes } from "tsr-shared-routes/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sharedRoutes(), tanstackStart()],
});
```

The stock generator must ignore `*.mount.ts` files and the generated `.gen` siblings; the codegen takes care of that by maintaining a `routeFileIgnorePattern` in your `tsr.config.json` (read by both TanStack's vite plugin and the `tsr` CLI — an existing pattern of yours is extended, never replaced).

## Your first mount

Start from any ordinary route subtree — nothing about it is special:

```
src/routes/home/shared-one/
├── route.tsx        # createFileRoute('/home/shared-one')({ … })
└── $childId.tsx     # createFileRoute('/home/shared-one/$childId')({ … })
```

Mount it somewhere else by creating a mount file (run `vite dev` to get the codegen running, or use the CLI):

```ts
// src/routes/about/shared-one.mount.ts  →  mounts at /about/shared-one
import { mount } from "tsr-shared-routes";
export default mount("../home/shared-one");
```

That's it. The codegen generates, per extra mount, a small **wrapper** route file at the mount location (`src/routes/about/shared-one/route.tsx` → `createFileRoute('/about/shared-one')({ ...shared.options })`), which the stock generator scans like any other route file — routing, loaders, SSR, and typing all remain 100% stock. Next to each source route file it generates a `<name>.gen.tsx` **sibling**, and a single `src/sharedRoutes.gen.ts` runtime module (right next to TanStack's `routeTree.gen.ts`).

All generated files are automatically removed when you delete the `*.mount.ts` file or a source route file. By default they are _gitignored_ (disable via config); `vite build` regenerates them.

## Two kinds of call sites

**Stock call sites keep working.** The wrappers monkey-patch the source `Route` instance's hooks with mount-resolving versions, so existing code like

```tsx
function Component() {
  const data = Route.useLoaderData();
  const navigate = Route.useNavigate();
  // …
}
```

resolves the mount it actually renders under at runtime. The types stay what they were — checked against the file's home location. For loader data, loader deps, and the file's own params that is exact under every mount (they are identical across mounts); what it cannot see is parent-derived divergence under the other mounts.

**Union call sites when you want cross-mount honesty.** Each source route file gets a generated sibling exporting `shared` — the same hooks, typed against the union of ALL of the file's route ids (home included):

```tsx
// src/routes/home/shared-one/$childId.tsx
import { shared } from "./$childId.gen";

function Component() {
  const params = shared.useParams(); // union across mounts
  const navigate = shared.useNavigate(); // relative nav resolved per mount
  return <shared.Link to="..">Close</shared.Link>;
}
```

Converting an existing route into a shared one therefore costs nothing up front: create the mount file, done. Reach for `shared.*` only at call sites where mounts can genuinely differ.

## Relative navigation semantics

- **Inside the subtree** (`'.'`, `'./$childId'`, `'..'` up to the mount root): every mount mirrors the same structure, so `shared.useNavigate()` / `shared.Link` are strictly and exactly typed — typos, bad search values, and missing params are compile errors, valid targets are valid under every mount.
- **Escaping the subtree**: the union navigate accepts a relative target that is valid under **at least one** mount (ANY-mount semantics — a target that only exists under one mount typechecks but not-founds under the others at runtime). Prefer isomorphic escapes (targets that exist under every mount, like `'../..'`) or absolute paths, which are stock-typed and mount-independent. The stock `Route.useNavigate()` is home-typed and therefore stricter: it only accepts escapes valid at home.
- **JSX links**: stock `Link` without `from` accepts only the bare `'.'` and `'..'` (resolved from the current leaf location at runtime). Any structured relative target (`'./$childId'`) needs a `from`, and a static `from` would be wrong under other mounts — use `shared.Link`, which resolves the current mount and passes it as `from`.
- **Index routes**: `'..'` from an index route resolves to the layout's **parent** — the trailing index segment does not count as a level (stock semantics, verified at both the type and runtime level).

## Overlapping mounts

A mount may target a subtree of another mounted subtree — each file's id union simply grows:

```ts
// src/routes/about/$childId.mount.ts
import { mount } from "tsr-shared-routes";
export default mount("../home/shared-one/$childId");
```

Now `$childId.tsx` is reachable at `/home/shared-one/$childId` (home), `/about/shared-one/$childId` (via the outer mount), and `/about/$childId` (direct) — its `.gen` sibling unions all three.

Not supported: a `*.mount.ts` file **inside** a mounted subtree (mounts of mounts by nesting files), and mounting a generated wrapper directory. Both are validation errors.

## `.lazy.tsx` route files

Stock `.lazy` pairs work unchanged — both halves are plain stock files:

```tsx
// src/routes/home/shared-one/chart.tsx — critical half
export const Route = createFileRoute("/home/shared-one/chart")({ loader: () => fetchData() });
```

```tsx
// src/routes/home/shared-one/chart.lazy.tsx — lazy half
import { Route as chartRoute } from "./chart";
export const Route = createLazyFileRoute("/home/shared-one/chart")({ component: Chart });

function Chart() {
  const data = chartRoute.useLoaderData(); // patched like any stock call site
  // …
}
```

The wrappers mirror both halves at each mount and the stock generator pairs them by filename, exactly as for hand-written files.

## How it works

For every route file in a mounted subtree, the wrapper at the mount location re-registers the source's options under the mount's route id, with the source's input-level types extracted from its stock `Route` export — so the route tree gets real types at every mount. The wrapper also calls `patchSharedHooks(...)` on the source instance (idempotent; `routeTree.gen.ts` imports all wrappers eagerly, so the patch lands before anything renders).

The `.gen` siblings and `sharedRoutes.gen.ts` are generated **into your project** rather than imported from the package for the same reason the stock generator emits `routeTree.gen.ts` into your app: `routeTree.gen.ts` registers your route tree by augmenting `@tanstack/react-router` via `declare module`, and module augmentation binds to one resolved copy of that module — your app's.

Generated files carry an ownership banner, are tracked in a manifest (`.tanstack/shared-routes/manifest.json`), and are cleaned up automatically when a source file or mount disappears. The pipeline never overwrites a file it does not own.

## CLI

```
tsr-shared-routes generate            # run the codegen pipeline once
tsr-shared-routes generate --check    # CI drift guard: exit 1 if anything would change
tsr-shared-routes generate --root x   # project root (default: cwd)
```

The CLI runs only this tool's pipeline — your build runs the stock generator as usual. Optional config file: `shared-routes.config.json` at the project root (same options as the plugin). `--check` matters for CI because the generated files must exist for a bare `tsc` run.

## Configuration

All options are optional (zero config works). Pass them to `sharedRoutes({ … })` or put them in `shared-routes.config.json`.

| Option                  | Default                                           | Description                                                        |
| ----------------------- | ------------------------------------------------- | ------------------------------------------------------------------ |
| `routesDirectory`       | `./src/routes`                                    | Must match the TanStack Router/Start `routesDirectory`.            |
| `gitignore`             | `true`                                            | Maintain a managed block in `.gitignore` covering generated files. |
| `banner`                | `// Generated by tsr-shared-routes. Do not edit.` | First line(s) of generated files; must keep the sentinel prefix.   |
| `routeFileIgnorePrefix` | `-`                                               | Mirror of the stock generator option.                              |
| `indexToken`            | `index`                                           | Mirror of the stock generator option.                              |
| `routeToken`            | `route`                                           | Mirror of the stock generator option.                              |
| `manifestPath`          | `.tanstack/shared-routes/manifest.json`           | Manifest location, relative to the project root.                   |

## Limitations

- **React only**: the generated runtime imports `@tanstack/react-router`.
- **Parent-derived types are home-typed in option functions**: `beforeLoad`/`loader` in a source file are typechecked against the home mount's parent chain only. If another mount's parents provide different context or inherited search, nothing flags it at compile time. Union hooks (`shared.*`) are honest at read sites; option functions cannot be.
- **Escape navigation is ANY-mount typed** (see above).
- **Start static route inspection sees the wrappers as opaque**: prerender auto-detection and server-only pruning work for the home location (a plain stock file) but not for the extra mounts.
- **Runtime patching is version-coupled**: `patchSharedHooks` replaces hook properties that `@tanstack/react-router` binds in its Route constructors; `SourceRouteTypes` infers positionally against `@tanstack/router-core`'s `Route` interface. A resolver that duplicates `router-core` degrades the wrapper types to `never` — loudly, at typecheck time; the fix is aligning the `@tanstack/router-core` version with the one `@tanstack/react-router` resolves.

## License

MIT
