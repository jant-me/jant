/**
 * Smart Collections API Routes
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { requireAuthApi } from "../../middleware/auth.js";
import {
  ContentLanguageSchema,
  CreateSmartCollectionSchema,
  SmartCollectionIdSchema,
  SmartCollectionPreviewSchema,
  UpdateSmartCollectionSchema,
  parseValidated,
} from "../../lib/schemas.js";
import { assertFound, parseIdParam } from "../../lib/errors.js";
import { ID_PREFIX } from "../../lib/ids.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const smartCollectionsApiRoutes = new Hono<Env>();

/**
 * Address availability, in the shape posts already use.
 *
 * `suggest` derives one from a title; `check` answers whether a typed one is
 * free. Collections answer the same question at `/api/collections/slug`.
 */
const SlugQuerySchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("suggest"),
    title: z.string().trim().max(300).optional(),
    smartCollectionId: SmartCollectionIdSchema.optional(),
  }),
  z.object({
    mode: z.literal("check"),
    slug: z.string().trim().toLowerCase().min(1).max(200),
    smartCollectionId: SmartCollectionIdSchema.optional(),
  }),
]);

const PreviewQuerySchema = z.object({
  lang: ContentLanguageSchema.optional(),
});

// --- Address ---------------------------------------------------------------
// Declared before `/:id` so the literal path wins.

smartCollectionsApiRoutes.get("/slug", requireAuthApi(), async (c) => {
  const query = parseValidated(SlugQuerySchema, c.req.query());

  if (query.mode === "suggest") {
    const slug = await c.var.services.smartCollections.suggestSlug({
      title: query.title,
      excludeId: query.smartCollectionId,
    });
    return c.json({ slug });
  }

  const available = await c.var.services.smartCollections.checkSlugAvailability(
    query.slug,
    query.smartCollectionId,
  );
  return c.json({ slug: query.slug, available });
});

// --- Preview ---------------------------------------------------------------

/**
 * How many threads a set of conditions would gather, against the site total.
 *
 * POST rather than GET: the conditions are a typed body in the same shape the
 * create endpoint validates, and putting them in a URL would mean inventing a
 * second spelling for them.
 */
smartCollectionsApiRoutes.post("/preview", requireAuthApi(), async (c) => {
  const body = parseValidated(SmartCollectionPreviewSchema, await c.req.json());
  const query = parseValidated(PreviewQuerySchema, c.req.query());

  const { count, baseline } = await c.var.services.smartCollections.preview(
    body.selection ?? {},
    { isAuthenticated: c.var.isAuthenticated, lang: query.lang },
  );

  c.header("Cache-Control", "no-store");
  return c.json({ count, baseline });
});

// --- CRUD ------------------------------------------------------------------

smartCollectionsApiRoutes.get("/", requireAuthApi(), async (c) => {
  const query = parseValidated(PreviewQuerySchema, c.req.query());
  const smartCollections =
    await c.var.services.smartCollections.listDirectoryEntries({
      isAuthenticated: c.var.isAuthenticated,
      lang: query.lang,
    });
  return c.json({ smartCollections });
});

smartCollectionsApiRoutes.post("/", requireAuthApi(), async (c) => {
  const body = parseValidated(CreateSmartCollectionSchema, await c.req.json());
  const smartCollection = await c.var.services.smartCollections.create(body);
  return c.json({ smartCollection }, 201);
});

smartCollectionsApiRoutes.get("/:id", requireAuthApi(), async (c) => {
  const id = parseIdParam(c.req.param("id"), ID_PREFIX.smartCollection);
  const smartCollection = await c.var.services.smartCollections.getById(id);
  assertFound(smartCollection, "Smart collection");
  return c.json({ smartCollection });
});

smartCollectionsApiRoutes.put("/:id", requireAuthApi(), async (c) => {
  const id = parseIdParam(c.req.param("id"), ID_PREFIX.smartCollection);
  const body = parseValidated(UpdateSmartCollectionSchema, await c.req.json());
  const smartCollection = await c.var.services.smartCollections.update(
    id,
    body,
  );
  assertFound(smartCollection, "Smart collection");
  return c.json({ smartCollection });
});

smartCollectionsApiRoutes.delete("/:id", requireAuthApi(), async (c) => {
  const id = parseIdParam(c.req.param("id"), ID_PREFIX.smartCollection);
  const deleted = await c.var.services.smartCollections.delete(id);
  assertFound(deleted || null, "Smart collection");
  return c.json({ success: true });
});
