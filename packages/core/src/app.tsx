/**
 * Jant App Factory
 */

import { Hono } from "hono";
import { createDatabase } from "./db/index.js";
import { createServices, type Services } from "./services/index.js";
import { createAuth, type Auth } from "./auth.js";
import { loadCatalogs, i18nMiddleware } from "./i18n/index.js";
import type { Bindings } from "./types.js";

// Routes - Pages
import { homeRoute } from "./routes/pages/home.js";
import { postRoute } from "./routes/pages/post.js";
import { collectionRoute } from "./routes/pages/collection.js";
import { archiveRoute } from "./routes/pages/archive.js";

// Routes - Dashboard
import { dashIndexRoute } from "./routes/dash/index.js";
import { postsRoutes as dashPostsRoutes } from "./routes/dash/posts.js";
import { settingsRoutes as dashSettingsRoutes } from "./routes/dash/settings.js";
import { redirectsRoutes as dashRedirectsRoutes } from "./routes/dash/redirects.js";
import { collectionsRoutes as dashCollectionsRoutes } from "./routes/dash/collections.js";

// Routes - API
import { postsApiRoutes } from "./routes/api/posts.js";
import { uploadApiRoutes } from "./routes/api/upload.js";

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
}

export type App = Hono<{ Bindings: Bindings; Variables: AppVariables }>;

export function createApp(): App {
  const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

  // Load i18n catalogs
  loadCatalogs();

  // Initialize services and auth middleware
  app.use("*", async (c, next) => {
    const db = createDatabase(c.env.DB);
    const services = createServices(db);
    c.set("services", services);

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

  // Redirect middleware
  app.use("*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
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

  // Static assets (Datastar, etc.)
  app.get("/assets/:filename", async (c) => {
    const filename = c.req.param("filename");
    // In production, these would be served from R2 or a CDN
    // For now, return a placeholder that loads from CDN
    if (filename === "datastar.min.js") {
      const response = await fetch(
        "https://cdn.jsdelivr.net/npm/@sudodevnull/datastar@latest/dist/datastar.min.js"
      );
      return new Response(response.body, {
        headers: { "Content-Type": "application/javascript" },
      });
    }
    return c.notFound();
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

  // Setup page
  app.get("/setup", async (c) => {
    const isComplete = await c.var.services.settings.isOnboardingComplete();
    if (isComplete) return c.redirect("/");

    const error = c.req.query("error");

    return c.html(
      <BaseLayout title="Setup - Jant">
        <div class="min-h-screen flex items-center justify-center">
          <div class="card max-w-md w-full">
            <header>
              <h2>Welcome to Jant</h2>
              <p>Let's set up your site.</p>
            </header>
            <section>
              {error && <p class="text-destructive text-sm mb-4">{error}</p>}
              <form method="post" action="/setup" class="flex flex-col gap-4">
                <div class="field">
                  <label class="label">Site Name</label>
                  <input type="text" name="siteName" class="input" required placeholder="My Blog" />
                </div>
                <div class="field">
                  <label class="label">Your Name</label>
                  <input type="text" name="name" class="input" required placeholder="John Doe" />
                </div>
                <div class="field">
                  <label class="label">Email</label>
                  <input type="email" name="email" class="input" required placeholder="you@example.com" />
                </div>
                <div class="field">
                  <label class="label">Password</label>
                  <input type="password" name="password" class="input" required minLength={8} />
                </div>
                <button type="submit" class="btn">Complete Setup</button>
              </form>
            </section>
          </div>
        </div>
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
      console.error("Setup error:", err);
      return c.redirect("/setup?error=Failed to create account");
    }
  });

  // Signin page
  app.get("/signin", async (c) => {
    const error = c.req.query("error");

    return c.html(
      <BaseLayout title="Sign In - Jant">
        <div class="min-h-screen flex items-center justify-center">
          <div class="card max-w-md w-full">
            <header>
              <h2>Sign In</h2>
            </header>
            <section>
              {error && <p class="text-destructive text-sm mb-4">{error}</p>}
              <form method="post" action="/signin" class="flex flex-col gap-4">
                <div class="field">
                  <label class="label">Email</label>
                  <input type="email" name="email" class="input" required />
                </div>
                <div class="field">
                  <label class="label">Password</label>
                  <input type="password" name="password" class="input" required />
                </div>
                <button type="submit" class="btn">Sign In</button>
              </form>
            </section>
          </div>
        </div>
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
  app.route("/dash", dashIndexRoute);
  app.route("/dash/posts", dashPostsRoutes);
  app.route("/dash/settings", dashSettingsRoutes);
  app.route("/dash/redirects", dashRedirectsRoutes);
  app.route("/dash/collections", dashCollectionsRoutes);

  // API routes
  app.route("/api/upload", uploadApiRoutes);

  // Feed routes
  app.route("/feed", rssRoutes);
  app.route("/", sitemapRoutes);

  // Frontend routes
  app.route("/archive", archiveRoute);
  app.route("/c", collectionRoute);
  app.route("/p", postRoute);
  app.route("/", homeRoute);

  return app;
}
