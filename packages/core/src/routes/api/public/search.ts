/**
 * Public Search API Routes
 *
 * Anonymous read-only full-text search across published public posts, gated by
 * `PUBLIC_API_ENABLED` and the site's per-client search rate limit.
 */

import { Hono } from "hono";
import type { Bindings } from "../../../types.js";
import type { AppVariables } from "../../../types/app-context.js";
import { loadSearchApiResults } from "../../../lib/api-search.js";
import { ExternalServiceError, ValidationError } from "../../../lib/errors.js";
import { checkRequestRateLimit } from "../../../lib/rate-limit.js";
import { SearchPostsQuerySchema } from "../../../lib/schemas.js";
import { requirePublicApiEnabled } from "../../../middleware/public-content-access.js";
import { validate } from "../../../middleware/validate.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const publicSearchApiRoutes = new Hono<Env>();

publicSearchApiRoutes.use("*", requirePublicApiEnabled());

publicSearchApiRoutes.get(
  "/",
  validate("query", SearchPostsQuerySchema),
  async (c) => {
    const { q: query, limit } = c.req.valid("query");

    const { searchPerMinute } = c.var.appConfig.rateLimit;
    if (!c.var.isAuthenticated && searchPerMinute > 0) {
      const rateLimit = await checkRequestRateLimit(c, {
        name: "search",
        limit: searchPerMinute,
        windowSec: 60,
      });
      if (!rateLimit.ok) {
        c.header("Retry-After", String(rateLimit.retryAfterSec));
        return c.json(
          {
            error: "Too many search requests. Please try again shortly.",
            code: "RATE_LIMITED",
          },
          429,
        );
      }
    }

    try {
      const results = await c.var.services.search.search(query, {
        limit,
        status: ["published"],
        asAuthor: false,
      });

      return c.json({
        query,
        results: await loadSearchApiResults(c.var, results),
        count: results.length,
      });
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      // eslint-disable-next-line no-console -- Error logging is intentional
      console.error("Public search error:", err);
      throw new ExternalServiceError("Search failed");
    }
  },
);
