/**
 * Jant App Factory
 */

import { Hono } from "hono";
import type { FC } from "hono/jsx";
import { createDatabase } from "./db/index.js";
import { createServices, type Services } from "./services/index.js";
import { createAuth, type Auth } from "./auth.js";
import { i18nMiddleware } from "./i18n/index.js";
import { useLingui } from "@lingui/react/macro";
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
import { sse } from "./lib/sse.js";

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
  app.get("/health", (c) =>
    c.json({
      status: "ok",
      auth: c.env.AUTH_SECRET ? "configured" : "missing",
      authSecretLength: c.env.AUTH_SECRET?.length ?? 0,
    }),
  );

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
  const SetupContent: FC = () => {
    const { t } = useLingui();

    return (
      <div class="min-h-screen flex items-center justify-center">
        <div class="card max-w-md w-full">
          <header>
            <h2>
              {t({
                message: "Welcome to Jant",
                comment: "@context: Setup page welcome heading",
              })}
            </h2>
            <p>
              {t({
                message: "Let's set up your site.",
                comment: "@context: Setup page description",
              })}
            </p>
          </header>
          <section>
            <div id="setup-message"></div>
            <form
              data-signals="{siteName: '', name: '', email: '', password: ''}"
              data-on:submit__prevent="@post('/setup')"
              class="flex flex-col gap-4"
            >
              <div class="field">
                <label class="label">
                  {t({
                    message: "Site Name",
                    comment: "@context: Setup form field - site name",
                  })}
                </label>
                <input
                  type="text"
                  data-bind="siteName"
                  class="input"
                  required
                  placeholder={t({
                    message: "My Blog",
                    comment: "@context: Setup site name placeholder",
                  })}
                />
              </div>
              <div class="field">
                <label class="label">
                  {t({
                    message: "Your Name",
                    comment: "@context: Setup form field - user name",
                  })}
                </label>
                <input
                  type="text"
                  data-bind="name"
                  class="input"
                  required
                  placeholder="John Doe"
                />
              </div>
              <div class="field">
                <label class="label">
                  {t({
                    message: "Email",
                    comment: "@context: Setup/signin form field - email",
                  })}
                </label>
                <input
                  type="email"
                  data-bind="email"
                  class="input"
                  required
                  placeholder="you@example.com"
                />
              </div>
              <div class="field">
                <label class="label">
                  {t({
                    message: "Password",
                    comment: "@context: Setup/signin form field - password",
                  })}
                </label>
                <input
                  type="password"
                  data-bind="password"
                  class="input"
                  required
                  minLength={8}
                />
              </div>
              <button type="submit" class="btn">
                {t({
                  message: "Complete Setup",
                  comment: "@context: Setup form submit button",
                })}
              </button>
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

    return c.html(
      <BaseLayout title="Setup - Jant" c={c}>
        <SetupContent />
      </BaseLayout>,
    );
  });

  app.post("/setup", async (c) => {
    const isComplete = await c.var.services.settings.isOnboardingComplete();
    if (isComplete) return c.redirect("/");

    const body = await c.req.json<{
      siteName: string;
      name: string;
      email: string;
      password: string;
    }>();
    const { siteName, name, email, password } = body;

    if (!siteName || !name || !email || !password) {
      return sse(c, async (stream) => {
        await stream.patchElements(
          '<div id="setup-message"><p class="text-destructive text-sm mb-4">All fields are required</p></div>',
        );
      });
    }

    if (password.length < 8) {
      return sse(c, async (stream) => {
        await stream.patchElements(
          '<div id="setup-message"><p class="text-destructive text-sm mb-4">Password must be at least 8 characters</p></div>',
        );
      });
    }

    if (!c.var.auth) {
      return sse(c, async (stream) => {
        await stream.patchElements(
          '<div id="setup-message"><p class="text-destructive text-sm mb-4">AUTH_SECRET not configured</p></div>',
        );
      });
    }

    try {
      const signUpResponse = await c.var.auth.api.signUpEmail({
        body: { name, email, password },
      });

      if (!signUpResponse || "error" in signUpResponse) {
        return sse(c, async (stream) => {
          await stream.patchElements(
            '<div id="setup-message"><p class="text-destructive text-sm mb-4">Failed to create account</p></div>',
          );
        });
      }

      await c.var.services.settings.setMany({
        SITE_NAME: siteName,
        SITE_LANGUAGE: "en",
      });
      await c.var.services.settings.completeOnboarding();

      return sse(c, async (stream) => {
        await stream.redirect("/signin");
      });
    } catch (err) {
      // eslint-disable-next-line no-console -- Error logging is intentional
      console.error("Setup error:", err);
      return sse(c, async (stream) => {
        await stream.patchElements(
          '<div id="setup-message"><p class="text-destructive text-sm mb-4">Failed to create account</p></div>',
        );
      });
    }
  });

  // Signin page component
  const SigninContent: FC<{
    demoEmail?: string;
    demoPassword?: string;
  }> = ({ demoEmail, demoPassword }) => {
    const { t } = useLingui();
    const signals = JSON.stringify({
      email: demoEmail || "",
      password: demoPassword || "",
    }).replace(/</g, "\\u003c");

    return (
      <div class="min-h-screen flex items-center justify-center">
        <div class="card max-w-md w-full">
          <header>
            <h2>
              {t({
                message: "Sign In",
                comment: "@context: Sign in page heading",
              })}
            </h2>
          </header>
          <section>
            <div id="signin-message"></div>
            {demoEmail && demoPassword && (
              <p class="text-muted-foreground text-sm mb-4">
                {t({
                  message: "Demo account pre-filled. Just click Sign In.",
                  comment:
                    "@context: Hint shown on signin page when demo credentials are pre-filled",
                })}
              </p>
            )}
            <form
              data-signals={signals}
              data-on:submit__prevent="@post('/signin')"
              class="flex flex-col gap-4"
            >
              <div class="field">
                <label class="label">
                  {t({
                    message: "Email",
                    comment: "@context: Setup/signin form field - email",
                  })}
                </label>
                <input type="email" data-bind="email" class="input" required />
              </div>
              <div class="field">
                <label class="label">
                  {t({
                    message: "Password",
                    comment: "@context: Setup/signin form field - password",
                  })}
                </label>
                <input
                  type="password"
                  data-bind="password"
                  class="input"
                  required
                />
              </div>
              <button type="submit" class="btn">
                {t({
                  message: "Sign In",
                  comment: "@context: Sign in form submit button",
                })}
              </button>
            </form>
          </section>
        </div>
      </div>
    );
  };

  // Signin page
  app.get("/signin", async (c) => {
    return c.html(
      <BaseLayout title="Sign In - Jant" c={c}>
        <SigninContent
          demoEmail={c.env.DEMO_EMAIL}
          demoPassword={c.env.DEMO_PASSWORD}
        />
      </BaseLayout>,
    );
  });

  app.post("/signin", async (c) => {
    if (!c.var.auth) {
      return sse(c, async (stream) => {
        await stream.patchElements(
          '<div id="signin-message"><p class="text-destructive text-sm mb-4">Auth not configured</p></div>',
        );
      });
    }

    const body = await c.req.json<{ email: string; password: string }>();
    const { email, password } = body;

    try {
      const signInRequest = new Request(
        `${c.env.SITE_URL}/api/auth/sign-in/email`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        },
      );

      const response = await c.var.auth.handler(signInRequest);

      if (!response.ok) {
        return sse(c, async (stream) => {
          await stream.patchElements(
            '<div id="signin-message"><p class="text-destructive text-sm mb-4">Invalid email or password</p></div>',
          );
        });
      }

      // Forward Set-Cookie headers from auth response
      const cookieHeaders: Record<string, string> = {};
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) {
        cookieHeaders["Set-Cookie"] = setCookie;
      }

      return sse(
        c,
        async (stream) => {
          await stream.redirect("/dash");
        },
        { headers: cookieHeaders },
      );
    } catch (err) {
      // eslint-disable-next-line no-console -- Error logging is intentional
      console.error("Signin error:", err);
      return sse(c, async (stream) => {
        await stream.patchElements(
          '<div id="signin-message"><p class="text-destructive text-sm mb-4">Invalid email or password</p></div>',
        );
      });
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

  // Media files from R2 (UUIDv7-based URLs with extension)
  app.get("/media/:idWithExt", async (c) => {
    if (!c.env.R2) {
      return c.notFound();
    }

    // Extract ID from "uuid.ext" format
    const idWithExt = c.req.param("idWithExt");
    const mediaId = idWithExt.replace(/\.[^.]+$/, "");

    const media = await c.var.services.media.getById(mediaId);
    if (!media) {
      return c.notFound();
    }

    const object = await c.env.R2.get(media.r2Key);
    if (!object) {
      return c.notFound();
    }

    const headers = new Headers();
    headers.set(
      "Content-Type",
      object.httpMetadata?.contentType || media.mimeType,
    );
    headers.set("Cache-Control", "public, max-age=31536000, immutable");

    return new Response(object.body, { headers });
  });

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
