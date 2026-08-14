import { defineConfig } from "tsup";

// dts is NOT handled by tsup: its dts step needs the JS-based TypeScript
// compiler API, which TypeScript 7 (native) does not provide. Declarations
// are emitted by `tsc -p tsconfig.build.json` instead (see the build script).
export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      vite: "src/vite.ts",
    },
    format: ["esm", "cjs"],
    clean: true,
    sourcemap: true,
    target: "node18",
  },
  {
    // The CLI is ESM-only: its direct-execution guard uses import.meta.url,
    // and the bin entry points at dist/cli.js.
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    sourcemap: true,
    target: "node18",
  },
]);
