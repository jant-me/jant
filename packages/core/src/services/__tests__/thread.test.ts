import { describe, expect, it } from "vitest";
import { createTestApp } from "../../__tests__/helpers/app.js";
import { ValidationError } from "../../lib/errors.js";
import type { CreatePost, Post } from "../../types.js";
import type { ThreadListQuery } from "../thread.js";

const DAY = 86_400;
const BASE = Date.UTC(2025, 0, 1) / 1000;
const day = (n: number) => BASE + n * DAY;

function setup() {
  const { services } = createTestApp();
  const post = (data: Partial<CreatePost> & { title?: string }) =>
    services.posts.create({ format: "note", bodyMarkdown: "body", ...data });
  const reply = (parent: Post, at: number, data: Partial<CreatePost> = {}) =>
    post({ replyToId: parent.id, publishedAt: at, createdAt: at, ...data });
  const list = async (
    query: Partial<ThreadListQuery> = {},
    limit = 50,
  ): Promise<string[]> => {
    const page = await services.threads.listThreads(
      { audience: "reader", selection: {}, ...query },
      { limit },
    );
    return page.threads.map((thread) => thread.root.id);
  };
  return { services, post, reply, list };
}

describe("ThreadService.listThreads", () => {
  it("lists what the homepage lists by default", async () => {
    const { post, reply, list } = setup();
    const quiet = await post({ publishedAt: day(1) });
    const pinned = await post({ publishedAt: day(0), pinned: true });
    const active = await post({ publishedAt: day(2) });
    await reply(active, day(9));
    await post({ publishedAt: day(3), visibility: "latest_hidden" });
    await post({ publishedAt: day(4), visibility: "private" });
    await post({ status: "draft" });

    // Pins first, then newest activity; hidden, private, and drafts left out.
    expect(await list()).toEqual([pinned.id, active.id, quiet.id]);
  });

  it("widens to Threads hidden from Latest on request", async () => {
    const { post, list } = setup();
    const shown = await post({ publishedAt: day(1) });
    const hidden = await post({
      publishedAt: day(2),
      visibility: "latest_hidden",
    });
    await post({ publishedAt: day(3), visibility: "private" });

    expect(await list({ includeHidden: true })).toEqual([hidden.id, shown.id]);
    expect(await list({ selection: { visibility: "latest_hidden" } })).toEqual([
      hidden.id,
    ]);
  });

  // Each order is one the site already shows, and only the homepage's puts
  // pins first.
  it("orders by each named axis", async () => {
    const { post, reply, list } = setup();
    const first = await post({ publishedAt: day(1), rating: 3 });
    const second = await post({ publishedAt: day(2), pinned: true });
    const third = await post({ publishedAt: day(3), rating: 5 });
    await reply(first, day(8));
    await reply(third, day(9), { quietReply: true });

    expect(await list({ sort: "activity" })).toEqual([
      second.id,
      first.id,
      third.id,
    ]);
    expect(await list({ sort: "published" })).toEqual([
      third.id,
      second.id,
      first.id,
    ]);
    // A quiet reply moves a Thread on `updated`, never on `activity`.
    expect(await list({ sort: "updated" })).toEqual([
      third.id,
      first.id,
      second.id,
    ]);
    expect(await list({ sort: "oldest" })).toEqual([
      first.id,
      second.id,
      third.id,
    ]);
    expect(await list({ sort: "rating" })).toEqual([
      third.id,
      first.id,
      second.id,
    ]);
  });

  it("lists featured Threads newest-published first and refuses another order", async () => {
    const { services, post, reply, list } = setup();
    const older = await post({ publishedAt: day(1), featured: true });
    const newer = await post({ publishedAt: day(2), featured: true });
    await post({ publishedAt: day(3) });
    await reply(older, day(9));

    expect(await list({ selection: { visibility: "featured" } })).toEqual([
      newer.id,
      older.id,
    ]);
    await expect(
      services.threads.listThreads(
        {
          audience: "reader",
          selection: { visibility: "featured" },
          sort: "activity",
        },
        { limit: 10 },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("uses a collection's own order and pins when it is named", async () => {
    const { services, post, reply, list } = setup();
    const collection = await services.collections.create({
      slug: "reading",
      title: "Reading",
      sortOrder: "oldest",
    });
    const early = await post({
      publishedAt: day(1),
      collectionIds: [collection.id],
    });
    const late = await post({
      publishedAt: day(2),
      collectionIds: [collection.id],
    });
    const pinnedInCollection = await post({
      publishedAt: day(3),
      collectionIds: [collection.id],
    });
    await post({ publishedAt: day(4) });
    await reply(early, day(9));
    await services.collections.pinThread(collection.id, pinnedInCollection.id);

    const selection = { collection: [collection.id] };
    // The collection's configured order, with its own pin on top.
    expect(await list({ selection })).toEqual([
      pinnedInCollection.id,
      early.id,
      late.id,
    ]);
    expect(await list({ selection, sort: "activity" })).toEqual([
      pinnedInCollection.id,
      early.id,
      late.id,
    ]);
    // `published` reads the collection as a plain filter: no collection pins.
    expect(await list({ selection, sort: "published" })).toEqual([
      pinnedInCollection.id,
      late.id,
      early.id,
    ]);
  });

  it("applies the other dimensions to a collection's own order", async () => {
    const { services, post, list } = setup();
    const collection = await services.collections.create({
      slug: "log",
      title: "Log",
    });
    const titled = await post({
      title: "Titled",
      publishedAt: day(1),
      collectionIds: [collection.id],
    });
    await post({ publishedAt: day(2), collectionIds: [collection.id] });
    const lastYear = await post({
      title: "Last year",
      publishedAt: BASE - 10 * DAY,
      collectionIds: [collection.id],
    });

    expect(
      await list({ selection: { collection: [collection.id], title: true } }),
    ).toEqual([titled.id, lastYear.id]);
    expect(
      await list({
        selection: { collection: [collection.id], title: true, year: 2025 },
      }),
    ).toEqual([titled.id]);
  });

  it("walks every order with a cursor, one Thread per page", async () => {
    const { services, post, reply } = setup();
    const collection = await services.collections.create({
      slug: "all",
      title: "All",
    });
    const roots: Post[] = [];
    for (let i = 0; i < 5; i++) {
      roots.push(
        await post({
          publishedAt: day(i),
          rating: (i % 3) + 1,
          collectionIds: [collection.id],
        }),
      );
    }
    await reply(roots[1] as Post, day(20));
    await services.collections.pinThread(collection.id, roots[3]?.id ?? "");

    const cases: Partial<ThreadListQuery>[] = [
      { sort: "activity" },
      { sort: "published" },
      { sort: "updated" },
      { sort: "oldest" },
      { sort: "rating" },
      { selection: { collection: [collection.id] } },
      { selection: { collection: [collection.id] }, sort: "rating" },
    ];
    for (const query of cases) {
      const full = await services.threads.listThreads(
        { audience: "reader", selection: {}, ...query },
        { limit: 50 },
      );
      const walked: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 10; page++) {
        const result = await services.threads.listThreads(
          { audience: "reader", selection: {}, ...query },
          { limit: 1, cursor },
        );
        walked.push(...result.threads.map((thread) => thread.root.id));
        if (!result.nextCursor) break;
        cursor = result.nextCursor;
      }
      expect(walked).toEqual(full.threads.map((thread) => thread.root.id));
    }
  });

  it("shows the author every status and visibility", async () => {
    const { services, post } = setup();
    const hidden = await post({
      publishedAt: day(1),
      visibility: "latest_hidden",
    });
    const secret = await post({ publishedAt: day(2), visibility: "private" });
    const draft = await post({ status: "draft" });

    const published = await services.threads.listThreads(
      { audience: "author", selection: {} },
      { limit: 10 },
    );
    expect(published.threads.map((thread) => thread.root.id)).toEqual([
      secret.id,
      hidden.id,
    ]);
    const drafts = await services.threads.listThreads(
      { audience: "author", status: "draft", selection: {} },
      { limit: 10 },
    );
    expect(drafts.threads.map((thread) => thread.root.id)).toEqual([draft.id]);
  });

  it("never shows a reader private Threads", async () => {
    const { services } = setup();
    await expect(
      services.threads.listThreads(
        { audience: "reader", selection: { visibility: "private" } },
        { limit: 10 },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("ThreadService.summarize", () => {
  it("counts published Posts and folds the way the homepage does", async () => {
    const { services, post, reply } = setup();
    const root = await post({ publishedAt: day(0), createdAt: day(0) });
    const replies: Post[] = [];
    let parent = root;
    for (let i = 1; i <= 8; i++) {
      parent = await reply(parent, day(i));
      replies.push(parent);
    }
    await services.posts.create({
      format: "note",
      bodyMarkdown: "unsent",
      replyToId: parent.id,
      status: "draft",
    });
    const lone = await post({ publishedAt: day(1) });

    const [thread, single] = await services.threads.summarize([root, lone], {
      fold: true,
    });
    expect(thread?.postCount).toBe(9);
    expect(thread?.fold?.leadingReplies.map((p) => p.id)).toEqual(
      replies.slice(0, 2).map((p) => p.id),
    );
    expect(thread?.fold?.trailingReplies.map((p) => p.id)).toEqual(
      replies.slice(5, 7).map((p) => p.id),
    );
    expect(thread?.fold?.latestReply.id).toBe(replies[7]?.id);
    expect(thread?.fold?.hiddenCount).toBe(3);
    expect(thread?.fold?.firstHiddenReply?.id).toBe(replies[2]?.id);

    expect(single?.postCount).toBe(1);
    expect(single?.fold).toBeNull();
  });

  it("leaves the fold out unless asked", async () => {
    const { services, post } = setup();
    const root = await post({ publishedAt: day(0) });
    const [summary] = await services.threads.summarize([root], {});
    expect(summary).toEqual({ root, postCount: 1 });
  });
});

describe("ThreadService.findRoot", () => {
  it("finds a Thread by any of its Posts", async () => {
    const { services, post, reply } = setup();
    const root = await post({ publishedAt: day(0) });
    const child = await reply(root, day(1));

    expect(
      (await services.threads.findRoot({ slug: child.slug }, "reader"))?.id,
    ).toBe(root.id);
    expect(
      (await services.threads.findRoot({ id: child.id }, "author"))?.id,
    ).toBe(root.id);
  });

  it("answers a reader only for what the site shows anyone", async () => {
    const { services, post, reply } = setup();
    const secret = await post({ publishedAt: day(0), visibility: "private" });
    const hidden = await post({
      publishedAt: day(1),
      visibility: "latest_hidden",
    });
    const draft = await post({ status: "draft" });
    const open = await post({ publishedAt: day(2) });
    const tail = await reply(open, day(3));
    const unsent = await services.posts.create({
      format: "note",
      bodyMarkdown: "unsent",
      replyToId: tail.id,
      status: "draft",
    });

    const find = (slug: string) =>
      services.threads.findRoot({ slug }, "reader");
    expect(await find(secret.slug)).toBeNull();
    expect(await find(draft.slug)).toBeNull();
    expect(await find(unsent.slug)).toBeNull();
    expect((await find(hidden.slug))?.id).toBe(hidden.id);
    expect(
      (await services.threads.findRoot({ id: draft.id }, "author"))?.id,
    ).toBe(draft.id);
  });
});

describe("posts.listThreadPostsPage", () => {
  async function thread(count: number) {
    const { services, post, reply } = setup();
    const root = await post({ publishedAt: day(0), createdAt: day(0) });
    const all: Post[] = [root];
    let parent = root;
    for (let i = 1; i < count; i++) {
      parent = await reply(parent, day(i));
      all.push(parent);
    }
    return { services, root, all, reply };
  }

  it("walks a Thread in Thread order, one Post per page", async () => {
    const { services, root, all } = await thread(5);
    const walked: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const result = await services.posts.listThreadPostsPage(
        root.id,
        {},
        { limit: 1, cursor },
      );
      walked.push(...result.posts.map((p) => p.id));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    expect(walked).toEqual(all.map((p) => p.id));
  });

  it("reaches a reply published while the walk is under way", async () => {
    const { services, root, all, reply } = await thread(3);
    const first = await services.posts.listThreadPostsPage(
      root.id,
      {},
      { limit: 2 },
    );
    const added = await reply(all[2] as Post, day(10));
    const rest = await services.posts.listThreadPostsPage(
      root.id,
      {},
      { limit: 10, cursor: first.nextCursor ?? undefined },
    );
    expect(rest.posts.map((p) => p.id)).toEqual([all[2]?.id, added.id]);
  });

  it("starts after a Post of the Thread named by ID", async () => {
    const { services, root, all } = await thread(6);
    const page = await services.posts.listThreadPostsPage(
      root.id,
      {},
      { limit: 2, cursor: all[2]?.id },
    );
    expect(page.posts.map((p) => p.id)).toEqual([all[3]?.id, all[4]?.id]);
  });

  it("refuses an ID from another Thread or one it wouldn't list", async () => {
    const { services, root, all } = await thread(2);
    const other = await services.posts.create({
      format: "note",
      bodyMarkdown: "elsewhere",
    });
    const unsent = await services.posts.create({
      format: "note",
      bodyMarkdown: "unsent",
      replyToId: all[1]?.id,
      status: "draft",
    });
    for (const cursor of [other.id, unsent.id, "not-a-cursor"]) {
      await expect(
        services.posts.listThreadPostsPage(root.id, {}, { limit: 5, cursor }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    // A cursor from a different list names a position on another axis.
    const listCursor = (
      await services.posts.listPage({ status: "published" }, { limit: 1 })
    ).nextCursor;
    await expect(
      services.posts.listThreadPostsPage(
        root.id,
        {},
        { limit: 5, cursor: listCursor ?? undefined },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("lists drafts only when asked", async () => {
    const { services, root, all } = await thread(2);
    const unsent = await services.posts.create({
      format: "note",
      bodyMarkdown: "unsent",
      replyToId: all[1]?.id,
      status: "draft",
    });
    const published = await services.posts.listThreadPostsPage(
      root.id,
      {},
      { limit: 10 },
    );
    expect(published.posts.map((p) => p.id)).toEqual(all.map((p) => p.id));
    const drafts = await services.posts.listThreadPostsPage(
      root.id,
      { status: "draft" },
      { limit: 10 },
    );
    expect(drafts.posts.map((p) => p.id)).toEqual([unsent.id]);
  });
});

describe("posts.countThreadPosts", () => {
  it("counts each Thread's published Posts, the root included", async () => {
    const { services, post, reply } = setup();
    const root = await post({ publishedAt: day(0) });
    const child = await reply(root, day(1));
    await services.posts.create({
      format: "note",
      bodyMarkdown: "unsent",
      replyToId: child.id,
      status: "draft",
    });
    const lone = await post({ publishedAt: day(2) });
    const draft = await post({ status: "draft" });

    const counts = await services.posts.countThreadPosts([
      root.id,
      lone.id,
      draft.id,
      root.id,
    ]);
    expect(counts.get(root.id)).toBe(2);
    expect(counts.get(lone.id)).toBe(1);
    expect(counts.has(draft.id)).toBe(false);
  });
});
