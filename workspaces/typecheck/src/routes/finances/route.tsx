import { Link, Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/finances")({
  component: FinancesLayout,
});

function FinancesLayout() {
  return (
    <section>
      <h1>Finances</h1>
      <Link to="/finances/providers">Providers</Link>
      <Outlet />
    </section>
  );
}
