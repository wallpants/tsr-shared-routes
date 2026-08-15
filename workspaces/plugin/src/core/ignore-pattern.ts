/**
 * The `routeFileIgnorePattern` that hides `*.mount.ts` files AND the
 * generated `.gen` siblings (which live inside the routes directory, next to
 * their source files) from the stock TanStack generator. Lives in its own
 * node-free module: the pipeline writes it into `tsr.config.json`.
 */
export const MOUNT_IGNORE_PATTERN = "\\.mount\\.(ts|js)$|\\.gen\\.(ts|js)x?$";

/** Sample names the maintained pattern must cover (see ensureTsrConfig). */
export const IGNORE_SAMPLES = ["x.mount.ts", "x.mount.js", "x.gen.tsx", "x.gen.ts"] as const;
