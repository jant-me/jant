import { Hono } from "hono";
import { z } from "zod";
import { requireInternalAdminApi } from "../../../middleware/auth.js";
import { ConflictError } from "../../../lib/errors.js";
import { resolveSummaryConfig } from "../../../lib/resolve-config.js";
import { parseValidated } from "../../../lib/schemas.js";
import {
  getConfiguredStorageDriver,
  getSiteResolutionMode,
} from "../../../lib/env.js";
import type { Bindings } from "../../../types.js";
import type { AppVariables } from "../../../types/app-context.js";
import { RebuildPostBodyHtmlSchema } from "./post-body-html.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

const ManagedSiteKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(40)
  .regex(
    /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/,
    "Site key must use lowercase letters, numbers, or hyphens.",
  );

const SiteKeyAvailabilityQuerySchema = z.object({
  key: ManagedSiteKeySchema,
});

const CreateManagedSiteSchema = z.object({
  key: ManagedSiteKeySchema,
  primaryHost: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(255)
    .regex(
      /^(?=.{1,255}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
      "Primary host must be a valid hostname.",
    ),
  siteName: z.string().trim().min(1).max(120),
  siteLanguage: z.string().trim().max(35).optional(),
  timeZone: z.string().trim().max(100).optional(),
  idempotencyKey: z.string().trim().min(1).max(128).optional(),
});

const SitePostCountsSchema = z.object({
  siteIds: z.array(z.string().trim().min(1)).max(200),
});

const CleanupSiteUploadsSchema = z.object({
  limit: z.number().int().positive().max(500).optional(),
});

const ManagedSiteDomainSchema = z.object({
  host: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(255)
    .regex(
      /^(?=.{1,255}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
      "Domain host must be a valid hostname.",
    ),
  makePrimary: z.boolean().optional(),
});

const RenameManagedSiteSchema = z.object({
  key: ManagedSiteKeySchema,
  primaryHost: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(255)
    .regex(
      /^(?=.{1,255}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
      "Primary host must be a valid hostname.",
    ),
});

export const internalSitesRoutes = new Hono<Env>();

function assertHostBasedMode(env: Bindings) {
  if (getSiteResolutionMode(env) !== "host-based") {
    throw new ConflictError(
      "Site provisioning is only available in host-based mode.",
    );
  }
}

internalSitesRoutes.post("/", requireInternalAdminApi(), async (c) => {
  assertHostBasedMode(c.env);

  const body = parseValidated(CreateManagedSiteSchema, await c.req.json());
  const result = await c.var.services.siteAdmin.createManagedSite(body);

  return c.json(
    {
      primaryHost: result.domain.host,
      siteId: result.site.id,
      status: result.site.status,
    },
    201,
  );
});

internalSitesRoutes.get(
  "/availability",
  requireInternalAdminApi(),
  async (c) => {
    assertHostBasedMode(c.env);

    const query = parseValidated(SiteKeyAvailabilityQuerySchema, {
      key: c.req.query("key") ?? "",
    });
    const result = await c.var.services.siteAdmin.isManagedSiteKeyAvailable(
      query.key,
    );

    return c.json(result);
  },
);

internalSitesRoutes.post(
  "/post-counts",
  requireInternalAdminApi(),
  async (c) => {
    assertHostBasedMode(c.env);

    const body = parseValidated(SitePostCountsSchema, await c.req.json());
    const counts = await c.var.services.siteAdmin.getManagedSitePostCounts(
      body.siteIds,
    );

    return c.json({ counts });
  },
);

internalSitesRoutes.delete("/:siteId", requireInternalAdminApi(), async (c) => {
  assertHostBasedMode(c.env);

  await c.var.services.siteAdmin.deleteManagedSite(c.req.param("siteId"), {
    storage: c.var.storage,
  });

  return c.body(null, 204);
});

internalSitesRoutes.get(
  "/:siteId/media-usage",
  requireInternalAdminApi(),
  async (c) => {
    assertHostBasedMode(c.env);

    const usage = await c.var.services.siteAdmin.getManagedSiteMediaUsage(
      c.req.param("siteId"),
    );

    return c.json(usage);
  },
);

// Clean up a single managed site's expired upload sessions and due trash
// objects. Invoked per-site by the hosted control plane's scheduled
// maintenance. Self-hosted operators use the host-scoped
// `POST /api/internal/uploads/cleanup` route / `jant uploads cleanup` CLI
// instead.
internalSitesRoutes.post(
  "/:siteId/uploads/cleanup",
  requireInternalAdminApi(),
  async (c) => {
    assertHostBasedMode(c.env);

    const storage = c.var.storage;
    if (!storage) {
      return c.json(
        { error: "File storage isn't set up. Check your server config." },
        500,
      );
    }

    const contentType = c.req.header("Content-Type") || "";
    const rawBody = contentType.includes("application/json")
      ? await c.req.json().catch(() => ({}))
      : {};
    const body = parseValidated(CleanupSiteUploadsSchema, rawBody);

    const services = c.var.servicesForSite(c.req.param("siteId"));
    const result = await services.uploads.cleanupExpired({
      storage,
      storageDriver: getConfiguredStorageDriver(c.env),
      limit: body.limit,
    });

    return c.json(result);
  },
);

// Rebuild one managed site's materialized body HTML projection. Hosted fleet
// orchestration stays in the control plane; core never silently widens a
// content-facing operation to every tenant.
internalSitesRoutes.post(
  "/:siteId/posts/body-html/rebuild",
  requireInternalAdminApi(),
  async (c) => {
    assertHostBasedMode(c.env);

    const contentType = c.req.header("Content-Type") || "";
    const rawBody = contentType.includes("application/json")
      ? await c.req.json().catch(() => ({}))
      : {};
    const body = parseValidated(RebuildPostBodyHtmlSchema, rawBody);
    const services = c.var.servicesForSite(c.req.param("siteId"));

    return c.json(
      await services.posts.rebuildBodyHtml({
        ...body,
        summaryConfig: resolveSummaryConfig(c.env),
      }),
    );
  },
);

internalSitesRoutes.get(
  "/:siteId/export",
  requireInternalAdminApi(),
  async (c) => {
    assertHostBasedMode(c.env);

    const archive = await c.var.services.siteAdmin.exportManagedSite(
      c.req.param("siteId"),
      {
        env: c.env,
        storage: c.var.storage,
      },
    );

    return new Response(archive.zip, {
      headers: {
        "Content-Disposition": `attachment; filename="${archive.filename}"`,
        "Content-Length": String(archive.zip.byteLength),
        "Content-Type": "application/zip",
      },
    });
  },
);

internalSitesRoutes.post(
  "/:siteId/suspend",
  requireInternalAdminApi(),
  async (c) => {
    assertHostBasedMode(c.env);
    const site = await c.var.services.siteAdmin.suspendManagedSite(
      c.req.param("siteId"),
    );

    return c.json({
      siteId: site.id,
      status: site.status,
    });
  },
);

internalSitesRoutes.post(
  "/:siteId/resume",
  requireInternalAdminApi(),
  async (c) => {
    assertHostBasedMode(c.env);
    const site = await c.var.services.siteAdmin.resumeManagedSite(
      c.req.param("siteId"),
    );

    return c.json({
      siteId: site.id,
      status: site.status,
    });
  },
);

internalSitesRoutes.post(
  "/:siteId/rename",
  requireInternalAdminApi(),
  async (c) => {
    assertHostBasedMode(c.env);
    const body = parseValidated(RenameManagedSiteSchema, await c.req.json());
    const result = await c.var.services.siteAdmin.renameManagedSite(
      c.req.param("siteId"),
      body,
    );

    return c.json({
      primaryHost: result.domain.host,
      siteId: result.site.id,
      status: result.site.status,
    });
  },
);

internalSitesRoutes.get(
  "/:siteId/domains",
  requireInternalAdminApi(),
  async (c) => {
    assertHostBasedMode(c.env);
    const domains = await c.var.services.siteAdmin.listManagedSiteDomains(
      c.req.param("siteId"),
    );

    return c.json({
      domains: domains.map((domain) => ({
        host: domain.host,
        id: domain.id,
        kind: domain.kind,
        redirectToPrimary: domain.redirectToPrimary,
      })),
    });
  },
);

internalSitesRoutes.post(
  "/:siteId/domains",
  requireInternalAdminApi(),
  async (c) => {
    assertHostBasedMode(c.env);
    const body = parseValidated(ManagedSiteDomainSchema, await c.req.json());
    const domains = await c.var.services.siteAdmin.addManagedSiteDomain(
      c.req.param("siteId"),
      body,
    );

    return c.json(
      {
        domains: domains.map((domain) => ({
          host: domain.host,
          id: domain.id,
          kind: domain.kind,
          redirectToPrimary: domain.redirectToPrimary,
        })),
      },
      201,
    );
  },
);

internalSitesRoutes.post(
  "/:siteId/domains/:domainId/primary",
  requireInternalAdminApi(),
  async (c) => {
    assertHostBasedMode(c.env);
    const domains = await c.var.services.siteAdmin.setManagedSitePrimaryDomain(
      c.req.param("siteId"),
      c.req.param("domainId"),
    );

    return c.json({
      domains: domains.map((domain) => ({
        host: domain.host,
        id: domain.id,
        kind: domain.kind,
        redirectToPrimary: domain.redirectToPrimary,
      })),
    });
  },
);

const ManagedSiteDomainRedirectSchema = z.object({
  redirectToPrimary: z.boolean(),
});

internalSitesRoutes.post(
  "/:siteId/domains/:domainId/redirect",
  requireInternalAdminApi(),
  async (c) => {
    assertHostBasedMode(c.env);
    const body = parseValidated(
      ManagedSiteDomainRedirectSchema,
      await c.req.json(),
    );
    const domains = await c.var.services.siteAdmin.setManagedSiteDomainRedirect(
      c.req.param("siteId"),
      c.req.param("domainId"),
      body.redirectToPrimary,
    );

    return c.json({
      domains: domains.map((domain) => ({
        host: domain.host,
        id: domain.id,
        kind: domain.kind,
        redirectToPrimary: domain.redirectToPrimary,
      })),
    });
  },
);

internalSitesRoutes.delete(
  "/:siteId/domains/:domainId",
  requireInternalAdminApi(),
  async (c) => {
    assertHostBasedMode(c.env);
    const domains = await c.var.services.siteAdmin.deleteManagedSiteDomain(
      c.req.param("siteId"),
      c.req.param("domainId"),
    );

    return c.json({
      domains: domains.map((domain) => ({
        host: domain.host,
        id: domain.id,
        kind: domain.kind,
        redirectToPrimary: domain.redirectToPrimary,
      })),
    });
  },
);
