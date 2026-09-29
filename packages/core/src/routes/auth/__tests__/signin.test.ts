import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createI18n } from "../../../i18n/index.js";
import { attachSession } from "../../../middleware/session.js";
import { requireAuth } from "../../../middleware/auth.js";
import { limitApiSignin, signinRoutes } from "../signin.js";
import { createApp } from "../../../app.js";
import { createTestDatabase } from "../../../__tests__/helpers/db.js";
import { createMemoryRateLimiter } from "../../../lib/rate-limit-memory.js";
import type { Bindings } from "../../../types.js";
import type { AppVariables } from "../../../types/app-context.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

const SIGNIN_FORM_MARKER = 'data-bind="password"';

/**
 * A session for `usr_stale` that the site knows nothing about — what a browser
 * still holds right after a factory reset, since better-auth answers from its
 * cookie cache for minutes after the rows are gone.
 */
function createMockAuth(signedIn: boolean) {
  return {
    api: {
      getSession: async () => ({
        headers: new Headers(),
        response: signedIn
          ? {
              user: { id: "usr_stale", email: "old@test.com", name: "Old" },
              session: { id: "ses_stale" },
            }
          : null,
      }),
    },
  } as unknown as AppVariables["auth"];
}

function createMockServices(isMember: boolean) {
  return {
    siteMembers: {
      get: async () =>
        isMember
          ? {
              createdAt: 0,
              role: "owner",
              siteId: "sit_test",
              updatedAt: 0,
              userId: "usr_stale",
            }
          : null,
    },
  } as unknown as AppVariables["services"];
}

function createSigninTestApp(options: {
  signedIn: boolean;
  isMember: boolean;
}) {
  const app = new Hono<Env>();
  app.use("*", async (c, next) => {
    c.env = {} as Bindings;
    c.set("auth", createMockAuth(options.signedIn));
    c.set("services", createMockServices(options.isMember));
    c.set("currentSite", {
      createdAt: 0,
      id: "sit_test",
      key: "default",
      status: "active",
      updatedAt: 0,
    });
    c.set("currentSiteDomain", null);
    c.set("appConfig", {
      siteName: "Jant",
      sitePathPrefix: "",
    } as AppVariables["appConfig"]);
    c.set("publicRequestUrl", "http://localhost/signin");
    c.set("lang", "en");
    c.set("i18n", createI18n("en"));
    await next();
  });
  app.use("*", attachSession());
  app.route("/", signinRoutes);
  app.use("/settings", requireAuth());
  app.get("/settings", (c) => c.text("Settings"));
  return app;
}

