/**
 * Non-lazy half of a stock `.lazy` pair inside a mounted subtree. Both halves
 * are plain stock files; the wrappers mirror both and the stock generator
 * pairs them by name at every mount.
 */
import { createFileRoute } from "@tanstack/react-router";
import { fetchTopics } from "./-data";

export const Route = createFileRoute("/help/chart")({
   loader: () => fetchTopics(""),
});
