import { Button } from "#/components/button.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "#/components/dialog.tsx";
import { Outlet } from "@tanstack/react-router";
import { createSharedRoute } from "./route.gen";

export const shared = createSharedRoute({
  component: Component,
});

function Component() {
  const navigate = shared.useNavigate();

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
              <shared.Link to="$sharedOneChild" params={{ sharedOneChild: 789 }}>
                {`$sharedOneChild params={{sharedOneChild: 789}}`}
              </shared.Link>
            }
          />
        </DialogContent>
      </Dialog>
      <Outlet />
    </>
  );
}
