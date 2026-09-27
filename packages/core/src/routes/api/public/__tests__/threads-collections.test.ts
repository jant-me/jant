import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestApp } from "../../../../__tests__/helpers/app.js";
import { walkThreadPages } from "../../../../__tests__/helpers/cursor-walk.js";
import { threadCollections } from "../../../../db/schema.js";
import { createEntityId } from "../../../../lib/ids.js";
import type {
  CollectionSortOrder,
  CreatePost,
  Post,
} from "../../../../types.js";
import { publicThreadsApiRoutes } from "../threads.js";

const DAY = 86_400;
const BASE = Date.UTC(2025, 0, 1) / 1000;
const day = (n: number) => BASE + n * DAY;

const ids = (items: Array<{ id: string }>) => items.map((item) => item.id);

function setup() {
  const testApp = createTestApp({ authenticated: false });
  testApp.app.route("/api/public/threads", publicThreadsApiRoutes);
  const { services } = testApp;
  const collection = (slug: string, sortOrder?: CollectionSortOrder) =>
    services.collections.create({ slug, title: slug, sortOrder });
  const post = (data: Partial<CreatePost>) =>
    services.posts.create({ format: "note", bodyMarkdown: "body", ...data });
  const get = async (path: string) => {
    const res = await testApp.app.request(path);
    return { status: res.status, body: await res.json() };
  };
  /** The Thread IDs one request lists, failing on anything but a 200. */
  const list = async (query: string) => {
    const { status, body } = await get(`/api/public/threads?${query}`);
    expect(status, query).toBe(200);
    return ids(body.threads);
  };
  return { ...testApp, collection, post, get, list };
}

