/**
 * Collections API Routes
 */

import { Hono } from "hono";
import {
  toApiCollection,
  toApiCollectionList,
  toApiDirectoryItem,
} from "../../lib/api-collections.js";
import { z } from "zod";
import type { Bindings, CollectionSortOrder } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { requireAuthApi } from "../../middleware/auth.js";
import {
  CollectionDescriptionValueSchema,
  CollectionDirectoryRowIdSchema,
  CollectionIdSchema,
  CollectionSortOrderSchema,
  ContentLanguageSchema,
  CreateCollectionDirectoryItemSchema,
  CreateCollectionSchema,
  parseValidated,
  PostIdSchema,
  readJsonBody,
  UpdateCollectionDirectoryItemSchema,
} from "../../lib/schemas.js";
import { assertFound, parseIdParam, NotFoundError } from "../../lib/errors.js";
import { ID_PREFIX } from "../../lib/ids.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const collectionsApiRoutes = new Hono<Env>();

// API update schema extends shared schema with nullable fields for explicit clearing
const UpdateCollectionSchema = CreateCollectionSchema.partial().extend({
  description: z.union([CollectionDescriptionValueSchema, z.null()]).optional(),
  sortOrder: CollectionSortOrderSchema.optional(),
});

const ThreadAssignSchema = z.object({
  threadId: PostIdSchema,
});

const MoveSchema = z.object({
  after: CollectionDirectoryRowIdSchema.nullable().optional(),
  before: CollectionDirectoryRowIdSchema.nullable().optional(),
});

const SlugQuerySchema = z.object({
  mode: z.literal("check"),
  slug: z.string().trim().toLowerCase().min(1).max(200),
  collectionId: CollectionIdSchema.optional(),
});

const ListCollectionsQuerySchema = z.object({
  view: z.enum(["compose"]).optional(),
  /**
   * Content language of the calling view. The directory's Thread counts are
   * narrowed by it, so the page and this endpoint have to be asked the same
   * question — see `jant-collection-directory`.
   */
  lang: ContentLanguageSchema.optional(),
});

// List collections (includes Thread counts and directory items)
collectionsApiRoutes.get("/", requireAuthApi(), async (c) => {
  const query = parseValidated(ListCollectionsQuerySchema, c.req.query());

  if (query.view === "compose") {
    c.header("Cache-Control", "no-store");
    // Smart collections are deliberately absent. A post cannot be added to one
    // by hand — its conditions decide, permanently — so offering it here would
    // be a control that does nothing. Every "add this post to a collection"
    // surface leaves them out for the same reason; see the smart collections
    // design notes on the asymmetry, which is not a gap to be filled in later.
    const collections = await c.var.services.collections.listByRecentActivity();
    return c.json({
      collections: collections.map(toApiCollection),
      directoryItems: [],
    });
  }

  const directoryData = await c.var.services.collections.listDirectoryData({
    // The caller is the author, by session or by token; `isAuthenticated`
    // only reports a session.
    isAuthenticated: true,
    lang: query.lang,
  });

  return c.json(toApiCollectionList(directoryData));
});

// Create directory item (divider or link) — must be before /:id
collectionsApiRoutes.post("/directory-items", requireAuthApi(), async (c) => {
  const body = parseValidated(
    CreateCollectionDirectoryItemSchema,
    await readJsonBody(c),
  );
  const item = await c.var.services.collections.createDirectoryItem(body);
  return c.json(toApiDirectoryItem(item), 201);
});

collectionsApiRoutes.put(
  "/directory-items/:id",
  requireAuthApi(),
  async (c) => {
    const id = parseIdParam(
      c.req.param("id"),
      ID_PREFIX.collectionDirectoryItem,
    );
    const body = parseValidated(
      UpdateCollectionDirectoryItemSchema,
      await readJsonBody(c),
    );

    const item = assertFound(
      await c.var.services.collections.updateDirectoryItem(id, body),
      "Directory item",
    );

    return c.json(toApiDirectoryItem(item));
  },
);

// Move directory item — must be before /:id
//
// The moved row and its neighbours may each be named by a collection or smart
// collection id: those are the rows the directory renders without one of its
// own. The service places them before it moves anything.
collectionsApiRoutes.put(
  "/directory-items/:id/move",
  requireAuthApi(),
  async (c) => {
    const id = parseValidated(
      CollectionDirectoryRowIdSchema,
      c.req.param("id"),
    );
    const body = parseValidated(MoveSchema, await readJsonBody(c));

    const item = assertFound(
      await c.var.services.collections.moveDirectoryItem(
        id,
        body.after ?? null,
        body.before ?? null,
      ),
      "Directory item",
    );

    return c.json(toApiDirectoryItem(item));
  },
);

