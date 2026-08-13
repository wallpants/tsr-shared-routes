import { fetchProviders } from "./-data";
import { createSharedRoute } from "./index.gen";

export const shared = createSharedRoute({
  loader: () => fetchProviders(),
  component: ProvidersList,
});

function ProvidersList() {
  const providers = shared.useLoaderData();
  const navigate = shared.useNavigate();

  return (
    <div>
      <h2>Providers</h2>
      <ul>
        {providers.map((p) => (
          <li key={p.id}>
            {/* relative link within the shared subtree */}
            <shared.Link to="./$providerId" params={{ providerId: p.id }}>
              {p.name}
            </shared.Link>
          </li>
        ))}
      </ul>
      <button onClick={() => navigate({ to: "./$providerId", params: { providerId: "acme" } })}>
        Jump to Acme
      </button>
      <p>
        {/* the .lazy pair: loader in chart.tsx, component code-split via chart.lazy.tsx */}
        <shared.Link to="./chart">Balance chart</shared.Link>
      </p>
    </div>
  );
}