describe("GET /api/public/threads with a collection", () => {
  it("lists in the collection's own order unless sort names another", async () => {
    const { collection, post, list } = setup();
    const readings = await collection("readings", "oldest");
    const older = await post({
      publishedAt: day(1),
      collectionIds: [readings.id],
    });
    const newer = await post({
      publishedAt: day(2),
      collectionIds: [readings.id],
    });

    expect(await list("collection=readings")).toEqual([older.id, newer.id]);
    expect(await list("collection=readings&sort=activity")).toEqual([
      newer.id,
      older.id,
    ]);
  });

  it("lists several collections by activity, whatever their own orders", async () => {
    const { collection, post, list } = setup();
    const tech = await collection("tech", "oldest");
    const art = await collection("art", "oldest");
    const techPost = await post({
      publishedAt: day(1),
      collectionIds: [tech.id],
    });
    const artPost = await post({
      publishedAt: day(2),
      collectionIds: [art.id],
    });
    const hiddenArt = await post({
      publishedAt: day(3),
      visibility: "latest_hidden",
      collectionIds: [art.id],
    });
    await post({ publishedAt: day(4) });

    expect(await list("collection=tech,art")).toEqual([
      artPost.id,
      techPost.id,
    ]);
    // As a plain filter, the way the archive reads it.
    expect(
      await list("collection=tech,art&visibility=any&sort=published"),
    ).toEqual([hiddenArt.id, artPost.id, techPost.id]);
  });

  it("narrows by root format, and leaves out Threads hidden from Latest unless asked", async () => {
    const { collection, post, list } = setup();
    const mixed = await collection("mixed");
    const note = await post({ publishedAt: day(1), collectionIds: [mixed.id] });
    await post({
      format: "link",
      title: "Example",
      url: "https://example.com",
      publishedAt: day(2),
      collectionIds: [mixed.id],
    });
    const hidden = await post({
      publishedAt: day(3),
      visibility: "latest_hidden",
      collectionIds: [mixed.id],
    });

    expect(await list("collection=mixed&format=note")).toEqual([note.id]);
    expect(await list("collection=mixed&format=note&visibility=any")).toEqual([
      hidden.id,
      note.id,
    ]);
    expect(await list("collection=mixed&visibility=hidden")).toEqual([
      hidden.id,
    ]);
  });

  it("orders by the ratings in a Thread's replies, page by page", async () => {
    const { app, collection, post } = setup();
    const rated = await collection("rated", "rating_desc");
    const ratedThread = async (n: number, rating: number) => {
      const root = await post({
        publishedAt: day(n),
        collectionIds: [rated.id],
      });
      await post({ replyToId: root.id, publishedAt: day(n) + 100, rating });
      return root;
    };
    // Newest activity would list these the other way round.
    const highest = await ratedThread(1, 5);
    const middle = await ratedThread(2, 3);
    const lowest = await ratedThread(3, 1);

    // The collection's own order counts ratings on replies too, as does
    // naming the order.
    for (const query of ["collection=rated", "collection=rated&sort=rating"]) {
      expect(
        await walkThreadPages(app, `/api/public/threads?${query}`, 1),
        query,
      ).toEqual([highest.id, middle.id, lowest.id]);
    }
  });

  it("walks a collection in each order the same as one unpaged request", async () => {
    const { app, db, collection, post, get } = setup();
    const walked = await collection("walked");
    const thread = (publishedAt: number, extra: Partial<CreatePost> = {}) =>
      post({ publishedAt, collectionIds: [walked.id], ...extra });

    // Pins tie on the pin time, then order by each sort's own keys.
    const pinnedA = await thread(day(1), { rating: 2 });
    const pinnedB = await thread(day(2));
    for (const pinned of [pinnedA, pinnedB]) {
      await db
        .update(threadCollections)
        .set({ pinnedAt: day(30) })
        .where(eq(threadCollections.threadId, pinned.id));
    }
    // A reply moves this Thread up under activity and rating, not oldest.
    const bumped = await thread(day(3), { rating: 4 });
    await post({ replyToId: bumped.id, publishedAt: day(20), rating: 5 });
    // Ties on publication time, activity, and rating.
    for (let i = 0; i < 3; i++) {
      await thread(day(10), { rating: 3 });
    }
    await thread(day(12));
    await thread(day(13), { visibility: "private" });
    await thread(day(14), { visibility: "latest_hidden" });

    for (const sort of ["activity", "oldest", "rating"]) {
      const path = `/api/public/threads?collection=walked&sort=${sort}`;
      const { body } = await get(`${path}&limit=100`);
      const expected = ids(body.threads);
      expect(body.nextCursor).toBeNull();
      expect(expected).toHaveLength(7);
      expect(expected.slice(0, 2).sort()).toEqual(
        [pinnedA.id, pinnedB.id].sort(),
      );
      for (const limit of [1, 2, 3]) {
        expect(await walkThreadPages(app, path, limit), sort).toEqual(expected);
      }
    }
  });

  it("keeps paging after the cursor Thread leaves the collection", async () => {
    const { services, collection, post, get } = setup();
    const shrinking = await collection("shrinking");
    const roots: Post[] = [];
    for (let n = 1; n <= 7; n++) {
      roots.push(
        await post({ publishedAt: day(n), collectionIds: [shrinking.id] }),
      );
    }
    const expected = ids(roots).reverse();
    const page = async (cursor: string | null) => {
      const query = cursor ? `&cursor=${cursor}` : "";
      const { status, body } = await get(
        `/api/public/threads?collection=shrinking&limit=2${query}`,
      );
      expect(status).toBe(200);
      return body as {
        threads: Array<{ id: string }>;
        nextCursor: string | null;
      };
    };

    // Each page ends on a Thread that is gone before the next request:
    // deleted, unpublished, then taken out of the collection.
    const page1 = await page(null);
    expect(ids(page1.threads)).toEqual(expected.slice(0, 2));
    await services.posts.delete(expected[1] ?? "");

    const page2 = await page(page1.nextCursor);
    expect(ids(page2.threads)).toEqual(expected.slice(2, 4));
    await services.posts.update(expected[3] ?? "", { status: "draft" });

    const page3 = await page(page2.nextCursor);
    expect(ids(page3.threads)).toEqual(expected.slice(4, 6));
    await services.collections.removeThread(shrinking.id, expected[5] ?? "");

    const page4 = await page(page3.nextCursor);
    expect(ids(page4.threads)).toEqual(expected.slice(6));
    expect(page4.nextCursor).toBeNull();
  });

  it("resumes from a bare root ID the collection lists, and refuses any other", async () => {
    const { services, collection, post, get } = setup();
    const legacy = await collection("legacy");
    const inCollection = (n: number, extra: Partial<CreatePost> = {}) =>
      post({ publishedAt: day(n), collectionIds: [legacy.id], ...extra });
    const first = await inCollection(1);
    const second = await inCollection(2);
    const third = await inCollection(3);

    // The bare root ID earlier releases returned as `nextCursor`.
    const resumed = await get(
      `/api/public/threads?collection=legacy&cursor=${third.id}`,
    );
    expect(resumed.status).toBe(200);
    expect(ids(resumed.body.threads)).toEqual([second.id, first.id]);
    expect(resumed.body.nextCursor).toBeNull();

    const privateRoot = await inCollection(4, { visibility: "private" });
    const hiddenRoot = await inCollection(5, { visibility: "latest_hidden" });
    const draftRoot = await post({
      status: "draft",
      collectionIds: [legacy.id],
    });
    const elsewhere = await post({ publishedAt: day(6) });
    const deleted = await inCollection(7);
    await services.posts.delete(deleted.id);

    const answers = [];
    for (const id of [
      privateRoot.id,
      hiddenRoot.id,
      draftRoot.id,
      elsewhere.id,
      deleted.id,
      createEntityId("post"),
    ]) {
      const { status, body } = await get(
        `/api/public/threads?collection=legacy&cursor=${id}`,
      );
      expect(status).toBe(400);
      expect(body.code).toBe("VALIDATION_ERROR");
      answers.push(body.error);
    }
    // Nothing in the answer tells a private Thread from one that never
    // existed.
    expect(new Set(answers).size).toBe(1);
  });

  it("refuses a cursor from another order, in the collection or out of it", async () => {
    const { collection, post, get } = setup();
    const ordered = await collection("ordered");
    for (const n of [1, 2, 3]) {
      await post({ publishedAt: day(n), collectionIds: [ordered.id] });
    }
    const cursorOf = async (query: string) =>
      (await get(`/api/public/threads?${query}`)).body.nextCursor as string;
    const own = await cursorOf("collection=ordered&limit=1");
    const latest = await cursorOf("limit=1");

    // The collection's own order here is `activity` by name.
    expect(
      (
        await get(
          `/api/public/threads?collection=ordered&sort=activity&cursor=${own}`,
        )
      ).status,
    ).toBe(200);
    for (const query of [
      `collection=ordered&sort=oldest&cursor=${own}`,
      // `published` reads the collection as a plain filter, in another order.
      `collection=ordered&sort=published&cursor=${own}`,
      `collection=ordered&cursor=${latest}`,
      `cursor=${own}`,
    ]) {
      const { status, body } = await get(`/api/public/threads?${query}`);
      expect(status, query).toBe(400);
      expect(body.error).toMatch(/different order/);
    }
    for (const cursor of ["garbage", "eyJ2IjoxfQ", "pst_"]) {
      const { status } = await get(
        `/api/public/threads?collection=ordered&cursor=${cursor}`,
      );
      expect(status, cursor).toBe(400);
    }
  });
});
