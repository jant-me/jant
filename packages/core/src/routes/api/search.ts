/**
 * Search API Routes
 */

import { Hono } from "hono";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../app.js";
import * as sqid from "../../lib/sqid.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const searchApiRoutes = new Hono<Env>();

// Search posts
searchApiRoutes.get("/", async (c) => {
  const query = c.req.query("q");

  if (!query || query.trim().length === 0) {
    return c.json({ error: "Query parameter 'q' is required" }, 400);
  }

  if (query.length > 200) {
    return c.json({ error: "Query too long" }, 400);
  }

  const limitParam = c.req.query("limit");
  const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 20, 50) : 20;

  try {
    const results = await c.var.services.search.search(query, {
      limit,
      visibility: ["featured", "quiet"],
    });

    return c.json({
      query,
      results: results.map((r) => ({
        id: sqid.encode(r.post.id),
        type: r.post.type,
        title: r.post.title,
        path: r.post.path,
        snippet: r.snippet,
        publishedAt: r.post.publishedAt,
        url: `/p/${sqid.encode(r.post.id)}`,
      })),
      count: results.length,
    });
  } catch (err) {
    console.error("Search error:", err);
    return c.json({ error: "Search failed" }, 500);
  }
});
