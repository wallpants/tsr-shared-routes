import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { describe, expect, it, vi } from "vitest";
import { MOUNT_IGNORE_PATTERN } from "../../src/core/ignore-pattern";
import { sharedRoutes } from "../../src/vite";
import {
   exists,
   makeTmpDir,
   mountFileSource,
   readFile,
   stockRouteSource,
   writeTree,
} from "../helpers";

function makeFixture(): string {
   const root = makeTmpDir();
   writeTree(root, {
      "src/routes/help/route.tsx": stockRouteSource("/help"),
      "src/routes/help/$topicId.tsx": stockRouteSource("/help/$topicId"),
      "src/routes/inventory/help.mount.ts": mountFileSource("../help"),
      "src/routes/finances/help.mount.ts": mountFileSource("../help"),
   });
   return root;
}

type Handler<T> = Extract<T, (...args: never) => unknown>;

function callConfig(plugin: Plugin, root: string): Promise<unknown> {
   const hook = plugin.config as Handler<Plugin["config"]>;
   return Promise.resolve(
      hook.call(undefined as never, { root }, { command: "serve", mode: "development" } as never),
   );
}

interface FakeServer {
   server: {
      config: { logger: { warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> } };
      watcher: { add: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> };
      ws: { send: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> };
   };
   emit: (event: string, file: string) => void;
   /** Fires a custom ws event registered via server.ws.on. */
   emitWs: (event: string, data: unknown, client: { send: (payload: never) => void }) => void;
   watched: Array<string>;
   errors: Array<string>;
   wsSent: Array<unknown>;
}

function makeFakeServer(): FakeServer {
   const listeners: Array<(event: string, file: string) => void> = [];
   const wsListeners = new Map<string, (data: unknown, client: unknown) => void>();
   const watched: Array<string> = [];
   const errors: Array<string> = [];
   const wsSent: Array<unknown> = [];
   const server = {
      config: {
         logger: {
            warn: vi.fn(),
            error: vi.fn((message: string) => errors.push(message)),
         },
      },
      watcher: {
         add: vi.fn((dir: string) => watched.push(dir)),
         on: vi.fn((event: string, cb: (event: string, file: string) => void) => {
            if (event === "all") listeners.push(cb);
         }),
      },
      ws: {
         send: vi.fn((payload: unknown) => wsSent.push(payload)),
         on: vi.fn((event: string, cb: (data: unknown, client: unknown) => void) => {
            wsListeners.set(event, cb);
         }),
      },
   };
   return {
      server,
      emit: (event, file) => {
         for (const listener of listeners) listener(event, file);
      },
      emitWs: (event, data, client) => {
         wsListeners.get(event)?.(data, client);
      },
      watched,
      errors,
      wsSent,
   };
}

function callConfigureServer(plugin: Plugin, fake: FakeServer): void {
   const hook = plugin.configureServer as Handler<Plugin["configureServer"]>;
   hook.call(undefined as never, fake.server as never);
}

