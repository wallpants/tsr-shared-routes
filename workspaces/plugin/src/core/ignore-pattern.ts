/**
 * The `routeFileIgnorePattern` that hides `*.mount.ts` files from the stock
 * TanStack generator. Lives in its own node-free module: the package entry
 * (bundled into the app) re-exports it, and the pipeline writes it into
 * `tsr.config.json`.
 */
export const MOUNT_IGNORE_PATTERN = "\\.mount\\.(ts|js)$";
