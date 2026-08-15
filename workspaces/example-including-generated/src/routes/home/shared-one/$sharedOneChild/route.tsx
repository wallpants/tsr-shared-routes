import { Dialog,DialogContent,DialogHeader,DialogTitle } from "#/components/dialog.tsx";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { shared } from "./route.gen";

const loader = createServerFn({ method: "GET" })
   .validator(z.object({ sharedOneChild: z.number() }))
   .handler(({ data }) => ({
      childParam: data.sharedOneChild,
   }));

// This subtree is covered by THREE mounts: its home (/home/shared-one/…),
// the outer mount of shared-one under /about, and the direct mount
// about/$sharedOneChild.mount.ts (overlapping sources).
export const Route = createFileRoute("/home/shared-one/$sharedOneChild")({
   params: z.object({ sharedOneChild: z.coerce.number() }),
   loader: ({ params }) => loader({ data: { sharedOneChild: params.sharedOneChild } }),
   component: Component,
});

function Component() {
   // Union-typed call sites via the .gen sibling: honest types across mounts.
   const params = shared.useParams();
   const navigate = shared.useNavigate();
   const loaderData = shared.useLoaderData();

   return (
      <Dialog open onOpenChange={() => navigate({ to: ".." })}>
         <DialogContent>
            <DialogHeader>
               <DialogTitle>Shared One's Child</DialogTitle>
            </DialogHeader>
            <p className="text-5xl">Child</p>
            <p className="text-5xl">loaderData: {loaderData.childParam}</p>
            <p className="text-5xl">param: {params.sharedOneChild}</p>
         </DialogContent>
      </Dialog>
   );
}
