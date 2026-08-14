import { fetchProviders } from "./-data";
import { createSharedRoute } from "./chart.gen";

/**
 * Base route file of a `.lazy` pair: critical options (loader) live here and
 * stay in the main bundle; the component ships in chart.lazy.tsx and is
 * code-split by the stock generator.
 */
export const shared = createSharedRoute({
  loader: () => fetchProviders(),
});
