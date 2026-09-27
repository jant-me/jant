/**
 * Search API Routes
 */

import { Hono } from "hono";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { ValidationError, ExternalServiceError } from "../../lib/errors.js";
import { toSearchApiResult } from "../../lib/api-search.js";
import { rateLimit } from "../../middleware/rate-limit.js";
import { requirePublicApiAccess } from "../../middleware/public-content-access.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 50;

/**
 * Read `limit` from the query string, clamped to 1–50.
 *
 * Clamped rather than rejected: the endpoint has always capped a large value
 * at 50, and a small one gets the same treatment. Anything that isn't a number
 * falls back to the default.
 *
 * @param value - Raw `limit` query parameter
 * @returns A page size between 1 and 50
 *
 * @example
 * ```ts
 * parseSearchLimit(undefined); // 20
 * parseSearchLimit("-1");      // 1
 * parseSearchLimit("500");     // 50
 * ```
 */
function parseSearchLimit(value: string | undefined): number {
  const parsed = value === undefined ? Number.NaN : Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return DEFAULT_SEARCH_LIMIT;
  return Math.min(Math.max(parsed, 1), MAX_SEARCH_LIMIT);
}

export const searchApiRoutes = new Hono<Env>();

searchApiRoutes.use("*", requirePublicApiAccess());

// Per-IP rate limit. The request-time wrapper is needed because the
// per-minute cap is pulled from `appConfig` which is only available on
// `c.var`; constructing the middleware once at module load would capture
// an undefined value.
searchApiRoutes.use("*", async (c, next) =>
  rateLimit({
    name: "search",
    limit: c.var.appConfig.rateLimit.searchPerMinute,
    windowSec: 60,
  })(c, next),
);

// Search posts
searchApiRoutes.get("/", async (c) => {
  const query = c.req.query("q");

  if (!query || query.trim().length === 0) {
    throw new ValidationError("Query parameter 'q' is required");
  }

  if (query.length > 200) {
    throw new ValidationError("Query too long");
  }

  const limit = parseSearchLimit(c.req.query("limit"));

  try {
    // One answer for every caller, as on `/api/public/*`: this endpoint is
    // documented as public, so a session or token does not widen it. The
    // author searches private posts on `/search` or through MCP.
    const results = await c.var.services.search.search(query, {
      limit,
      status: ["published"],
      includePrivate: false,
    });

    return c.json({
      query,
      results: results.map((r) =>
        toSearchApiResult(r.post, r.snippet, c.var.appConfig.sitePathPrefix),
      ),
      count: results.length,
    });
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    // eslint-disable-next-line no-console -- Error logging is intentional
    console.error("Search error:", err);
    throw new ExternalServiceError("Search failed");
  }
});
