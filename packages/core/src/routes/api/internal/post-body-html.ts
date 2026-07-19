import { Hono } from "hono";
import { z } from "zod";
import { requireInternalAdminApi } from "../../../middleware/auth.js";
import { parseValidated } from "../../../lib/schemas.js";
import type { Bindings } from "../../../types.js";
import type { AppVariables } from "../../../types/app-context.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const RebuildPostBodyHtmlSchema = z.object({
  limit: z.number().int().positive().max(100).optional(),
  cursor: z.string().trim().min(1).optional(),
  dryRun: z.boolean().optional(),
});

export const internalPostBodyHtmlRoutes = new Hono<Env>();

/**
 * Rebuild the current site's materialized post body HTML projection.
 *
 * Callers follow `nextCursor` until `done`. The service owns rendering,
 * compare-and-swap writes, and timestamp preservation; this route only
 * validates the authenticated maintenance request.
 */
internalPostBodyHtmlRoutes.post(
  "/rebuild",
  requireInternalAdminApi(),
  async (c) => {
    const contentType = c.req.header("Content-Type") || "";
    const rawBody = contentType.includes("application/json")
      ? await c.req.json().catch(() => ({}))
      : {};
    const body = parseValidated(RebuildPostBodyHtmlSchema, rawBody);

    const result = await c.var.services.posts.rebuildBodyHtml(body);
    return c.json(result);
  },
);
