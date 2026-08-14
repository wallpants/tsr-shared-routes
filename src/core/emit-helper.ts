import path from "node:path";

/**
 * `.gen.tsx` typed-helper emission. For every shared ROUTE file (non-lazy) a
 * sibling `<base>.gen.tsx` is generated inside the shared dir, exposing the
 * typed `createSharedRoute` factory for that file. All type + runtime
 * machinery lives in the package (`makeCreateSharedRoute`); the generated
 * file contributes only what is file-specific — the union of this file's
 * route ids under EVERY mount of its shared dir.
 */
export interface HelperSpec {
  /**
   * Route ids of this shared file under every mount that references its
   * shared dir (each planned wrapper's route-id literal), deduped, in plan
   * order.
   */
  mountIds: Array<string>;
  /** Shared source file shown in the header comment (root-relative, posix). */
  sourceLabel: string;
  /** First line(s) of the file; must start with the banner sentinel. */
  banner: string;
}

/** Sibling helper path for a shared route file: `<base>.gen.tsx`. */
export function helperPathFor(sharedFilePath: string): string {
  const dir = path.dirname(sharedFilePath);
  const base = path.basename(sharedFilePath).replace(/\.(tsx|ts|jsx|js)$/, "");
  return path.join(dir, `${base}.gen.tsx`);
}

/** Renders the helper file content. */
export function renderHelper(spec: HelperSpec): string {
  const mountIds = [...new Set(spec.mountIds)];
  const mountIdLines = mountIds.map((id) => `  ${JSON.stringify(id)},`).join("\n");
  const mountUnion = mountIds.map((id) => JSON.stringify(id)).join(" | ");
  /** Error-message path: the source label without its extension. */
  const errorPath = spec.sourceLabel.replace(/\.(tsx|ts|jsx|js)$/, "");

  return `${spec.banner}
/* eslint-disable */
// source: ${spec.sourceLabel}
// mounts: ${mountIds.join(", ")}
import { makeCreateSharedRoute } from "tanstack-shared-routes";

type MountFilePaths = ${mountUnion};

export const createSharedRoute = makeCreateSharedRoute<MountFilePaths>(
  [
${mountIdLines}
  ],
  ${JSON.stringify(errorPath)},
);
`;
}
