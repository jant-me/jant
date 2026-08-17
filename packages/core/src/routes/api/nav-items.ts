/**
 * Nav Items API Routes
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { requireAuthApi } from "../../middleware/auth.js";
import { requirePublicApiAccess } from "../../middleware/public-content-access.js";
import {
  CreateNavItemSchema,
  NavItemIdSchema,
  UpdateNavItemSchema,
  parseValidated,
} from "../../lib/schemas.js";
import { assertFound, parseIdParam, NotFoundError } from "../../lib/errors.js";
import { AddressQuerySchema, requestInternalPath } from "../../lib/address.js";
import { toPublicPath } from "../../lib/url.js";
import { ID_PREFIX } from "../../lib/ids.js";
import { renderSiteHeaderHtml } from "../../lib/site-header-fragment.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const navItemsApiRoutes = new Hono<Env>();

const INCLUDE_SITE_HEADER_RESPONSE = "include";
const SITE_HEADER_RESPONSE_HEADER = "x-jant-site-header";

const MoveSchema = z.object({
  after: NavItemIdSchema.nullable().optional(),
  before: NavItemIdSchema.nullable().optional(),
});

const PageCandidatesQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

async function withSiteHeaderHtml<T extends object>(
  c: Context<Env>,
  body: T,
): Promise<T | (T & { headerHtml: string })> {
  if (
    c.req.header(SITE_HEADER_RESPONSE_HEADER) !== INCLUDE_SITE_HEADER_RESPONSE
  ) {
    return body;
  }

  return {
    ...body,
    headerHtml: await renderSiteHeaderHtml(c),
  };
}

// List nav items
navItemsApiRoutes.get("/", requirePublicApiAccess(), async (c) => {
  const items = await c.var.services.navItems.list();
  return c.json({ navItems: items });
});

// Search published titled notes that can be added as pages (requires auth)
navItemsApiRoutes.get("/pages", requireAuthApi(), async (c) => {
  const query = parseValidated(PageCandidatesQuerySchema, c.req.query());
  const pages = await c.var.services.navItems.listPageCandidates({
    query: query.q,
    limit: query.limit,
  });
  return c.json({ pages });
});

/**
 * What a pasted address could become in navigation.
 *
 * The author is holding a URL, not a title, so searching titles cannot answer
 * them. The rules stay in the service; this only says which address was asked
 * about, so the picker can name it back.
 */
navItemsApiRoutes.get("/resolve", requireAuthApi(), async (c) => {
  const { url } = parseValidated(AddressQuerySchema, c.req.query());
  const path = requestInternalPath(c, url);
  if (path === null) {
    return c.json({ resolution: { kind: "external", address: url.trim() } });
  }

  const resolution = await c.var.services.navItems.resolveNavTarget(path);
  const address = toPublicPath(path, c.var.appConfig.sitePathPrefix);

  if (resolution.status === "page") {
    return c.json({
      resolution: { kind: "page", address, page: resolution.page },
    });
  }
  if (resolution.status === "collection") {
    return c.json({
      resolution: {
        kind: "collection",
        address,
        collection: resolution.collection,
      },
    });
  }

  return c.json({ resolution: { kind: resolution.status, address } });
});

// Move nav item (requires auth) — must be before /:id
navItemsApiRoutes.put("/:id/move", requireAuthApi(), async (c) => {
  const id = parseIdParam(c.req.param("id"), ID_PREFIX.navItem);
  const body = parseValidated(MoveSchema, await c.req.json());

  const item = assertFound(
    await c.var.services.navItems.move(
      id,
      body.after ?? null,
      body.before ?? null,
    ),
    "Nav item",
  );

  return c.json(await withSiteHeaderHtml(c, item));
});

// Create nav item (requires auth)
navItemsApiRoutes.post("/", requireAuthApi(), async (c) => {
  const body = parseValidated(CreateNavItemSchema, await c.req.json());

  let item;
  if (body.type === "system") {
    item = await c.var.services.navItems.create({
      type: "system",
      systemKey: body.systemKey,
      placement: body.placement,
    });
  } else if (body.type === "collection") {
    item = await c.var.services.navItems.create({
      type: "collection",
      collectionId: body.collectionId,
      label: body.label,
      placement: body.placement,
    });
  } else if (body.type === "page") {
    item = await c.var.services.navItems.create({
      type: "page",
      postId: body.postId,
      label: body.label,
      placement: body.placement,
    });
  } else {
    item = await c.var.services.navItems.create({
      type: "link",
      label: body.label,
      url: body.url,
      placement: body.placement,
    });
  }

  return c.json(await withSiteHeaderHtml(c, item), 201);
});

// Update nav item (requires auth)
navItemsApiRoutes.put("/:id", requireAuthApi(), async (c) => {
  const id = parseIdParam(c.req.param("id"), ID_PREFIX.navItem);
  const body = parseValidated(UpdateNavItemSchema, await c.req.json());

  const item = assertFound(
    await c.var.services.navItems.update(id, body),
    "Nav item",
  );

  return c.json(await withSiteHeaderHtml(c, item));
});

// Delete nav item (requires auth)
navItemsApiRoutes.delete("/:id", requireAuthApi(), async (c) => {
  const id = parseIdParam(c.req.param("id"), ID_PREFIX.navItem);

  const success = await c.var.services.navItems.delete(id);
  if (!success) throw new NotFoundError("Nav item");

  return c.json(await withSiteHeaderHtml(c, { success: true }));
});
