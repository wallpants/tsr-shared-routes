import path from "node:path";

/**
 * `.gen.tsx` sibling emission. For every mounted SOURCE route file (non-lazy)
 * a sibling `<base>.gen.tsx` is generated next to it, exporting the
 * union-typed `shared` view for that file. All type + runtime machinery lives
 * in the generated runtime module (`makeSharedRoute`); the sibling
 * contributes only what is file-specific — the union of the file's route ids
 * under EVERY mount, the home mount included. It imports nothing from the
 * source file (the hooks resolve via the live match tree), so source files
 * may import their sibling without creating a cycle.
 */
export interface HelperSpec {
   /**
    * Route ids of this source file under every mount — its own (home) id
    * first, then one per covering mount — deduped, in plan order.
    */
   mountIds: Array<string>;
   /** Source file shown in the header comment (root-relative, posix). */
   sourceLabel: string;
   /** Relative import specifier of the project's `sharedRoutes.gen` runtime module. */
   runtimeSpecifier: string;
   /** First line(s) of the file; must start with the banner sentinel. */
   banner: string;
}

/** Sibling path for a source route file: `<base>.gen.tsx`. */
export function helperPathFor(sourceFilePath: string): string {
   const dir = path.dirname(sourceFilePath);
   const base = path.basename(sourceFilePath).replace(/\.(tsx|ts|jsx|js)$/, "");
   return path.join(dir, `${base}.gen.tsx`);
}

/** Renders the `.gen.tsx` sibling content. */
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
import { makeSharedRoute } from ${JSON.stringify(spec.runtimeSpecifier)};

type MountFilePaths = ${mountUnion};

export const shared = makeSharedRoute<MountFilePaths>(
  [
${mountIdLines}
  ],
  ${JSON.stringify(errorPath)},
);
`;
}
