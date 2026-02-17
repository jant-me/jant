/**
 * Jant App Factory
 */

import { Hono } from "hono";
import { createDatabase } from "./db/index.js";
import { createServices, type Services } from "./services/index.js";
import { createAuth, type Auth } from "./auth.js";
import { i18nMiddleware } from "./i18n/index.js";
import type { Bindings, JantConfig } from "./types.js";
import { SETTINGS_KEYS } from "./lib/constants.js";

// Routes - Auth
import { setupRoutes } from "./routes/auth/setup.js";
import { signinRoutes } from "./routes/auth/signin.js";
import { resetRoutes } from "./routes/auth/reset.js";

// Routes - Pages
import { homeRoutes } from "./routes/pages/home.js";
import { postRoutes } from "./routes/pages/post.js";
import { pageRoutes } from "./routes/pages/page.js";
import { collectionRoutes } from "./routes/pages/collection.js";
import { archiveRoutes } from "./routes/pages/archive.js";
import { searchRoutes } from "./routes/pages/search.js";
import { featuredRoutes } from "./routes/pages/featured.js";
import { latestRoutes } from "./routes/pages/latest.js";
import { collectionsPageRoutes } from "./routes/pages/collections.js";

// Routes - Dashboard
import { dashIndexRoutes } from "./routes/dash/index.js";
import { postsRoutes as dashPostsRoutes } from "./routes/dash/posts.js";
import { pagesRoutes as dashPagesRoutes } from "./routes/dash/pages.js";
import { mediaRoutes as dashMediaRoutes } from "./routes/dash/media.js";
import { settingsRoutes as dashSettingsRoutes } from "./routes/dash/settings.js";
import { redirectsRoutes as dashRedirectsRoutes } from "./routes/dash/redirects.js";
import { collectionsRoutes as dashCollectionsRoutes } from "./routes/dash/collections.js";

// Routes - API
import { postsApiRoutes } from "./routes/api/posts.js";
import { pagesApiRoutes } from "./routes/api/pages.js";
import { navItemsApiRoutes } from "./routes/api/nav-items.js";
import { collectionsApiRoutes } from "./routes/api/collections.js";
import { settingsApiRoutes } from "./routes/api/settings.js";
import { uploadApiRoutes } from "./routes/api/upload.js";
import { searchApiRoutes } from "./routes/api/search.js";
// Routes - Compose
import { composeRoutes } from "./routes/compose.js";

// Routes - Feed
import { rssRoutes } from "./routes/feed/rss.js";
import { sitemapRoutes } from "./routes/feed/sitemap.js";

// Middleware
import { requireAuth } from "./middleware/auth.js";
import { requireOnboarding } from "./middleware/onboarding.js";

import { getAvailableThemes, buildThemeStyle } from "./lib/theme.js";
import { createStorageDriver, type StorageDriver } from "./lib/storage.js";
import { BUILTIN_FONT_THEMES } from "./ui/font-themes.js";
import { getMediaUrl, getPublicUrlForProvider } from "./lib/image.js";
import { base64ToUint8Array } from "./lib/favicon.js";

// Extend Hono's context variables
export interface AppVariables {
  services: Services;
  auth: Auth;
  config: JantConfig;
  themeStyle: string;
  customCSS: string;
  isAuthenticated: boolean;
  storage: StorageDriver | null;
  faviconUrl?: string;
  noindex?: boolean;
}

export type App = Hono<{ Bindings: Bindings; Variables: AppVariables }>;

/**
 * Create a Jant application
 *
 * @param config - Optional configuration
 * @returns Hono app instance
 *
 * Site settings (name, description, language) should be configured via
 * environment variables (SITE_NAME, SITE_DESCRIPTION, SITE_LANGUAGE).
 * They can also be set in the dashboard, which stores them in the database.
 *
 * @example
 * ```typescript
 * import { createApp } from "@jant/core";
 *
 * export default createApp({
 *   cssVariables: { "--card-radius": "0" },
 * });
 * ```
 */
