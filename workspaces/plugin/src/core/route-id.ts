import { determineInitialRoutePath, removeExt, replaceBackslash } from "@tanstack/router-generator";

/**
 * Computes the `createFileRoute('<literal>')` route id for a wrapper file at
 * `wrapperRelPath` (relative to `routesDirectory`).
 *
 * This is a faithful port of the residual per-file logic of the stock
 * generator's physical scan (`getRouteNodes.ts`) on top of the published
 * `determineInitialRoutePath` (which is the stock implementation of dot-flat
 * splitting and bracket escapes). The oracle test in
 * `tests/unit/route-id.test.ts` pins it against the real
 * `physicalGetRouteNodes` so any drift in stock semantics fails CI.
 *
 * Helpers reimplemented below (`escapeRegExp`, `unwrapBracketWrappedSegment`,
 * `hasEscapedLeadingUnderscore`, segment token regexes) are not re-exported by
 * the package's public entry point, and its `exports` field blocks deep
 * imports.
 */

export interface RouteIdOptions {
   indexToken?: string;
   routeToken?: string;
}

const SPECIAL_SUFFIXES = [
   "component",
   "errorComponent",
   "notFoundComponent",
   "pendingComponent",
   "loader",
   "lazy",
] as const;

function escapeRegExp(s: string): string {
   return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isBracketWrappedSegment(segment: string): boolean {
   return segment.startsWith("[") && segment.endsWith("]");
}

function unwrapBracketWrappedSegment(segment: string): string {
   return isBracketWrappedSegment(segment) ? segment.slice(1, -1) : segment;
}

function isFullyEscapedSegment(originalSegment: string): boolean {
   return (
      isBracketWrappedSegment(originalSegment) &&
      !originalSegment.slice(1, -1).includes("[") &&
      !originalSegment.slice(1, -1).includes("]")
   );
}

function hasEscapedLeadingUnderscore(originalSegment: string): boolean {
   return (
      originalSegment.startsWith("[_]") ||
      (originalSegment.startsWith("[_") && isFullyEscapedSegment(originalSegment))
   );
}

/** Stock `createTokenRegex(token, { type: 'segment' })` for string tokens. */
function segmentRegex(token: string): RegExp {
   return new RegExp(`^${escapeRegExp(token)}$`);
}

type FsRouteType =
   | "static"
   | "layout"
   | "pathless_layout"
   | "lazy"
   | "loader"
   | "component"
   | "pendingComponent"
   | "errorComponent"
   | "notFoundComponent";

interface TokenRegexes {
   indexTokenSegmentRegex: RegExp;
   routeTokenSegmentRegex: RegExp;
}

/** Port of stock `getRouteMeta` (fsRouteType part only). */
function getFsRouteType(
   routePath: string,
   originalRoutePath: string,
   { routeTokenSegmentRegex }: TokenRegexes,
): FsRouteType {
   const originalSegments = originalRoutePath.split("/").filter(Boolean);
   const lastOriginalSegment = originalSegments[originalSegments.length - 1] ?? "";
   const isSuffixEscaped = (suffix: string): boolean =>
      isBracketWrappedSegment(lastOriginalSegment) &&
      unwrapBracketWrappedSegment(lastOriginalSegment) === suffix;
   const routeSegments = routePath.split("/").filter(Boolean);
   const lastRouteSegment = routeSegments[routeSegments.length - 1] ?? "";
   const routeTokenCandidate = unwrapBracketWrappedSegment(lastOriginalSegment);
   const isRouteTokenEscaped =
      lastOriginalSegment !== routeTokenCandidate &&
      routeTokenSegmentRegex.test(routeTokenCandidate);

   if (routeTokenSegmentRegex.test(lastRouteSegment) && !isRouteTokenEscaped) return "layout";
   if (routePath.endsWith("/lazy") && !isSuffixEscaped("lazy")) return "lazy";
   if (routePath.endsWith("/loader") && !isSuffixEscaped("loader")) return "loader";
   if (routePath.endsWith("/component") && !isSuffixEscaped("component")) return "component";
   if (routePath.endsWith("/pendingComponent") && !isSuffixEscaped("pendingComponent")) {
      return "pendingComponent";
   }
   if (routePath.endsWith("/errorComponent") && !isSuffixEscaped("errorComponent")) {
      return "errorComponent";
   }
   if (routePath.endsWith("/notFoundComponent") && !isSuffixEscaped("notFoundComponent")) {
      return "notFoundComponent";
   }
   return "static";
}

/** Port of stock `isValidPathlessLayoutRoute`. */
function isValidPathlessLayoutRoute(
   normalizedRoutePath: string,
   originalRoutePath: string,
   routeType: FsRouteType,
   { indexTokenSegmentRegex, routeTokenSegmentRegex }: TokenRegexes,
): boolean {
   if (routeType === "lazy") return false;
   const segments = normalizedRoutePath.split("/").filter(Boolean);
   const originalSegments = originalRoutePath.split("/").filter(Boolean);
   if (segments.length === 0) return false;
   const lastRouteSegment = segments[segments.length - 1]!;
   const lastOriginalSegment = originalSegments[originalSegments.length - 1] ?? "";
   const secondToLastRouteSegment = segments[segments.length - 2];
   const secondToLastOriginalSegment = originalSegments[originalSegments.length - 2];
   if (lastRouteSegment === "__root") return false;
   if (
      routeTokenSegmentRegex.test(lastRouteSegment) &&
      typeof secondToLastRouteSegment === "string" &&
      typeof secondToLastOriginalSegment === "string"
   ) {
      if (hasEscapedLeadingUnderscore(secondToLastOriginalSegment)) return false;
      return secondToLastRouteSegment.startsWith("_");
   }
   if (hasEscapedLeadingUnderscore(lastOriginalSegment)) return false;
   return (
      !indexTokenSegmentRegex.test(lastRouteSegment) &&
      !routeTokenSegmentRegex.test(lastRouteSegment) &&
      lastRouteSegment.startsWith("_")
   );
}

/**
 * Route-id literal for a route file at `wrapperRelPath` relative to
 * `routesDirectory` (e.g. `inventory/providers/$providerId.tsx` →
 * `/inventory/providers/$providerId`).
 */
export function computeRouteIdLiteral(
   wrapperRelPath: string,
   options: RouteIdOptions = {},
): string {
   const indexToken = options.indexToken ?? "index";
   const routeToken = options.routeToken ?? "route";
   const tokenRegexes: TokenRegexes = {
      indexTokenSegmentRegex: segmentRegex(indexToken),
      routeTokenSegmentRegex: segmentRegex(routeToken),
   };
   const { indexTokenSegmentRegex, routeTokenSegmentRegex } = tokenRegexes;

   const filePath = replaceBackslash(wrapperRelPath);
   const initial = determineInitialRoutePath(removeExt(filePath));
   let routePath = initial.routePath;
   let originalRoutePath = initial.originalRoutePath;

   let routeType = getFsRouteType(routePath, originalRoutePath, tokenRegexes);
   if (routeType === "lazy") {
      routePath = routePath.replace(/\/lazy$/, "");
      originalRoutePath = originalRoutePath.replace(/\/lazy$/, "");
   }
   if (isValidPathlessLayoutRoute(routePath, originalRoutePath, routeType, tokenRegexes)) {
      routeType = "pathless_layout";
   }

   // Strip a special suffix (`.lazy` handled above, deprecated suffixes) or a
   // trailing route-token segment.
   const originalSegments = originalRoutePath.split("/").filter(Boolean);
   const lastOriginalSegmentForSuffix = originalSegments[originalSegments.length - 1] ?? "";
   const routePathSegments = routePath.split("/").filter(Boolean);
   const lastRouteSegment = routePathSegments[routePathSegments.length - 1] ?? "";
   const suffixToStrip = SPECIAL_SUFFIXES.find((suffix) => {
      const endsWithSuffix = routePath.endsWith(`/${suffix}`);
      const isEscaped =
         isBracketWrappedSegment(lastOriginalSegmentForSuffix) &&
         unwrapBracketWrappedSegment(lastOriginalSegmentForSuffix) === suffix;
      return endsWithSuffix && !isEscaped;
   });
   const routeTokenCandidate = unwrapBracketWrappedSegment(lastOriginalSegmentForSuffix);
   const isRouteTokenEscaped =
      lastOriginalSegmentForSuffix !== routeTokenCandidate &&
      routeTokenSegmentRegex.test(routeTokenCandidate);
   const shouldStripRouteToken =
      routeTokenSegmentRegex.test(lastRouteSegment) && !isRouteTokenEscaped;
   if (suffixToStrip !== undefined || shouldStripRouteToken) {
      const stripSegment = suffixToStrip ?? lastRouteSegment;
      routePath = routePath.replace(new RegExp(`/${escapeRegExp(stripSegment)}$`), "");
      originalRoutePath = originalRoutePath.replace(
         new RegExp(`/${escapeRegExp(stripSegment)}$`),
         "",
      );
   }

   // Collapse a trailing index-token segment to `/`.
   const lastOriginalSegment = originalRoutePath.split("/").filter(Boolean).pop() ?? "";
   const indexTokenCandidate = unwrapBracketWrappedSegment(lastOriginalSegment);
   const isIndexTokenEscaped =
      lastOriginalSegment !== indexTokenCandidate &&
      indexTokenSegmentRegex.test(indexTokenCandidate);
   if (!isIndexTokenEscaped) {
      const updatedRouteSegments = routePath.split("/").filter(Boolean);
      const updatedLastRouteSegment = updatedRouteSegments[updatedRouteSegments.length - 1] ?? "";
      if (indexTokenSegmentRegex.test(updatedLastRouteSegment)) {
         if (routePathSegments.length === 1) routePath = "/";
         const isLayoutRoute = routeType === "layout";
         routePath =
            routePath.replace(new RegExp(`/${escapeRegExp(updatedLastRouteSegment)}$`), "/") ||
            (isLayoutRoute ? "" : "/");
      }
   }

   return routePath;
}
