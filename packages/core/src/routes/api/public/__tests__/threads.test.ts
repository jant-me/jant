import { describe, expect, it } from "vitest";
import { createTestApp } from "../../../../__tests__/helpers/app.js";
import { enforceD1BoundParameterLimit } from "../../../../__tests__/helpers/db.js";
import {
  walkPostPages,
  walkThreadPages,
} from "../../../../__tests__/helpers/cursor-walk.js";
import type { CreatePost, Post } from "../../../../types.js";
import { publicArchiveApiRoutes } from "../archive.js";
import { publicPostsApiRoutes } from "../posts.js";
import { publicThreadsApiRoutes } from "../threads.js";

const DAY = 86_400;
const BASE = Date.UTC(2025, 0, 1) / 1000;
const day = (n: number) => BASE + n * DAY;

function setup() {
  const testApp = createTestApp({ authenticated: false });
  testApp.app.route("/api/public/threads", publicThreadsApiRoutes);
  testApp.app.route("/api/public/posts", publicPostsApiRoutes);
  testApp.app.route("/api/public/archive", publicArchiveApiRoutes);
  const { services } = testApp;
  const post = (data: Partial<CreatePost>) =>
    services.posts.create({ format: "note", bodyMarkdown: "body", ...data });
  /** A root and `replies` replies, one a day, each created when published. */
  const thread = async (replies: number, root: Partial<CreatePost> = {}) => {
    const first = await post({
      publishedAt: day(0),
      createdAt: day(0),
      ...root,
    });
    const all: Post[] = [first];
    let parent = first;
    for (let i = 1; i <= replies; i++) {
      parent = await post({
        replyToId: parent.id,
        publishedAt: day(i),
        createdAt: day(i),
      });
      all.push(parent);
    }
    return all;
  };
  const get = async (path: string) => {
    const res = await testApp.app.request(path);
    return { status: res.status, headers: res.headers, body: await res.json() };
  };
  return { ...testApp, post, thread, get };
}

const ids = (items: Array<{ id: string }>) => items.map((item) => item.id);