// Delete directory item — must be before /:id
collectionsApiRoutes.delete(
  "/directory-items/:id",
  requireAuthApi(),
  async (c) => {
    const id = parseIdParam(
      c.req.param("id"),
      ID_PREFIX.collectionDirectoryItem,
    );
    const deleted = await c.var.services.collections.deleteDirectoryItem(id);
    if (!deleted) throw new NotFoundError("Directory item");
    return c.json({ success: true });
  },
);

/**
 * Address availability, in the shape smart collections already use.
 *
 * Declared before `/:id` so the literal path wins. The editing dialog asks
 * while the author types, so a clash is answered where the decision is being
 * made rather than on write.
 */
collectionsApiRoutes.get("/slug", requireAuthApi(), async (c) => {
  const query = parseValidated(SlugQuerySchema, c.req.query());
  const available = await c.var.services.collections.checkSlugAvailability(
    query.slug,
    query.collectionId,
  );
  return c.json({ slug: query.slug, available });
});

// Get single collection
collectionsApiRoutes.get("/:id", requireAuthApi(), async (c) => {
  const id = parseIdParam(c.req.param("id"), ID_PREFIX.collection);
  const collection = assertFound(
    await c.var.services.collections.getById(id),
    "Collection",
  );
  return c.json(toApiCollection(collection));
});

// Create collection (requires auth)
collectionsApiRoutes.post("/", requireAuthApi(), async (c) => {
  const body = parseValidated(CreateCollectionSchema, await readJsonBody(c));

  const collection = await c.var.services.collections.create({
    slug: body.slug,
    title: body.title,
    description: body.description,
    sortOrder: body.sortOrder as CollectionSortOrder | undefined,
  });

  return c.json(toApiCollection(collection), 201);
});

// Update collection (requires auth)
collectionsApiRoutes.put("/:id", requireAuthApi(), async (c) => {
  const id = parseIdParam(c.req.param("id"), ID_PREFIX.collection);
  const body = parseValidated(UpdateCollectionSchema, await readJsonBody(c));

  const collection = assertFound(
    await c.var.services.collections.update(id, body),
    "Collection",
  );

  return c.json(toApiCollection(collection));
});

// Delete collection (requires auth)
collectionsApiRoutes.delete("/:id", requireAuthApi(), async (c) => {
  const id = parseIdParam(c.req.param("id"), ID_PREFIX.collection);

  const success = await c.var.services.collections.delete(id);
  if (!success) throw new NotFoundError("Collection");

  return c.json({ success: true });
});

// Add a thread to a collection (requires auth)
collectionsApiRoutes.post("/:id/threads", requireAuthApi(), async (c) => {
  const id = parseIdParam(c.req.param("id"), ID_PREFIX.collection);
  const body = parseValidated(ThreadAssignSchema, await readJsonBody(c));
  await c.var.services.collections.addThread(id, body.threadId);

  return c.json({ success: true }, 201);
});

// Remove a thread from a collection (requires auth)
collectionsApiRoutes.delete(
  "/:id/threads/:threadId",
  requireAuthApi(),
  async (c) => {
    const id = parseIdParam(c.req.param("id"), ID_PREFIX.collection);
    const threadId = parseIdParam(c.req.param("threadId"), ID_PREFIX.post);
    await c.var.services.collections.removeThread(id, threadId);

    return c.json({ success: true });
  },
);

// Pin a thread within a collection (requires auth)
collectionsApiRoutes.put(
  "/:id/threads/:threadId/pin",
  requireAuthApi(),
  async (c) => {
    const id = parseIdParam(c.req.param("id"), ID_PREFIX.collection);
    const threadId = parseIdParam(c.req.param("threadId"), ID_PREFIX.post);
    await c.var.services.collections.pinThread(id, threadId);

    return c.json({ success: true });
  },
);

// Unpin a thread within a collection (requires auth)
collectionsApiRoutes.delete(
  "/:id/threads/:threadId/pin",
  requireAuthApi(),
  async (c) => {
    const id = parseIdParam(c.req.param("id"), ID_PREFIX.collection);
    const threadId = parseIdParam(c.req.param("threadId"), ID_PREFIX.post);
    await c.var.services.collections.unpinThread(id, threadId);

    return c.json({ success: true });
  },
);
