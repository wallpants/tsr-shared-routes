import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      vite: "src/vite.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
    target: "node18",
  },
  {
    // The CLI is ESM-only: its direct-execution guard uses import.meta.url,
    // and the bin entry points at dist/cli.js.
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    target: "node18",
  },
]);
