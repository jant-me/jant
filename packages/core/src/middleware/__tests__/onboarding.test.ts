import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { requireOnboarding, resetOnboardingCache } from "../onboarding.js";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { DEFAULT_TEST_SITE_ID } from "../../__tests__/helpers/db.js";
import {
  ONBOARDING_STATUS,
  type OnboardingStatus,
} from "../../lib/constants.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

function createMockServices(status: OnboardingStatus) {
  let callCount = 0;
  const services = {
    settings: {
      getOnboardingStatus: async () => {
        callCount++;
        return status;
      },
    },
  } as AppVariables["services"];
  return { services, getCallCount: () => callCount };
}

function createApp(
  status: OnboardingStatus | boolean,
  options?: { authenticated?: boolean },
) {
  const resolved: OnboardingStatus =
    typeof status === "boolean"
      ? status
        ? ONBOARDING_STATUS.COMPLETED
        : ONBOARDING_STATUS.PENDING
      : status;
  const mock = createMockServices(resolved);
  const app = new Hono<Env>();

  app.use("*", async (c, next) => {
    c.set("services", mock.services);
    c.set("isAuthenticated", options?.authenticated ?? false);
    c.set("currentSite", {
      id: DEFAULT_TEST_SITE_ID,
      key: "default",
      status: "active",
      createdAt: 0,
      updatedAt: 0,
    });
    c.set("currentSiteDomain", null);
    await next();
  });
  app.use("*", requireOnboarding());

  // Register routes for testing
  app.get("/", (c) => c.text("Home"));
  app.get("/settings", (c) => c.text("Settings"));
  app.get("/settings/general", (c) => c.text("General"));
  app.get("/archive", (c) => c.text("Archive"));
  app.get("/p/abc", (c) => c.text("Post"));
  app.get("/setup", (c) => c.text("Setup"));
  app.get("/healthz", (c) => c.text("OK"));
  app.get("/signin", (c) => c.text("Signin"));
  app.post("/signout", (c) => c.text("Signout"));
  app.get("/reset", (c) => c.text("Reset"));
  app.get("/api/auth/session", (c) => c.json({ ok: true }));
  app.get("/assets/client-B2b-1X3C.js", (c) => c.text("js"));
  app.get("/feed", (c) => c.text("rss"));
  app.get("/robots.txt", (c) => c.text("robots"));
  app.get("/sitemap.xml", (c) => c.text("sitemap"));
  app.get("/media/abc.jpg", (c) => c.text("image"));
  app.get("/compose", (c) => c.text("Compose"));

  return { app, getCallCount: mock.getCallCount };
}

