/**
 * Media API Routes
 *
 * The author's uploaded files as a resource: list, read, change alt text,
 * delete. Uploading happens at `POST /api/upload` (one request) or
 * `/api/uploads` (a resumable session); the MCP media tools share these
 * responses.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { requireAuthApi } from "../../middleware/auth.js";
import { assertFound, parseIdParam } from "../../lib/errors.js";
import { ID_PREFIX } from "../../lib/ids.js";
import {
  MediaIdSchema,
  parseValidated,
  readJsonBody,
} from "../../lib/schemas.js";
import { toApiMedia } from "../../lib/api-media.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const mediaApiRoutes = new Hono<Env>();

const ListMediaQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  mimePrefix: z.string().trim().min(1).optional(),
  cursor: MediaIdSchema.optional(),
});

const UpdateMediaSchema = z.object({
  alt: z
    .string()
    .max(500)
    .transform((value) => value.trim()),
});

mediaApiRoutes.use("*", requireAuthApi());

// List files, newest first
mediaApiRoutes.get("/", async (c) => {
  const { limit, mimePrefix, cursor } = parseValidated(
    ListMediaQuerySchema,
    c.req.query(),
  );
  const mediaList = await c.var.services.media.list({
    limit,
    mimePrefix,
    cursor,
  });

  return c.json({
    media: mediaList.map((media) => toApiMedia(media, c.var.appConfig)),
    nextCursor:
      mediaList.length === limit ? (mediaList.at(-1)?.id ?? null) : null,
  });
});

mediaApiRoutes.get("/:id", async (c) => {
  const id = parseIdParam(c.req.param("id"), ID_PREFIX.media);
  const media = assertFound(await c.var.services.media.getById(id), "Media");
  return c.json(toApiMedia(media, c.var.appConfig));
});

mediaApiRoutes.patch("/:id", async (c) => {
  const id = parseIdParam(c.req.param("id"), ID_PREFIX.media);
  const { alt } = parseValidated(UpdateMediaSchema, await readJsonBody(c));
  assertFound(await c.var.services.media.getById(id), "Media");

  await c.var.services.media.updateAlt(id, alt);

  const media = assertFound(await c.var.services.media.getById(id), "Media");
  return c.json(toApiMedia(media, c.var.appConfig));
});

mediaApiRoutes.delete("/:id", async (c) => {
  const id = parseIdParam(c.req.param("id"), ID_PREFIX.media);
  assertFound(await c.var.services.media.getById(id), "Media");

  await c.var.services.media.delete(id, c.var.storage);

  return c.json({ success: true });
});
