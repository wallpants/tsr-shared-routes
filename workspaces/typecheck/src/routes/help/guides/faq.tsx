/**
 * Overlap fixture: this file is covered by TWO mounts — via /inventory/help
 * (the outer mount of the whole help subtree) and via /settings/guides (a
 * direct mount of the guides subtree) — plus its home location.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/help/guides/faq")({
   loader: () => ({ answers: 42 }),
   component: () => <p>FAQ</p>,
});
