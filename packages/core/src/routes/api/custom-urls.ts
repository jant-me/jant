/**
 * Custom URLs API Routes
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { requireAuthApi } from "../../middleware/auth.js";
import {
  CreateCustomUrlSchema,
  parseValidated,
  readJsonBody,
} from "../../lib/schemas.js";
import { parseIdParam, NotFoundError } from "../../lib/errors.js";
import { toApiCustomUrl } from "../../lib/api-custom-urls.js";
import { ID_PREFIX } from "../../lib/ids.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const customUrlsApiRoutes = new Hono<Env>();

const ListCustomUrlsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(100),
  cursor: z.string().optional(),
});

// List custom URLs, newest first (requires auth)
customUrlsApiRoutes.get("/", requireAuthApi(), async (c) => {
  const { limit, cursor } = parseValidated(
    ListCustomUrlsQuerySchema,
    c.req.query(),
  );
  const page = await c.var.services.customUrls.listPage({ limit, cursor });
  return c.json({
    customUrls: page.customUrls.map(toApiCustomUrl),
    nextCursor: page.nextCursor,
  });
});

// Create custom URL (requires auth)
customUrlsApiRoutes.post("/", requireAuthApi(), async (c) => {
  const body = parseValidated(CreateCustomUrlSchema, await readJsonBody(c));

  const customUrl = await c.var.services.customUrls.create({
    path: body.path,
    targetType: body.targetType,
    targetId: body.targetId,
    toPath: body.toPath,
    redirectType: body.redirectType
      ? (parseInt(body.redirectType, 10) as 301 | 302)
      : undefined,
  });

  return c.json(toApiCustomUrl(customUrl), 201);
});

// Delete custom URL (requires auth)
customUrlsApiRoutes.delete("/:id", requireAuthApi(), async (c) => {
  const id = parseIdParam(c.req.param("id"), ID_PREFIX.path);

  const success = await c.var.services.customUrls.delete(id);
  if (!success) throw new NotFoundError("Custom URL");

  return c.json({ success: true });
});
