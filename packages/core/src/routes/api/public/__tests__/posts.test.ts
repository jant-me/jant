import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestApp } from "../../../../__tests__/helpers/app.js";
import { walkPostPages } from "../../../../__tests__/helpers/cursor-walk.js";
import { posts, threadCollections } from "../../../../db/schema.js";
import { createEntityId } from "../../../../lib/ids.js";
import { publicPostsApiRoutes } from "../posts.js";

describe("Public Posts API Routes", () => {
  describe("GET /api/public/posts", () => {
    it("returns published public root posts without authentication", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const publicRoot = await services.posts.create({
        format: "note",
        title: "Public root",
        bodyMarkdown: "visible root",
      });

      await services.posts.create({
        format: "note",
        title: "Latest hidden root",
        bodyMarkdown: "hidden from latest",
        visibility: "latest_hidden",
      });
      await services.posts.create({
        format: "note",
        title: "Private root",
        bodyMarkdown: "private root",
        visibility: "private",
      });
      await services.posts.create({
        format: "note",
        title: "Draft root",
        bodyMarkdown: "draft root",
        status: "draft",
      });
      await services.posts.create({
        format: "note",
        bodyMarkdown: "public reply",
        replyToId: publicRoot.id,
      });

      const res = await app.request("/api/public/posts");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.nextCursor).toBeNull();
      expect(body.posts).toHaveLength(1);
      expect(body.posts[0].slug).toBe(publicRoot.slug);
      expect(body.posts[0].title).toBe("Public root");
      expect(body.posts[0].status).toBe("published");
      expect(body.posts[0].visibility).toBe("public");
      expect(body.posts[0]).not.toHaveProperty("body");
    });

    // Consumers need both axes: `lastActivityAt` answers "when was this
    // announced", `threadUpdatedAt` answers "when did it actually change".
    // Exposing only the first left no way to tell a quiet addition happened.
    it("reports both thread activity timestamps", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const root = await services.posts.create({
        format: "note",
        title: "Quietly extended",
        bodyMarkdown: "root",
        publishedAt: 1000,
      });
      await services.posts.create({
        format: "note",
        bodyMarkdown: "quiet addendum",
        replyToId: root.id,
        publishedAt: 3000,
        quietReply: true,
      });

      const res = await app.request("/api/public/posts");
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        posts: {
          title: string | null;
          quietReply: boolean;
          lastActivityAt: number;
          threadUpdatedAt: number;
        }[];
      };

      const entry = body.posts.find((p) => p.title === "Quietly extended");
      expect(entry?.lastActivityAt).toBe(1000);
      expect(entry?.threadUpdatedAt).toBe(3000);
      expect(entry?.quietReply).toBe(false);
    });

    it("supports format and limit filters", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      await services.posts.create({
        format: "note",
        title: "Note one",
        bodyMarkdown: "first note",
      });
      await services.posts.create({
        format: "note",
        title: "Note two",
        bodyMarkdown: "second note",
      });
      await services.posts.create({
        format: "link",
        title: "Example",
        url: "https://example.com",
      });

      const res = await app.request("/api/public/posts?format=note&limit=1");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.posts).toHaveLength(1);
      expect(body.posts[0].format).toBe("note");
      expect(body.nextCursor).toBeTruthy();
    });

    it("walks pinned posts and bumped Threads the same as one unpaged request", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const day = (n: number) => Date.UTC(2025, 0, n) / 1000;
      await services.posts.create({
        format: "note",
        title: "Pinned",
        bodyMarkdown: "pinned",
        publishedAt: day(1),
        pinnedAt: day(20),
      });
      await services.posts.create({
        format: "note",
        title: "Pinned at the same moment",
        bodyMarkdown: "pinned too",
        publishedAt: day(2),
        pinnedAt: day(20),
      });
      const bumped = await services.posts.create({
        format: "note",
        title: "Old root, new reply",
        bodyMarkdown: "bumped",
        publishedAt: day(3),
      });
      await services.posts.create({
        format: "note",
        bodyMarkdown: "reply",
        replyToId: bumped.id,
        publishedAt: day(15),
      });
      for (const title of ["Tie A", "Tie B", "Tie C"]) {
        await services.posts.create({
          format: "note",
          title,
          bodyMarkdown: title,
          publishedAt: day(10),
        });
      }
      await services.posts.create({
        format: "note",
        title: "Hidden from Latest",
        bodyMarkdown: "hidden",
        visibility: "latest_hidden",
        publishedAt: day(11),
      });

      const res = await app.request("/api/public/posts");
      const expected = (await res.json()).posts.map(
        (post: { id: string }) => post.id,
      );
      expect(expected).toHaveLength(6);
      for (const limit of [1, 2, 4]) {
        expect(await walkPostPages(app, "/api/public/posts", limit)).toEqual(
          expected,
        );
      }
    });

    it("keeps paging after the cursor post is deleted, and reads old ID cursors", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const created = [];
      for (let n = 1; n <= 4; n++) {
        created.push(
          await services.posts.create({
            format: "note",
            title: `Post ${n}`,
            bodyMarkdown: `post ${n}`,
            publishedAt: Date.UTC(2025, 0, n) / 1000,
          }),
        );
      }
      const [first, second, third, fourth] = created;

      const page1 = await (
        await app.request("/api/public/posts?limit=2")
      ).json();
      expect(page1.posts.map((post: { id: string }) => post.id)).toEqual([
        fourth?.id,
        third?.id,
      ]);
      await services.posts.delete(third?.id ?? "");
      expect(
        await walkPostPages(app, "/api/public/posts", 2, page1.nextCursor),
      ).toEqual([second?.id, first?.id]);

      // The bare post ID earlier releases returned as `nextCursor`.
      const legacy = await app.request(
        `/api/public/posts?cursor=${fourth?.id}`,
      );
      expect(legacy.status).toBe(200);
      expect(
        (await legacy.json()).posts.map((post: { id: string }) => post.id),
      ).toEqual([second?.id, first?.id]);
    });

    it("returns markdown instead of rendered fields when content=markdown", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      await services.posts.create({
        format: "note",
        title: "Markdown post",
        bodyMarkdown: "# Hello\n\nBody text",
      });

      const res = await app.request("/api/public/posts?content=markdown");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.posts).toHaveLength(1);
      expect(body.posts[0].bodyMarkdown).toBe("# Hello\n\nBody text");
      expect(body.posts[0]).not.toHaveProperty("bodyHtml");
      expect(body.posts[0]).not.toHaveProperty("bodyText");
    });

    it("returns canonical v3 HTML when the stored projection is stale", async () => {
      const { app, services, db } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);
      const post = await services.posts.create({
        format: "note",
        title: "Footnote API",
        bodyMarkdown: "API body[^1]\n\n[^1]: API definition",
      });
      await db
        .update(posts)
        .set({
          bodyHtml: '<span class="sidenote">legacy</span>',
          bodyHtmlVersion: 1,
        })
        .where(eq(posts.id, post.id));

      const response = await app.request("/api/public/posts");
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.posts[0].bodyHtml).toContain('role="doc-noteref"');
      expect(body.posts[0].bodyHtml).toMatch(/id="fn-[a-z0-9]{13}-1"/);
      expect(body.posts[0].bodyHtml).not.toContain(post.id);
      expect(body.posts[0].bodyHtml).not.toContain("legacy");
    });

    it("filters posts by a single collection slug", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const collection = await services.collections.create({
        slug: "design",
        title: "Design",
      });
      const inCollection = await services.posts.create({
        format: "note",
        title: "Design post",
        bodyMarkdown: "in collection",
        collectionIds: [collection.id],
      });
      await services.posts.create({
        format: "note",
        title: "Other post",
        bodyMarkdown: "not in collection",
      });

      const res = await app.request("/api/public/posts?collection=design");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.posts).toHaveLength(1);
      expect(body.posts[0].id).toBe(inCollection.id);
    });

    it("filters posts by multiple collection slugs (aggregate)", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const col1 = await services.collections.create({
        slug: "tech",
        title: "Tech",
      });
      const col2 = await services.collections.create({
        slug: "art",
        title: "Art",
      });
      const techPost = await services.posts.create({
        format: "note",
        title: "Tech post",
        bodyMarkdown: "tech",
        collectionIds: [col1.id],
      });
      const artPost = await services.posts.create({
        format: "note",
        title: "Art post",
        bodyMarkdown: "art",
        collectionIds: [col2.id],
      });
      await services.posts.create({
        format: "note",
        title: "Unrelated",
        bodyMarkdown: "neither",
      });

      const res = await app.request("/api/public/posts?collection=tech,art");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.posts).toHaveLength(2);
      const ids = body.posts.map((p: { id: string }) => p.id);
      expect(ids).toContain(techPost.id);
      expect(ids).toContain(artPost.id);
    });

    it("returns empty array for unknown collection slug", async () => {
      const { app } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const res = await app.request("/api/public/posts?collection=nonexistent");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.posts).toHaveLength(0);
      expect(body.nextCursor).toBeNull();
    });

    it("respects collection sort order (oldest)", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const collection = await services.collections.create({
        slug: "chronological",
        title: "Chronological",
        sortOrder: "oldest",
      });
      const older = await services.posts.create({
        format: "note",
        title: "Older",
        bodyMarkdown: "first",
        collectionIds: [collection.id],
        publishedAt: 1000,
      });
      const newer = await services.posts.create({
        format: "note",
        title: "Newer",
        bodyMarkdown: "second",
        collectionIds: [collection.id],
        publishedAt: 2000,
      });
      await services.posts.create({
        format: "note",
        bodyMarkdown: "Later reply to the older Thread",
        replyToId: older.id,
        publishedAt: 3000,
      });

      const res = await app.request(
        "/api/public/posts?collection=chronological",
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.posts).toHaveLength(2);
      expect(body.posts[0].id).toBe(older.id);
      expect(body.posts[1].id).toBe(newer.id);
    });

    it("sorts collection results by Thread activity from Child Posts", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const collection = await services.collections.create({
        slug: "active-threads",
        title: "Active Threads",
      });
      const olderRoot = await services.posts.create({
        format: "note",
        title: "Older root",
        bodyMarkdown: "older",
        collectionIds: [collection.id],
        publishedAt: 1000,
      });
      const newerRoot = await services.posts.create({
        format: "note",
        title: "Newer root",
        bodyMarkdown: "newer",
        collectionIds: [collection.id],
        publishedAt: 2000,
      });
      await services.posts.create({
        format: "note",
        bodyMarkdown: "new activity",
        replyToId: olderRoot.id,
        publishedAt: 3000,
      });

      const res = await app.request(
        "/api/public/posts?collection=active-threads&sort=newest",
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.posts.map((post: { id: string }) => post.id)).toEqual([
        olderRoot.id,
        newerRoot.id,
      ]);
    });

    it("sorts and cursor-paginates collection Threads by Child ratings", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const collection = await services.collections.create({
        slug: "rated-threads",
        title: "Rated Threads",
        sortOrder: "rating_desc",
      });
      const createRatedThread = async (
        title: string,
        publishedAt: number,
        rating: number,
      ) => {
        const root = await services.posts.create({
          format: "note",
          title,
          bodyMarkdown: `${title} root`,
          collectionIds: [collection.id],
          publishedAt,
        });
        await services.posts.create({
          format: "note",
          bodyMarkdown: `${title} rated Child`,
          replyToId: root.id,
          publishedAt: publishedAt + 100,
          rating,
        });
        return root;
      };

      const highest = await createRatedThread("Highest", 1000, 5);
      const middle = await createRatedThread("Middle", 2000, 3);
      const lowest = await createRatedThread("Lowest", 3000, 1);

      expect(
        await walkPostPages(
          app,
          "/api/public/posts?collection=rated-threads",
          1,
        ),
      ).toEqual([highest.id, middle.id, lowest.id]);
    });

    it("walks a collection in each order the same as one unpaged request", async () => {
      const { app, services, db } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const collection = await services.collections.create({
        slug: "walked",
        title: "Walked",
      });
      const day = (n: number) => Date.UTC(2025, 0, n) / 1000;
      const thread = async (
        title: string,
        publishedAt: number,
        extra: {
          rating?: number;
          visibility?: "private" | "latest_hidden";
        } = {},
      ) =>
        services.posts.create({
          format: "note",
          title,
          bodyMarkdown: title,
          collectionIds: [collection.id],
          publishedAt,
          ...extra,
        });

      // Pins tie on the pin time, then order by each sort's own keys.
      const pinnedA = await thread("Pinned A", day(1), { rating: 2 });
      const pinnedB = await thread("Pinned B", day(2));
      for (const pinned of [pinnedA, pinnedB]) {
        await db
          .update(threadCollections)
          .set({ pinnedAt: day(30) })
          .where(eq(threadCollections.threadId, pinned.id));
      }
      // A reply moves this Thread up under newest and rating, not oldest.
      const bumped = await thread("Bumped", day(3), { rating: 4 });
      await services.posts.create({
        format: "note",
        bodyMarkdown: "reply",
        replyToId: bumped.id,
        publishedAt: day(20),
        rating: 5,
      });
      // Ties on publication time, activity, and rating.
      for (const title of ["Tie A", "Tie B", "Tie C"]) {
        await thread(title, day(10), { rating: 3 });
      }
      await thread("Unrated", day(12));
      await thread("Private", day(13), { visibility: "private" });
      await thread("Hidden from Latest", day(14), {
        visibility: "latest_hidden",
      });

      for (const sort of ["newest", "oldest", "rating_desc"]) {
        const path = `/api/public/posts?collection=walked&sort=${sort}`;
        const res = await app.request(`${path}&limit=100`);
        const body = await res.json();
        const expected = body.posts.map((post: { id: string }) => post.id);
        expect(body.nextCursor).toBeNull();
        expect(expected).toHaveLength(7);
        expect(expected.slice(0, 2).sort()).toEqual(
          [pinnedA.id, pinnedB.id].sort(),
        );
        for (const limit of [1, 2, 3]) {
          expect(await walkPostPages(app, path, limit), sort).toEqual(expected);
        }
      }
    });

    it("keeps paging a collection after the cursor Thread leaves it", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const collection = await services.collections.create({
        slug: "shrinking",
        title: "Shrinking",
      });
      const roots = [];
      for (let n = 1; n <= 7; n++) {
        roots.push(
          await services.posts.create({
            format: "note",
            title: `Thread ${n}`,
            bodyMarkdown: `thread ${n}`,
            collectionIds: [collection.id],
            publishedAt: Date.UTC(2025, 0, n) / 1000,
          }),
        );
      }
      const ids = roots.map((root) => root.id).reverse();
      const path = "/api/public/posts?collection=shrinking&limit=2";
      const readPage = async (cursor?: string) => {
        const res = await app.request(
          cursor ? `${path}&cursor=${encodeURIComponent(cursor)}` : path,
        );
        expect(res.status).toBe(200);
        return (await res.json()) as {
          posts: { id: string }[];
          nextCursor: string | null;
        };
      };
      const idsOf = (page: { posts: { id: string }[] }) =>
        page.posts.map((post) => post.id);

      // Each page ends on a Thread that is gone before the next request:
      // deleted, unpublished, then taken out of the collection.
      const page1 = await readPage();
      expect(idsOf(page1)).toEqual(ids.slice(0, 2));
      await services.posts.delete(ids[1] ?? "");

      const page2 = await readPage(page1.nextCursor ?? undefined);
      expect(idsOf(page2)).toEqual(ids.slice(2, 4));
      await services.posts.update(ids[3] ?? "", { status: "draft" });

      const page3 = await readPage(page2.nextCursor ?? undefined);
      expect(idsOf(page3)).toEqual(ids.slice(4, 6));
      await services.collections.removeThread(collection.id, ids[5] ?? "");

      const page4 = await readPage(page3.nextCursor ?? undefined);
      expect(idsOf(page4)).toEqual(ids.slice(6));
      expect(page4.nextCursor).toBeNull();
    });

    it("resumes a collection from a bare root ID it lists, and rejects any other", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const collection = await services.collections.create({
        slug: "legacy",
        title: "Legacy",
      });
      const inCollection = async (title: string, n: number) =>
        services.posts.create({
          format: "note",
          title,
          bodyMarkdown: title,
          collectionIds: [collection.id],
          publishedAt: Date.UTC(2025, 0, n) / 1000,
        });
      const first = await inCollection("First", 1);
      const second = await inCollection("Second", 2);
      const third = await inCollection("Third", 3);

      // The bare root ID earlier releases returned as `nextCursor`.
      const legacy = await app.request(
        `/api/public/posts?collection=legacy&cursor=${third.id}`,
      );
      expect(legacy.status).toBe(200);
      const body = await legacy.json();
      expect(body.posts.map((post: { id: string }) => post.id)).toEqual([
        second.id,
        first.id,
      ]);
      expect(body.nextCursor).toBeNull();

      const privateRoot = await services.posts.create({
        format: "note",
        title: "Private",
        bodyMarkdown: "private",
        collectionIds: [collection.id],
        visibility: "private",
      });
      const draftRoot = await services.posts.create({
        format: "note",
        title: "Draft",
        bodyMarkdown: "draft",
        collectionIds: [collection.id],
        status: "draft",
      });
      const elsewhere = await services.posts.create({
        format: "note",
        title: "Not in the collection",
        bodyMarkdown: "elsewhere",
      });
      const deleted = await inCollection("Deleted", 4);
      await services.posts.delete(deleted.id);

      const answers = [];
      for (const id of [
        privateRoot.id,
        draftRoot.id,
        elsewhere.id,
        deleted.id,
        createEntityId("post"),
      ]) {
        const res = await app.request(
          `/api/public/posts?collection=legacy&cursor=${id}`,
        );
        expect(res.status).toBe(400);
        const error = await res.json();
        expect(error.code).toBe("VALIDATION_ERROR");
        answers.push(error.error);
      }
      // Nothing in the answer tells a private Thread from one that never
      // existed.
      expect(new Set(answers).size).toBe(1);
    });

    it("rejects a cursor from a collection in another order, or from Latest", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const collection = await services.collections.create({
        slug: "ordered",
        title: "Ordered",
      });
      for (const n of [1, 2, 3]) {
        await services.posts.create({
          format: "note",
          title: `Thread ${n}`,
          bodyMarkdown: `thread ${n}`,
          collectionIds: [collection.id],
          publishedAt: Date.UTC(2025, 0, n) / 1000,
        });
      }
      const cursorOf = async (path: string) =>
        (await (await app.request(path)).json()).nextCursor as string;

      const newest = await cursorOf(
        "/api/public/posts?collection=ordered&sort=newest&limit=1",
      );
      const latest = await cursorOf("/api/public/posts?limit=1");
      for (const path of [
        `/api/public/posts?collection=ordered&sort=oldest&cursor=${newest}`,
        `/api/public/posts?collection=ordered&cursor=${latest}`,
        `/api/public/posts?cursor=${newest}`,
      ]) {
        const res = await app.request(path);
        expect(res.status, path).toBe(400);
        expect((await res.json()).error).toMatch(/different order/);
      }
      for (const cursor of ["garbage", "eyJ2IjoxfQ", "pst_"]) {
        const res = await app.request(
          `/api/public/posts?collection=ordered&cursor=${cursor}`,
        );
        expect(res.status).toBe(400);
      }
    });

    it("keeps root format and Latest visibility filters for Collections", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const collection = await services.collections.create({
        slug: "mixed",
        title: "Mixed",
      });
      const note = await services.posts.create({
        format: "note",
        title: "Visible note",
        bodyMarkdown: "note",
        collectionIds: [collection.id],
      });
      await services.posts.create({
        format: "link",
        title: "Visible link",
        url: "https://example.com",
        collectionIds: [collection.id],
      });
      await services.posts.create({
        format: "note",
        title: "Hidden note",
        bodyMarkdown: "hidden",
        visibility: "latest_hidden",
        collectionIds: [collection.id],
      });

      const res = await app.request(
        "/api/public/posts?collection=mixed&format=note",
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.posts.map((post: { id: string }) => post.id)).toEqual([
        note.id,
      ]);
    });

    it("allows overriding collection sort order via sort parameter", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const collection = await services.collections.create({
        slug: "readings",
        title: "Readings",
        sortOrder: "oldest",
      });
      const older = await services.posts.create({
        format: "note",
        title: "Older",
        bodyMarkdown: "first",
        collectionIds: [collection.id],
      });
      const newer = await services.posts.create({
        format: "note",
        title: "Newer",
        bodyMarkdown: "second",
        collectionIds: [collection.id],
      });

      const res = await app.request(
        "/api/public/posts?collection=readings&sort=newest",
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.posts).toHaveLength(2);
      expect(body.posts[0].id).toBe(newer.id);
      expect(body.posts[1].id).toBe(older.id);
    });
  });

  describe("GET /api/public/posts/:slug", () => {
    it("returns a public post by slug without authentication", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const collection = await services.collections.create({
        slug: "reading",
        title: "Reading",
      });
      const post = await services.posts.create({
        format: "note",
        title: "Public post",
        bodyMarkdown: "public body",
        collectionIds: [collection.id],
      });

      const res = await app.request(`/api/public/posts/${post.slug}`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.id).toBe(post.id);
      expect(body.slug).toBe(post.slug);
      expect(body.permalink).toBe(`/${post.slug}`);
      expect(body.collections).toEqual([
        {
          id: collection.id,
          slug: "reading",
          title: "Reading",
          url: "/reading",
        },
      ]);
      expect(body.bodyHtml).toContain("public body");
      expect(body).not.toHaveProperty("body");
    });

    it("returns the shared Thread Collections for a child post", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const collection = await services.collections.create({
        slug: "shared",
        title: "Shared",
      });
      const root = await services.posts.create({
        format: "note",
        bodyMarkdown: "root",
        collectionIds: [collection.id],
      });
      const child = await services.posts.create({
        format: "note",
        bodyMarkdown: "child",
        replyToId: root.id,
      });

      const res = await app.request(`/api/public/posts/${child.slug}`);
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        id: child.id,
        collections: [
          {
            id: collection.id,
            slug: "shared",
            title: "Shared",
          },
        ],
      });
    });

    it("returns markdown instead of rendered fields when content=markdown", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const post = await services.posts.create({
        format: "note",
        title: "Markdown detail",
        bodyMarkdown: "Line 1\n\nLine 2",
      });

      const res = await app.request(
        `/api/public/posts/${post.slug}?content=markdown`,
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.bodyMarkdown).toBe("Line 1\n\nLine 2");
      expect(body).not.toHaveProperty("bodyHtml");
      expect(body).not.toHaveProperty("bodyText");
    });

    it("returns quote attribution as sourceName/sourceUrl", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const post = await services.posts.create({
        format: "quote",
        title: "Marcus Aurelius",
        url: "https://example.com/meditations",
        quoteText: "What stands in the way becomes the way.",
      });

      const res = await app.request(`/api/public/posts/${post.slug}`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.format).toBe("quote");
      expect(body.sourceName).toBe("Marcus Aurelius");
      expect(body.sourceUrl).toBe("https://example.com/meditations");
      expect(body).not.toHaveProperty("title");
      expect(body).not.toHaveProperty("url");
    });

    it("returns latest_hidden posts for direct reads", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const post = await services.posts.create({
        format: "note",
        title: "Hidden from latest",
        bodyMarkdown: "still public by permalink",
        visibility: "latest_hidden",
      });

      const res = await app.request(`/api/public/posts/${post.slug}`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.visibility).toBe("latest_hidden");
      expect(body.slug).toBe(post.slug);
    });

    it("returns 404 for draft or private posts", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const draft = await services.posts.create({
        format: "note",
        title: "Draft",
        bodyMarkdown: "draft body",
        status: "draft",
      });
      const privatePost = await services.posts.create({
        format: "note",
        title: "Private",
        bodyMarkdown: "private body",
        visibility: "private",
      });

      await expect(
        app.request(`/api/public/posts/${draft.slug}`),
      ).resolves.toMatchObject({ status: 404 });
      await expect(
        app.request(`/api/public/posts/${privatePost.slug}`),
      ).resolves.toMatchObject({ status: 404 });
    });
  });
});
