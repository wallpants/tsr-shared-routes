# typecheck

Not an example — a type-level test harness for `tsr-shared-routes`. The root `bun run typecheck` compiles it with `tsc --noEmit`.

It is a minimal TanStack Start route tree with a `/help` source subtree mounted at `/inventory/help` (plus an overlapping direct mount of `/help/guides` at `/settings/guides`, and a stock `.lazy` pair). Generated files are committed (`gitignore: false`), so a bare `tsc` run works without codegen. The interesting parts:

- `src/type-probes.tsx` — asserts the types are strict, not `any`: every `@ts-expect-error` line must fail to compile for the file to pass. Covers home-typed stock call sites, union-typed `shared.*` call sites, the wrapper's route-tree registration (`getRouteApi`), overlapping-source unions, required-search enforcement, and the stock-`Link` relative-path surface. It also documents the known ANY-mount limitation of union escape navigation.
- `scripts/generate.ts` — re-runs the full codegen chain (this tool's pipeline, then the stock generator) after plugin changes: `bun run generate`. Requires a fresh plugin build (`bun run build` in `workspaces/plugin`) since it runs the built CLI.

These probes need a real app with a compiled route tree (`routeTree.gen.ts` module augmentation), which is why they live in their own workspace instead of the plugin's vitest suite.
