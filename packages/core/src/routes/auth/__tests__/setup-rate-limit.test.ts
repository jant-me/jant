/**
 * `POST /setup` answers anyone while a site isn't set up, so each client gets
 * a limited number of tries.
 */

import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createI18n } from "../../../i18n/index.js";
import { ONBOARDING_STATUS } from "../../../lib/constants.js";
import { createMemoryRateLimiter } from "../../../lib/rate-limit-memory.js";
import { setupRoutes } from "../setup.js";
import type { Bindings } from "../../../types.js";
import type { AppVariables } from "../../../types/app-context.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

function createSetupApp() {
  const signUpEmail = vi.fn(async () => {
    throw new Error("rejected");
  });
  const rateLimiter = createMemoryRateLimiter();
  const app = new Hono<Env>();
  app.use("*", async (c, next) => {
    c.env = {} as Bindings;
    c.set("auth", {
      api: { signUpEmail },
    } as unknown as AppVariables["auth"]);
    c.set("services", {
      settings: {
        getOnboardingStatus: async () => ONBOARDING_STATUS.PENDING,
      },
    } as unknown as AppVariables["services"]);
    c.set("rateLimiter", rateLimiter);
    c.set("appConfig", {
      siteName: "Jant",
      sitePathPrefix: "",
      rateLimit: { disabled: false, searchPerMinute: 30 },
    } as AppVariables["appConfig"]);
    c.set("lang", "en");
    c.set("i18n", createI18n("en"));
    await next();
  });
  app.route("/", setupRoutes);
  return app;
}

function submit(app: Hono<Env>) {
  return app.request("/setup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": "203.0.113.7",
    },
    body: JSON.stringify({ email: "a@example.com", password: "x" }),
  });
}

describe("POST /setup rate limit", () => {
  it("refuses a client after twenty tries in ten minutes", async () => {
    const app = createSetupApp();

    for (let i = 0; i < 20; i++) {
      const res = await submit(app);
      await expect(res.text()).resolves.not.toContain("Too many setup");
    }
    const res = await submit(app);

    await expect(res.text()).resolves.toContain(
      "Too many setup attempts. Wait a few minutes and try again.",
    );
  });
});
