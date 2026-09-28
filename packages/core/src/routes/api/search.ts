/**
 * Search API Routes
 */

import { Hono } from "hono";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { ValidationError, ExternalServiceError } from "../../lib/errors.js";
import { toSearchApiResult } from "../../lib/api-search.js";
import { parseValidated, SearchPostsQuerySchema } from "../../lib/schemas.js";
import { requireAuthApi } from "../../middleware/auth.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const searchApiRoutes = new Hono<Env>();

// The author's search, like the rest of the author API: readers search on the
// `/search` page, which is where the per-client search limit applies.
searchApiRoutes.use("*", requireAuthApi());

// Search posts
searchApiRoutes.get("/", async (c) => {
  const { q: query, limit } = parseValidated(
    SearchPostsQuerySchema,
    c.req.query(),
  );

  try {
    const results = await c.var.services.search.search(query, {
      limit,
      status: ["published"],
      includePrivate: true,
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
