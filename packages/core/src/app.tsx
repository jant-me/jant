/**
 * Jant App Factory
 */

import { Hono, type Context } from "hono";
import { i18nMiddleware } from "./i18n/index.js";
import type { Bindings } from "./types.js";

// Routes - Auth
import { setupRoutes } from "./routes/auth/setup.js";
import { signinRoutes } from "./routes/auth/signin.js";
import { resetRoutes } from "./routes/auth/reset.js";
import { devAuthRoutes } from "./routes/auth/dev.js";
import { hostedSsoRoutes } from "./routes/auth/hosted-sso.js";
import { hostedDomainCheckRoutes } from "./routes/hosted/domain-check.js";

// Routes - Pages
import { homeRoutes } from "./routes/pages/home.js";
import { pageRoutes } from "./routes/pages/page.js";
import { collectionRoutes } from "./routes/pages/collection.js";
import { archiveRoutes } from "./routes/pages/archive.js";
import { searchRoutes } from "./routes/pages/search.js";
import { featuredRoutes } from "./routes/pages/featured.js";
import { latestRoutes } from "./routes/pages/latest.js";
import { collectionsPageRoutes } from "./routes/pages/collections.js";
import { newPostRoutes } from "./routes/pages/new.js";
import { partialPageRoutes } from "./routes/pages/partials.js";
import { themeSampleRoutes } from "./routes/pages/theme-sample.js";
import { brandRoutes } from "./routes/pages/brand.js";

// Routes - Settings (admin)
import { settingsRoutes } from "./routes/dash/settings.js";
import { customUrlsRoutes } from "./routes/dash/custom-urls.js";

// Routes - API
import { postsApiRoutes } from "./routes/api/posts.js";
import { attachmentsApiRoutes } from "./routes/api/attachments.js";
import { navItemsApiRoutes } from "./routes/api/nav-items.js";
import { collectionsApiRoutes } from "./routes/api/collections.js";
import { settingsApiRoutes } from "./routes/api/settings.js";
import { uploadApiRoutes } from "./routes/api/upload.js";
import { uploadsApiRoutes } from "./routes/api/uploads.js";
import { multipartUploadApiRoutes } from "./routes/api/upload-multipart.js";
import { searchApiRoutes } from "./routes/api/search.js";
import { mcpApiRoutes } from "./routes/api/mcp.js";
import { customUrlsApiRoutes } from "./routes/api/custom-urls.js";
import { exportApiRoutes } from "./routes/api/export.js";
import { paletteApiRoutes } from "./routes/api/palette.js";
import { internalApiTokensRoutes } from "./routes/api/internal/api-tokens.js";
import { internalSitesRoutes } from "./routes/api/internal/sites.js";
import {
  githubSyncWebhookRoutes,
  githubSyncAdminRoutes,
} from "./routes/api/github-sync.js";
import { telegramWebhookRoutes } from "./routes/api/telegram.js";
import { internalTextAttachmentsRoutes } from "./routes/api/internal/text-attachments.js";
import { internalSearchReindexRoutes } from "./routes/api/internal/search-reindex.js";
import { internalPostBodyHtmlRoutes } from "./routes/api/internal/post-body-html.js";
import { internalUploadsRoutes } from "./routes/api/internal/uploads.js";
import { publicArchiveApiRoutes } from "./routes/api/public/archive.js";
import { publicPostsApiRoutes } from "./routes/api/public/posts.js";
// Routes - Compose
import { composeRoutes } from "./routes/compose.js";

// Routes - Feed
import { feedRoutes } from "./routes/feed/feed.js";
import { sitemapRoutes } from "./routes/feed/sitemap.js";
import { manifestRoutes } from "./routes/feed/manifest.js";

// Middleware
import { requireAuth } from "./middleware/auth.js";
import { attachSession } from "./middleware/session.js";
import { defaultCacheControl } from "./middleware/cache-control.js";
import { requireOnboarding } from "./middleware/onboarding.js";
import { errorHandler } from "./middleware/error-handler.js";
import { withConfig } from "./middleware/config.js";
import { secureHeadersMiddleware } from "./middleware/secure-headers.js";
import { apiCors } from "./middleware/cors.js";

