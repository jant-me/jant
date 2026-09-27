import { describe, expect, it } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { collectionsApiRoutes } from "../collections.js";
import { navItemsApiRoutes } from "../nav-items.js";
import { publicPostsApiRoutes } from "../public/posts.js";
import { publicThreadsApiRoutes } from "../public/threads.js";

function mountPublicReadRoutes(authenticated = false) {
  const testApp = createTestApp({ authenticated, fts: true });
  testApp.app.route("/api/public/posts", publicPostsApiRoutes);
  testApp.app.route("/api/public/threads", publicThreadsApiRoutes);
  testApp.app.route("/api/collections", collectionsApiRoutes);
  testApp.app.route("/api/nav-items", navItemsApiRoutes);
  return testApp;
}

describe("public API access setting", () => {
  /**
   * Every public read, pointed at a post that exists, so that with the
   * switch off nothing but the switch can be what answers 404.
   */
  async function publicReads(
    services: ReturnType<typeof mountPublicReadRoutes>["services"],
  ) {
    const post = await services.posts.create({
      format: "note",
      bodyMarkdown: "A public note",
      status: "published",
    });
    return [
      "/api/public/threads",
      `/api/public/threads/${post.slug}`,
      `/api/public/threads/${post.slug}/posts`,
      `/api/public/posts/${post.slug}`,
    ];
  }

  it("answers every public read while the public API is on", async () => {
    const { app, services } = mountPublicReadRoutes();
    for (const path of await publicReads(services)) {
      expect((await app.request(path)).status, path).toBe(200);
    }
  });

  it("returns 404 for every public read when the public API is off", async () => {
    const { app, services } = mountPublicReadRoutes();
    const paths = await publicReads(services);
    await services.settings.set("PUBLIC_API_ENABLED", "false");

    for (const path of paths) {
      expect((await app.request(path)).status, path).toBe(404);
    }
  });

  it("does not let an authenticated session bypass the public API switch", async () => {
    const { app, services } = mountPublicReadRoutes(true);
    await services.settings.set("PUBLIC_API_ENABLED", "false");

    expect((await app.request("/api/public/threads")).status).toBe(404);
  });

  it("does not let a Bearer token bypass the public API switch", async () => {
    const { app, services } = mountPublicReadRoutes();
    await services.settings.set("PUBLIC_API_ENABLED", "false");
    const { plaintext } = await services.apiTokens.create("Test client");

    const response = await app.request("/api/public/threads", {
      headers: { Authorization: `Bearer ${plaintext}` },
    });

    expect(response.status).toBe(404);
  });

  it.each([
    "/api/collections",
    "/api/collections/not-a-typeid",
    "/api/nav-items",
  ])(
    "keeps %s for the author, whatever the public API switch",
    async (path) => {
      // Collections and navigation were read without a token outside /public;
      // readers see them on the site's pages.
      const anonymous = mountPublicReadRoutes();
      expect((await anonymous.app.request(path)).status).toBe(401);

      const author = mountPublicReadRoutes(true);
      await author.services.settings.set("PUBLIC_API_ENABLED", "false");
      expect((await author.app.request(path)).status).not.toBe(401);
    },
  );
});
