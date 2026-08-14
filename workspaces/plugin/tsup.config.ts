import fs from "node:fs";
import path from "node:path";
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
  esbuildPlugins: [
    // Vite-style `?raw` imports (the runtime-module emitter inlines
    // src/shared-route.ts as a string). Vitest gets this from Vite natively;
    // tsc sees the ambient declaration in src/raw-imports.d.ts.
    {
      name: "raw",
      setup(build) {
        build.onResolve({ filter: /\?raw$/ }, (args) => ({
          path: path.resolve(args.resolveDir, args.path.replace(/\?raw$/, "")),
          namespace: "raw-text",
        }));
        build.onLoad({ filter: /.*/, namespace: "raw-text" }, (args) => ({
          contents: `export default ${JSON.stringify(fs.readFileSync(args.path, "utf8"))}`,
          loader: "js",
        }));
      },
    },
  ],
});