describe("GET /signin", () => {
  it("shows the form to a session that is not a member of this site", async () => {
    const app = createSigninTestApp({ signedIn: true, isMember: false });

    const res = await app.request("/signin?redirect=%2Fsettings", {
      redirect: "manual",
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toContain(SIGNIN_FORM_MARKER);
  });

  it("sends a member on to where they were headed", async () => {
    const app = createSigninTestApp({ signedIn: true, isMember: true });

    const res = await app.request("/signin?redirect=%2Fsettings", {
      redirect: "manual",
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/settings");
  });

  it("still shows the form to a visitor with no session", async () => {
    const app = createSigninTestApp({ signedIn: false, isMember: false });

    const res = await app.request("/signin", { redirect: "manual" });

    expect(res.status).toBe(200);
    expect(await res.text()).toContain(SIGNIN_FORM_MARKER);
  });
});

describe("stale session redirect loop", () => {
  it("lands on the sign-in form instead of volleying with /settings", async () => {
    const app = createSigninTestApp({ signedIn: true, isMember: false });

    // `requireAuth` requires membership, so a session left over from a deleted
    // site is turned away here.
    const guarded = await app.request("/settings", { redirect: "manual" });
    expect(guarded.status).toBe(302);
    const signinLocation = guarded.headers.get("Location");
    expect(signinLocation).toBe("/signin?redirect=%2Fsettings");

    // …and this is the hop that used to send the same session straight back to
    // /settings, three redirects per lap until the browser gave up.
    const signin = await app.request(signinLocation!, { redirect: "manual" });
    expect(signin.status).toBe(200);
    expect(await signin.text()).toContain(SIGNIN_FORM_MARKER);
  });
});

describe("POST /signin rate limit", () => {
  // better-auth's own sign-in takes the same password, so its limiter has to
  // run before the better-auth handler, which answers without yielding.
  it("limits better-auth's sign-in ahead of the better-auth handler", () => {
    const routes = createApp().routes;
    const limiter = routes.findIndex(
      (route) =>
        route.method === "POST" && route.path === "/api/auth/sign-in/email",
    );
    // The last match: `noStore()` is mounted on the same path first.
    const handler = routes.findLastIndex(
      (route) => route.method === "ALL" && route.path === "/api/auth/*",
    );
    expect(limiter).toBeGreaterThanOrEqual(0);
    expect(limiter).toBeLessThan(handler);
  });

  function createGuessingApp({ demoMode = false } = {}) {
    const signInEmail = vi.fn(async () => {
      throw new Error("Invalid email or password");
    });
    const rateLimiter = createMemoryRateLimiter();
    const app = new Hono<Env>();
    app.use("*", async (c, next) => {
      c.env = {} as Bindings;
      c.set("auth", {
        api: { signInEmail },
      } as unknown as AppVariables["auth"]);
      c.set("rateLimiter", rateLimiter);
      c.set("appConfig", {
        siteName: "Jant",
        sitePathPrefix: "",
        rateLimit: { enabled: true, searchPerMinute: 30 },
        demoMode,
      } as AppVariables["appConfig"]);
      c.set("lang", "en");
      c.set("i18n", createI18n("en"));
      await next();
    });
    app.route("/", signinRoutes);
    // Mounted as `app.tsx` mounts it, with a stand-in for better-auth that
    // reads the body it was sent.
    const betterAuthSignIn = vi.fn(async (request: Request) =>
      Response.json({
        email: ((await request.json()) as { email: string }).email,
      }),
    );
    app.post("/api/auth/sign-in/email", limitApiSignin);
    app.all("/api/auth/*", (c) => betterAuthSignIn(c.req.raw));
    return { app, signInEmail, betterAuthSignIn };
  }

  function attempt(app: Hono<Env>, email: string, ip: string) {
    return app.request("/signin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": ip,
      },
      body: JSON.stringify({ email, password: "guess-password" }),
    });
  }

  it("stops password guesses at one account from many clients", async () => {
    const { app, signInEmail } = createGuessingApp();

    for (let i = 0; i < 10; i++) {
      await attempt(app, "owner@example.com", `203.0.113.${i}`);
    }
    const res = await attempt(app, "Owner@Example.com", "203.0.113.99");

    await expect(res.text()).resolves.toContain("Too many sign-in attempts");
    expect(signInEmail).toHaveBeenCalledTimes(10);
  });

  it("stops one client guessing across many accounts", async () => {
    const { app, signInEmail } = createGuessingApp();

    for (let i = 0; i < 20; i++) {
      await attempt(app, `user${i}@example.com`, "203.0.113.1");
    }
    const res = await attempt(app, "another@example.com", "203.0.113.1");

    await expect(res.text()).resolves.toContain("Too many sign-in attempts");
    expect(signInEmail).toHaveBeenCalledTimes(20);
  });

  it("counts better-auth's sign-in against the same limits", async () => {
    const { app, betterAuthSignIn } = createGuessingApp();
    const apiAttempt = (ip: string) =>
      app.request("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
        body: JSON.stringify({ email: "owner@example.com", password: "guess" }),
      });

    const passed = await apiAttempt("203.0.113.1");
    await expect(passed.json()).resolves.toEqual({
      email: "owner@example.com",
    });
    for (let i = 0; i < 9; i++) {
      await attempt(app, "owner@example.com", `203.0.113.${i + 10}`);
    }
    const limited = await apiAttempt("203.0.113.99");

    expect(limited.status).toBe(429);
    expect(limited.headers.get("X-Retry-After")).toMatch(/^[1-9]\d*$/);
    expect(betterAuthSignIn).toHaveBeenCalledTimes(1);
  });

  // Every demo visitor signs in to the one published account.
  it("lets many clients sign in to the demo account", async () => {
    const { app, signInEmail } = createGuessingApp({ demoMode: true });

    for (let i = 0; i < 30; i++) {
      await attempt(app, "demo@jant.me", `203.0.113.${i}`);
    }

    expect(signInEmail).toHaveBeenCalledTimes(30);
  });
});

describe("POST /api/auth/sign-in/email in the full app", () => {
  it("answers 429 once one client passes the sign-in limit", async () => {
    const { sqlite } = createTestDatabase();
    const app = createApp();
    const env = {
      SITE_ORIGIN: "https://blog.example",
      AUTH_SECRET: "x".repeat(40),
      NODE_SQLITE: sqlite,
    } as unknown as Bindings;
    const executionCtx = {
      waitUntil() {},
      passThroughOnException() {},
      props: {},
    } as unknown as Parameters<typeof app.fetch>[2];
    const signIn = (n: number) =>
      app.fetch(
        new Request("https://blog.example/api/auth/sign-in/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: `guess${n}@example.com`,
            password: "guess-password",
          }),
        }),
        env,
        executionCtx,
      );

    for (let n = 0; n < 20; n++) {
      expect((await signIn(n)).status, `attempt ${n + 1}`).not.toBe(429);
    }
    const limited = await signIn(20);

    expect(limited.status).toBe(429);
    await expect(limited.json()).resolves.toMatchObject({
      message: expect.stringContaining("Too many sign-in attempts"),
    });
  });
});
