/**
 * Tests for who may answer the remaining setup question on a provisioned site.
 *
 * A provisioned site already has an owner, so `POST /setup` writes the site's
 * language on behalf of that owner. Carrying a session is not enough to be that
 * owner — the session may belong to someone this site has never heard of.
 */

import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createI18n } from "../../../i18n/index.js";
import { attachSession } from "../../../middleware/session.js";
import { ONBOARDING_STATUS } from "../../../lib/constants.js";
import { setupRoutes } from "../setup.js";
import type { Bindings } from "../../../types.js";
import type { AppVariables } from "../../../types/app-context.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

function createMockAuth(signedIn: boolean) {
  return {
    api: {
      getSession: async () => ({
        headers: new Headers(),
        response: signedIn
          ? {
              user: {
                id: "usr_outsider",
                email: "someone@test.com",
                name: "S",
              },
              session: { id: "ses_outsider" },
            }
          : null,
      }),
    },
  } as unknown as AppVariables["auth"];
}

function createProvisionedSetupApp(options: {
  signedIn: boolean;
  isMember: boolean;
}) {
  const confirmFirstRunLanguage = vi.fn(async () => {});

  const app = new Hono<Env>();
  app.use("*", async (c, next) => {
    c.env = {} as Bindings;
    c.set("auth", createMockAuth(options.signedIn));
    c.set("services", {
      settings: {
        getOnboardingStatus: async () => ONBOARDING_STATUS.PROVISIONED,
        confirmFirstRunLanguage,
      },
      siteMembers: {
        get: async () =>
          options.isMember
            ? {
                createdAt: 0,
                role: "owner",
                siteId: "sit_test",
                updatedAt: 0,
                userId: "usr_outsider",
              }
            : null,
      },
    } as unknown as AppVariables["services"]);
    c.set("currentSite", {
      createdAt: 0,
      id: "sit_test",
      key: "default",
      status: "active",
      updatedAt: 0,
    });
    c.set("appConfig", {
      siteName: "Jant",
      sitePathPrefix: "",
      siteLanguage: "en",
    } as AppVariables["appConfig"]);
    c.set("lang", "en");
    c.set("i18n", createI18n("en"));
    await next();
  });
  app.use("*", attachSession());
  app.route("/", setupRoutes);

  return { app, confirmFirstRunLanguage };
}

function postLanguage(app: Hono<Env>) {
  return app.request("/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentLanguage: "zh-Hans" }),
  });
}

describe("POST /setup on a provisioned site", () => {
  it("refuses a session that is not a member of this site", async () => {
    const { app, confirmFirstRunLanguage } = createProvisionedSetupApp({
      signedIn: true,
      isMember: false,
    });

    const res = await postLanguage(app);

    await expect(res.text()).resolves.toContain("/signin");
    expect(confirmFirstRunLanguage).not.toHaveBeenCalled();
  });

  it("lets the site's own owner answer", async () => {
    const { app, confirmFirstRunLanguage } = createProvisionedSetupApp({
      signedIn: true,
      isMember: true,
    });

    await postLanguage(app);

    expect(confirmFirstRunLanguage).toHaveBeenCalledOnce();
  });
});

describe("GET /setup on a provisioned site", () => {
  it("sends a non-member to the site instead of showing the form", async () => {
    const { app } = createProvisionedSetupApp({
      signedIn: true,
      isMember: false,
    });

    const res = await app.request("/setup", { redirect: "manual" });

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
  });
});
