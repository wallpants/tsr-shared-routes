import type { LazyRouteOptions } from "@tanstack/react-router";
import { shared } from "./chart";

/** Lazy half of the chart route: the generated `chart.lazy.tsx` wrappers pass this to `createLazyFileRoute`. */
export const sharedLazy = {
   component: ProvidersChart,
} satisfies LazyRouteOptions;

function ProvidersChart() {
   const providers = shared.useLoaderData();

   return (
      <div>
         <h2>Provider balance chart</h2>
         <ul>
            {providers.map((p) => (
               <li key={p.id}>
                  {p.name}: {"#".repeat(Math.max(1, Math.round(Math.abs(p.balance) / 100)))}{" "}
                  {p.balance}
               </li>
            ))}
         </ul>
         <shared.Link to="..">Back to list</shared.Link>
      </div>
   );
}
