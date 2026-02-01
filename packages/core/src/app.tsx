/**
 * Jant App Factory
 */

import { Hono } from "hono";
import type { FC } from "hono/jsx";
import { createDatabase } from "./db/index.js";
import { createServices, type Services } from "./services/index.js";
import { createAuth, type Auth } from "./auth.js";
import { i18nMiddleware, useLingui } from "./i18n/index.js";
import { loadAssets } from "./lib/assets.js";
import type { Bindings, JantConfig } from "./types.js";

// Routes - Pages
import { homeRoutes } from "./routes/pages/home.js";
import { postRoutes } from "./routes/pages/post.js";
import { pageRoutes } from "./routes/pages/page.js";
import { collectionRoutes } from "./routes/pages/collection.js";
import { archiveRoutes } from "./routes/pages/archive.js";
import { searchRoutes } from "./routes/pages/search.js";

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
import { uploadApiRoutes } from "./routes/api/upload.js";
import { searchApiRoutes } from "./routes/api/search.js";

// Routes - Feed
import { rssRoutes } from "./routes/feed/rss.js";
import { sitemapRoutes } from "./routes/feed/sitemap.js";

// Middleware
import { requireAuth } from "./middleware/auth.js";

// Layouts for auth pages
import { BaseLayout } from "./theme/layouts/index.js";

// Extend Hono's context variables
export interface AppVariables {
  services: Services;
  auth: Auth;
  config: JantConfig;
}

export type App = Hono<{ Bindings: Bindings; Variables: AppVariables }>;

/**
 * Create a Jant application
 *
 * @param config - Optional configuration
 * @returns Hono app instance
 *
 * @example
 * ```typescript
 * import { createApp } from "@jant/core";
 *
 * export default createApp({
 *   site: { name: "My Blog" },
 *   theme: { components: { PostCard: MyPostCard } },
 * });
 * ```
 */
