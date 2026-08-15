import { createLazyFileRoute } from "@tanstack/react-router";
import { Route as chartRoute } from "./chart";

export const Route = createLazyFileRoute("/help/chart")({
   component: Chart,
});

function Chart() {
   // Stock call site on the non-lazy half's Route: home-typed, runtime-patched.
   const topics = chartRoute.useLoaderData();
   return <div>{topics.length} topics</div>;
}
