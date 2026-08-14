import { defineConfig } from "tsup";

// ESM-only. dts is NOT handled by tsup: its dts step needs the JS-based
// TypeScript compiler API, which TypeScript 7 (native) does not provide.
// Declarations are emitted by `tsc -p tsconfig.build.json` (see build script).
export default defineConfig({
  entry: {
    index: "src/index.ts",
    vite: "src/vite.ts",
    cli: "src/cli.ts",
  },
  format: ["esm"],
  clean: true,
  sourcemap: true,
  target: "node22",
});
