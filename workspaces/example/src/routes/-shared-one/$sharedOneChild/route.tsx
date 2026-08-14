import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "#/components/dialog.tsx";
import { createSharedRoute } from "./route.gen";

const loader = createServerFn({ method: "GET" })
   .validator(z.object({ sharedOneChild: z.number() }))
   .handler(({ data }) => ({
      childParam: data.sharedOneChild,
   }));

export const shared = createSharedRoute({
   params: z.object({ sharedOneChild: z.coerce.number() }),
   loader: ({ params }) => loader({ data: { sharedOneChild: params.sharedOneChild } }),
   component: Component,
});

function Component() {
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
