/**
 * SPIKE — a plain stock route file that is ALSO mounted at /inventory/help.
 * No shared directory, no `shared` export, no special factory: the only
 * concession to multi-mounting is using `shared.Link` (from the .gen sibling)
 * for relative JSX links, since stock `Link` requires a `from` and any static
 * `from` would be wrong under the other mount.
 */
import { Outlet, createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { fetchTopics } from "./-data";
import { shared } from "./route.gen";

export const Route = createFileRoute("/help")({
   validateSearch: z.object({
      q: z.string().default(""),
   }),
   loaderDeps: ({ search }) => ({ q: search.q }),
   loader: ({ deps }) => fetchTopics(deps.q),
   component: HelpLayout,
});

function HelpLayout() {
   // Stock call site: home-typed, made runtime-correct under every mount by
   // the wrapper's patchSharedHooks call.
   const topics = Route.useLoaderData();

   return (
      <div>
         <h2>Help ({topics.length})</h2>
         <ul>
            {topics.map((topic) => (
               <li key={topic.id}>
                  {/* union-typed relative link — resolves under whichever
                      mount rendered this component */}
                  <shared.Link to="./$topicId" params={{ topicId: topic.id }}>
                     {topic.title}
                  </shared.Link>
               </li>
            ))}
         </ul>
         <Outlet />
      </div>
   );
}
