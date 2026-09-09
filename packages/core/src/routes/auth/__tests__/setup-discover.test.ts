/**
 * Tests for the Discover answer the setup screen collects.
 *
 * The point under test is that setup records an answer rather than inferring
 * one — a ticked box and a cleared box both write, and a form that carried no
 * field at all writes nothing, since that last case is an older client or a
 * scripted setup and reading it as a refusal would opt sites out that never
 * said so — and then acts on it, on the same terms as the settings page's own
 * switch.
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
 * A provisioned site whose owner is answering. Both install kinds reach the
 * Discover write through this one branch — a self-hosted site arrives here from
 * its second screen, a hosted one from its only screen.
 */
function createSetupApp(
  options: { demoMode?: boolean; shouldAnnounce?: boolean } = {},
) {
  const completeSiteSetup = vi.fn(async () => {});
  const updateDiscoverSetting = vi.fn(async () => ({
    shouldAnnounce: options.shouldAnnounce ?? true,
  }));
  const announceToDiscover = vi.fn(async () => {});
  // The hook `runDeferred` offers tests: every backgrounded promise lands
  // here, so the announcement can be awaited instead of raced.
  const pending: Promise<unknown>[] = [];

  const app = new Hono<Env>();
  app.use("*", async (c, next) => {
    c.env = {
      DISCOVER_PING_URL: "https://directory.test/api/discover/ping",
      __pendingDeferred: pending,
    } as unknown as Bindings;
    c.set("auth", createMockAuth());
    c.set("services", {
      settings: {
        getOnboardingStatus: async () => ONBOARDING_STATUS.PROVISIONED,
        // Already named, so this is the hosted screen: language and Discover
        // and nothing else.
        get: async () => "My Blog",
        updateDiscoverSetting,
        announceToDiscover,
      },
      bootstrap: { completeSiteSetup },
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
      siteUrl: "https://example.com",
      demoMode: options.demoMode ?? false,
      noindex: false,
      rssFeedsEnabled: true,
    } as AppVariables["appConfig"]);
    c.set("lang", "en");
    c.set("i18n", createI18n("en"));
    await next();
  });
  app.use("*", attachSession());
  app.route("/", setupRoutes);

  return { app, updateDiscoverSetting, announceToDiscover, pending };
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

  // The answer takes effect now, not when the author next happens to open a
  // settings page they have no reason to open. A directory decides eligibility
  // for itself and re-reads the feed on its own schedule, so a site with
  // nothing published yet loses nothing by saying hello early.
  it("announces the site when the box was ticked", async () => {
    const { app, announceToDiscover, pending } = createSetupApp();

    await post(app, { discover: true });
    await Promise.all(pending);

    expect(announceToDiscover).toHaveBeenCalledWith({
      endpoint: "https://directory.test/api/discover/ping",
      feedUrl: "https://example.com/latest/feed",
    });
  });

  // Not awaited: a directory takes up to twelve seconds to give up on, and the
  // last screen of setup is not a place to spend them. The outcome is recorded
  // for the settings page's status block to read back.
  it("does not hold the response while the directory answers", async () => {
    const { app, announceToDiscover, pending } = createSetupApp();
    let settled = false;
    announceToDiscover.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      settled = true;
    });

    await post(app, { discover: true });

    expect(settled).toBe(false);
    await Promise.all(pending);
    expect(settled).toBe(true);
  });

  // Nothing to tell a directory that was never told anything: going from unset
  // to `off` leaves the site exactly as unlisted as it already was.
  it("announces nothing when the setting service reports no change", async () => {
    const { app, announceToDiscover, pending } = createSetupApp({
      shouldAnnounce: false,
    });

    await post(app, { discover: false });
    await Promise.all(pending);

    expect(announceToDiscover).not.toHaveBeenCalled();
  });

  it("announces nothing from a demo site", async () => {
    const { app, announceToDiscover, pending } = createSetupApp({
      demoMode: true,
    });

    await post(app, { discover: true });
    await Promise.all(pending);

    expect(announceToDiscover).not.toHaveBeenCalled();
  });
});
