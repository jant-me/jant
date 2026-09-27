import { describe, expect, it } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { walkThreadPages } from "../../../__tests__/helpers/cursor-walk.js";
import type { CreatePost } from "../../../types.js";
import { threadsApiRoutes } from "../threads.js";

const DAY = 86_400;
const BASE = Date.UTC(2025, 0, 1) / 1000;
const day = (n: number) => BASE + n * DAY;

function setup(authenticated = true) {
  const testApp = createTestApp({ authenticated });
  testApp.app.route("/api/threads", threadsApiRoutes);
  const post = (data: Partial<CreatePost>) =>
    testApp.services.posts.create({
      format: "note",
      bodyMarkdown: "body",
      ...data,
    });
  const get = async (path: string) => {
    const res = await testApp.app.request(path);
    return { status: res.status, body: await res.json() };
  };
  return { ...testApp, post, get };
}

const ids = (items: Array<{ id: string }>) => items.map((item) => item.id);

describe("Threads API Routes", () => {
  it.each(["/api/threads", "/api/threads/pst_x", "/api/threads/pst_x/posts"])(
    "requires authentication for %s",
    async (path) => {
      const { app } = setup(false);
      expect((await app.request(path)).status).toBe(401);
    },
  );

  it("lists every visibility by default, in the editing view", async () => {
    const { post, get } = setup();
    const shown = await post({ publishedAt: day(1) });
    const hidden = await post({
      publishedAt: day(2),
      visibility: "latest_hidden",
    });
    const secret = await post({ publishedAt: day(3), visibility: "private" });
    await post({ status: "draft" });

    const { status, body } = await get("/api/threads");
    expect(status).toBe(200);
    expect(ids(body.threads)).toEqual([secret.id, hidden.id, shown.id]);
    expect(body.threads[0].root).toMatchObject({
      id: secret.id,
      body: expect.any(String),
      displayTitle: expect.any(String),
      threadPostCount: 1,
    });

    const privateOnly = await get("/api/threads?visibility=private");
    expect(ids(privateOnly.body.threads)).toEqual([secret.id]);
  });

  it("lists drafts by status", async () => {
    const { post, get } = setup();
    const draft = await post({ status: "draft" });
    await post({ publishedAt: day(1) });
    const { body } = await get("/api/threads?status=draft");
    expect(ids(body.threads)).toEqual([draft.id]);
    expect(body.threads[0].postCount).toBe(0);
  });

  it("walks with a cursor", async () => {
    const { post, get, app } = setup();
    for (let i = 0; i < 4; i++) await post({ publishedAt: day(i) });
    const { body } = await get("/api/threads?sort=published&limit=100");
    expect(
      await walkThreadPages(app, "/api/threads?sort=published", 1),
    ).toEqual(ids(body.threads));
  });

  it("returns a Thread, drafts included, by any of its Posts", async () => {
    const { post, get } = setup();
    const draft = await post({ status: "draft" });
    const root = await post({ publishedAt: day(1) });
    const reply = await post({ replyToId: root.id, publishedAt: day(2) });

    const found = await get(`/api/threads/${reply.id}?include=fold`);
    expect(found.status).toBe(200);
    expect(found.body).toMatchObject({ id: root.id, postCount: 2 });
    expect(found.body.fold).toEqual({
      leading: [],
      hidden: 0,
      gap: null,
      trailing: [expect.objectContaining({ id: reply.id })],
    });

    expect((await get(`/api/threads/${draft.id}`)).status).toBe(200);
    expect((await get("/api/threads/not-an-id")).status).toBe(400);
    expect(
      (await get("/api/threads/pst_01jpyx3m7gw4w3h7m4bknq0v1d")).status,
    ).toBe(404);
  });

  it("lists a Thread's Posts by status", async () => {
    const { post, get } = setup();
    const root = await post({ publishedAt: day(1) });
    const reply = await post({ replyToId: root.id, publishedAt: day(2) });
    const unsent = await post({ replyToId: reply.id, status: "draft" });

    const published = await get(`/api/threads/${root.id}/posts`);
    expect(ids(published.body.posts)).toEqual([root.id, reply.id]);
    expect(published.body.posts[1].threadPostCount).toBe(2);
    const drafts = await get(`/api/threads/${root.id}/posts?status=draft`);
    expect(ids(drafts.body.posts)).toEqual([unsent.id]);
  });
});
