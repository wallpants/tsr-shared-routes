import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { describe, expect, it, vi } from "vitest";
import { IGNORE_PATTERN_WARNING, sharedRoutes } from "../../src/vite";
import { exists, makeTmpDir, mountFileSource, readFile, writeTree } from "../helpers";

function makeFixture(): string {
  const root = makeTmpDir();
  writeTree(root, {
    "src/routes/inventory/providers.mount.ts": mountFileSource("../../shared/providers"),
    "src/routes/finances/providers.mount.ts": mountFileSource("../../shared/providers"),
    "src/shared/providers/index.tsx": "export const shared = {} as any\n",
    "src/shared/providers/$providerId.tsx": "export const shared = {} as any\n",
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

function callConfigResolved(plugin: Plugin, logger: { warn: (msg: string) => void }): void {
  const hook = plugin.configResolved as Handler<Plugin["configResolved"]>;
  hook.call(undefined as never, { logger } as never);
}

interface FakeServer {
  server: {
    config: { logger: { warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> } };
    watcher: { add: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> };
  };
  emit: (event: string, file: string) => void;
  watched: Array<string>;
  errors: Array<string>;
}

function makeFakeServer(): FakeServer {
  const listeners: Array<(event: string, file: string) => void> = [];
  const watched: Array<string> = [];
  const errors: Array<string> = [];
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
  };
  return {
    server,
    emit: (event, file) => {
      for (const listener of listeners) listener(event, file);
    },
    watched,
    errors,
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
    expect(plugin.name).toBe("tanstack-shared-routes");
    expect(plugin.enforce).toBe("pre");
  });

  it("runs the pipeline in the config hook so wrappers exist before configResolved", async () => {
    const root = makeFixture();
    await callConfig(sharedRoutes(), root);
    expect(exists(path.join(root, "src/routes/inventory/providers/index.tsx"))).toBe(true);
    expect(exists(path.join(root, "src/routes/finances/providers/$providerId.tsx"))).toBe(true);
  });

  it("warns once about a missing routeFileIgnorePattern via the vite logger", async () => {
    const root = makeFixture();
    const plugin = sharedRoutes();
    await callConfig(plugin, root);
    const warn = vi.fn();
    callConfigResolved(plugin, { warn });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(IGNORE_PATTERN_WARNING);
    // A second configResolved (or hot restart of the hook) never re-warns.
    callConfigResolved(plugin, { warn });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does not warn when tsr.config.json declares a matching ignore pattern", async () => {
    const root = makeFixture();
    writeTree(root, {
      "tsr.config.json": JSON.stringify({ routeFileIgnorePattern: "\\.mount\\.(ts|js)$" }),
    });
    const plugin = sharedRoutes();
    await callConfig(plugin, root);
    const warn = vi.fn();
    callConfigResolved(plugin, { warn });
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns when tsr.config.json has a pattern that does not cover mount files", async () => {
    const root = makeFixture();
    writeTree(root, {
      "tsr.config.json": JSON.stringify({ routeFileIgnorePattern: "\\.test\\.ts$" }),
    });
    const plugin = sharedRoutes();
    await callConfig(plugin, root);
    const warn = vi.fn();
    callConfigResolved(plugin, { warn });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("suppresses the warning via silenceIgnorePatternWarning", async () => {
    const root = makeFixture();
    const plugin = sharedRoutes({ silenceIgnorePatternWarning: true });
    await callConfig(plugin, root);
    const warn = vi.fn();
    callConfigResolved(plugin, { warn });
    expect(warn).not.toHaveBeenCalled();
  });

  it("watches the routes dir and every shared root, never the target dirs", async () => {
    const root = makeFixture();
    const plugin = sharedRoutes();
    await callConfig(plugin, root);
    const fake = makeFakeServer();
    callConfigureServer(plugin, fake);
    expect(fake.watched).toContain(path.join(root, "src", "routes"));
    expect(fake.watched).toContain(path.join(root, "src", "shared", "providers"));
    for (const dir of fake.watched) {
      expect(dir).not.toContain(path.join("routes", "inventory", "providers"));
      expect(dir).not.toContain(path.join("routes", "finances", "providers"));
    }
  });

  it("re-runs the pipeline when a shared file is removed (unlink under shared root)", async () => {
    const root = makeFixture();
    const plugin = sharedRoutes();
    await callConfig(plugin, root);
    const fake = makeFakeServer();
    callConfigureServer(plugin, fake);

    const sharedFile = path.join(root, "src", "shared", "providers", "$providerId.tsx");
    fs.rmSync(sharedFile);
    fake.emit("unlink", sharedFile);
    await settle();
    expect(exists(path.join(root, "src/routes/inventory/providers/$providerId.tsx"))).toBe(false);
    expect(exists(path.join(root, "src/routes/inventory/providers/index.tsx"))).toBe(true);
  });

  it("re-runs when a mount file changes, but ignores content changes under shared roots", async () => {
    const root = makeFixture();
    const plugin = sharedRoutes();
    await callConfig(plugin, root);
    const fake = makeFakeServer();
    callConfigureServer(plugin, fake);

    // Content-only change to a shared route file: no codegen (wrapper mtime stable).
    const sharedFile = path.join(root, "src", "shared", "providers", "index.tsx");
    const wrapper = path.join(root, "src", "routes", "inventory", "providers", "index.tsx");
    fs.rmSync(wrapper); // if a rerun happens it would come back
    fake.emit("change", sharedFile);
    await settle();
    expect(exists(wrapper)).toBe(false);

    // Mount file event: rerun (wrapper reappears).
    const mountFile = path.join(root, "src", "routes", "inventory", "providers.mount.ts");
    fake.emit("change", mountFile);
    await settle();
    expect(exists(wrapper)).toBe(true);
  });

  it("ignores events under wrapper target dirs (loop-proofing)", async () => {
    const root = makeFixture();
    const plugin = sharedRoutes();
    await callConfig(plugin, root);
    const fake = makeFakeServer();
    callConfigureServer(plugin, fake);

    const wrapper = path.join(root, "src", "routes", "inventory", "providers", "index.tsx");
    fs.rmSync(wrapper);
    // The generator touching a wrapper must not re-trigger us.
    fake.emit("unlink", wrapper);
    fake.emit("add", wrapper);
    fake.emit("change", wrapper);
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
    const wrapper = path.join(root, "src", "routes", "inventory", "providers", "index.tsx");
    fs.writeFileSync(wrapper, "// my own file\n");
    const mountFile = path.join(root, "src", "routes", "inventory", "providers.mount.ts");
    fake.emit("change", mountFile);
    fake.emit("change", mountFile);
    fake.emit("change", mountFile);
    await settle();
    expect(fake.errors).toHaveLength(1);
    expect(fake.errors[0]).toContain("tanstack-shared-routes");
    expect(readFile(wrapper)).toBe("// my own file\n"); // untouched, server alive
  });

  it("picks up newly referenced shared roots and watches them after a rerun", async () => {
    const root = makeFixture();
    const plugin = sharedRoutes();
    await callConfig(plugin, root);
    const fake = makeFakeServer();
    callConfigureServer(plugin, fake);

    writeTree(root, {
      "src/routes/reviews.mount.ts": mountFileSource("../shared/reviews"),
      "src/shared/reviews/index.tsx": "export const shared = {} as any\n",
    });
    fake.emit("add", path.join(root, "src", "routes", "reviews.mount.ts"));
    await settle();
    expect(exists(path.join(root, "src/routes/reviews/index.tsx"))).toBe(true);
    expect(fake.watched).toContain(path.join(root, "src", "shared", "reviews"));
  });
});
