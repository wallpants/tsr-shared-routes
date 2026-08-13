/**
 * Spike probes: each @ts-expect-error line MUST error for this file to
 * compile — proving the shared-route types are strict, not `any`.
 * This file is type-only; it is never imported.
 */
import { shared as providerDetail } from "./shared/providers/$providerId";
import { shared as providerList } from "./shared/providers/index";

export function DetailProbes() {
  const provider = providerDetail.useLoaderData();
  const params = providerDetail.useParams();
  const search = providerDetail.useSearch();
  const navigate = providerDetail.useNavigate();

  // loader data is the real Provider type, not any/never
  const balance: number = provider.balance;
  // @ts-expect-error Provider has no such property
  provider.doesNotExist;

  // own-subtree param typed as string
  const pid: string = params.providerId;
  // @ts-expect-error unknown param
  params.nope;

  // search is the validated schema output
  const tab: "info" | "orders" = search.tab;
  // @ts-expect-error not part of the search schema
  search.unknownKey;

  // within-subtree relative nav is strictly typed
  void navigate({ to: ".", search: { tab: "orders" } });
  void navigate({ to: ".." });
  // @ts-expect-error typo'd relative target must be rejected
  void navigate({ to: "./tpyo" });
  // @ts-expect-error invalid search value must be rejected
  void navigate({ to: ".", search: { tab: "nope" } });

  return { balance, pid, tab };
}

export function AbsoluteNavProbes() {
  // absolute paths into mounts are stock-typed from anywhere; params for
  // $providerId are optional here because `from` (the mount union) already
  // carries providerId — stock inherit-params semantics.
  return (
    <>
      <providerDetail.Link to="/finances/providers/$providerId" params={{ providerId: "acme" }} />
      {/* @ts-expect-error nonexistent absolute path must be rejected */}
      <providerDetail.Link to="/does/not/exist" />
    </>
  );
}

export function ListProbes() {
  const providers = providerList.useLoaderData();
  const navigate = providerList.useNavigate();

  // loader data is Array<Provider>, not any/never
  const first: string | undefined = providers[0]?.name;

  // list -> detail within the subtree, params required (index has none)
  void navigate({ to: "./$providerId", params: { providerId: "acme" } });
  // @ts-expect-error missing params must be rejected (from an index route)
  void navigate({ to: "./$providerId", params: {} });

  // escaping the subtree from the index route: stock index-route semantics
  // need '../..' (one '..' only strips the index segment). Resolves to
  // '/inventory' | '/finances' — valid under BOTH mounts (isomorphic escape).
  void navigate({ to: "../.." });

  return { first };
}
