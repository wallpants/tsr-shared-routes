import path from "node:path";
import process from "node:process";
import type { Plugin } from "vite";
import type { SharedRoutesConfig, SharedRoutesUserConfig } from "./config";
import { resolveConfig } from "./config";
import { isMountFile } from "./core/discover";
import type { PipelineSummary } from "./core/pipeline";
import { runPipeline } from "./core/pipeline";
import { GEN_FILE_RE } from "./core/scan-shared";

export type { SharedRoutesUserConfig } from "./config";

/** Debounce window for watcher-triggered pipeline re-runs. */
const RERUN_DEBOUNCE_MS = 50;

/** True when `child` is inside (or equal to) `parent`. Both absolute. */
function isWithin(parent: string, child: string): boolean {
   const rel = path.relative(parent, child);
   return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function formatError(error: unknown): string {
   const message = error instanceof Error ? error.message : String(error);
   return message.startsWith("tsr-shared-routes") ? message : `tsr-shared-routes: ${message}`;
}

/**
 * Vite plugin: runs the shared-routes codegen pipeline in the `config` hook —
 * every plugin's `config` hook completes before ANY plugin's `configResolved`
 * runs, and the stock TanStack generator first generates in `configResolved`,
 * so wrappers exist before its first pass regardless of plugin order.
 */
export function sharedRoutes(userConfig: SharedRoutesUserConfig = {}): Plugin {
   let resolved: SharedRoutesConfig | undefined;
   let routesDir = "";
   let sharedRoots: Array<string> = [];
   let targetDirs: Array<string> = [];
   let pendingWarnings: Array<string> = [];

   const applySummary = (
      summary: PipelineSummary,
      logger?: { warn: (msg: string, opts?: { timestamp: boolean }) => void },
   ): void => {
      sharedRoots = summary.sharedRoots;
      targetDirs = summary.targetDirs;
      const lines = summary.errors.map((warning) => `tsr-shared-routes: ${warning}`);
      if (logger === undefined) {
         pendingWarnings = lines; // no logger yet in the config hook — defer
      } else {
         for (const line of lines) logger.warn(line, { timestamp: true });
      }
   };

   return {
      name: "tsr-shared-routes",
      enforce: "pre",

      async config(viteConfig) {
         const root = path.resolve(viteConfig.root ?? process.cwd());
         resolved = resolveConfig(userConfig, root);
         routesDir = path.resolve(root, resolved.routesDirectory);
         applySummary(runPipeline(resolved, { lenient: true }));
      },

      configResolved(viteConfig) {
         for (const line of pendingWarnings) viteConfig.logger.warn(line);
         pendingWarnings = [];
      },

      configureServer(server) {
         const config = resolved;
         if (config === undefined) return;
         const logger = server.config.logger;

         const watchDirs = (): void => {
            server.watcher.add(routesDir);
            for (const dir of sharedRoots) server.watcher.add(dir);
            // Wrapper target dirs are deliberately NEVER watched by us: the stock
            // generator corrects wrapper literals in place, and reacting to that
            // would create a write/watch loop. (Vite itself still watches them, so
            // the stock generator picks our wrapper writes up — desired.)
         };
         watchDirs();

         let timer: ReturnType<typeof setTimeout> | undefined;
         let running = false;
         let queued = false;

         const runNow = (): void => {
            if (running) {
               // An event arrived mid-run: queue exactly one follow-up re-run.
               queued = true;
               return;
            }
            running = true;
            try {
               applySummary(runPipeline(config, { lenient: true }), logger);
               watchDirs(); // mounts may reference shared roots we did not watch yet
            } catch (error) {
               // Never crash the dev server over a codegen problem.
               logger.error(formatError(error), { timestamp: true });
            } finally {
               running = false;
               if (queued) {
                  queued = false;
                  schedule();
               }
            }
         };

         const schedule = (): void => {
            clearTimeout(timer);
            timer = setTimeout(runNow, RERUN_DEBOUNCE_MS);
         };

         const isRelevant = (event: string, file: string): boolean => {
            const absPath = path.resolve(file);
            // Our own output: the generator edits wrappers (literal corrections)
            // and we write them — neither may re-trigger the pipeline.
            if (targetDirs.some((dir) => isWithin(dir, absPath))) return false;
            if (sharedRoots.some((dir) => isWithin(dir, absPath))) {
               // Our own `.gen` helper writes must never re-trigger the pipeline.
               if (GEN_FILE_RE.test(absPath)) return false;
               // Content edits flow through HMR; only structure changes need codegen.
               if (
                  event === "add" ||
                  event === "unlink" ||
                  event === "addDir" ||
                  event === "unlinkDir"
               ) {
                  return true;
               }
               // Editing a nested mount file changes the plan, not just content.
               return event === "change" && isMountFile(absPath);
            }
            // Any event on a mount file under the routes dir changes the plan.
            if (isWithin(routesDir, absPath)) return isMountFile(absPath);
            return false;
         };

         server.watcher.on("all", (event, file) => {
            if (isRelevant(event, file)) schedule();
         });
      },
   };
}
