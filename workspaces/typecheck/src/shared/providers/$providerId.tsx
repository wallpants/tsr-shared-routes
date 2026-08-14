import { z } from "zod";
import { createSharedRoute } from "./$providerId.gen";
import { fetchProvider } from "./-data";

export const shared = createSharedRoute({
  validateSearch: z.object({
    tab: z.enum(["info", "orders"]).default("info"),
  }),
  loaderDeps: ({ search }) => ({ tab: search.tab }),
  loader: ({ params }) => fetchProvider(params.providerId),
  component: ProviderDetail,
});

function ProviderDetail() {
  const provider = shared.useLoaderData();
  const { providerId } = shared.useParams();
  const { tab } = shared.useSearch();
  const navigate = shared.useNavigate();

  return (
    <div>
      <h2>
        {provider.name} ({providerId})
      </h2>
      <p>Active tab: {tab}</p>
      <shared.Link to="." search={{ tab: "orders" }}>
        Orders
      </shared.Link>
      <button onClick={() => navigate({ to: ".", search: { tab: "info" } })}>Info</button>
      {/* relative link back up to the shared subtree root (the list) */}
      <shared.Link to="..">Back to list</shared.Link>
    </div>
  );
}
