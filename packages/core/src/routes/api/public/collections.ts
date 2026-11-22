/**
 * Public Collections API Routes
 *
 * Anonymous read-only view of the site's curated Collections, Smart
 * Collections, and directory layout, gated by `PUBLIC_API_ENABLED`.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Bindings } from "../../../types.js";
import type { AppVariables } from "../../../types/app-context.js";
import {
  toApiCollection,
  toApiCollectionList,
  toApiSmartCollection,
} from "../../../lib/api-collections.js";
import { NotFoundError } from "../../../lib/errors.js";
import { ContentLanguageSchema } from "../../../lib/schemas.js";
import { requirePublicApiEnabled } from "../../../middleware/public-content-access.js";
import { validate } from "../../../middleware/validate.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const publicCollectionsApiRoutes = new Hono<Env>();

publicCollectionsApiRoutes.use("*", requirePublicApiEnabled());

const PublicCollectionsQuerySchema = z.object({
  lang: ContentLanguageSchema.optional(),
});

publicCollectionsApiRoutes.get(
  "/",
  validate("query", PublicCollectionsQuerySchema),
  async (c) => {
    const query = c.req.valid("query");
    const directoryData = await c.var.services.collections.listDirectoryData({
      isAuthenticated: false,
      lang: query.lang,
      timeZone: c.var.appConfig.timeZone,
    });

    return c.json(toApiCollectionList(directoryData));
  },
);

publicCollectionsApiRoutes.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const collection = await c.var.services.collections.getBySlug(slug);
  if (collection) {
    return c.json(toApiCollection(collection));
  }

  const smartCollection = await c.var.services.smartCollections.getBySlug(slug);
  if (smartCollection) {
    return c.json(toApiSmartCollection(smartCollection));
  }

  throw new NotFoundError("Collection");
});
