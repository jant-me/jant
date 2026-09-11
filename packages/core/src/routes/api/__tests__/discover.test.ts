import { describe, expect, it } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { enforceD1BoundParameterLimit } from "../../../__tests__/helpers/db.js";
import { DISCOVER_STATUS_MAX_IDS } from "../../../lib/discover.js";
import { createEntityId } from "../../../lib/ids.js";
import { discoverApiRoutes } from "../discover.js";

type Status = { id: string; latest: boolean; featured: boolean };

async function setupApp(
  options: Parameters<typeof createTestApp>[0] = {},
  { discover = "latest" }: { discover?: string | null } = {},
) {
  const testApp = createTestApp({ authenticated: false, ...options });
  testApp.app.route("/api/discover", discoverApiRoutes);
  if (discover) await testApp.services.settings.set("DISCOVER", discover);
  return testApp;
}

async function ask(
  app: { request: (path: string) => Promise<Response> },
  ids: string[],
  extra = "",
): Promise<Status[]> {
  const query = ids.map((id) => `id=${id}`).join("&");
  const res = await app.request(`/api/discover/posts?${query}${extra}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { posts: Status[] };
  return body.posts;
}

describe("GET /api/discover/posts", () => {
  it("says whether each post is in the Latest and featured feeds", async () => {
    const { app, services } = await setupApp();
    const plain = await services.posts.create({
      format: "note",
      bodyMarkdown: "plain",
    });
    const featured = await services.posts.create({
      format: "note",
      bodyMarkdown: "featured",
      featured: true,
    });
    const hiddenFeatured = await services.posts.create({
      format: "note",
      bodyMarkdown: "hidden from Latest, still featured",
      visibility: "latest_hidden",
      featured: true,
    });

    expect(await ask(app, [plain.id, featured.id, hiddenFeatured.id])).toEqual([
      { id: plain.id, latest: true, featured: false },
      { id: featured.id, latest: true, featured: true },
      { id: hiddenFeatured.id, latest: false, featured: true },
    ]);
  });

  it("answers false for every way a post can be gone", async () => {
    const { app, services } = await setupApp();
    const privatePost = await services.posts.create({
      format: "note",
      bodyMarkdown: "private",
      visibility: "private",
      featured: true,
    });
    const draft = await services.posts.create({
      format: "note",
      bodyMarkdown: "draft",
      status: "draft",
    });
    const deleted = await services.posts.create({
      format: "note",
      bodyMarkdown: "deleted",
      featured: true,
    });
    await services.posts.delete(deleted.id);
    const unknown = createEntityId("post");

    const ids = [privatePost.id, draft.id, deleted.id, unknown];
    expect(await ask(app, ids)).toEqual(
      ids.map((id) => ({ id, latest: false, featured: false })),
    );
  });

  it("counts a Thread featured when a reply in it is", async () => {
    const { app, services } = await setupApp();
    const root = await services.posts.create({
      format: "note",
      bodyMarkdown: "root",
    });
    const reply = await services.posts.create({
      format: "note",
      bodyMarkdown: "featured reply",
      replyToId: root.id,
      featured: true,
    });

    // A reply is never an entry of its own, so it is in neither feed; its
    // Thread is in both.
    expect(await ask(app, [root.id, reply.id])).toEqual([
      { id: root.id, latest: true, featured: true },
      { id: reply.id, latest: false, featured: false },
    ]);
  });

  it("holds a new post back for the RSS delay, as the feeds do", async () => {
    const { app, services } = await setupApp({ rssPublishDelaySeconds: 300 });
    const currentTime = Math.floor(Date.now() / 1000);
    const settled = await services.posts.create({
      format: "note",
      bodyMarkdown: "settled",
      publishedAt: currentTime - 400,
    });
    const fresh = await services.posts.create({
      format: "note",
      bodyMarkdown: "fresh",
      publishedAt: currentTime,
    });

    expect(await ask(app, [settled.id, fresh.id])).toEqual([
      { id: settled.id, latest: true, featured: false },
      { id: fresh.id, latest: false, featured: false },
    ]);
  });

  it("scopes the answer to one language view with ?lang=", async () => {
    const { app, services } = await setupApp();
    await services.settings.set("SITE_LANGUAGE", "zh-Hans");
    await services.settings.set("ADDITIONAL_LANGUAGES", "en");
    await services.settings.set("MULTILINGUAL_ENABLED", "true");
    const english = await services.posts.create({
      format: "note",
      bodyMarkdown: "hello",
      language: "en",
    });

    expect(await ask(app, [english.id], "&lang=en")).toEqual([
      { id: english.id, latest: true, featured: false },
    ]);
    expect(await ask(app, [english.id], "&lang=zh-Hans")).toEqual([
      { id: english.id, latest: false, featured: false },
    ]);
  });

  it("answers each post once, in the order asked", async () => {
    const { app, services } = await setupApp();
    const first = await services.posts.create({
      format: "note",
      bodyMarkdown: "first",
    });
    const second = await services.posts.create({
      format: "note",
      bodyMarkdown: "second",
    });

    const answer = await ask(app, [second.id, first.id, second.id]);

    expect(answer.map((status) => status.id)).toEqual([second.id, first.id]);
  });

  it("fits a full request within D1's bound-parameter limit", async () => {
    const { app, services, sqlite } = await setupApp();
    const real = await services.posts.create({
      format: "note",
      bodyMarkdown: "real",
      featured: true,
    });
    const ids = [
      real.id,
      ...Array.from({ length: DISCOVER_STATUS_MAX_IDS - 1 }, () =>
        createEntityId("post"),
      ),
    ];
    enforceD1BoundParameterLimit(sqlite);

    const answer = await ask(app, ids);

    expect(answer).toHaveLength(DISCOVER_STATUS_MAX_IDS);
    expect(answer[0]).toEqual({ id: real.id, latest: true, featured: true });
  });

  it("rejects a request with no ids, too many, or one that is not a post ID", async () => {
    const { app } = await setupApp();
    const tooMany = Array.from(
      { length: DISCOVER_STATUS_MAX_IDS + 1 },
      () => `id=${createEntityId("post")}`,
    ).join("&");

    for (const query of [
      "",
      tooMany,
      "id=not-an-id",
      `id=${createEntityId("collection")}`,
    ]) {
      const res = await app.request(`/api/discover/posts?${query}`);
      expect(res.status, query.slice(0, 40)).toBe(400);
    }
  });

  it("is not there for a site that is not in Discover", async () => {
    const { app } = await setupApp({}, { discover: "off" });

    const res = await app.request(
      `/api/discover/posts?id=${createEntityId("post")}`,
    );

    expect(res.status).toBe(404);
  });

  it("still answers when the public JSON API is turned off", async () => {
    const { app, services } = await setupApp();
    await services.settings.set("PUBLIC_API_ENABLED", "false");
    const post = await services.posts.create({
      format: "note",
      bodyMarkdown: "listed",
    });

    expect(await ask(app, [post.id])).toEqual([
      { id: post.id, latest: true, featured: false },
    ]);
  });
});
