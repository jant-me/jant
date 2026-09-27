import { describe, expect, it } from "vitest";
import { createTestApp } from "../../__tests__/helpers/app.js";
import { isRssFeedPath } from "../../lib/feed-path.js";
import {
  requirePublicApiEnabled,
  requireRssFeedsEnabled,
} from "../public-content-access.js";

describe("public content access policies", () => {
  it.each([
    "/feed",
    "/feed/latest",
    "/feed/atom.xml",
    "/latest/feed",
    "/featured/feed/atom.xml",
    "/archive/feed",
    "/reading/feed",
    "/settings-notes/feed",
    "/collections/reading+movies/feed",
  ])("recognizes %s as a feed path", (path) => {
    expect(isRssFeedPath(path)).toBe(true);
  });

  it.each([
    "/",
    "/archive",
    "/api/example/feed",
    "/settings/feed",
    "/compose/feed",
    "/_/theme/feed",
  ])("does not treat %s as a feed path", (path) => {
    expect(isRssFeedPath(path)).toBe(false);
  });

  it("returns 404 for the dedicated public API even with a session", async () => {
    const { app, services } = createTestApp({ authenticated: true });
    await services.settings.set("PUBLIC_API_ENABLED", "false");
    app.get("/api/public/data", requirePublicApiEnabled(), (c) =>
      c.json({ ok: true }),
    );

    const response = await app.request("/api/public/data");

    expect(response.status).toBe(404);
  });

  it("returns 404 for feed paths when feed publishing is off", async () => {
    const { app, services } = createTestApp();
    await services.settings.set("RSS_FEEDS_ENABLED", "false");
    app.use("*", requireRssFeedsEnabled());
    app.get("*", (c) => c.text("page"));

    expect((await app.request("/settings-notes/feed")).status).toBe(404);
    expect((await app.request("/settings/feed")).status).toBe(200);
    expect((await app.request("/settings-notes")).status).toBe(200);
  });
});
