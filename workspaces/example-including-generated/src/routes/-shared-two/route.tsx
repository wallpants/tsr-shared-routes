import { Dialog, DialogContent, DialogHeader, DialogTitle } from "#/components/dialog.tsx";
import { createSharedRoute } from "./route.gen";

export const shared = createSharedRoute({
  component: Component,
});

function Component() {
  const navigate = shared.useNavigate();

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
