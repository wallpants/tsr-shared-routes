import { Link, Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/inventory")({
   component: InventoryLayout,
});

function InventoryLayout() {
   return (
      <section>
         <h1>Inventory</h1>
         <Link to="/inventory/help">Help</Link> <Link to="/inventory/stock">Stock</Link>
         <Outlet />
      </section>
   );
}
