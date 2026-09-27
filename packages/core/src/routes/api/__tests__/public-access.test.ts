import { describe, expect, it } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { collectionsApiRoutes } from "../collections.js";
import { navItemsApiRoutes } from "../nav-items.js";
import { publicArchiveApiRoutes } from "../public/archive.js";
import { publicPostsApiRoutes } from "../public/posts.js";
import { publicThreadsApiRoutes } from "../public/threads.js";

function mountPublicReadRoutes(authenticated = false) {
  const testApp = createTestApp({ authenticated, fts: true });
  testApp.app.route("/api/public/posts", publicPostsApiRoutes);
  testApp.app.route("/api/public/archive", publicArchiveApiRoutes);
  testApp.app.route("/api/public/threads", publicThreadsApiRoutes);
  testApp.app.route("/api/collections", collectionsApiRoutes);
  testApp.app.route("/api/nav-items", navItemsApiRoutes);
  return testApp;
}

describe("public API access setting", () => {
  it.each([
    "/api/public/posts",
    "/api/public/posts/missing",
    "/api/public/archive",
    "/api/public/threads",
    "/api/public/threads/missing",
    "/api/public/threads/missing/posts",
  ])("returns 404 for %s when the public API is off", async (path) => {
    const { app, services } = mountPublicReadRoutes();
    await services.settings.set("PUBLIC_API_ENABLED", "false");

    const response = await app.request(path);

    expect(response.status).toBe(404);
  });

  it("does not let an authenticated session bypass the public API switch", async () => {
    const { app, services } = mountPublicReadRoutes(true);
    await services.settings.set("PUBLIC_API_ENABLED", "false");

    expect((await app.request("/api/public/posts")).status).toBe(404);
    expect((await app.request("/api/public/archive")).status).toBe(404);
  });

  it("does not let a Bearer token bypass the public API switch", async () => {
    const { app, services } = mountPublicReadRoutes();
    await services.settings.set("PUBLIC_API_ENABLED", "false");
    const { plaintext } = await services.apiTokens.create("Test client");

    const response = await app.request("/api/public/posts", {
      headers: { Authorization: `Bearer ${plaintext}` },
    });

    expect(response.status).toBe(404);
  });

  it.each([
    "/api/collections",
    "/api/collections/not-a-typeid",
    "/api/nav-items",
  ])(
    "requires authentication for %s when anonymous reads are off",
    async (path) => {
      const { app, services } = mountPublicReadRoutes();
      await services.settings.set("PUBLIC_API_ENABLED", "false");

      const response = await app.request(path);

      expect(response.status).toBe(401);
    },
  );

  it.each(["/api/collections", "/api/nav-items"])(
    "preserves authenticated access to shared read endpoint %s",
    async (path) => {
      const { app, services } = mountPublicReadRoutes(true);
      await services.settings.set("PUBLIC_API_ENABLED", "false");

      const response = await app.request(path);

      expect(response.status).toBe(200);
    },
  );
});