describe("GET /api/public/threads", () => {
  it("lists what the homepage lists, as Thread objects", async () => {
    const { post, thread, get } = setup();
    const [root, reply] = await thread(1);
    const lone = await post({ publishedAt: day(5) });
    await post({ publishedAt: day(6), visibility: "latest_hidden" });
    await post({ publishedAt: day(7), visibility: "private" });

    const { status, body } = await get("/api/public/threads");
    expect(status).toBe(200);
    expect(ids(body.threads)).toEqual([lone.id, root?.id]);
    expect(body.nextCursor).toBeNull();

    const [loneThread, rootThread] = body.threads;
    expect(rootThread).toMatchObject({
      id: root?.id,
      postCount: 2,
      lastActivityAt: reply?.publishedAt,
      root: { id: root?.id, threadPostCount: 2, permalink: `/${root?.slug}` },
    });
    expect(rootThread.fold).toBeUndefined();
    expect(loneThread.postCount).toBe(1);
  });

  it("attaches the homepage fold on request", async () => {
    const { post, thread, get } = setup();
    const all = await thread(8);
    const lone = await post({ publishedAt: day(1) });

    const { body } = await get("/api/public/threads?include=fold&sort=oldest");
    const [long, single] = body.threads;
    expect(long.id).toBe(all[0]?.id);
    expect(ids(long.fold.leading)).toEqual(ids(all.slice(1, 3)));
    expect(long.fold.hidden).toBe(3);
    expect(long.fold.gap).toEqual({
      id: all[3]?.id,
      slug: all[3]?.slug,
      permalink: `/${all[3]?.slug}`,
    });
    // Oldest first, the newest reply last.
    expect(ids(long.fold.trailing)).toEqual(ids(all.slice(6)));
    expect(long.fold.trailing[2].threadPostCount).toBe(9);

    expect(single.id).toBe(lone.id);
    expect(single.fold).toEqual({
      leading: [],
      hidden: 0,
      gap: null,
      trailing: [],
    });
  });

  it("opens the run a fold hides with one request", async () => {
    const { thread, get, app } = setup();
    const all = await thread(10);
    const {
      body: { threads },
    } = await get("/api/public/threads?include=fold");
    const fold = threads[0].fold;
    const lastLeading = fold.leading[fold.leading.length - 1].id;

    const { body } = await get(
      `/api/public/threads/${all[0]?.slug}/posts?cursor=${lastLeading}&limit=${fold.hidden}`,
    );
    expect(body.posts[0].id).toBe(fold.gap.id);
    expect(ids(body.posts)).toEqual(ids(all.slice(3, 3 + fold.hidden)));

    expect(
      await walkPostPages(app, `/api/public/threads/${all[0]?.slug}/posts`, 3),
    ).toEqual(ids(all));
  });

  it("widens to every visibility a reader may see with visibility=any", async () => {
    const { post, get } = setup();
    const shown = await post({ publishedAt: day(1) });
    const hidden = await post({
      publishedAt: day(2),
      visibility: "latest_hidden",
    });
    await post({ publishedAt: day(3), visibility: "private" });

    const any = await get("/api/public/threads?visibility=any");
    expect(ids(any.body.threads)).toEqual([hidden.id, shown.id]);
    const only = await get("/api/public/threads?visibility=hidden");
    expect(ids(only.body.threads)).toEqual([hidden.id]);
  });

  it("walks a whole site in publication order", async () => {
    const { post, thread, app } = setup();
    const [old] = await thread(1);
    await post({ publishedAt: day(4), visibility: "latest_hidden" });
    await post({ publishedAt: day(3), pinned: true });
    await post({ publishedAt: day(2) });

    const full = await app.request(
      "/api/public/threads?visibility=any&sort=published&limit=100",
    );
    const expected = ids((await full.json()).threads);
    expect(expected).toHaveLength(4);
    expect(expected[3]).toBe(old?.id);
    expect(
      await walkThreadPages(
        app,
        "/api/public/threads?visibility=any&sort=published",
        1,
      ),
    ).toEqual(expected);
  });

  it("takes the archive's filters", async () => {
    const { services, post, get } = setup();
    const collection = await services.collections.create({
      slug: "books",
      title: "Books",
    });
    const titled = await post({
      title: "A title",
      publishedAt: day(1),
      collectionIds: [collection.id],
    });
    await post({ publishedAt: day(2), collectionIds: [collection.id] });
    await post({ title: "Elsewhere", publishedAt: day(3) });

    const { body } = await get(
      "/api/public/threads?collection=books&title=any",
    );
    expect(ids(body.threads)).toEqual([titled.id]);
    const missing = await get("/api/public/threads?collection=nope");
    expect(missing.status).toBe(200);
    expect(missing.body).toEqual({ threads: [], nextCursor: null });
  });

  it.each([
    ["an unknown parameter", "?sorting=published"],
    ["visibility=all", "?visibility=all"],
    ["visibility=private", "?visibility=private"],
    ["an unknown include", "?include=replies"],
    ["an unknown sort", "?sort=newest"],
    ["featured with another order", "?visibility=featured&sort=activity"],
  ])("refuses %s", async (_label, query) => {
    const { get } = setup();
    const { status, body } = await get(`/api/public/threads${query}`);
    expect(status).toBe(400);
    expect(typeof body.error).toBe("string");
  });

  // D1 refuses a statement with more than 100 bound parameters, and a full
  // page with the fold asks about 100 Threads at once.
  it("serves a full page with the fold within D1's parameter limit", async () => {
    const { services, sqlite, get } = setup();
    for (let i = 0; i < 101; i++) {
      const root = await services.posts.create({
        format: "note",
        bodyMarkdown: `root ${i}`,
        publishedAt: day(i),
      });
      if (i % 10 === 0) {
        await services.posts.create({
          format: "note",
          bodyMarkdown: `reply ${i}`,
          replyToId: root.id,
          publishedAt: day(i) + 1,
        });
      }
    }
    enforceD1BoundParameterLimit(sqlite);

    const { status, body } = await get(
      "/api/public/threads?limit=100&include=fold",
    );
    expect(status).toBe(200);
    expect(body.threads).toHaveLength(100);
    expect(
      body.threads.filter(
        (thread: { fold: { trailing: unknown[] } }) =>
          thread.fold.trailing.length === 1,
      ),
    ).toHaveLength(10);
    expect(body.nextCursor).not.toBeNull();
  });

  it("returns Markdown on request", async () => {
    const { post, get } = setup();
    await post({ publishedAt: day(1), bodyMarkdown: "Some *text*" });
    const { body } = await get("/api/public/threads?content=markdown");
    expect(body.threads[0].root.bodyMarkdown).toBe("Some *text*");
    expect(body.threads[0].root.bodyHtml).toBeUndefined();
  });
});

