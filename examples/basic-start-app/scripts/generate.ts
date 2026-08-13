/**
 * Runs the real @tanstack/router-generator over this app, exactly like the
 * vite plugin does in dev — used by spikes/CI without a dev server.
 */
import { Generator, getConfig } from "@tanstack/router-generator";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const config = getConfig(
  {
    target: "react",
    routesDirectory: "./src/routes",
    generatedRouteTree: "./src/routeTree.gen.ts",
    routeFileIgnorePattern: "\\.mount\\.(ts|js)$",
    autoCodeSplitting: true,
  },
  root,
);

const generator = new Generator({ config, root });
await generator.run();
console.log("routeTree.gen.ts generated");
