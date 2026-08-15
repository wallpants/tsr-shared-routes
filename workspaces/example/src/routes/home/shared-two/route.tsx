import { Dialog,DialogContent,DialogHeader,DialogTitle } from "#/components/dialog.tsx";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/home/shared-two")({
   component: Component,
});

function Component() {
   // Pure option-B file: nothing but stock code — the wrapper's patch makes
   // this navigate resolve per mount at runtime.
   const navigate = Route.useNavigate();

   return (
      <Dialog open onOpenChange={() => navigate({ to: ".." })}>
         <DialogContent>
            <DialogHeader>
               <DialogTitle>Shared Two</DialogTitle>
            </DialogHeader>
            <p className="text-5xl">Shared Two Route</p>
         </DialogContent>
      </Dialog>
   );
}
