import { afterEach, describe, it, expect, vi } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { SETTINGS_KEYS } from "../../../lib/constants.js";
import { MAX_SITE_FOOTER_LENGTH } from "../../../types.js";
import { settingsApiRoutes } from "../settings.js";

function createMockStorage() {
  return {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Settings API Routes", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("GET /api/settings", () => {
    it("returns 401 when not authenticated", async () => {
      const { app } = createTestApp({ authenticated: false });
      app.route("/api/settings", settingsApiRoutes);

      const res = await app.request("/api/settings");
      expect(res.status).toBe(401);
    });

    it("returns default settings when none are stored", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/settings", settingsApiRoutes);

      const res = await app.request("/api/settings");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.settings).toBeDefined();
      expect(body.settings.SITE_NAME).toBe("Jant");
      expect(body.settings.SITE_DESCRIPTION).toBe("");
      expect(body.settings.SITE_LANGUAGE).toBe("en");
      expect(body.settings.PAGE_SIZE).toBe("25");
      expect(body.settings.SEARCH_PAGE_SIZE).toBe("25");
      expect(body.settings.ARCHIVE_PAGE_SIZE).toBe("25");
      expect(body.settings.RSS_PUBLISH_DELAY_SECONDS).toBe("0");
    });

    it("returns stored settings overriding defaults", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/settings", settingsApiRoutes);

      await services.settings.set("SITE_NAME" as never, "My Blog");

      const res = await app.request("/api/settings");
      const body = await res.json();

      expect(body.settings.SITE_NAME).toBe("My Blog");
    });

    it("does not include env-only settings", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/settings", settingsApiRoutes);

      const res = await app.request("/api/settings");
      const body = await res.json();

      // Env-only keys should not be in the response
      expect(body.settings.AUTH_SECRET).toBeUndefined();
      expect(body.settings.SITE_ORIGIN).toBeUndefined();
      expect(body.settings.SITE_PATH_PREFIX).toBeUndefined();
    });

    it("does not include internal settings", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/settings", settingsApiRoutes);

      await services.settings.set(
        SETTINGS_KEYS.DISCOVERY_COMPOSE_OPEN_SHORTCUT_AT,
        "1773964800",
      );

      const res = await app.request("/api/settings");
      const body = await res.json();

      expect(body.settings.DISCOVERY_COMPOSE_OPEN_SHORTCUT_AT).toBeUndefined();
    });

    it("returns NOINDEX as locked on in demo mode", async () => {
      const { app } = createTestApp({ authenticated: true, demoMode: true });
      app.route("/api/settings", settingsApiRoutes);

      const res = await app.request("/api/settings");
      const body = await res.json();

      expect(body.settings.NOINDEX).toBe("true");
    });
  });

  describe("PUT /api/settings", () => {
    it("returns 401 when not authenticated", async () => {
      const { app } = createTestApp({ authenticated: false });
      app.route("/api/settings", settingsApiRoutes);

      const res = await app.request("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ SITE_NAME: "New Name" }),
      });

      expect(res.status).toBe(401);
    });

    it("updates editable settings", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/settings", settingsApiRoutes);

      const res = await app.request("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ SITE_NAME: "Updated Blog" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.settings.SITE_NAME).toBe("Updated Blog");
    });

    it("trims site text settings before storing them", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/settings", settingsApiRoutes);

      const res = await app.request("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ SITE_NAME: "  Updated Blog  " }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.settings.SITE_NAME).toBe("Updated Blog");
    });

    it("normalizes legacy timezone values to canonical IANA identifiers", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/settings", settingsApiRoutes);

      const res = await app.request("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ TIME_ZONE: "Beijing" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.settings.TIME_ZONE).toBe("Asia/Shanghai");
    });

    it("rejects unsupported timezone values", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/settings", settingsApiRoutes);

      const res = await app.request("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ TIME_ZONE: "+8" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Choose a valid time zone.");
    });

    it("rejects site footer values beyond the maximum length", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/settings", settingsApiRoutes);

      const res = await app.request("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          SITE_FOOTER: "x".repeat(MAX_SITE_FOOTER_LENGTH + 1),
        }),
      });

      expect(res.status).toBe(400);
    });

    it("rejects env-only keys", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/settings", settingsApiRoutes);

      const res = await app.request("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ AUTH_SECRET: "should-not-work" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.details.rejectedKeys).toContain("AUTH_SECRET");
    });

    it("rejects the multilingual keys, which only the language page may write", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/settings", settingsApiRoutes);

      const res = await app.request("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          MULTILINGUAL_ENABLED: "true",
          ADDITIONAL_LANGUAGES: "en",
        }),
      });

      // Writing these directly would skip the confirmation that stamps
      // existing posts and the URL-prefix conflict check.
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.details.rejectedKeys).toContain("MULTILINGUAL_ENABLED");
      expect(body.details.rejectedKeys).toContain("ADDITIONAL_LANGUAGES");
    });

    it("rejects internal keys", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/settings", settingsApiRoutes);

      const res = await app.request("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          DISCOVERY_COMPOSE_OPEN_SHORTCUT_AT: "1773964800",
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.details.rejectedKeys).toContain(
        "DISCOVERY_COMPOSE_OPEN_SHORTCUT_AT",
      );
    });

    it("partially applies when mixing editable and env-only keys", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/settings", settingsApiRoutes);

      const res = await app.request("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          SITE_NAME: "Mixed Update",
          AUTH_SECRET: "ignored",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.settings.SITE_NAME).toBe("Mixed Update");
      expect(body.rejectedKeys).toContain("AUTH_SECRET");
    });

    it("returns 400 for invalid body", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/settings", settingsApiRoutes);

      const res = await app.request("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify("not an object"),
      });

      expect(res.status).toBe(400);
    });

    it("rejects invalid boolean and enum values", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/settings", settingsApiRoutes);

      const booleanResponse = await app.request("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ SHOW_JANT_BRANDING_ON_HOME: "yes" }),
      });
      expect(booleanResponse.status).toBe(400);
      expect((await booleanResponse.json()).error).toContain("true or false");

      const enumResponse = await app.request("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ MAIN_RSS_FEED: "popular" }),
      });
      expect(enumResponse.status).toBe(400);
      expect((await enumResponse.json()).error).toContain("available options");
    });

    it("validates and canonicalizes bounded integer settings", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/settings", settingsApiRoutes);

      const validResponse = await app.request("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          PAGE_SIZE: "80",
          SUMMARY_MAX_PARAGRAPHS: "20",
          SUMMARY_MAX_CHARS: "1200",
          RSS_FEED_LIMIT: "150",
          RSS_PUBLISH_DELAY_SECONDS: "0",
        }),
      });
      expect(validResponse.status).toBe(200);
      await expect(validResponse.json()).resolves.toMatchObject({
        settings: {
          PAGE_SIZE: "80",
          SEARCH_PAGE_SIZE: "80",
          ARCHIVE_PAGE_SIZE: "80",
          SUMMARY_MAX_PARAGRAPHS: "20",
          SUMMARY_MAX_CHARS: "1200",
          RSS_FEED_LIMIT: "150",
          RSS_PUBLISH_DELAY_SECONDS: "0",
        },
      });

      for (const [key, value] of [
        ["PAGE_SIZE", "101"],
        ["SEARCH_PAGE_SIZE", "1.5"],
        ["SUMMARY_MAX_PARAGRAPHS", "51"],
        ["SUMMARY_MAX_CHARS", "1501"],
        ["RSS_FEED_LIMIT", "201"],
        ["RSS_PUBLISH_DELAY_SECONDS", "7201"],
      ]) {
        const response = await app.request("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [key]: value }),
        });
        expect(response.status).toBe(400);
      }
    });

    it("validates and canonicalizes content language tags", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/settings", settingsApiRoutes);

      const validResponse = await app.request("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ SITE_LANGUAGE: "zh-hans" }),
      });
      expect(validResponse.status).toBe(200);
      expect((await validResponse.json()).settings.SITE_LANGUAGE).toBe(
        "zh-Hans",
      );

      const invalidResponse = await app.request("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ SITE_LANGUAGE: "not_a_language" }),
      });
      expect(invalidResponse.status).toBe(400);
    });

    it("rejects NOINDEX updates in demo mode", async () => {
      const { app } = createTestApp({ authenticated: true, demoMode: true });
      app.route("/api/settings", settingsApiRoutes);

      const res = await app.request("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ NOINDEX: "" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.details.rejectedKeys).toContain("NOINDEX");
    });

    it("partially applies non-demo settings while rejecting NOINDEX in demo mode", async () => {
      const { app } = createTestApp({ authenticated: true, demoMode: true });
      app.route("/api/settings", settingsApiRoutes);

      const res = await app.request("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          SITE_NAME: "Demo Blog",
          NOINDEX: "",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.settings.SITE_NAME).toBe("Demo Blog");
      expect(body.settings.NOINDEX).toBe("true");
      expect(body.rejectedKeys).toContain("NOINDEX");
    });
  });

  describe("DELETE /api/settings/:key", () => {
    it("returns 401 when not authenticated", async () => {
      const { app } = createTestApp({ authenticated: false });
      app.route("/api/settings", settingsApiRoutes);

      const res = await app.request("/api/settings/SITE_NAME", {
        method: "DELETE",
      });

      expect(res.status).toBe(401);
    });

    it("removes an override and returns the fallback value", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/settings", settingsApiRoutes);
      await services.settings.set("SITE_NAME", "Custom name");

      const res = await app.request("/api/settings/SITE_NAME", {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      expect(await services.settings.get("SITE_NAME")).toBeNull();
      const body = await res.json();
      expect(body.settings.SITE_NAME).toBe("Jant");
      expect(body.setting).toMatchObject({
        key: "SITE_NAME",
        value: "Jant",
        modified: false,
      });
    });

    it("resets search page size to the current page-size setting", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/settings", settingsApiRoutes);
      await services.settings.set("PAGE_SIZE", "80");
      await services.settings.set("SEARCH_PAGE_SIZE", "25");

      const res = await app.request("/api/settings/SEARCH_PAGE_SIZE", {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      expect(await services.settings.get("SEARCH_PAGE_SIZE")).toBeNull();
      const body = await res.json();
      expect(body.settings.SEARCH_PAGE_SIZE).toBe("80");
      expect(body.setting).toMatchObject({
        key: "SEARCH_PAGE_SIZE",
        value: "80",
        fallbackValue: "80",
        modified: false,
      });
    });

    it("removes a safe linked scalar override and returns its fallback", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/settings", settingsApiRoutes);
      await services.settings.set("THEME", "paper");

      const res = await app.request("/api/settings/THEME", {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      expect(await services.settings.get("THEME")).toBeNull();
      const body = await res.json();
      expect(body.settings.THEME).toBeUndefined();
      expect(body.setting).toMatchObject({
        key: "THEME",
        mode: "link",
        value: "tufte",
        modified: false,
        resettable: true,
      });
    });

    it("resets an API-editable textarea setting through its linked editor state", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/settings", settingsApiRoutes);
      await services.settings.set("SITE_DESCRIPTION", "A longer introduction");

      const res = await app.request("/api/settings/SITE_DESCRIPTION", {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      expect(await services.settings.get("SITE_DESCRIPTION")).toBeNull();
      const body = await res.json();
      expect(body.settings.SITE_DESCRIPTION).toBe("");
      expect(body.setting).toMatchObject({
        key: "SITE_DESCRIPTION",
        mode: "link",
        value: "false",
        modified: false,
        resettable: true,
        settingsPath: "/settings/general",
      });
    });

    it("rejects unsafe, specialized, and demo-locked keys", async () => {
      const standard = createTestApp({ authenticated: true });
      standard.app.route("/api/settings", settingsApiRoutes);

      for (const key of [
        "AUTH_SECRET",
        "GITHUB_SYNC_TOKEN",
        "CUSTOM_CSS",
        "SITE_AVATAR",
      ]) {
        const res = await standard.app.request(`/api/settings/${key}`, {
          method: "DELETE",
        });
        expect(res.status).toBe(400);
        expect((await res.json()).details.rejectedKeys).toContain(key);
      }

      const demo = createTestApp({ authenticated: true, demoMode: true });
      demo.app.route("/api/settings", settingsApiRoutes);
      const demoResponse = await demo.app.request("/api/settings/NOINDEX", {
        method: "DELETE",
      });
      expect(demoResponse.status).toBe(400);
    });
  });

  describe("PUT /api/settings/import", () => {
    it("returns 401 when not authenticated", async () => {
      const { app } = createTestApp({ authenticated: false });
      app.route("/api/settings", settingsApiRoutes);

      const res = await app.request("/api/settings/import", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ THEME: "paper" }),
      });

      expect(res.status).toBe(401);
    });

    it("stores whitelisted internal settings", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/settings", settingsApiRoutes);

      const res = await app.request("/api/settings/import", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          THEME: "paper",
          FONT_THEME: "serif",
          THEME_MODE: "dark",
          CUSTOM_CSS: "body { color: red; }",
          SHOW_HEADER_AVATAR: "true",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      expect(await services.settings.get("THEME")).toBe("paper");
      expect(await services.settings.get("FONT_THEME")).toBe("serif");
      expect(await services.settings.get("THEME_MODE")).toBe("dark");
      expect(await services.settings.get("CUSTOM_CSS")).toBe(
        "body { color: red; }",
      );
      expect(await services.settings.get("SHOW_HEADER_AVATAR")).toBe("true");
    });

    it("rejects non-whitelisted internal keys", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/settings", settingsApiRoutes);

      const res = await app.request("/api/settings/import", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          SITE_AVATAR: "media/sit/assets/avatar/avatar.png",
          SITE_FAVICON_ICO: "ZmFrZQ==",
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.details.rejectedKeys).toContain("SITE_AVATAR");
      expect(body.details.rejectedKeys).toContain("SITE_FAVICON_ICO");
    });

    it("rejects regular editable keys (caller should use PUT /api/settings)", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/settings", settingsApiRoutes);

      const res = await app.request("/api/settings/import", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ SITE_NAME: "Blog" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.details.rejectedKeys).toContain("SITE_NAME");
    });

    it("partially applies when mixing whitelisted and unknown keys", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/settings", settingsApiRoutes);

      const res = await app.request("/api/settings/import", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          THEME: "paper",
          SITE_NAME: "ignored",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.rejectedKeys).toContain("SITE_NAME");
      expect(await services.settings.get("THEME")).toBe("paper");
    });
  });

  describe("POST /api/settings/discovery/compose-open-shortcut", () => {
    it("returns 401 when not authenticated", async () => {
      const { app } = createTestApp({ authenticated: false });
      app.route("/api/settings", settingsApiRoutes);

      const res = await app.request(
        "/api/settings/discovery/compose-open-shortcut",
        {
          method: "POST",
        },
      );

      expect(res.status).toBe(401);
    });

    it("stores the completion timestamp once", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-20T00:00:00Z"));

      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/settings", settingsApiRoutes);

      const first = await app.request(
        "/api/settings/discovery/compose-open-shortcut",
        {
          method: "POST",
        },
      );

      expect(first.status).toBe(201);
      expect(
        await services.settings.get(
          SETTINGS_KEYS.DISCOVERY_COMPOSE_OPEN_SHORTCUT_AT,
        ),
      ).toBe("1773964800");

      vi.setSystemTime(new Date("2026-03-21T00:00:00Z"));

      const second = await app.request(
        "/api/settings/discovery/compose-open-shortcut",
        {
          method: "POST",
        },
      );

      expect(second.status).toBe(200);
      expect(
        await services.settings.get(
          SETTINGS_KEYS.DISCOVERY_COMPOSE_OPEN_SHORTCUT_AT,
        ),
      ).toBe("1773964800");
    });
  });

  describe("POST /api/settings/discovery/slash-command", () => {
    it("returns 401 when not authenticated", async () => {
      const { app } = createTestApp({ authenticated: false });
      app.route("/api/settings", settingsApiRoutes);

      const res = await app.request("/api/settings/discovery/slash-command", {
        method: "POST",
      });

      expect(res.status).toBe(401);
    });

    it("stores the completion timestamp once", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-20T00:00:00Z"));

      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/settings", settingsApiRoutes);

      const first = await app.request("/api/settings/discovery/slash-command", {
        method: "POST",
      });

      expect(first.status).toBe(201);
      expect(
        await services.settings.get(SETTINGS_KEYS.DISCOVERY_SLASH_COMMAND_AT),
      ).toBe("1773964800");

      vi.setSystemTime(new Date("2026-03-21T00:00:00Z"));

      const second = await app.request(
        "/api/settings/discovery/slash-command",
        {
          method: "POST",
        },
      );

      expect(second.status).toBe(200);
      expect(
        await services.settings.get(SETTINGS_KEYS.DISCOVERY_SLASH_COMMAND_AT),
      ).toBe("1773964800");
    });

    it("is not exposed through GET /api/settings", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/settings", settingsApiRoutes);

      await services.settings.set(
        SETTINGS_KEYS.DISCOVERY_SLASH_COMMAND_AT,
        "1773964800",
      );

      const res = await app.request("/api/settings");
      const body = await res.json();

      expect(body.settings.DISCOVERY_SLASH_COMMAND_AT).toBeUndefined();
    });
  });

  describe("POST /api/settings/avatar", () => {
    it("returns 401 when not authenticated", async () => {
      const storage = createMockStorage();
      const { app } = createTestApp({
        authenticated: false,
        storage,
      });
      app.route("/api/settings", settingsApiRoutes);

      const formData = new FormData();
      formData.append(
        "file",
        new File([new Uint8Array([1, 2, 3])], "avatar.png", {
          type: "image/png",
        }),
      );

      const res = await app.request("/api/settings/avatar", {
        method: "POST",
        body: formData,
      });

      expect(res.status).toBe(401);
    });

    it("returns 500 when storage is unavailable", async () => {
      const { app } = createTestApp({
        authenticated: true,
        storage: null,
      });
      app.route("/api/settings", settingsApiRoutes);

      const formData = new FormData();
      formData.append(
        "file",
        new File([new Uint8Array([1, 2, 3])], "avatar.png", {
          type: "image/png",
        }),
      );

      const res = await app.request("/api/settings/avatar", {
        method: "POST",
        body: formData,
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain("storage");
    });

    it("returns 400 when no file is provided", async () => {
      const storage = createMockStorage();
      const { app } = createTestApp({
        authenticated: true,
        storage,
      });
      app.route("/api/settings", settingsApiRoutes);

      const res = await app.request("/api/settings/avatar", {
        method: "POST",
        body: new FormData(),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("No file selected");
    });

    it("uploads the avatar and optional apple-touch icon", async () => {
      const storage = createMockStorage();
      const { app, services } = createTestApp({
        authenticated: true,
        storage,
      });
      app.route("/api/settings", settingsApiRoutes);

      const formData = new FormData();
      formData.append(
        "file",
        new File([new Uint8Array([1, 2, 3])], "avatar.png", {
          type: "image/png",
        }),
      );
      formData.append(
        "appleTouch",
        new File([new Uint8Array([137, 80, 78, 71])], "apple-touch-icon.png", {
          type: "image/png",
        }),
      );

      const res = await app.request("/api/settings/avatar", {
        method: "POST",
        body: formData,
      });

      expect(res.status).toBe(201);
      expect(await services.settings.get("SITE_AVATAR")).toContain(
        "assets/avatar/",
      );
      expect(await services.settings.get("SITE_FAVICON_APPLE_TOUCH")).toBe(
        "media/sit_test00000000000000000000000/assets/favicon/apple-touch-icon.png",
      );
      expect(await services.settings.get("SITE_FAVICON_VERSION")).toMatch(
        /^\d{12}$/,
      );
      expect(storage.put).toHaveBeenCalledTimes(2);

      const mediaList = await services.media.list();
      expect(mediaList).toHaveLength(2);
      const originalNames = mediaList.map((entry) => entry.originalName).sort();
      expect(originalNames).toEqual(["apple-touch-icon.png", "avatar.png"]);
    });
  });

  describe("DELETE /api/settings/avatar", () => {
    it("returns 401 when not authenticated", async () => {
      const storage = createMockStorage();
      const { app } = createTestApp({
        authenticated: false,
        storage,
      });
      app.route("/api/settings", settingsApiRoutes);

      const res = await app.request("/api/settings/avatar", {
        method: "DELETE",
      });

      expect(res.status).toBe(401);
    });

    it("removes avatar-related settings", async () => {
      const storage = createMockStorage();
      const { app, services } = createTestApp({
        authenticated: true,
        storage,
      });
      app.route("/api/settings", settingsApiRoutes);

      await services.settings.set(
        "SITE_AVATAR" as never,
        "media/sit_test00000000000000000000000/assets/avatar/avatar.png",
      );
      await services.settings.set("SITE_FAVICON_ICO" as never, "ZmFrZQ==");
      await services.settings.set(
        "SITE_FAVICON_APPLE_TOUCH" as never,
        "media/sit_test00000000000000000000000/assets/favicon/apple-touch-icon.png",
      );
      await services.settings.set(
        "SITE_FAVICON_VERSION" as never,
        "202603181200",
      );

      const res = await app.request("/api/settings/avatar", {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(await services.settings.get("SITE_AVATAR")).toBeNull();
      expect(await services.settings.get("SITE_FAVICON_ICO")).toBeNull();
      expect(
        await services.settings.get("SITE_FAVICON_APPLE_TOUCH"),
      ).toBeNull();
      expect(await services.settings.get("SITE_FAVICON_VERSION")).toBeNull();
    });
  });
});
