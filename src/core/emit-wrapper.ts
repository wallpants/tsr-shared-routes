import path from "node:path";
import { extractRouteIdLiteral, maskRouteIdLiteral, replaceRouteIdLiteral } from "./fsio";

export interface WrapperSpec {
  kind: "wrapper" | "wrapper-lazy";
  /** The createFileRoute/createLazyFileRoute string literal. */
  routeIdLiteral: string;
  /** Absolute path of the wrapper file being rendered. */
  targetPath: string;
  /** Absolute path of the shared file the wrapper imports. */
  sharedFilePath: string;
  /** Shared file path as shown in the source comment (root-relative, posix). */
  sourceLabel: string;
  /** Mount file path as shown in the source comment (root-relative, posix). */
  mountLabel: string;
  /** Which router package to import from. */
  target: "react" | "solid";
  /** First line(s) of the file; must start with the banner sentinel. */
  banner: string;
}

/**
 * POSIX, extensionless import specifier from the wrapper to the shared file
 * (e.g. `../../../shared/providers/$providerId`).
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
 * Renders a wrapper file. The non-lazy shape mirrors the verified spike
 * (examples/basic-start-app) byte-for-byte modulo names/paths and formatting
 * style (we emit single quotes, no semicolons; the stock generator's
 * transformer preserves whatever style is on disk).
 */
export function renderWrapper(spec: WrapperSpec): string {
  const routerModule = `@tanstack/${spec.target}-router`;
  const importPath = computeImportPath(spec.targetPath, spec.sharedFilePath);
  const header = `${spec.banner}\n// source: ${spec.sourceLabel} (mount: ${spec.mountLabel})\n`;

  if (spec.kind === "wrapper-lazy") {
    return (
      header +
      `import { createLazyFileRoute } from '${routerModule}'\n` +
      `import { sharedLazy } from '${importPath}'\n` +
      `\n` +
      `export const Route = createLazyFileRoute('${spec.routeIdLiteral}')(sharedLazy)\n`
    );
  }

  return (
    header +
    `import type { Register } from '${routerModule}'\n` +
    `import { createFileRoute } from '${routerModule}'\n` +
    `import { shared } from '${importPath}'\n` +
    `\n` +
    `type T = (typeof shared)['~types']\n` +
    `\n` +
    `export const Route = createFileRoute('${spec.routeIdLiteral}')<\n` +
    `  Register,\n` +
    `  T['searchValidator'],\n` +
    `  T['params'],\n` +
    `  T['routeContextFn'],\n` +
    `  T['beforeLoadFn'],\n` +
    `  T['loaderDeps'],\n` +
    `  T['loaderFn'],\n` +
    `  unknown,\n` +
    `  T['ssr'],\n` +
    `  T['middlewares'],\n` +
    `  T['handlers']\n` +
    `>({ ...shared.options } as any)\n`
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
