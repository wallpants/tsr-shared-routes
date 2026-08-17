/**
 * Type probes for the "mount already-mounted routes" model: each
 * @ts-expect-error line MUST error for this file to compile — proving the
 * types are strict, not `any`. Type-only; never imported.
 */
import { Link, getRouteApi, useParams } from "@tanstack/react-router";
import { Route as topicRoute } from "./routes/help/$topicId";
import { shared as topicShared } from "./routes/help/$topicId.gen";
import { shared as faqShared } from "./routes/help/guides/faq.gen";
import { Route as helpRoute } from "./routes/help/route";
import { shared as modalShared } from "./routes/modal/open.gen";

export function HomeTypedProbes() {
   // Stock call sites stay fully stock-typed against the home mount.
   const topics = helpRoute.useLoaderData();
   const first: string | undefined = topics[0]?.title;
   // @ts-expect-error unknown property on HelpTopic
   topics[0]?.nope;

   const search = helpRoute.useSearch();
   const q: string = search.q;

   const nav = helpRoute.useNavigate();
   // home-typed relative nav typechecks against /help
   void nav({ to: ".", search: { q: "billing" } });
   // @ts-expect-error invalid search value type
   void nav({ to: ".", search: { q: 1 } });

   return { first, q };
}

export function UnionTypedProbes() {
   const topic = topicShared.useLoaderData();
   const body: string = topic.body;
   // @ts-expect-error unknown property on HelpTopic
   topic.nope;

   const params = topicShared.useParams();
   const tid: string = params.topicId;
   // @ts-expect-error unknown param
   params.nope;

   // inherited search from the layout's validateSearch, under both mounts
   const search = topicShared.useSearch();
   const q: string = search.q;

   const navigate = topicShared.useNavigate();
   // within-subtree relative target, valid under both mounts
   void navigate({ to: ".." });
   // @ts-expect-error typo'd relative target must be rejected
   void navigate({ to: "./tpyo" });
   // escape valid under BOTH mounts ('/' at home, '/inventory' at the other)
   void navigate({ to: "../.." });
   // KNOWN LIMITATION: union-`from` navigation accepts targets valid under
   // ANY mount, not ALL mounts — this escape only exists under
   // /inventory/help ('/stock' is not a route at home) yet it typechecks.
   void navigate({ to: "../../stock" });

   return { body, tid, q };
}

export function HomeNavigateStrictnessProbes() {
   // The home-typed stock navigate (from = '/help/$topicId') is STRICTER
   // than the union view for one-mount escapes: '/stock' does not exist
   // under the home mount, so it is rejected here while the union navigate
   // above accepts it.
   const homeNav = topicRoute.useNavigate();
   void homeNav({ to: "../.." });
   // @ts-expect-error no /stock route under the home mount
   void homeNav({ to: "../../stock" });
   return null;
}

export function WrapperRegistrationProbes() {
   // The wrapper's generics — extracted from the STOCK source Route — must
   // register real types in the route tree, not any/unknown.
   const api = getRouteApi("/inventory/help");
   const topics = api.useLoaderData();
   const first: string | undefined = topics[0]?.title;
   // @ts-expect-error loader data is HelpTopic[], not any
   topics[0]?.nope;

   const search = api.useSearch();
   const q: string = search.q;

   const childApi = getRouteApi("/inventory/help/$topicId");
   const topic = childApi.useLoaderData();
   const body: string = topic.body;

   return { first, q, body };
}

export function OverlappingSourceProbes() {
   // faq.tsx is covered by two mounts (outer /inventory/help mirror + direct
   // /settings/guides mount) plus home — all three register real types.
   const settingsApi = getRouteApi("/settings/guides/faq");
   const viaSettings: number = settingsApi.useLoaderData().answers;
   const outerApi = getRouteApi("/inventory/help/guides/faq");
   const viaOuter: number = outerApi.useLoaderData().answers;
   const answers: number = faqShared.useLoaderData().answers;
   // @ts-expect-error unknown property
   faqShared.useLoaderData().nope;
   return { viaSettings, viaOuter, answers };
}

export function NestedMountProbes() {
   // /modal is mounted INSIDE the /help subtree (help/modal.mount.ts), and
   // /help is itself mounted at /inventory/help — the nested-home wrapper AND
   // the virtual wrapper both register real types in the route tree.
   const nestedHomeApi = getRouteApi("/help/modal/open");
   const viaNestedHome: string = nestedHomeApi.useLoaderData().dialogId;
   const virtualApi = getRouteApi("/inventory/help/modal/open");
   const viaVirtual: string = virtualApi.useLoaderData().dialogId;
   // @ts-expect-error loader data is { dialogId: string }, not any
   virtualApi.useLoaderData().nope;

   // The source's sibling unions all three locations.
   const dialogId: string = modalShared.useLoaderData().dialogId;
   const match = modalShared.useMatch();
   const id: "/modal/open" | "/help/modal/open" | "/inventory/help/modal/open" = match.routeId;
   // @ts-expect-error the union is exact — no other route ids
   const wrong: "/modal/open" | "/help/modal/open" = match.routeId;

   return { viaNestedHome, viaVirtual, dialogId, id, wrong };
}

export function StrictFalseProbes() {
   // `strict: false` types against the merge of EVERY route's params, so it
   // is the canary for a poisoned registration: a single route registering
   // `unknown` params absorbs the whole union (`X | unknown = unknown`) and
   // degrades every strict-false call site in the app.
   const params = useParams({ strict: false });
   const tid: string | undefined = params.topicId;
   // @ts-expect-error unknown param — errors only while params is a real object type
   params.nope;
   return { tid };
}

export function RequiredSearchProbes() {
   // Stock navigation DOES enforce a REQUIRED search param (no default).
   const nav = helpRoute.useNavigate();
   void nav({ to: "/required-search", search: { w: "x" } });
   // @ts-expect-error missing required search param
   void nav({ to: "/required-search" });
   return (
      <>
         <Link to="/required-search" search={{ w: "x" }} />
         {/* @ts-expect-error missing required search param */}
         <Link to="/required-search" />
      </>
   );
}

export function LinkProbes() {
   return (
      <>
         {/* absolute stock links work from anywhere */}
         <Link to="/inventory/help" />
         {/* without `from`, stock Link accepts ONLY the bare '.' and '..'
             relatives (leaf-resolved at runtime) — any structured relative
             target needs a `from`, hence shared.Link */}
         <Link to=".." />
         {/* @ts-expect-error structured relative `to` without `from` is rejected */}
         <Link to="./$topicId" params={{ topicId: "billing" }} />
         {/* union-typed relative link via the .gen sibling */}
         <topicShared.Link to=".." />
         <topicShared.Link to="." />
      </>
   );
}
