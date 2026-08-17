import path from "node:path";
import { extractRouteIdLiteral, maskRouteIdLiteral, replaceRouteIdLiteral } from "./fsio";

export interface WrapperSpec {
   kind: "wrapper" | "wrapper-lazy";
   /** The createFileRoute/createLazyFileRoute string literal. */
   routeIdLiteral: string;
   /** Absolute path of the wrapper file being rendered. */
   targetPath: string;
   /** Absolute path of the source route file the wrapper imports. */
   sharedFilePath: string;
   /**
    * Route ids of the source file under every mount (home first) — passed to
    * patchSharedHooks so stock `Route.useX()` call sites in the source
    * resolve the mount they actually render under.
    */
   mountIds: Array<string>;
   /** Relative import specifier of the project's `sharedRoutes.gen` runtime module. */
   runtimeSpecifier: string;
   /** Source file path as shown in the source comment (root-relative, posix). */
   sourceLabel: string;
   /** Mount file path as shown in the source comment (root-relative, posix). */
   mountLabel: string;
   /** First line(s) of the file; must start with the banner sentinel. */
   banner: string;
}

/**
 * POSIX, extensionless import specifier from the wrapper to the source file
 * (e.g. `../../help/$topicId`).
 */
export function computeImportPath(fromWrapperPath: string, toSharedFilePath: string): string {
   const relative = path
      .relative(path.dirname(fromWrapperPath), toSharedFilePath)
      .split(path.sep)
      .join("/")
      .replace(/\.(tsx|ts|jsx|js)$/, "");
   return relative.startsWith(".") ? relative : `./${relative}`;
}

/**
 * Renders a wrapper file. Mirrors the verified spike
 * (workspaces/typecheck/src/routes/inventory/help/*) modulo names/paths: the
 * wrapper re-registers the STOCK source route's options at the mount's route
 * id, with the source's input-level generics extracted via SourceRouteTypes,
 * and monkey-patches the source instance's hooks with the mount-resolving
 * versions.
 */
export function renderWrapper(spec: WrapperSpec): string {
   const routerModule = "@tanstack/react-router";
   const importPath = computeImportPath(spec.targetPath, spec.sharedFilePath);
   const idList = [...new Set(spec.mountIds)].map((id) => JSON.stringify(id)).join(", ");
   const header = `${spec.banner}\n/* eslint-disable */\n// source: ${spec.sourceLabel} (mount: ${spec.mountLabel})\n`;

   // Both option arguments below are PLAIN object literals on purpose:
   // TanStack's vite transform only injects its route HMR accept code when
   // the options argument is an ObjectExpression, and that injection is what
   // lets a wrapper hot-re-execute (re-patching the source Route) instead of
   // forcing a full page reload when a mounted source file changes.
   if (spec.kind === "wrapper-lazy") {
      return (
         header +
         `import { createLazyFileRoute } from "${routerModule}"\n` +
         `import { patchSharedHooks } from "${spec.runtimeSpecifier}"\n` +
         `import { Route as sharedLazy } from "${importPath}"\n` +
         `\n` +
         `patchSharedHooks(sharedLazy, [${idList}])\n` +
         `\n` +
         `const { id: _id, ...lazyOptions } = sharedLazy.options\n` +
         `\n` +
         `export const Route = createLazyFileRoute("${spec.routeIdLiteral}")({ ...lazyOptions })\n`
      );
   }

   return (
      header +
      `import type { Register } from "${routerModule}"\n` +
      `import { createFileRoute } from "${routerModule}"\n` +
      `import type { SourceRouteTypes } from "${spec.runtimeSpecifier}"\n` +
      `import { patchSharedHooks } from "${spec.runtimeSpecifier}"\n` +
      `import { Route as shared } from "${importPath}"\n` +
      `\n` +
      `patchSharedHooks(shared, [${idList}])\n` +
      `\n` +
      `type T = SourceRouteTypes<typeof shared>\n` +
      `\n` +
      // The stripped keys are the "generated" route options the router's
      // .update() (and TanStack's HMR handleRouteUpdate) merge into the live
      // source route's options — they belong to the HOME mount and must not
      // leak into the wrapper's createFileRoute call (id+path together throw).
      `const { id: _id, path: _path, getParentRoute: _getParentRoute, ...sourceOptions } = shared.options as any\n` +
      `\n` +
      `export const Route = createFileRoute("${spec.routeIdLiteral}")<\n` +
      `  Register,\n` +
      `  T["searchValidator"],\n` +
      `  T["params"],\n` +
      `  T["routeContextFn"],\n` +
      `  T["beforeLoadFn"],\n` +
      `  T["loaderDeps"],\n` +
      `  T["loaderFn"],\n` +
      `  unknown,\n` +
      `  T["ssr"],\n` +
      `  T["middlewares"],\n` +
      `  T["handlers"]\n` +
      `>({ ...sourceOptions })\n`
   );
}

export type WriteDecision =
   /** File is missing or structurally different: persist `content` to disk. */
   | { action: "write"; content: string }
   /** File is byte-identical: nothing to do. */
   | { action: "skip"; content: string }
   /**
    * Only the route-id literal differs — the stock generator corrected it and
    * is the authority. Adopt the on-disk content in memory, write NOTHING.
    */
   | { action: "adopt"; content: string };

/**
 * Idempotency core: compares existing vs desired with the route-id literal
 * masked on both sides so a generator-corrected literal never causes a write
 * war. When a structural rewrite is needed, the existing literal is still
 * adopted into the new content.
 */
export function decideWrite(existing: string | undefined, desired: string): WriteDecision {
   if (existing === undefined) return { action: "write", content: desired };
   if (existing === desired) return { action: "skip", content: existing };
   if (maskRouteIdLiteral(existing) === maskRouteIdLiteral(desired)) {
      return { action: "adopt", content: existing };
   }
   const existingLiteral = extractRouteIdLiteral(existing);
   const content =
      existingLiteral === undefined ? desired : replaceRouteIdLiteral(desired, existingLiteral);
   return { action: "write", content };
}