import { getConfiguredSingleSitePathPrefix } from "./lib/env.js";
import { getRuntimeSitePathPrefix } from "./lib/site-resolution.js";
import { getStartupConfigurationErrorPage } from "./lib/startup-config.js";
import { base64ToUint8Array } from "./lib/favicon.js";
import {
  getDefaultJantAppleTouchIconBytes,
  getDefaultJantFaviconIcoBytes,
} from "./lib/jant-branding.js";
import { isAssetPath } from "./lib/asset-path.js";
import { getHostedCanonicalRedirect } from "./lib/hosted-domain.js";
import { stripSitePathPrefix, toPublicHref } from "./lib/url.js";
import { withWorkerResponseCache } from "./lib/worker-response-cache.js";
import { createRequestRuntime } from "./runtime/index.js";
import { getInstanceReadiness } from "./runtime/readiness.js";
import { type AppVariables, type App } from "./types/app-context.js";
import { isPublicStorageKeyAllowed } from "./lib/public-storage.js";
import { isTextAttachment } from "./services/media.js";
import { markdownToTiptapJson } from "./lib/markdown-to-tiptap.js";
import { renderTiptapJson } from "./lib/tiptap-render.js";

export type { AppVariables, App };

const publicRequestMeta = new WeakMap<
  Request,
  { publicRequestUrl: string; publicPath: string }
>();

function prepareRequestForRouting(
  request: Request,
  sitePathPrefix: string,
): Request | Response {
  const publicUrl = new URL(request.url);
  const publicPath = publicUrl.pathname;

  if (!sitePathPrefix) {
    publicRequestMeta.set(request, {
      publicRequestUrl: publicUrl.toString(),
      publicPath,
    });
    return request;
  }

  const internalPath = stripSitePathPrefix(publicPath, sitePathPrefix);
  if (!internalPath) {
    return new Response("Not Found", { status: 404 });
  }

  const internalUrl = new URL(publicUrl.toString());
  internalUrl.pathname = internalPath;
  const rewrittenRequest = new Request(internalUrl, request);
  publicRequestMeta.set(rewrittenRequest, {
    publicRequestUrl: publicUrl.toString(),
    publicPath,
  });
  return rewrittenRequest;
}

async function servePublicStorage(
  c: Context<{ Bindings: Bindings; Variables: AppVariables }>,
): Promise<Response> {
  const storage = c.var.storage;
  if (!storage) {
    return c.notFound();
  }

  const storageKey = c.req.path.slice(1);
  if (!isPublicStorageKeyAllowed(storageKey, c.var.currentSite.id)) {
    return c.notFound();
  }

  const rangeHeader = c.req.header("Range");

  if (rangeHeader) {
    const meta = await storage.head(storageKey);
    if (!meta) return c.notFound();

    const totalSize = meta.size;
    if (!totalSize) {
      const full = await storage.get(storageKey);
      if (!full) return c.notFound();
      const headers = new Headers();
      headers.set(
        "Content-Type",
        full.contentType || "application/octet-stream",
      );
      headers.set(
        "Cache-Control",
        full.cacheControl || "public, max-age=31536000, immutable",
      );
      if (full.contentDisposition) {
        headers.set("Content-Disposition", full.contentDisposition);
      }
      if (full.contentDisposition === "attachment") {
        headers.set("X-Content-Type-Options", "nosniff");
      }
      return new Response(full.body, { headers });
    }

    const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
    if (!match) {
      return new Response("Invalid Range", {
        status: 416,
        headers: { "Content-Range": `bytes */${totalSize}` },
      });
    }

    const start = parseInt(match[1] ?? "0", 10);
    const end = match[2]
      ? Math.min(parseInt(match[2], 10), totalSize - 1)
      : totalSize - 1;

    if (start > end || start >= totalSize) {
      return new Response("Range Not Satisfiable", {
        status: 416,
        headers: { "Content-Range": `bytes */${totalSize}` },
      });
    }

    const rangeObj = await storage.get(storageKey, {
      range: { offset: start, length: end - start + 1 },
    });
    if (!rangeObj) return c.notFound();

    const headers = new Headers();
    headers.set(
      "Content-Type",
      rangeObj.contentType || "application/octet-stream",
    );
    headers.set(
      "Cache-Control",
      rangeObj.cacheControl || "public, max-age=31536000, immutable",
    );
    if (rangeObj.contentDisposition) {
      headers.set("Content-Disposition", rangeObj.contentDisposition);
    }
    if (rangeObj.contentDisposition === "attachment") {
      headers.set("X-Content-Type-Options", "nosniff");
    }
    headers.set("Accept-Ranges", "bytes");
    headers.set("Content-Range", `bytes ${start}-${end}/${totalSize}`);
    headers.set("Content-Length", String(end - start + 1));

    return new Response(rangeObj.body, { status: 206, headers });
  }

  const object = await storage.get(storageKey);
  if (!object) {
    return c.notFound();
  }

  const headers = new Headers();
  headers.set("Content-Type", object.contentType || "application/octet-stream");
  headers.set(
    "Cache-Control",
    object.cacheControl || "public, max-age=31536000, immutable",
  );
  if (object.contentDisposition) {
    headers.set("Content-Disposition", object.contentDisposition);
  }
  if (object.contentDisposition === "attachment") {
    headers.set("X-Content-Type-Options", "nosniff");
  }
  headers.set("Accept-Ranges", "bytes");
  if (object.size) {
    headers.set("Content-Length", String(object.size));
  }

  return new Response(object.body, { headers });
}

