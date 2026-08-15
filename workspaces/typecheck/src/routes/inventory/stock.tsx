/**
 * Exists only under /inventory — the type probes use it to show that a
 * relative escape valid under one mount only still typechecks on the union
 * navigate (ANY-mount semantics).
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/inventory/stock")({
   component: () => <p>Stock levels</p>,
});
