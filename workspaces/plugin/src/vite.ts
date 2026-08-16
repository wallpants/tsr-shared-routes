import path from "node:path";
import process from "node:process";
import type { Plugin } from "vite";
import type { SharedRoutesConfig, SharedRoutesUserConfig } from "./config";
import { resolveConfig } from "./config";
import { isMountFile } from "./core/discover";
import { runtimeModulePath } from "./core/emit-runtime";
import type { PipelineSummary } from "./core/pipeline";
import { runPipeline } from "./core/pipeline";
import { GEN_FILE_RE } from "./core/scan-source";

export type { SharedRoutesUserConfig } from "./config";

/** Debounce window for watcher-triggered pipeline re-runs. */
const RERUN_DEBOUNCE_MS = 50;

/** Custom HMR event carrying lint findings to the browser console. */
const LINT_EVENT = "tsr-shared-routes:lint";
const LINT_CONNECT_EVENT = "tsr-shared-routes:lint-connected";

/**
 * Appended to the served `sharedRoutes.gen.ts` (dev only, never on disk):
 * every wrapper imports that module, so this listener is always in the
 * client graph and surfaces lint findings in the browser console alongside
 * TanStack's own warnings. Inert in SSR/prod (no `import.meta.hot`).
 */
const LINT_CLIENT_SNIPPET = `
if (import.meta.hot) {
  import.meta.hot.on(${JSON.stringify(LINT_EVENT)}, (messages) => {
    for (const message of messages) console.warn('[tsr-shared-routes] ' + message)
  })
  import.meta.hot.send(${JSON.stringify(LINT_CONNECT_EVENT)})
}
`;

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
   let runtimePath = "";
   let isServe = false;
   let sourceRoots: Array<string> = [];
   let targetDirs: Array<string> = [];
   let wrappersBySource: Record<string, Array<string>> = {};
   let lintWarnings: Array<string> = [];
   let broadcastLint: (() => void) | undefined;
   let pendingWarnings: Array<string> = [];

   const applySummary = (
      summary: PipelineSummary,
      logger?: { warn: (msg: string, opts?: { timestamp: boolean }) => void },
   ): void => {
      sourceRoots = summary.sourceRoots;
      targetDirs = summary.targetDirs;
      wrappersBySource = summary.wrappersBySource;
      lintWarnings = summary.lintWarnings;
      const lines = summary.errors.map((warning) => `tsr-shared-routes: ${warning}`);
      if (logger === undefined) {
         pendingWarnings = lines; // no logger yet in the config hook — defer
      } else {
         for (const line of lines) logger.warn(line, { timestamp: true });
      }
      broadcastLint?.();
   };

   /**
    * HMR: TanStack's route modules self-accept (their injected hot-update
    * code stops propagation at the route file), so when a mounted SOURCE
    * file hot-updates, its wrapper modules would never re-run — leaving the
    * freshly created Route instance unpatched (wrong-mount navigation, and a
    * Rules-of-Hooks crash when the change flips a rendered component's hooks
    * from patched to stock). Pulling the wrappers into the same HMR batch
    * re-executes them, re-patching the new instance before React Refresh
    * re-renders.
    */
   const extraHotModules = <TModule>(
      file: string,
      getModulesByFile: (file: string) => Set<TModule> | undefined,
   ): Array<TModule> => {
      const wrappers = wrappersBySource[path.resolve(file)];
      if (wrappers === undefined) return [];
      const extra: Array<TModule> = [];
      for (const wrapperPath of wrappers) {
         for (const mod of getModulesByFile(wrapperPath) ?? []) extra.push(mod);
      }
      return extra;
   };

   return {
      name: "tsr-shared-routes",
      enforce: "pre",

      // Vite 6+ (environment API). Client only: the SSR environment already
      // page-reloads on route-file changes (TanStack's handling) — adding
      // the wrappers there would just schedule a duplicate reload.
      hotUpdate(options) {
         if (this.environment.name !== "client") return;
         if (options.type !== "update") return;
         const extra = extraHotModules(options.file, (file) =>
            this.environment.moduleGraph.getModulesByFile(file),
         );
         if (extra.length === 0) return;
         const merged = new Set([...options.modules, ...extra]);
         return [...merged];
      },

      // Vite 5 fallback (ignored by Vite 6+ when hotUpdate is present).
      handleHotUpdate(ctx) {
         const extra = extraHotModules(ctx.file, (file) =>
            ctx.server.moduleGraph.getModulesByFile(file),
         );
         if (extra.length === 0) return;
         const merged = new Set([...ctx.modules, ...extra]);
         return [...merged];
      },

      async config(viteConfig, env) {
         const root = path.resolve(viteConfig.root ?? process.cwd());
         resolved = resolveConfig(userConfig, root);
         routesDir = path.resolve(root, resolved.routesDirectory);
         runtimePath = runtimeModulePath(routesDir);
         isServe = env.command === "serve";
         applySummary(runPipeline(resolved, { lenient: true }));
      },

      // Dev only: append the lint console listener to the served runtime
      // module (never written to disk).
      transform(code, id) {
         if (!isServe) return;
         if (path.resolve(id.split("?")[0] ?? id) !== runtimePath) return;
         return { code: code + LINT_CLIENT_SNIPPET, map: null };
      },

      configResolved(viteConfig) {
         for (const line of pendingWarnings) viteConfig.logger.warn(line);
         pendingWarnings = [];
      },

      configureServer(server) {
         const config = resolved;
         if (config === undefined) return;
         const logger = server.config.logger;

         // Source subtrees live inside the routes directory, so watching it
         // covers everything. Wrapper target dirs are deliberately NEVER
         // reacted to by us: the stock generator corrects wrapper literals in
         // place, and reacting to that would create a write/watch loop. (Vite
         // itself still watches them, so the stock generator picks our
         // wrapper writes up — desired.)
         server.watcher.add(routesDir);

         // Lint findings → browser console. Broadcast on change after each
         // pipeline run; late-connecting clients pull the current state via
         // the connect event the served runtime module sends.
         let lastBroadcast = "";
         const sendLint = (client?: { send: (payload: never) => void }): void => {
            if (lintWarnings.length === 0) return;
            const payload = { type: "custom", event: LINT_EVENT, data: lintWarnings };
            (client ?? server.ws).send(payload as never);
         };
         server.ws.on(LINT_CONNECT_EVENT, (_: unknown, client: { send: (p: never) => void }) =>
            sendLint(client),
         );
         broadcastLint = () => {
            const serialized = JSON.stringify(lintWarnings);
            if (serialized === lastBroadcast) return;
            lastBroadcast = serialized;
            sendLint();
         };
         broadcastLint();

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
            if (!isWithin(routesDir, absPath)) return false;
            // Our own output: the generator edits wrappers (literal
            // corrections) and we write them — neither may re-trigger the
            // pipeline.
            if (targetDirs.some((dir) => isWithin(dir, absPath))) return false;
            // Our own `.gen` sibling writes must never re-trigger either.
            if (GEN_FILE_RE.test(absPath)) return false;
            // Any event on a mount file changes the plan.
            if (isMountFile(absPath)) return true;
            // Structure changes (files entering/leaving mounted subtrees, new
            // directories) change the plan.
            if (
               event === "add" ||
               event === "unlink" ||
               event === "addDir" ||
               event === "unlinkDir"
            ) {
               return true;
            }
            // Content edits on MOUNTED source files matter too: the
            // Route-export gate and the relative-escape lint both read file
            // content. Plain routes outside mounted subtrees stay HMR-only.
            return event === "change" && sourceRoots.some((dir) => isWithin(dir, absPath));
         };

         server.watcher.on("all", (event, file) => {
            if (isRelevant(event, file)) schedule();
         });
      },
   };
}
