import path from "node:path";
import { atomicWrite, readIfExists } from "./fsio";
import { MOUNT_IGNORE_PATTERN } from "./ignore-pattern";

export const TSR_CONFIG_FILE = "tsr.config.json";

export interface TsrConfigUpdate {
   /** true when tsr.config.json was (or, under dryRun, would be) written. */
   changed: boolean;
   /** Set when the file needs manual attention instead of an automatic write. */
   warning?: string;
}

/**
 * Ensures the project's `tsr.config.json` carries a `routeFileIgnorePattern`
 * covering `*.mount.ts` files. That file is read by BOTH the `tsr` CLI and
 * TanStack's vite plugin (inline vite options win over it), so managing it
 * here hides mount files from the stock generator in every mode without any
 * user wiring. An existing user pattern is extended by alternation, never
 * replaced; a file we cannot safely edit is left alone with a warning.
 */
export function ensureTsrConfig(root: string, dryRun: boolean): TsrConfigUpdate {
   const configPath = path.join(root, TSR_CONFIG_FILE);
   const raw = readIfExists(configPath);

   let config: Record<string, unknown> = {};
   if (raw !== undefined) {
      let parsed: unknown;
      try {
         parsed = JSON.parse(raw);
      } catch {
         return { changed: false, warning: manualFixWarning("is not valid JSON") };
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
         return { changed: false, warning: manualFixWarning("is not a JSON object") };
      }
      config = parsed as Record<string, unknown>;
   }

   const existing = config["routeFileIgnorePattern"];
   let next: string;
   if (existing === undefined || existing === "") {
      next = MOUNT_IGNORE_PATTERN;
   } else if (typeof existing !== "string") {
      return {
         changed: false,
         warning: manualFixWarning("has a non-string routeFileIgnorePattern"),
      };
   } else {
      let pattern: RegExp;
      try {
         pattern = new RegExp(existing);
      } catch {
         return {
            changed: false,
            warning: manualFixWarning("has an invalid routeFileIgnorePattern regex"),
         };
      }
      if (pattern.test("x.mount.ts") && pattern.test("x.mount.js")) return { changed: false };
      next = `(?:${existing})|${MOUNT_IGNORE_PATTERN}`;
   }

   if (!dryRun) {
      const content = `${JSON.stringify({ ...config, routeFileIgnorePattern: next }, null, 2)}\n`;
      atomicWrite(configPath, content);
   }
   return { changed: true };
}

function manualFixWarning(reason: string): string {
   return `${TSR_CONFIG_FILE} ${reason} — set routeFileIgnorePattern to cover *.mount.ts files yourself (e.g. ${JSON.stringify(MOUNT_IGNORE_PATTERN)})`;
}