export function createApp(config: JantConfig = {}): App {
  const resolvedConfig: JantConfig = { ...config };

  const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

  // Initialize services, auth, and config middleware
  app.use("*", async (c, next) => {
    // Use withSession() to enable D1 Read Replication
    const session = c.env.DB.withSession();

    // Note: Drizzle ORM doesn't officially support D1DatabaseSession yet (issue #2226)
    // but it works at runtime. We use type assertion as a temporary workaround.
    const db = createDatabase(session as unknown as D1Database);
    const services = createServices(db, session as unknown as D1Database);
    c.set("services", services);
    c.set("config", resolvedConfig);
    c.set("storage", createStorageDriver(c.env));

    if (!c.env.AUTH_SECRET) {
      // eslint-disable-next-line no-console -- Startup warning is intentional
      console.warn(
        "[Jant] AUTH_SECRET is not set. Authentication is disabled. Set AUTH_SECRET in .dev.vars or wrangler.toml to enable auth.",
      );
    }

    if (c.env.AUTH_SECRET) {
      const baseURL = c.env.SITE_URL || new URL(c.req.url).origin;
      const auth = createAuth(session as unknown as D1Database, {
        secret: c.env.AUTH_SECRET,
        baseURL,
      });
      c.set("auth", auth);
    }

    await next();
  });

  // Onboarding gate — redirect to /setup if not yet initialized
  app.use("*", requireOnboarding());

  // Theme middleware - resolve active color theme, font theme, custom CSS, and auth state
  app.use("*", async (c, next) => {
    const [themeId, fontThemeId, customCSS, noindexValue, avatarMediaId] =
      await Promise.all([
        c.var.services.settings.get(SETTINGS_KEYS.THEME),
        c.var.services.settings.get("FONT_THEME"),
        c.var.services.settings.get(SETTINGS_KEYS.CUSTOM_CSS),
        c.var.services.settings.get("NOINDEX"),
        c.var.services.settings.get("SITE_AVATAR"),
      ]);
    const themes = getAvailableThemes(resolvedConfig);
    const activeTheme = themeId
      ? themes.find((t) => t.id === themeId)
      : undefined;

    // Build font override CSS variables
    const fontTheme = fontThemeId
      ? BUILTIN_FONT_THEMES.find((f) => f.id === fontThemeId)
      : undefined;
    const fontOverrides: Record<string, string> = {};
    if (fontTheme) {
      fontOverrides["--font-body"] = fontTheme.fontFamily;
    }

    const themeStyle = buildThemeStyle(activeTheme, {
      ...resolvedConfig.cssVariables,
      ...fontOverrides,
    });
    c.set("themeStyle", themeStyle);
    c.set("customCSS", customCSS ?? "");

    // Noindex
    c.set("noindex", noindexValue === "true");

    // Resolve favicon from avatar media
    if (avatarMediaId) {
      const media = await c.var.services.media.getById(avatarMediaId);
      if (media) {
        const publicUrl = getPublicUrlForProvider(
          media.provider,
          c.env.R2_PUBLIC_URL,
          c.env.S3_PUBLIC_URL,
        );
        c.set("faviconUrl", getMediaUrl(media.id, media.storageKey, publicUrl));
      }
    }

    // Check auth state for data-authenticated attribute on <body>
    let isAuthenticated = false;
    if (c.var.auth) {
      try {
        const session = await c.var.auth.api.getSession({
          headers: c.req.raw.headers,
        });
        isAuthenticated = !!session;
      } catch {
        // Not authenticated
      }
    }
    c.set("isAuthenticated", isAuthenticated);

    await next();
  });

  // i18n middleware
  app.use("*", i18nMiddleware());

  // Trailing slash redirect (redirect /foo/ to /foo)
  app.use("*", async (c, next) => {
    const url = new URL(c.req.url);
    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      const newUrl = url.pathname.slice(0, -1) + url.search;
      return c.redirect(newUrl, 301);
    }
    await next();
  });

  // Redirect middleware
  app.use("*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    // Skip redirect check for API routes and static assets
    if (path.startsWith("/api/") || path.startsWith("/assets/")) {
      return next();
    }

    const redirect = await c.var.services.redirects.getByPath(path);
    if (redirect) {
      return c.redirect(redirect.toPath, redirect.type);
    }

    await next();
  });

  // Health check
  app.get("/health", (c) =>
    c.json({
      status: "ok",
      auth: c.env.AUTH_SECRET ? "configured" : "missing",
      authSecretLength: c.env.AUTH_SECRET?.length ?? 0,
    }),
  );

  // Favicon routes - serve from DB settings (small files, avoids R2 round-trip)
  app.get("/favicon.ico", async (c) => {
    const data = await c.var.services.settings.get("SITE_FAVICON_ICO");
    if (!data) return c.notFound();

    return new Response(base64ToUint8Array(data), {
      headers: {
        "Content-Type": "image/x-icon",
        "Cache-Control": "public, max-age=86400",
      },
    });
  });

  app.get("/apple-touch-icon.png", async (c) => {
    const data = await c.var.services.settings.get("SITE_FAVICON_APPLE_TOUCH");
    if (!data) return c.notFound();

    return new Response(base64ToUint8Array(data), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    });
  });

  // better-auth handler
  app.all("/api/auth/*", async (c) => {
    if (!c.var.auth) {
      return c.json({ error: "Auth not configured. Set AUTH_SECRET." }, 500);
    }
    return c.var.auth.handler(c.req.raw);
  });

  // API Routes
  app.route("/api/posts", postsApiRoutes);
  app.route("/api/pages", pagesApiRoutes);
  app.route("/api/nav-items", navItemsApiRoutes);
  app.route("/api/collections", collectionsApiRoutes);
  app.route("/api/settings", settingsApiRoutes);

  // Auth routes
  app.route("/", setupRoutes);
  app.route("/", signinRoutes);
  app.route("/", resetRoutes);

  // Dashboard routes (protected)
  app.use("/dash/*", requireAuth());
  app.route("/dash", dashIndexRoutes);
  app.route("/dash/posts", dashPostsRoutes);
  app.route("/dash/pages", dashPagesRoutes);
  app.route("/dash/media", dashMediaRoutes);
  app.route("/dash/settings", dashSettingsRoutes);
  app.route("/dash/redirects", dashRedirectsRoutes);
  app.route("/dash/collections", dashCollectionsRoutes);
  // API routes
  app.route("/api/upload", uploadApiRoutes);
  app.route("/api/search", searchApiRoutes);

  // Media files from storage (UUIDv7-based URLs with extension)
  app.get("/media/:idWithExt", async (c) => {
    const storage = c.var.storage;
    if (!storage) {
      return c.notFound();
    }

    // Extract ID from "uuid.ext" format
    const idWithExt = c.req.param("idWithExt");
    const mediaId = idWithExt.replace(/\.[^.]+$/, "");

    const media = await c.var.services.media.getById(mediaId);
    if (!media) {
      return c.notFound();
    }

    const object = await storage.get(media.storageKey);
    if (!object) {
      return c.notFound();
    }

    const headers = new Headers();
    headers.set("Content-Type", object.contentType || media.mimeType);
    headers.set("Cache-Control", "public, max-age=31536000, immutable");

    return new Response(object.body, { headers });
  });

  // Compose route (auth enforced in route middleware)
  app.route("/compose", composeRoutes);

  // Feed routes
  app.route("/feed", rssRoutes);
  app.route("/", sitemapRoutes);

  // Frontend routes
  app.route("/search", searchRoutes);
  app.route("/archive", archiveRoutes);
  app.route("/featured", featuredRoutes);
  app.route("/latest", latestRoutes);
  app.route("/collections", collectionsPageRoutes);
  app.route("/c", collectionRoutes);
  app.route("/p", postRoutes);
  app.route("/", homeRoutes);

  // Custom page catch-all (must be last)
  app.route("/", pageRoutes);

  return app;
}
