# typecheck

Not an example — a type-level test harness for `tsr-shared-routes`. The root `bun run typecheck` compiles it with `tsc --noEmit`.

It is a minimal TanStack Start route tree (two mounts of one shared directory, including a `.lazy` pair) whose generated files are committed (`gitignore: false`), so a bare `tsc` run works without codegen. The interesting parts:

- `src/type-probes.tsx` — asserts the mounted shared-route types are strict, not `any`: every `@ts-expect-error` line (typo'd relative targets, invalid search values, missing params, unknown loader-data properties) must fail to compile for the file to pass.
- `src/placeholder-probe.tsx` — same idea for the package-level pre-mount `createSharedRoute` placeholder: option-key rejection and `validateSearch` → `loaderDeps` → `loader` inference without any mount.
- `scripts/generate.ts` — re-runs the full codegen chain (this tool's pipeline, then the stock generator) after plugin changes: `bun run generate`.
- `scripts/scale-fixture.ts` — scales the fixture to measure type-instantiation growth (the numbers in the root README's "Type performance" section).

These probes need a real app with a compiled route tree (`routeTree.gen.ts` module augmentation), which is why they live in their own workspace instead of the plugin's vitest suite.
