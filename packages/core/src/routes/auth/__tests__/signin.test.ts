import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createI18n } from "../../../i18n/index.js";
import { attachSession } from "../../../middleware/session.js";
import { requireAuth } from "../../../middleware/auth.js";
import { signinRoutes } from "../signin.js";
import { createApp } from "../../../app.js";
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
  // The limit is on /signin. better-auth's own endpoints would take the same
  // password with none (/api/auth/sign-in/email), and before setup would take
  // the first account (/api/auth/sign-up/email), so the app serves none of
  // them: every sign-in goes through Jant's own pages.
  it("leaves better-auth's HTTP endpoints unserved", () => {
    expect(
      createApp().routes.filter((route) => route.path.startsWith("/api/auth")),
    ).toEqual([]);
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
    return { app, signInEmail };
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

  // Every demo visitor signs in to the one published account.
  it("lets many clients sign in to the demo account", async () => {
    const { app, signInEmail } = createGuessingApp({ demoMode: true });

    for (let i = 0; i < 30; i++) {
      await attempt(app, "demo@jant.me", `203.0.113.${i}`);
    }

    expect(signInEmail).toHaveBeenCalledTimes(30);
  });
});
