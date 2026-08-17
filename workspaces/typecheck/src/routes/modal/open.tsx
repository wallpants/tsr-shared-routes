/**
 * Nested-mount fixture: the /modal subtree is mounted by a mount file INSIDE
 * the /help subtree (help/modal.mount.ts), and /help is itself mounted at
 * /inventory/help — so this file is reachable at /modal/open (home),
 * /help/modal/open (nested home), and /inventory/help/modal/open (virtual).
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/modal/open")({
   loader: () => ({ dialogId: "confirm" }),
   component: () => <p>Modal</p>,
});