export function createApp(config: JantConfig = {}): App {
  const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

  // Load asset manifest (only once, cached after first request)
  app.use("*", async (c, next) => {
    // In production, load assets from manifest
    // @ts-expect-error - ASSETS binding provided by @cloudflare/vite-plugin
    if (c.env.ASSETS?.fetch) {
      // @ts-expect-error - ASSETS binding
      await loadAssets((url: string) => c.env.ASSETS.fetch(new Request(new URL(url, c.req.url))));
    }
    await next();
  });

  // Initialize services, auth, and config middleware
  app.use("*", async (c, next) => {
    const db = createDatabase(c.env.DB);
    const services = createServices(db, c.env.DB);
    c.set("services", services);
    c.set("config", config);

    if (c.env.AUTH_SECRET) {
      const auth = createAuth(c.env.DB, {
        secret: c.env.AUTH_SECRET,
        baseURL: c.env.SITE_URL,
      });
      c.set("auth", auth);
    }

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
  app.get("/health", (c) => c.json({ status: "ok" }));

  // better-auth handler
  app.all("/api/auth/*", async (c) => {
    if (!c.var.auth) {
      return c.json({ error: "Auth not configured. Set AUTH_SECRET." }, 500);
    }
    return c.var.auth.handler(c.req.raw);
  });

  // API Routes
  app.route("/api/posts", postsApiRoutes);

  // Setup page component
  const SetupContent: FC<{ error?: string }> = ({ error }) => {
    const { t } = useLingui();

    return (
      <div class="min-h-screen flex items-center justify-center">
        <div class="card max-w-md w-full">
          <header>
            <h2>{t({ message: "Welcome to Jant", comment: "@context: Setup page welcome heading" })}</h2>
            <p>{t({ message: "Let's set up your site.", comment: "@context: Setup page description" })}</p>
          </header>
          <section>
            {error && <p class="text-destructive text-sm mb-4">{error}</p>}
            <form method="post" action="/setup" class="flex flex-col gap-4">
              <div class="field">
                <label class="label">{t({ message: "Site Name", comment: "@context: Setup form field - site name" })}</label>
                <input type="text" name="siteName" class="input" required placeholder={t({ message: "My Blog", comment: "@context: Setup site name placeholder" })} />
              </div>
              <div class="field">
                <label class="label">{t({ message: "Your Name", comment: "@context: Setup form field - user name" })}</label>
                <input type="text" name="name" class="input" required placeholder="John Doe" />
              </div>
              <div class="field">
                <label class="label">{t({ message: "Email", comment: "@context: Setup/signin form field - email" })}</label>
                <input type="email" name="email" class="input" required placeholder="you@example.com" />
              </div>
              <div class="field">
                <label class="label">{t({ message: "Password", comment: "@context: Setup/signin form field - password" })}</label>
                <input type="password" name="password" class="input" required minLength={8} />
              </div>
              <button type="submit" class="btn">{t({ message: "Complete Setup", comment: "@context: Setup form submit button" })}</button>
            </form>
          </section>
        </div>
      </div>
    );
  };

  // Setup page
  app.get("/setup", async (c) => {
    const isComplete = await c.var.services.settings.isOnboardingComplete();
    if (isComplete) return c.redirect("/");

    const error = c.req.query("error");

    return c.html(
      <BaseLayout title="Setup - Jant" c={c}>
        <SetupContent error={error} />
      </BaseLayout>
    );
  });

  app.post("/setup", async (c) => {
    const isComplete = await c.var.services.settings.isOnboardingComplete();
    if (isComplete) return c.redirect("/");

    const formData = await c.req.formData();
    const siteName = formData.get("siteName") as string;
    const name = formData.get("name") as string;
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    if (!siteName || !name || !email || !password) {
      return c.redirect("/setup?error=All fields are required");
    }

    if (password.length < 8) {
      return c.redirect("/setup?error=Password must be at least 8 characters");
    }

    if (!c.var.auth) {
      return c.redirect("/setup?error=AUTH_SECRET not configured");
    }

    try {
      const signUpResponse = await c.var.auth.api.signUpEmail({
        body: { name, email, password },
      });

      if (!signUpResponse || "error" in signUpResponse) {
        return c.redirect("/setup?error=Failed to create account");
      }

      await c.var.services.settings.setMany({
        SITE_NAME: siteName,
        SITE_LANGUAGE: "en",
      });
      await c.var.services.settings.completeOnboarding();

      return c.redirect("/signin");
    } catch (err) {
      // eslint-disable-next-line no-console -- Error logging is intentional
      console.error("Setup error:", err);
      return c.redirect("/setup?error=Failed to create account");
    }
  });

  // Signin page component
  const SigninContent: FC<{ error?: string }> = ({ error }) => {
    const { t } = useLingui();

    return (
      <div class="min-h-screen flex items-center justify-center">
        <div class="card max-w-md w-full">
          <header>
            <h2>{t({ message: "Sign In", comment: "@context: Sign in page heading" })}</h2>
          </header>
          <section>
            {error && <p class="text-destructive text-sm mb-4">{error}</p>}
            <form method="post" action="/signin" class="flex flex-col gap-4">
              <div class="field">
                <label class="label">{t({ message: "Email", comment: "@context: Setup/signin form field - email" })}</label>
                <input type="email" name="email" class="input" required />
              </div>
              <div class="field">
                <label class="label">{t({ message: "Password", comment: "@context: Setup/signin form field - password" })}</label>
                <input type="password" name="password" class="input" required />
              </div>
              <button type="submit" class="btn">{t({ message: "Sign In", comment: "@context: Sign in form submit button" })}</button>
            </form>
          </section>
        </div>
      </div>
    );
  };

  // Signin page
  app.get("/signin", async (c) => {
    const error = c.req.query("error");

    return c.html(
      <BaseLayout title="Sign In - Jant" c={c}>
        <SigninContent error={error} />
      </BaseLayout>
    );
  });

  app.post("/signin", async (c) => {
    if (!c.var.auth) {
      return c.redirect("/signin?error=Auth not configured");
    }

    const formData = await c.req.formData();
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    try {
      const signInRequest = new Request(`${c.env.SITE_URL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const response = await c.var.auth.handler(signInRequest);

      if (!response.ok) {
        return c.redirect("/signin?error=Invalid email or password");
      }

      const headers = new Headers(response.headers);
      headers.set("Location", "/dash");

      return new Response(null, { status: 302, headers });
    } catch (err) {
      // eslint-disable-next-line no-console -- Error logging is intentional
      console.error("Signin error:", err);
      return c.redirect("/signin?error=Invalid email or password");
    }
  });

  app.get("/signout", async (c) => {
    if (c.var.auth) {
      try {
        await c.var.auth.api.signOut({ headers: c.req.raw.headers });
      } catch {
        // Ignore signout errors
      }
    }
    return c.redirect("/");
  });

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

  // Feed routes
  app.route("/feed", rssRoutes);
  app.route("/", sitemapRoutes);

  // Frontend routes
  app.route("/search", searchRoutes);
  app.route("/archive", archiveRoutes);
  app.route("/c", collectionRoutes);
  app.route("/p", postRoutes);
  app.route("/", homeRoutes);

  // Custom page catch-all (must be last)
  app.route("/", pageRoutes);

  return app;
}