/**
 * Create a Jant application
 *
 * @returns Hono app instance
 *
 * @example
 * ```typescript
 * import { createApp } from "@jant/core";
 *
 * export default createApp();
 * ```
 */
export function createApp(): App {
  const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();
  const defaultFetch = app.fetch.bind(app);

  app.fetch = (request, env, executionCtx) => {
    const bindings = env as Bindings | undefined;
    const preparedRequest = prepareRequestForRouting(
      request,
      getConfiguredSingleSitePathPrefix(bindings),
    );
    if (preparedRequest instanceof Response) {
      return Promise.resolve(preparedRequest);
    }
    return withWorkerResponseCache({
      bindings,
      executionCtx,
      request,
      next: () =>
        Promise.resolve(defaultFetch(preparedRequest, bindings, executionCtx)),
    });
  };

  // Global error handler: maps DomainError → HTTP responses
  app.onError(errorHandler);

  // Instance health checks must bypass hosted site resolution so container
  // health probes keep working in host-based mode before any site matches.
  app.get("/healthz", (c) => c.json({ status: "ok" }));
  app.get("/readyz", async (c) => {
    const readiness = await getInstanceReadiness(c.env);
    return c.json(readiness, readiness.status === "ok" ? 200 : 503);
  });

  // Lightweight init — no DB queries
  app.use("*", async (c, next) => {
    const publicMeta = publicRequestMeta.get(c.req.raw);
    const publicRequestUrl = publicMeta?.publicRequestUrl ?? c.req.url;
    const publicPath =
      publicMeta?.publicPath ?? new URL(publicRequestUrl).pathname;
    c.set("publicRequestUrl", publicRequestUrl);
    c.set("publicPath", publicPath);

    const startupConfigError = getStartupConfigurationErrorPage(c.env);
    if (startupConfigError) {
      return c.html(startupConfigError, 500);
    }
    const runtime = await createRequestRuntime(c.env, publicRequestUrl);
    c.set("services", runtime.services);
    c.set("servicesForSite", runtime.servicesForSite);
    c.set("hostedHandoff", runtime.hostedHandoff);
    c.set("storage", runtime.storage);
    c.set("auth", runtime.auth);
    c.set("currentSite", runtime.currentSite);
    c.set("currentSiteDomain", runtime.currentSiteDomain);
    c.set("rateLimiter", runtime.rateLimiter);

    await next();
  });

  // Populate c.var.session / c.var.isAuthenticated once per request so
  // downstream handlers don't each call auth.api.getSession themselves.
  app.use("*", attachSession());

  // Default every response without an explicit Cache-Control to
  // `private, no-store`. Jant pages are auth-variant, so a shared/CDN cache
  // must never store them; routes serving genuinely public resources (media,
  // feeds, sitemaps, favicons) set their own Cache-Control and are untouched.
  app.use("*", defaultCacheControl());

  app.use("*", async (c, next) => {
    const redirectUrl = await getHostedCanonicalRedirect({
      currentSite: c.var.currentSite,
      currentSiteDomain: c.var.currentSiteDomain,
      publicRequestUrl: c.var.publicRequestUrl,
      services: c.var.services,
    });
    if (redirectUrl) {
      return c.redirect(redirectUrl, 308);
    }

    await next();
  });

  // Security headers (CSP, X-Frame-Options, etc.)
  app.use("*", secureHeadersMiddleware());

  // CORS for cross-origin API access (controlled by CORS_ORIGINS env var)
  app.use("/api/*", apiCors());

  // --- Routes that don't need config/theme ---

  app.route("/", hostedDomainCheckRoutes);
  app.route("/api/attachments", attachmentsApiRoutes);
  app.route("/api/internal/api-tokens", internalApiTokensRoutes);
  app.route("/api/internal/sites", internalSitesRoutes);
  app.route("/api/internal/text-attachments", internalTextAttachmentsRoutes);
  app.route("/api/internal/search/reindex", internalSearchReindexRoutes);
  app.route("/api/internal/posts/body-html", internalPostBodyHtmlRoutes);
  app.route("/api/internal/uploads", internalUploadsRoutes);
  app.route("/api/github-sync", githubSyncWebhookRoutes);
  app.route("/api/telegram", telegramWebhookRoutes);

  // Fetch text media content by ID (same-origin proxy to avoid CORS with CDN URLs)
  app.get("/api/media/:id/content", async (c) => {
    const media = await c.var.services.media.getById(c.req.param("id"));
    if (!media) return c.notFound();

    const storage = c.var.storage;
    if (!storage) return c.notFound();

    const etag = `"${media.updatedAt}"`;
    if (c.req.header("If-None-Match") === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag } });
    }

    // Text attachments are stored as plain markdown. The preview dialog
    // wants both the raw source (for Copy) and a rendered HTML view, so
    // read the single `.md` object and render HTML on the fly. Rendering
    // cost is negligible at typical attachment sizes, and response-level
    // cache hints let edge caches keep the rendered form for repeat hits.
    if (isTextAttachment(media)) {
      const object = await storage.get(media.storageKey);
      if (!object) return c.notFound();

      const markdown = await new Response(object.body).text();
      const html = renderTiptapJson(markdownToTiptapJson(markdown), {
        namespace: media.id,
      });

      return c.json({ html, markdown }, 200, {
        "Cache-Control": "public, no-cache",
        ETag: etag,
      });
    }

    const object = await storage.get(media.storageKey);
    if (!object) return c.notFound();

    const headers = new Headers();
    headers.set(
      "Content-Type",
      object.contentType || "application/octet-stream",
    );
    headers.set("Cache-Control", "public, no-cache");
    headers.set("ETag", etag);

    return new Response(object.body, { headers });
  });

  // Public storage proxy for the current `media/{siteId}/...` layout.
  // `/sites/*` remains readable for older stored keys during migration.
  // Supports HTTP Range requests for seekable audio/video playback.
  app.get("/media/*", servePublicStorage);
  app.get("/sites/*", servePublicStorage);

  // better-auth handler
  app.all("/api/auth/*", async (c) => {
    return c.var.auth.handler(c.req.raw);
  });

  // Favicon routes - serve from DB settings (small files, avoids R2 round-trip)
  app.get("/favicon.ico", async (c) => {
    const data = await c.var.services.settings.get("SITE_FAVICON_ICO");
    if (!data) {
      return new Response(getDefaultJantFaviconIcoBytes(), {
        headers: {
          "Content-Type": "image/x-icon",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    return new Response(base64ToUint8Array(data), {
      headers: {
        "Content-Type": "image/x-icon",
        "Cache-Control": "public, max-age=86400",
      },
    });
  });

  app.get("/apple-touch-icon.png", async (c) => {
    const storage = c.var.storage;
    const storageKey = await c.var.services.settings.get(
      "SITE_FAVICON_APPLE_TOUCH",
    );
    if (!storage || !storageKey) {
      return new Response(getDefaultJantAppleTouchIconBytes(), {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    const object = await storage.get(storageKey);
    if (!object) {
      return new Response(getDefaultJantAppleTouchIconBytes(), {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    return new Response(object.body, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    });
  });

  // --- Middleware for all remaining routes ---

  // Onboarding gate — redirect to /setup if not yet initialized
  app.use("*", requireOnboarding());

  // Trailing slash redirect (redirect /foo/ to /foo)
  app.use("*", async (c, next) => {
    const publicUrl = new URL(c.var.publicRequestUrl);
    if (c.var.publicPath !== "/" && c.var.publicPath.endsWith("/")) {
      const newUrl = c.var.publicPath.slice(0, -1) + publicUrl.search;
      return c.redirect(newUrl, 301);
    }
    await next();
  });

  // Redirect middleware — only handles redirect-type custom URLs
  app.use("*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    // Skip redirect check for API routes and static assets
    if (path.startsWith("/api/") || isAssetPath(path)) {
      return next();
    }

    const customUrl = await c.var.services.customUrls.getByPath(path.slice(1));
    if (customUrl?.targetType === "redirect" && customUrl.toPath) {
      return c.redirect(
        toPublicHref(
          customUrl.toPath,
          getRuntimeSitePathPrefix({
            env: c.env,
            currentSiteDomain: c.var.currentSiteDomain,
          }),
        ),
        customUrl.redirectType ?? 301,
      );
    }

    await next();
  });

  // Config + i18n — loads settings, resolves config/theme
  app.use("*", withConfig());
  app.use("*", i18nMiddleware());

  // --- Routes that need config ---

  // API Routes
  app.route("/api/public/posts", publicPostsApiRoutes);
  app.route("/api/public/archive", publicArchiveApiRoutes);
  app.route("/api/posts", postsApiRoutes);
  app.route("/api/nav-items", navItemsApiRoutes);
  app.route("/api/collections", collectionsApiRoutes);
  app.route("/api/settings", settingsApiRoutes);
  app.route("/api/custom-urls", customUrlsApiRoutes);
  app.route("/api/export", exportApiRoutes);
  app.route("/api/github-sync", githubSyncAdminRoutes);

  // Auth routes
  app.route("/", setupRoutes);
  app.route("/", signinRoutes);
  app.route("/", resetRoutes);
  app.route("/", devAuthRoutes);
  app.route("/", hostedSsoRoutes);

  // Settings routes (protected)
  app.use("/settings/*", requireAuth());
  app.use("/settings", requireAuth());
  app.route("/settings/custom-urls", customUrlsRoutes);
  app.route("/settings", settingsRoutes);

  // Protected API routes (multipart must be registered before base upload)
  app.route("/api/upload/multipart", multipartUploadApiRoutes);
  app.route("/api/upload", uploadApiRoutes);
  app.route("/api/uploads", uploadsApiRoutes);
  app.route("/api/search", searchApiRoutes);
  app.route("/api/palette", paletteApiRoutes);
  app.route("/api/mcp", mcpApiRoutes);

  // Compose route (auth enforced in route middleware)
  app.route("/compose", composeRoutes);

  // Feed routes
  app.route("/feed", feedRoutes);
  app.route("/", sitemapRoutes);
  app.route("/", manifestRoutes);

  // Frontend routes
  app.route("/search", searchRoutes);
  app.route("/", newPostRoutes);
  app.route("/archive", archiveRoutes);
  app.route("/featured", featuredRoutes);
  app.route("/latest", latestRoutes);
  app.route("/", partialPageRoutes);
  app.route("/_", brandRoutes);
  app.route("/_", themeSampleRoutes);
  app.route("/collections", collectionsPageRoutes);
  app.route("/collections", collectionRoutes);
  app.route("/", homeRoutes);

  // Custom page catch-all (must be last)
  app.route("/", pageRoutes);

  return app;
}
