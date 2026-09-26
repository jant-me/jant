import { Hono } from "hono";
import { z } from "zod";
import { requireInternalAdminApi } from "../../../middleware/auth.js";
import { parseValidated } from "../../../lib/schemas.js";
import type { Bindings } from "../../../types.js";
import type { AppVariables } from "../../../types/app-context.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

const ReindexSchema = z.object({
  limit: z.number().int().positive().max(500).optional(),
  cursor: z.string().min(1).optional(),
});

export const internalSearchReindexRoutes = new Hono<Env>();

/**
 * Rebuild `post.body_text` for a batch of non-deleted posts. FTS indexes
 * (SQLite trigger / Postgres generated column) refresh automatically when
 * `body_text` changes.
 *
 * Idempotent. Callers loop with the returned `nextCursor` until `done: true`.
 * Used by the `jant search reindex` CLI to backfill search indexes for
 * existing posts after changes to the text extraction logic (e.g. including
 * link mark hrefs so inline URLs become searchable).
 */
internalSearchReindexRoutes.post("/", requireInternalAdminApi(), async (c) => {
  const contentType = c.req.header("Content-Type") || "";
  const rawBody = contentType.includes("application/json")
    ? await c.req.json().catch(() => ({}))
    : {};
  const body = parseValidated(ReindexSchema, rawBody);

  const result = await c.var.services.posts.reindexBodyText({
    limit: body.limit,
    cursor: body.cursor,
  });

  return c.json(result);
});
