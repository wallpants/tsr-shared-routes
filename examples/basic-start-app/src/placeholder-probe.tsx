/**
 * Spike probes for the package-level placeholder `createSharedRoute` (the
 * pre-mount import): it must reject unknown option keys and infer through
 * validateSearch/loader chains. Type-only; never imported.
 */
import { createSharedRoute } from "tanstack-shared-routes";
import { z } from "zod";

export const shared = createSharedRoute({
  validateSearch: z.object({ tab: z.enum(["info", "orders"]).default("info") }),
  loaderDeps: ({ search }) => ({ tab: search.tab }),
  loader: ({ deps }) => ({ echoed: deps.tab }),
});

export function Probe() {
  // deps/search flow through the option chain even without a mount
  const okTab: "info" | "orders" = shared.options.loaderDeps!({
    search: { tab: "info" },
  }).tab;

  // @ts-expect-error unknown option keys must be rejected
  createSharedRoute({ nonsense: true });

  return okTab;
}
