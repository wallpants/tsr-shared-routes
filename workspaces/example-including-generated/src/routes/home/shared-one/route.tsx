import { Button } from "#/components/button.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "#/components/dialog.tsx";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { shared } from "./route.gen";

// A plain stock route: /home is its home mount; about/shared-one.mount.ts
// mounts this subtree at /about/shared-one as well.
export const Route = createFileRoute("/home/shared-one")({
   component: Component,
});

function Component() {
   // Stock call site: typed against the home mount, runtime-patched by the
   // generated wrappers to resolve whichever mount actually rendered this.
   const navigate = Route.useNavigate();

   return (
      <>
         <Dialog open onOpenChange={() => navigate({ to: ".." })}>
            <DialogContent className="max-w-200! h-200">
               <DialogHeader>
                  <DialogTitle>Shared One</DialogTitle>
               </DialogHeader>
               <p className="text-5xl">Shared One Route</p>
               <Button
                  nativeButton={false}
                  render={
                     // Relative links use the union-typed shared.Link — it
                     // resolves the current mount and passes it as `from`.
                     <shared.Link to="$sharedOneChild" params={{ sharedOneChild: 789 }}>
                        {`$sharedOneChild params={{sharedOneChild: 789}}`}
                     </shared.Link>
                  }
               />
               <Button
                  nativeButton={false}
                  render={
                     // shared-two is nested-mounted inside this subtree
                     // (shared-two.mount.ts), so this relative target exists
                     // under every mount of shared-one.
                     <shared.Link to="shared-two">shared-two</shared.Link>
                  }
               />
            </DialogContent>
         </Dialog>
         <Outlet />
      </>
   );
}
