/**
 * Tests for the Jant Discover settings routes.
 *
 * Both are POSTs with no SSR, so `settingsRoutes` can be mounted and driven
 * directly. What they are really guarding is the contract with
 * `client/settings-bridge.ts`: it sends `Accept: application/json` and parses
 * the body with `readJsonObject`, which throws on anything else — so a route
 * that answers with a Datastar toast reads to the owner as a failed save no
 * matter what the server did.
 */

import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createI18n } from "../../../i18n/index.js";
import { settingsRoutes } from "../settings.js";
import type { Bindings } from "../../../types.js";
import type { AppVariables } from "../../../types/app-context.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

function createDiscoverTestApp(
  overrides: {
    env?: Partial<Bindings>;
    storedDiscover?: string;
    demoMode?: boolean;
    rssFeedsEnabled?: boolean;
  } = {},
) {
  const announceToDiscover = vi.fn(async () => ({
    at: 0,
    ok: true,
    feedUrl: "https://blog.example/latest/feed",
  }));
  const updateDiscoverSetting = vi.fn(async () => ({ shouldAnnounce: true }));

  const app = new Hono<Env>();
  app.use("*", async (c, next) => {
    c.env = (overrides.env ?? {}) as Bindings;
    c.set("services", {
      settings: { announceToDiscover, updateDiscoverSetting },
    } as unknown as AppVariables["services"]);
    c.set("allSettings", {
      ...(overrides.storedDiscover === undefined
        ? {}
        : { DISCOVER: overrides.storedDiscover }),
    });
    c.set("isAuthenticated", true);
    c.set("appConfig", {
      demoMode: overrides.demoMode ?? false,
      noindex: false,
      rssFeedsEnabled: overrides.rssFeedsEnabled ?? true,
      siteUrl: "https://blog.example",
      sitePathPrefix: "",
    } as AppVariables["appConfig"]);
    c.set("lang", "en");
    c.set("i18n", createI18n("en"));
    await next();
  });
  app.route("/settings", settingsRoutes);

  return { app, announceToDiscover, updateDiscoverSetting };
}

function postJson(app: Hono<Env>, path: string, body: unknown = {}) {
  return app.request(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Exactly what `settings-bridge.ts` sends.
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /settings/general/discover/announce", () => {
  it("answers JSON, so the bridge does not read a success as a failure", async () => {
    const { app, announceToDiscover } = createDiscoverTestApp({
      storedDiscover: "latest",
    });

    const res = await postJson(app, "/settings/general/discover/announce");

    expect(res.status).toBe(200);
    // The assertion that matters: a parseable body. A Datastar toast is
    // `text/html`, and `readJsonObject` throws on it.
    await expect(res.json()).resolves.toMatchObject({
      status: "ok",
      toast: expect.stringContaining("Announcing your site"),
    });
    expect(announceToDiscover).toHaveBeenCalledOnce();
  });

  it("says so in JSON when there is nothing to announce to", async () => {
    const { app, announceToDiscover } = createDiscoverTestApp({
      storedDiscover: "latest",
      env: { DISCOVER_PING_URL: "" },
    });

    const res = await postJson(app, "/settings/general/discover/announce");

    await expect(res.json()).resolves.toMatchObject({
      status: "ok",
      toast: expect.stringContaining("no directory"),
    });
    expect(announceToDiscover).not.toHaveBeenCalled();
  });

  it("never announces a demo site", async () => {
    const { app, announceToDiscover } = createDiscoverTestApp({
      storedDiscover: "latest",
      demoMode: true,
    });

    await postJson(app, "/settings/general/discover/announce");

    expect(announceToDiscover).not.toHaveBeenCalled();
  });

  it("does not announce a feed address that would answer 404", async () => {
    // Feeds are off, so `/latest/feed` does not exist to be polled.
    const { app, announceToDiscover } = createDiscoverTestApp({
      storedDiscover: "latest",
      rssFeedsEnabled: false,
    });

    await postJson(app, "/settings/general/discover/announce");

    expect(announceToDiscover).not.toHaveBeenCalled();
  });

  it("still answers a Datastar toast when JSON was not asked for", async () => {
    const { app } = createDiscoverTestApp({ storedDiscover: "latest" });

    const res = await app.request("/settings/general/discover/announce", {
      method: "POST",
    });

    expect(res.headers.get("Content-Type")).toContain("text/html");
  });
});

describe("POST /settings/general/discover", () => {
  it("announces the feed the newly saved mode names, not the stored one", async () => {
    // `allSettings` is the snapshot taken before the request ran, so it still
    // holds the previous answer on the save that triggers the announcement.
    const { app, announceToDiscover } = createDiscoverTestApp({
      storedDiscover: undefined,
    });

    await postJson(app, "/settings/general/discover", {
      discover: "featured",
    });

    expect(announceToDiscover).toHaveBeenCalledWith(
      expect.objectContaining({
        feedUrl: "https://blog.example/featured/feed",
      }),
    );
  });

  it("does not announce when the save was not an opt-in", async () => {
    const { app, announceToDiscover, updateDiscoverSetting } =
      createDiscoverTestApp({ storedDiscover: "latest" });
    updateDiscoverSetting.mockResolvedValueOnce({ shouldAnnounce: false });

    await postJson(app, "/settings/general/discover", {
      discover: "featured",
    });

    expect(announceToDiscover).not.toHaveBeenCalled();
  });
});
