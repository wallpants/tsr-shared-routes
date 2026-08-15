/**
 * A route with a REQUIRED search param (no default), used only to probe that
 * stock navigation enforces required search at the type level.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

export const Route = createFileRoute("/required-search")({
   validateSearch: z.object({
      w: z.string(),
   }),
});
