/**
 * Tests for the Discover answer the setup screen collects.
 *
 * The point under test is that setup records an answer rather than inferring
 * one: a ticked box and a cleared box both write, and a form that carried no
 * field at all writes nothing — that last case is an older client or a scripted
 * setup, and reading it as a refusal would opt sites out that never said so.
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

function createMockAuth() {
  return {
    api: {
      getSession: async () => ({
        headers: new Headers(),
        response: {
          user: { id: "usr_owner", email: "owner@test.com", name: "O" },
          session: { id: "ses_owner" },
        },
      }),
    },
  } as unknown as AppVariables["auth"];
}

/**
 * A provisioned site whose owner is answering — the branch that reaches the
 * Discover write with the least scaffolding around it. The fresh-install branch
 * calls the same helper one line later.
 */
function createSetupApp(options: { demoMode?: boolean } = {}) {
  const confirmFirstRunLanguage = vi.fn(async () => {});
  const updateDiscoverSetting = vi.fn(async () => ({ shouldAnnounce: true }));

  const app = new Hono<Env>();
  app.use("*", async (c, next) => {
    c.env = {} as Bindings;
    c.set("auth", createMockAuth());
    c.set("services", {
      settings: {
        getOnboardingStatus: async () => ONBOARDING_STATUS.PROVISIONED,
        confirmFirstRunLanguage,
        updateDiscoverSetting,
      },
      siteMembers: {
        get: async () => ({
          createdAt: 0,
          role: "owner",
          siteId: "sit_test",
          updatedAt: 0,
          userId: "usr_owner",
        }),
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
      demoMode: options.demoMode ?? false,
    } as AppVariables["appConfig"]);
    c.set("lang", "en");
    c.set("i18n", createI18n("en"));
    await next();
  });
  app.use("*", attachSession());
  app.route("/", setupRoutes);

  return { app, updateDiscoverSetting };
}

function post(app: Hono<Env>, body: Record<string, unknown>) {
  return app.request("/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentLanguage: "zh-Hans", ...body }),
  });
}

describe("POST /setup, the Discover answer", () => {
  it("stores `latest` when the box was ticked", async () => {
    const { app, updateDiscoverSetting } = createSetupApp();

    await post(app, { discover: true });

    expect(updateDiscoverSetting).toHaveBeenCalledWith("latest", {
      demoMode: false,
    });
  });

  // The half that matters on a deployment which lists by default: a cleared box
  // has to be written, or `DISCOVER=latest` keeps deciding for someone who just
  // said no.
  it("stores `off` when the box was cleared", async () => {
    const { app, updateDiscoverSetting } = createSetupApp();

    await post(app, { discover: false });

    expect(updateDiscoverSetting).toHaveBeenCalledWith("off", {
      demoMode: false,
    });
  });

  it("writes nothing when the form carried no answer", async () => {
    const { app, updateDiscoverSetting } = createSetupApp();

    await post(app, {});

    expect(updateDiscoverSetting).not.toHaveBeenCalled();
  });

  // `shouldAnnounce` comes back true here and is deliberately dropped: at first
  // run the site is usually not reachable yet, and the ping answers 202 for
  // everything, so a recorded success would hide the retry the owner needs.
  it("does not announce, whatever the setting service reports", async () => {
    const { app, updateDiscoverSetting } = createSetupApp();

    const res = await post(app, { discover: true });

    expect(updateDiscoverSetting).toHaveBeenCalledOnce();
    await expect(res.text()).resolves.not.toContain("announce");
  });
});