const settle = (ms = 150): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("sharedRoutes vite plugin", () => {
   it("has the required identity and ordering", () => {
      const plugin = sharedRoutes();
      expect(plugin.name).toBe("tsr-shared-routes");
      expect(plugin.enforce).toBe("pre");
   });

   it("runs the pipeline in the config hook so wrappers exist before configResolved", async () => {
      const root = makeFixture();
      await callConfig(sharedRoutes(), root);
      expect(exists(path.join(root, "src/routes/inventory/help/route.tsx"))).toBe(true);
      expect(exists(path.join(root, "src/routes/finances/help/$topicId.tsx"))).toBe(true);
   });

   it("maintains tsr.config.json from the config hook", async () => {
      const root = makeFixture();
      await callConfig(sharedRoutes(), root);
      expect(JSON.parse(readFile(path.join(root, "tsr.config.json")))).toEqual({
         routeFileIgnorePattern: MOUNT_IGNORE_PATTERN,
      });
   });

   it("watches the routes dir", async () => {
      const root = makeFixture();
      const plugin = sharedRoutes();
      await callConfig(plugin, root);
      const fake = makeFakeServer();
      callConfigureServer(plugin, fake);
      expect(fake.watched).toContain(path.join(root, "src", "routes"));
   });

   it("re-runs the pipeline when a source file is removed (unlink under a source root)", async () => {
      const root = makeFixture();
      const plugin = sharedRoutes();
      await callConfig(plugin, root);
      const fake = makeFakeServer();
      callConfigureServer(plugin, fake);

      const sourceFile = path.join(root, "src", "routes", "help", "$topicId.tsx");
      fs.rmSync(sourceFile);
      fake.emit("unlink", sourceFile);
      await settle();
      expect(exists(path.join(root, "src/routes/inventory/help/$topicId.tsx"))).toBe(false);
      expect(exists(path.join(root, "src/routes/inventory/help/route.tsx"))).toBe(true);
   });

   it("re-runs on mounted-source content edits, ignores edits to unmounted routes", async () => {
      const root = makeFixture();
      writeTree(root, { "src/routes/plain.tsx": stockRouteSource("/plain") });
      const plugin = sharedRoutes();
      await callConfig(plugin, root);
      const fake = makeFakeServer();
      callConfigureServer(plugin, fake);

      const wrapper = path.join(root, "src", "routes", "inventory", "help", "route.tsx");

      // Content edit to an UNMOUNTED route file: no codegen (wrapper stays gone).
      fs.rmSync(wrapper); // if a rerun happens it would come back
      fake.emit("change", path.join(root, "src", "routes", "plain.tsx"));
      await settle();
      expect(exists(wrapper)).toBe(false);

      // Content edit to a MOUNTED source file: rerun (the Route-export gate
      // and the escape lint read content), wrapper reappears.
      fake.emit("change", path.join(root, "src", "routes", "help", "route.tsx"));
      await settle();
      expect(exists(wrapper)).toBe(true);

      // Mount file event: rerun too.
      fs.rmSync(wrapper);
      fake.emit("change", path.join(root, "src", "routes", "inventory", "help.mount.ts"));
      await settle();
      expect(exists(wrapper)).toBe(true);
   });

   it("re-runs on a source content edit while a wrapper is deferred (Route export appears)", async () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/help/route.tsx": "// authoring in progress\n",
         "src/routes/inventory/help.mount.ts": mountFileSource("../help"),
      });
      const plugin = sharedRoutes();
      await callConfig(plugin, root);
      const fake = makeFakeServer();
      callConfigureServer(plugin, fake);

      const wrapper = path.join(root, "src", "routes", "inventory", "help", "route.tsx");
      expect(exists(wrapper)).toBe(false); // deferred: no Route export yet

      const sourceFile = path.join(root, "src", "routes", "help", "route.tsx");
      fs.writeFileSync(sourceFile, stockRouteSource("/help"));
      fake.emit("change", sourceFile);
      await settle();
      expect(exists(wrapper)).toBe(true);
   });

   it("ignores events under wrapper target dirs and on .gen files (loop-proofing)", async () => {
      const root = makeFixture();
      const plugin = sharedRoutes();
      await callConfig(plugin, root);
      const fake = makeFakeServer();
      callConfigureServer(plugin, fake);

      const wrapper = path.join(root, "src", "routes", "inventory", "help", "route.tsx");
      fs.rmSync(wrapper);
      // The generator touching a wrapper must not re-trigger us.
      fake.emit("unlink", wrapper);
      fake.emit("add", wrapper);
      fake.emit("change", wrapper);
      // Our own .gen sibling writes must not re-trigger us either.
      fake.emit("change", path.join(root, "src", "routes", "help", "route.gen.tsx"));
      fake.emit("add", path.join(root, "src", "routes", "help", "route.gen.tsx"));
      await settle();
      expect(exists(wrapper)).toBe(false);
   });

   it("debounces bursts into one run and logs pipeline errors instead of throwing", async () => {
      const root = makeFixture();
      const plugin = sharedRoutes();
      await callConfig(plugin, root);
      const fake = makeFakeServer();
      callConfigureServer(plugin, fake);

      // Make the next pipeline run fail: unowned file at a target path.
      const wrapper = path.join(root, "src", "routes", "inventory", "help", "route.tsx");
      fs.writeFileSync(wrapper, "// my own file\n");
      const mountFile = path.join(root, "src", "routes", "inventory", "help.mount.ts");
      fake.emit("change", mountFile);
      fake.emit("change", mountFile);
      fake.emit("change", mountFile);
      await settle();
      expect(fake.errors).toHaveLength(1);
      expect(fake.errors[0]).toContain("tsr-shared-routes");
      expect(readFile(wrapper)).toBe("// my own file\n"); // untouched, server alive
   });

   it("appends the lint console listener to the served runtime module only", async () => {
      const root = makeFixture();
      const plugin = sharedRoutes();
      await callConfig(plugin, root);

      const hook = plugin.transform as unknown;
      const handler = (
         typeof hook === "function" ? hook : (hook as { handler: unknown }).handler
      ) as (this: unknown, code: string, id: string) => { code: string } | undefined;

      const runtime = handler.call({}, "// runtime", path.join(root, "src/sharedRoutes.gen.ts"));
      expect(runtime?.code).toContain("import.meta.hot.on");
      expect(runtime?.code).toContain("tsr-shared-routes:lint");

      const other = handler.call({}, "// other", path.join(root, "src/routes/help/route.tsx"));
      expect(other).toBeUndefined();
   });

   it("broadcasts lint findings over the ws channel and replies to late clients", async () => {
      const root = makeTmpDir();
      writeTree(root, {
         "src/routes/help/$topicId.tsx": `${stockRouteSource("/help/$topicId")}const go = { to: '../../stock' }\n`,
         "src/routes/inventory/stock.tsx": stockRouteSource("/inventory/stock"),
         "src/routes/inventory/help.mount.ts": mountFileSource("../help"),
      });
      const plugin = sharedRoutes();
      await callConfig(plugin, root);
      const fake = makeFakeServer();
      callConfigureServer(plugin, fake);

      // broadcast on server start (findings exist from the config-hook run)
      expect(fake.wsSent).toHaveLength(1);
      const payload = fake.wsSent[0] as { event: string; data: Array<string> };
      expect(payload.event).toBe("tsr-shared-routes:lint");
      expect(payload.data[0]).toContain("'../../stock'");

      // a late-connecting client gets the current findings directly
      const clientSent: Array<unknown> = [];
      fake.emitWs("tsr-shared-routes:lint-connected", undefined, {
         send: ((p: unknown) => clientSent.push(p)) as never,
      });
      expect(clientSent).toHaveLength(1);

      // unchanged findings are not re-broadcast on subsequent reruns
      const mountFile = path.join(root, "src", "routes", "inventory", "help.mount.ts");
      fake.emit("change", mountFile);
      await settle();
      expect(fake.wsSent).toHaveLength(1);
   });

   it("pulls wrapper modules into the HMR batch when a mounted source file updates", async () => {
      const root = makeFixture();
      const plugin = sharedRoutes();
      await callConfig(plugin, root);

      const hook = plugin.hotUpdate as unknown;
      const handler = (
         typeof hook === "function" ? hook : (hook as { handler: unknown }).handler
      ) as (this: unknown, options: unknown) => unknown;

      const sourceModule = { id: "source" };
      const inventoryWrapper = { id: "inventory-wrapper" };
      const financesWrapper = { id: "finances-wrapper" };
      const byFile = new Map<string, Set<unknown>>([
         [path.join(root, "src/routes/inventory/help/route.tsx"), new Set([inventoryWrapper])],
         [path.join(root, "src/routes/finances/help/route.tsx"), new Set([financesWrapper])],
      ]);
      const context = {
         environment: {
            name: "client",
            moduleGraph: { getModulesByFile: (file: string) => byFile.get(file) },
         },
      };

      const result = handler.call(context, {
         type: "update",
         file: path.join(root, "src/routes/help/route.tsx"),
         timestamp: 0,
         modules: [sourceModule],
         read: () => "",
      });
      expect(result).toEqual([sourceModule, financesWrapper, inventoryWrapper]);

      // a file no mount covers: no opinion, default HMR behavior
      const none = handler.call(context, {
         type: "update",
         file: path.join(root, "src/routes/index.tsx"),
         timestamp: 0,
         modules: [sourceModule],
         read: () => "",
      });
      expect(none).toBeUndefined();

      // non-client environments are left alone (TanStack already reloads SSR)
      const ssr = handler.call(
         { environment: { ...context.environment, name: "ssr" } },
         {
            type: "update",
            file: path.join(root, "src/routes/help/route.tsx"),
            timestamp: 0,
            modules: [sourceModule],
            read: () => "",
         },
      );
      expect(ssr).toBeUndefined();
   });

   it("picks up a newly added mount and generates its wrappers", async () => {
      const root = makeFixture();
      const plugin = sharedRoutes();
      await callConfig(plugin, root);
      const fake = makeFakeServer();
      callConfigureServer(plugin, fake);

      writeTree(root, {
         "src/routes/reviews/index.tsx": stockRouteSource("/reviews/"),
         "src/routes/archive/reviews.mount.ts": mountFileSource("../reviews"),
      });
      fake.emit("add", path.join(root, "src", "routes", "archive", "reviews.mount.ts"));
      await settle();
      expect(exists(path.join(root, "src/routes/archive/reviews/index.tsx"))).toBe(true);
   });
});