describe("GET /api/public/threads/:slug", () => {
  it("returns the Thread any of its Posts names", async () => {
    const { thread, get } = setup();
    const all = await thread(2);
    const { status, body } = await get(
      `/api/public/threads/${all[2]?.slug}?include=fold`,
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({ id: all[0]?.id, postCount: 3 });
    expect(ids(body.fold.leading)).toEqual(ids(all.slice(1, 2)));
    expect(ids(body.fold.trailing)).toEqual(ids(all.slice(2)));
  });

  it("finds a Thread hidden from Latest", async () => {
    const { thread, get } = setup();
    const [root] = await thread(0, { visibility: "latest_hidden" });
    expect((await get(`/api/public/threads/${root?.slug}`)).status).toBe(200);
  });

  it("returns 404 for what a reader can't see", async () => {
    const { services, post, thread, get } = setup();
    const secret = await post({ publishedAt: day(1), visibility: "private" });
    const draft = await post({ status: "draft" });
    const all = await thread(1);
    const unsent = await services.posts.create({
      format: "note",
      bodyMarkdown: "unsent",
      replyToId: all[1]?.id,
      status: "draft",
    });

    for (const slug of [secret.slug, draft.slug, unsent.slug, "missing"]) {
      expect((await get(`/api/public/threads/${slug}`)).status).toBe(404);
      expect((await get(`/api/public/threads/${slug}/posts`)).status).toBe(404);
    }
  });
});

describe("GET /api/public/threads/:slug/posts", () => {
  it("lists published Posts in Thread order", async () => {
    const { services, thread, get } = setup();
    const all = await thread(3);
    await services.posts.create({
      format: "note",
      bodyMarkdown: "unsent",
      replyToId: all[3]?.id,
      status: "draft",
    });

    const { body } = await get(`/api/public/threads/${all[1]?.slug}/posts`);
    expect(ids(body.posts)).toEqual(ids(all));
    expect(body.posts[0].threadPostCount).toBe(4);
    expect(body.nextCursor).toBeNull();
  });

  it("pages a Thread longer than one page", async () => {
    const { thread, get, sqlite } = setup();
    const all = await thread(104);
    enforceD1BoundParameterLimit(sqlite);

    const path = `/api/public/threads/${all[0]?.slug}/posts`;
    const first = await get(path);
    expect(first.status).toBe(200);
    expect(first.body.posts).toHaveLength(100);
    expect(first.body.posts[0].threadPostCount).toBe(105);
    const second = await get(`${path}?cursor=${first.body.nextCursor}`);
    expect(second.body.nextCursor).toBeNull();
    expect([...ids(first.body.posts), ...ids(second.body.posts)]).toEqual(
      ids(all),
    );
  });

  it("refuses a cursor that names a Post outside the Thread", async () => {
    const { post, thread, get } = setup();
    const all = await thread(1);
    const other = await post({ publishedAt: day(3) });
    const { status } = await get(
      `/api/public/threads/${all[0]?.slug}/posts?cursor=${other.id}`,
    );
    expect(status).toBe(400);
  });
});

describe("deprecated Thread lists", () => {
  it.each([
    ["/api/public/posts", "</api/public/threads>"],
    [
      "/api/public/archive",
      "</api/public/threads?visibility=any&sort=published>",
    ],
  ])(
    "%s names its replacement and still answers as before",
    async (path, successor) => {
      const { thread, get } = setup();
      const [root] = await thread(2);

      const { status, headers, body } = await get(path);
      expect(status).toBe(200);
      expect(headers.get("Deprecation")).toMatch(/^@\d+$/);
      expect(headers.get("Link")).toBe(`${successor}; rel="successor-version"`);
      expect(ids(body.posts)).toEqual([root?.id]);
      expect(body.posts[0].threadPostCount).toBe(3);

      // Errors carry the headers too.
      const refused = await get(`${path}?limit=0`);
      expect(refused.status).toBe(400);
      expect(refused.headers.get("Deprecation")).toMatch(/^@\d+$/);
    },
  );

  it("leaves the single-post endpoint undeprecated", async () => {
    const { thread, get } = setup();
    const all = await thread(1);
    const { status, headers, body } = await get(
      `/api/public/posts/${all[1]?.slug}`,
    );
    expect(status).toBe(200);
    expect(headers.get("Deprecation")).toBeNull();
    expect(body.threadPostCount).toBe(2);
  });
});
