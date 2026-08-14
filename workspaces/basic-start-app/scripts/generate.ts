/**
 * Runs the full codegen chain without a dev server, exactly like the vite
 * plugin does in dev: our shared-routes pipeline first (wrappers + .gen.tsx
 * helpers, via the built package), then the stock @tanstack/router-generator.
 */
import { Generator, getConfig } from "@tanstack/router-generator";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { main as sharedRoutesCli } from "tanstack-shared-routes/cli";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 1. tanstack-shared-routes: mounts → wrappers + typed helpers.
const exitCode = sharedRoutesCli(["generate", "--root", root]);
if (exitCode !== 0) process.exit(exitCode);

// 2. Stock generator: route tree from the routes dir (wrappers included).
//    routeFileIgnorePattern comes from tsr.config.json, maintained by the
//    pipeline above; getConfig merges that file in.
const config = getConfig(
  {
    target: "react",
    routesDirectory: "./src/routes",
    generatedRouteTree: "./src/routeTree.gen.ts",
    autoCodeSplitting: true,
  },
  root,
);

const generator = new Generator({ config, root });
await generator.run();
console.log("routeTree.gen.ts generated");