describe("requireOnboarding", () => {
  beforeEach(() => {
    resetOnboardingCache();
  });

  describe("redirected paths", () => {
    it("redirects / to /setup when onboarding not complete", async () => {
      const { app } = createApp(false);
      const res = await app.request("/", { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/setup");
    });

    it("redirects /settings to /setup when onboarding not complete", async () => {
      const { app } = createApp(false);
      const res = await app.request("/settings", { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/setup");
    });

    it("redirects /settings/* to /setup when onboarding not complete", async () => {
      const { app } = createApp(false);
      const res = await app.request("/settings/general", {
        redirect: "manual",
      });
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/setup");
    });

    it("redirects /signin to /setup when onboarding not complete", async () => {
      const { app } = createApp(false);
      const res = await app.request("/signin", { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/setup");
    });

    it("redirects /reset to /setup when onboarding not complete", async () => {
      const { app } = createApp(false);
      const res = await app.request("/reset", { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/setup");
    });
  });

  it("allows through when onboarding is complete", async () => {
    const { app } = createApp(true);
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Home");
  });

  it("caches result — second request skips DB query", async () => {
    const { app, getCallCount } = createApp(true);

    await app.request("/");
    expect(getCallCount()).toBe(1);

    await app.request("/settings");
    expect(getCallCount()).toBe(1); // still 1 — cached
  });

  it("does not cache incomplete status", async () => {
    const { app, getCallCount } = createApp(false);

    await app.request("/", { redirect: "manual" });
    expect(getCallCount()).toBe(1);

    await app.request("/settings", { redirect: "manual" });
    expect(getCallCount()).toBe(2); // queried again
  });

  // A control plane already built the site and its owner, so readers must be
  // served normally; only the author still owes setup an answer.
  describe("provisioned sites", () => {
    const provisioned = ONBOARDING_STATUS.PROVISIONED;

    it("serves the public root to a signed-out visitor", async () => {
      const { app } = createApp(provisioned);
      const res = await app.request("/", { redirect: "manual" });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("Home");
    });

    it("serves /signin to a signed-out visitor", async () => {
      const { app } = createApp(provisioned);
      const res = await app.request("/signin", { redirect: "manual" });
      expect(res.status).toBe(200);
    });

    it("redirects the signed-in author from / to /setup", async () => {
      const { app } = createApp(provisioned, { authenticated: true });
      const res = await app.request("/", { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/setup");
    });

    it("redirects the signed-in author from /settings to /setup", async () => {
      const { app } = createApp(provisioned, { authenticated: true });
      const res = await app.request("/settings", { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/setup");
    });

    it("redirects the signed-in author from /compose to /setup", async () => {
      const { app } = createApp(provisioned, { authenticated: true });
      const res = await app.request("/compose", { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/setup");
    });

    it("leaves an archive page alone even for the author", async () => {
      const { app } = createApp(provisioned, { authenticated: true });
      const res = await app.request("/archive", { redirect: "manual" });
      expect(res.status).toBe(200);
    });

    it("is not cached as complete", async () => {
      const { app, getCallCount } = createApp(provisioned, {
        authenticated: true,
      });

      await app.request("/", { redirect: "manual" });
      await app.request("/settings", { redirect: "manual" });
      expect(getCallCount()).toBe(2);
    });
  });

  describe("non-redirected paths (pass through without DB check)", () => {
    it("allows /setup", async () => {
      const { app, getCallCount } = createApp(false);
      const res = await app.request("/setup");
      expect(res.status).toBe(200);
      expect(getCallCount()).toBe(0);
    });

    it("allows /healthz", async () => {
      const { app, getCallCount } = createApp(false);
      const res = await app.request("/healthz");
      expect(res.status).toBe(200);
      expect(getCallCount()).toBe(0);
    });

    it("allows /signout", async () => {
      const { app, getCallCount } = createApp(false);
      const res = await app.request("/signout", { method: "POST" });
      expect(res.status).toBe(200);
      expect(getCallCount()).toBe(0);
    });

    it("allows /api/auth/*", async () => {
      const { app, getCallCount } = createApp(false);
      const res = await app.request("/api/auth/session");
      expect(res.status).toBe(200);
      expect(getCallCount()).toBe(0);
    });

    it("allows /assets/*", async () => {
      const { app, getCallCount } = createApp(false);
      const res = await app.request("/assets/client-B2b-1X3C.js");
      expect(res.status).toBe(200);
      expect(getCallCount()).toBe(0);
    });

    it("allows /feed", async () => {
      const { app, getCallCount } = createApp(false);
      const res = await app.request("/feed");
      expect(res.status).toBe(200);
      expect(getCallCount()).toBe(0);
    });

    it("allows /robots.txt", async () => {
      const { app, getCallCount } = createApp(false);
      const res = await app.request("/robots.txt");
      expect(res.status).toBe(200);
      expect(getCallCount()).toBe(0);
    });

    it("allows /sitemap.xml", async () => {
      const { app, getCallCount } = createApp(false);
      const res = await app.request("/sitemap.xml");
      expect(res.status).toBe(200);
      expect(getCallCount()).toBe(0);
    });

    it("allows /media/*", async () => {
      const { app, getCallCount } = createApp(false);
      const res = await app.request("/media/abc.jpg");
      expect(res.status).toBe(200);
      expect(getCallCount()).toBe(0);
    });

    it("allows /archive", async () => {
      const { app, getCallCount } = createApp(false);
      const res = await app.request("/archive");
      expect(res.status).toBe(200);
      expect(getCallCount()).toBe(0);
    });

    it("allows /p/*", async () => {
      const { app, getCallCount } = createApp(false);
      const res = await app.request("/p/abc");
      expect(res.status).toBe(200);
      expect(getCallCount()).toBe(0);
    });
  });
});
