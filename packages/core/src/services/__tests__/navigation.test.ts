import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestDatabase,
  DEFAULT_TEST_SITE_ID,
} from "../../__tests__/helpers/db.js";
import { createNavItemService } from "../navigation.js";
import type { Database } from "../../db/index.js";
import { now } from "../../lib/time.js";

const TEST_COLLECTION_ID = "col_test00000000000000000000001";
const TEST_COLLECTION_ID_2 = "col_test00000000000000000000002";
const TEST_POST_ID = "pst_test00000000000000000000001";
const TEST_POST_ID_2 = "pst_test00000000000000000000002";
const TEST_POST_ID_3 = "pst_test00000000000000000000003";
const TEST_POST_ID_4 = "pst_test00000000000000000000004";

function insertTestPath(
  sqlite: ReturnType<typeof createTestDatabase>["sqlite"],
  input: {
    id: string;
    path: string;
    kind: "slug" | "alias" | "redirect" | "archive";
    postId?: string | null;
    collectionId?: string | null;
    redirectToPath?: string | null;
    redirectType?: 301 | 302 | null;
    archiveQuery?: string | null;
  },
) {
  const ts = now();
  sqlite
    .prepare(
      `INSERT INTO path_registry (
        id, site_id, path, kind, post_id, collection_id, redirect_to_path,
        redirect_type, archive_query, created_at, updated_at
      )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      DEFAULT_TEST_SITE_ID,
      input.path,
      input.kind,
      input.postId ?? null,
      input.collectionId ?? null,
      input.redirectToPath ?? null,
      input.redirectType ?? null,
      input.archiveQuery ?? null,
      ts,
      ts,
    );
}

function insertTestCollection(
  sqlite: ReturnType<typeof createTestDatabase>["sqlite"],
  id: string,
  slug: string,
  title: string,
) {
  const ts = now();
  sqlite
    .prepare(
      `INSERT INTO collection (id, site_id, title, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, 'newest', ?, ?)`,
    )
    .run(id, DEFAULT_TEST_SITE_ID, title, ts, ts);
  insertTestPath(sqlite, {
    id: `pth_col_${id.slice(4)}`,
    path: slug,
    kind: "slug",
    collectionId: id,
  });
}

function insertTestPost(
  sqlite: ReturnType<typeof createTestDatabase>["sqlite"],
  input: {
    id: string;
    slug: string;
    title: string | null;
    format?: "note" | "link" | "quote";
    status?: "draft" | "published";
    visibility?: "public" | "latest_hidden" | "private";
    language?: string | null;
    translationGroupId?: string | null;
  },
) {
  const ts = now();
  sqlite
    .prepare(
      `INSERT INTO post (
        id, site_id, format, status, visibility, title, thread_id,
        language, translation_group_id,
        published_at, last_activity_at, created_at, updated_at
      )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      DEFAULT_TEST_SITE_ID,
      input.format ?? "note",
      input.status ?? "published",
      input.visibility ?? "latest_hidden",
      input.title,
      input.id,
      input.language ?? null,
      input.translationGroupId ?? null,
      ts,
      ts,
      ts,
      ts,
    );
  insertTestPath(sqlite, {
    id: `pth_pst_${input.id.slice(4)}`,
    path: input.slug,
    kind: "slug",
    postId: input.id,
  });
}

describe("NavItemService", () => {
  let db: Database;
  let sqlite: ReturnType<typeof createTestDatabase>["sqlite"];
  let navItemService: ReturnType<typeof createNavItemService>;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db as unknown as Database;
    sqlite = testDb.sqlite;
    navItemService = createNavItemService(db, DEFAULT_TEST_SITE_ID);
  });

  describe("create", () => {
    it("creates a nav item with auto-assigned position", async () => {
      const item = await navItemService.create({
        type: "link",
        label: "Home",
        url: "/",
      });

      expect(item.type).toBe("link");
      expect(item.label).toBe("Home");
      expect(item.url).toBe("/");
      expect(typeof item.position).toBe("string");
      expect(typeof item.id).toBe("string");
      expect(item.id.length).toBeGreaterThan(0);
    });

    it("auto-increments position for subsequent items", async () => {
      const first = await navItemService.create({
        type: "link",
        label: "Home",
        url: "/",
      });
      const second = await navItemService.create({
        type: "link",
        label: "Archive",
        url: "/archive",
      });

      expect(second.position > first.position).toBe(true);
    });

    it("uses provided position when specified", async () => {
      const item = await navItemService.create({
        type: "link",
        label: "Home",
        url: "/",
        position: "z99",
      });

      expect(item.position).toBe("z99");
    });

    it("rejects duplicate provided positions", async () => {
      await navItemService.create({
        type: "link",
        label: "Home",
        url: "/",
        position: "m0",
      });

      await expect(
        navItemService.create({
          type: "link",
          label: "Archive",
          url: "/archive",
          position: "m0",
        }),
      ).rejects.toThrow();
    });

    it("sets createdAt and updatedAt timestamps", async () => {
      const item = await navItemService.create({
        type: "link",
        label: "Home",
        url: "/",
      });

      expect(item.createdAt).toBeGreaterThan(0);
      expect(item.updatedAt).toBeGreaterThan(0);
      expect(item.createdAt).toBe(item.updatedAt);
    });

    it("derives built-in system label and url from systemKey", async () => {
      const item = await navItemService.create({
        type: "system",
        systemKey: "settings",
      });

      expect(item.type).toBe("system");
      expect(item.systemKey).toBe("settings");
      expect(item.label).toBe("");
      expect(item.url).toBe("/settings");
    });

    it("uses the built-in default placement for system items", async () => {
      const latest = await navItemService.create({
        type: "system",
        systemKey: "latest",
      });
      const rss = await navItemService.create({
        type: "system",
        systemKey: "rss",
      });

      expect(latest.placement).toBe("header");
      expect(rss.placement).toBe("more");
    });

    it("rejects duplicate built-in system items", async () => {
      await navItemService.create({
        type: "system",
        systemKey: "archive",
      });

      await expect(
        navItemService.create({
          type: "system",
          systemKey: "archive",
        }),
      ).rejects.toThrow("Built-in navigation item already exists");
    });

    it("creates a page nav item from an eligible titled note", async () => {
      insertTestPost(sqlite, {
        id: TEST_POST_ID,
        slug: "about-me",
        title: "About me",
      });

      const item = await navItemService.create({
        type: "page",
        postId: TEST_POST_ID,
      });

      expect(item).toMatchObject({
        type: "page",
        postId: TEST_POST_ID,
        // Nothing stored: the item follows the page's title from here on.
        label: "",
        targetTitle: "About me",
        url: "/about-me",
        placement: "header",
      });
    });

    it("rejects duplicate and ineligible page nav items", async () => {
      insertTestPost(sqlite, {
        id: TEST_POST_ID,
        slug: "about",
        title: "About",
      });
      insertTestPost(sqlite, {
        id: TEST_POST_ID_2,
        slug: "private-page",
        title: "Private page",
        visibility: "private",
      });
      await navItemService.create({ type: "page", postId: TEST_POST_ID });

      await expect(
        navItemService.create({ type: "page", postId: TEST_POST_ID }),
      ).rejects.toThrow("Page already added to navigation");
      await expect(
        navItemService.create({ type: "page", postId: TEST_POST_ID_2 }),
      ).rejects.toThrow("Page must be a published, non-private titled note");
    });

    it("truncates a page's custom navigation label", async () => {
      insertTestPost(sqlite, {
        id: TEST_POST_ID,
        slug: "long-title",
        title: "A".repeat(150),
      });

      const item = await navItemService.create({
        type: "page",
        postId: TEST_POST_ID,
        label: "B".repeat(150),
      });

      expect(item.label).toBe("B".repeat(100));
    });

    it("leaves a page item's label empty so it follows the page title", async () => {
      insertTestPost(sqlite, {
        id: TEST_POST_ID,
        slug: "about-me",
        title: "About me",
      });
      const item = await navItemService.create({
        type: "page",
        postId: TEST_POST_ID,
      });

      sqlite
        .prepare(`UPDATE post SET title = ? WHERE id = ?`)
        .run("Colophon", TEST_POST_ID);

      const [reread] = await navItemService.list();
      expect(reread).toMatchObject({
        id: item.id,
        label: "",
        targetTitle: "Colophon",
      });
    });
  });

  describe("list in a language view", () => {
    const TRANSLATION_GROUP = "tgr_test0000000000000000000001";

    function addAboutPageNav() {
      insertTestPost(sqlite, {
        id: TEST_POST_ID,
        slug: "about",
        title: "关于",
        language: "zh-Hans",
        translationGroupId: TRANSLATION_GROUP,
      });
      return navItemService.create({ type: "page", postId: TEST_POST_ID });
    }

    it("points a page item at the version written in the view's language", async () => {
      const item = await addAboutPageNav();
      insertTestPost(sqlite, {
        id: TEST_POST_ID_2,
        slug: "about-en",
        title: "About",
        language: "en",
        translationGroupId: TRANSLATION_GROUP,
      });

      const [resolved] = await navItemService.list({ language: "en" });

      expect(resolved).toMatchObject({
        id: item.id,
        // The address and the title move together: a link that lands on
        // English content is labelled in English.
        url: "/about-en",
        targetTitle: "About",
        // Still the configured target — only the destination follows the view.
        postId: TEST_POST_ID,
      });
    });

    it("leaves the item alone when that language has no version", async () => {
      const item = await addAboutPageNav();

      const [resolved] = await navItemService.list({ language: "ja" });

      expect(resolved).toMatchObject({
        id: item.id,
        url: "/about",
        targetTitle: "关于",
      });
    });

    it("ignores a translation that is not publicly readable", async () => {
      await addAboutPageNav();
      insertTestPost(sqlite, {
        id: TEST_POST_ID_2,
        slug: "about-en",
        title: "About",
        status: "draft",
        language: "en",
        translationGroupId: TRANSLATION_GROUP,
      });
      insertTestPost(sqlite, {
        id: TEST_POST_ID_3,
        slug: "about-ja",
        title: "About (ja)",
        visibility: "private",
        language: "ja",
        translationGroupId: TRANSLATION_GROUP,
      });

      const [draftView] = await navItemService.list({ language: "en" });
      const [privateView] = await navItemService.list({ language: "ja" });

      expect(draftView?.url).toBe("/about");
      expect(privateView?.url).toBe("/about");
    });

    it("keeps a label the author typed, whatever the view", async () => {
      insertTestPost(sqlite, {
        id: TEST_POST_ID,
        slug: "about",
        title: "关于",
        language: "zh-Hans",
        translationGroupId: TRANSLATION_GROUP,
      });
      insertTestPost(sqlite, {
        id: TEST_POST_ID_2,
        slug: "about-en",
        title: "About",
        language: "en",
        translationGroupId: TRANSLATION_GROUP,
      });
      await navItemService.create({
        type: "page",
        postId: TEST_POST_ID,
        label: "自我介绍",
      });

      const [resolved] = await navItemService.list({ language: "en" });

      expect(resolved).toMatchObject({
        label: "自我介绍",
        url: "/about-en",
      });
    });

    it("does not follow translations without a language", async () => {
      const item = await addAboutPageNav();

      const [resolved] = await navItemService.list();

      expect(resolved).toMatchObject({ id: item.id, url: "/about" });
    });
  });

  describe("materializeDefaultNavigation", () => {
    it("creates the five-item default profile without Latest", async () => {
      const created = await navItemService.materializeDefaultNavigation();

      expect(created.map((item) => item.systemKey)).toEqual([
        "featured",
        "archive",
        "collections",
        "rss",
        "settings",
      ]);
      expect(created.map((item) => item.placement)).toEqual([
        "header",
        "header",
        "more",
        "more",
        "more",
      ]);
      expect(created.map((item) => item.systemKey)).not.toContain("latest");
    });

    it("preserves an existing optional Latest item", async () => {
      const latest = await navItemService.create({
        type: "system",
        systemKey: "latest",
      });
      const customizedLatest = await navItemService.update(latest.id, {
        label: "Recent writing",
        placement: "more",
        position: "a3",
      });

      const created = await navItemService.materializeDefaultNavigation();
      const items = await navItemService.list();

      expect(created.map((item) => item.systemKey)).toEqual([
        "featured",
        "archive",
        "collections",
        "rss",
        "settings",
      ]);
      expect(items.find((item) => item.id === latest.id)).toEqual(
        customizedLatest,
      );
      expect(items.filter((item) => item.type === "system")).toHaveLength(6);
    });

    it("only appends missing profile items during recovery", async () => {
      const archive = await navItemService.create({
        type: "system",
        systemKey: "archive",
      });
      const customizedArchive = await navItemService.update(archive.id, {
        label: "All posts",
        placement: "more",
        position: "a2",
      });
      const customLink = await navItemService.create({
        type: "link",
        label: "Elsewhere",
        url: "https://example.com",
        position: "a3",
      });

      const created = await navItemService.materializeDefaultNavigation();
      const items = await navItemService.list();

      expect(created.map((item) => item.systemKey)).toEqual([
        "featured",
        "collections",
        "rss",
        "settings",
      ]);
      expect(items.slice(0, 2).map((item) => item.id)).toEqual([
        archive.id,
        customLink.id,
      ]);
      expect(items.find((item) => item.id === archive.id)).toEqual(
        customizedArchive,
      );
      expect(items.find((item) => item.id === customLink.id)).toEqual(
        customLink,
      );
      expect(items.map((item) => item.systemKey)).not.toContain("latest");
    });

    it("is idempotent when the current profile already exists", async () => {
      await navItemService.materializeDefaultNavigation();

      const created = await navItemService.materializeDefaultNavigation();
      const items = await navItemService.list();

      expect(created).toEqual([]);
      expect(items.filter((item) => item.type === "system")).toHaveLength(5);
    });
  });

  describe("getById", () => {
    it("returns a nav item by ID", async () => {
      const created = await navItemService.create({
        type: "link",
        label: "Home",
        url: "/",
      });

      const found = await navItemService.getById(created.id);
      expect(found).not.toBeNull();
      expect(found?.label).toBe("Home");
      expect(found?.type).toBe("link");
    });

    it("returns null for non-existent ID", async () => {
      const found = await navItemService.getById(
        "00000000-0000-0000-0000-000000009999",
      );
      expect(found).toBeNull();
    });
  });

  describe("list", () => {
    it("returns empty array when no items exist", async () => {
      const items = await navItemService.list();
      expect(items).toEqual([]);
    });

    it("returns items ordered by position", async () => {
      await navItemService.create({
        type: "link",
        label: "C",
        url: "/collections",
        position: "c0",
      });
      await navItemService.create({
        type: "link",
        label: "A",
        url: "/a",
        position: "a0",
      });
      await navItemService.create({
        type: "link",
        label: "B",
        url: "/b",
        position: "b0",
      });

      const items = await navItemService.list();
      expect(items).toHaveLength(3);
      expect(items[0]?.label).toBe("A");
      expect(items[1]?.label).toBe("B");
      expect(items[2]?.label).toBe("C");
    });

    it("returns items with correct types", async () => {
      await navItemService.create({
        type: "link",
        label: "External",
        url: "https://example.com",
      });
      await navItemService.create({
        type: "system",
        systemKey: "settings",
      });

      const items = await navItemService.list();
      expect(items).toHaveLength(2);
      expect(items[0]?.type).toBe("link");
      expect(items[1]?.type).toBe("system");
      expect(items[1]?.systemKey).toBe("settings");
    });
  });

  describe("listPageCandidates", () => {
    it("returns eligible notes by title and excludes added pages", async () => {
      insertTestPost(sqlite, {
        id: TEST_POST_ID,
        slug: "about",
        title: "About this site",
        visibility: "latest_hidden",
      });
      insertTestPost(sqlite, {
        id: TEST_POST_ID_2,
        slug: "another-note",
        title: "Another note",
        visibility: "public",
      });
      insertTestPost(sqlite, {
        id: TEST_POST_ID_3,
        slug: "about-link",
        title: "About link",
        format: "link",
      });
      insertTestPost(sqlite, {
        id: TEST_POST_ID_4,
        slug: "about-draft",
        title: "About draft",
        status: "draft",
      });

      expect(
        await navItemService.listPageCandidates({ query: "ABOUT" }),
      ).toEqual([
        {
          id: TEST_POST_ID,
          title: "About this site",
          slug: "about",
          updatedAt: expect.any(Number),
        },
      ]);

      await navItemService.create({ type: "page", postId: TEST_POST_ID });
      expect(
        await navItemService.listPageCandidates({ query: "about" }),
      ).toEqual([]);
    });
  });

  describe("resolveNavTarget", () => {
    it("resolves a page address to the item it can become", async () => {
      insertTestPost(sqlite, {
        id: TEST_POST_ID,
        slug: "about",
        title: "About this site",
        visibility: "latest_hidden",
      });

      expect(await navItemService.resolveNavTarget("/about")).toEqual({
        status: "page",
        page: {
          id: TEST_POST_ID,
          title: "About this site",
          slug: "about",
          updatedAt: expect.any(Number),
        },
      });
    });

    it("reports an address navigation can only hold as a link", async () => {
      // A custom archive URL is a real page with no post behind it, so no page
      // item can track it.
      insertTestPath(sqlite, {
        id: "pth_archive000000000000000000",
        path: "reading-2025",
        kind: "archive",
        archiveQuery: "year=2025",
      });

      expect(await navItemService.resolveNavTarget("/reading-2025")).toEqual({
        status: "link_only",
      });
    });

    it("resolves an alias to the post's canonical slug", async () => {
      insertTestPost(sqlite, {
        id: TEST_POST_ID,
        slug: "about",
        title: "About this site",
      });
      insertTestPath(sqlite, {
        id: "pth_alias0000000000000000000000",
        path: "about-us",
        kind: "alias",
        postId: TEST_POST_ID,
      });

      // The menu should show where the page lives, not the old address the
      // author happened to have in their history.
      expect(await navItemService.resolveNavTarget("/about-us")).toEqual(
        expect.objectContaining({
          status: "page",
          page: expect.objectContaining({ slug: "about" }),
        }),
      );
    });
  });

  describe("listSuggestedLinks", () => {
    it("suggests a published /about page as a page nav item", async () => {
      insertTestPost(sqlite, {
        id: TEST_POST_ID,
        slug: "about",
        title: "About me",
      });

      const suggestions = await navItemService.listSuggestedLinks();

      expect(suggestions).toEqual([
        {
          key: "about",
          label: "About me",
          url: "/about",
          targetType: "page",
          navItemType: "page",
          postId: TEST_POST_ID,
        },
      ]);
    });

    it("suggests a canonical /now collection as a collection nav item", async () => {
      insertTestCollection(sqlite, TEST_COLLECTION_ID, "now", "Now");

      const suggestions = await navItemService.listSuggestedLinks();

      expect(suggestions).toEqual([
        {
          key: "now",
          label: "Now",
          url: "/now",
          targetType: "collection",
          navItemType: "collection",
          collectionId: TEST_COLLECTION_ID,
        },
      ]);
    });

    it("suggests a /now collection alias as a normal link to preserve the path", async () => {
      insertTestCollection(sqlite, TEST_COLLECTION_ID, "updates", "Updates");
      insertTestPath(sqlite, {
        id: "pth_now_alias",
        path: "now",
        kind: "alias",
        collectionId: TEST_COLLECTION_ID,
      });

      const suggestions = await navItemService.listSuggestedLinks();

      expect(suggestions).toEqual([
        {
          key: "now",
          label: "Updates",
          url: "/now",
          targetType: "collection",
          navItemType: "link",
        },
      ]);
    });

    it("hides suggestions already represented by path or collection id", async () => {
      insertTestPost(sqlite, {
        id: TEST_POST_ID,
        slug: "about",
        title: "About",
      });
      insertTestCollection(sqlite, TEST_COLLECTION_ID, "now", "Now");

      await navItemService.create({
        type: "link",
        label: "About",
        url: "/about/",
      });
      await navItemService.create({
        type: "collection",
        collectionId: TEST_COLLECTION_ID,
        label: "Now",
        url: "/now",
      });

      const suggestions = await navItemService.listSuggestedLinks();

      expect(suggestions).toEqual([]);
    });

    it("hides suggestions already represented by a same-site absolute URL", async () => {
      insertTestPost(sqlite, {
        id: TEST_POST_ID,
        slug: "about",
        title: "About",
      });

      await navItemService.create({
        type: "link",
        label: "About",
        url: "https://preview-test.owenyoung.com/about",
      });

      const suggestions = await navItemService.listSuggestedLinks({
        siteOrigin: "https://preview-test.owenyoung.com",
      });

      expect(suggestions).toEqual([]);
    });

    it("hides suggestions already represented by a public path prefix", async () => {
      insertTestPost(sqlite, {
        id: TEST_POST_ID,
        slug: "about",
        title: "About",
      });

      await navItemService.create({
        type: "link",
        label: "About",
        url: "https://example.com/blog/about",
      });

      const suggestions = await navItemService.listSuggestedLinks({
        siteOrigin: "https://example.com",
        sitePathPrefix: "/blog",
      });

      expect(suggestions).toEqual([]);
    });

    it("does not suggest draft or private posts", async () => {
      insertTestPost(sqlite, {
        id: TEST_POST_ID,
        slug: "about",
        title: "About",
        status: "draft",
      });
      insertTestPost(sqlite, {
        id: TEST_POST_ID_2,
        slug: "now",
        title: "Now",
        visibility: "private",
      });

      const suggestions = await navItemService.listSuggestedLinks();

      expect(suggestions).toEqual([]);
    });
  });

  describe("update", () => {
    it("updates a nav item's label", async () => {
      const created = await navItemService.create({
        type: "link",
        label: "Home",
        url: "/",
      });

      const updated = await navItemService.update(created.id, {
        label: "Main Page",
      });

      expect(updated?.label).toBe("Main Page");
      expect(updated?.url).toBe("/");
      expect(updated?.type).toBe("link");
    });

    it("updates a nav item's url", async () => {
      const created = await navItemService.create({
        type: "link",
        label: "Blog",
        url: "/blog",
      });

      const updated = await navItemService.update(created.id, {
        url: "/posts",
      });

      expect(updated?.url).toBe("/posts");
      expect(updated?.label).toBe("Blog");
    });

    it("updates updatedAt timestamp", async () => {
      const created = await navItemService.create({
        type: "link",
        label: "Home",
        url: "/",
      });

      const updated = await navItemService.update(created.id, {
        label: "Updated",
      });

      expect(updated?.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
    });

    it("returns null for non-existent ID", async () => {
      const result = await navItemService.update(
        "00000000-0000-0000-0000-000000009999",
        { label: "Nope" },
      );
      expect(result).toBeNull();
    });

    it("allows label changes for built-in system items", async () => {
      const created = await navItemService.create({
        type: "system",
        systemKey: "archive",
      });

      const updated = await navItemService.update(created.id, {
        label: "Everything",
      });

      expect(updated?.label).toBe("Everything");
    });

    it("rejects URL changes for built-in system items", async () => {
      const created = await navItemService.create({
        type: "system",
        systemKey: "archive",
      });

      await expect(
        navItemService.update(created.id, {
          url: "/custom-archive",
        }),
      ).rejects.toThrow("Built-in navigation URLs are managed automatically");
    });
  });

  describe("delete", () => {
    it("deletes a nav item by ID", async () => {
      const item = await navItemService.create({
        type: "link",
        label: "Home",
        url: "/",
      });
      const result = await navItemService.delete(item.id);

      expect(result).toBe(true);

      const found = await navItemService.getById(item.id);
      expect(found).toBeNull();
    });

    it("returns false for non-existent ID", async () => {
      const result = await navItemService.delete(
        "00000000-0000-0000-0000-000000009999",
      );
      expect(result).toBe(false);
    });
  });

  describe("move", () => {
    it("moves an item between two others", async () => {
      const a = await navItemService.create({
        type: "link",
        label: "A",
        url: "/a",
      });
      const b = await navItemService.create({
        type: "link",
        label: "B",
        url: "/b",
      });
      const c = await navItemService.create({
        type: "link",
        label: "C",
        url: "/collections",
      });

      // Move C between A and B
      await navItemService.move(c.id, a.id, b.id);

      const items = await navItemService.list();
      expect(items[0]?.label).toBe("A");
      expect(items[1]?.label).toBe("C");
      expect(items[2]?.label).toBe("B");
    });

    it("moves an item to the beginning", async () => {
      const a = await navItemService.create({
        type: "link",
        label: "A",
        url: "/a",
      });
      await navItemService.create({
        type: "link",
        label: "B",
        url: "/b",
      });
      const c = await navItemService.create({
        type: "link",
        label: "C",
        url: "/collections",
      });

      // Move C before A
      await navItemService.move(c.id, null, a.id);

      const items = await navItemService.list();
      expect(items[0]?.label).toBe("C");
      expect(items[1]?.label).toBe("A");
      expect(items[2]?.label).toBe("B");
    });

    it("moves an item to the end", async () => {
      const a = await navItemService.create({
        type: "link",
        label: "A",
        url: "/a",
      });
      await navItemService.create({
        type: "link",
        label: "B",
        url: "/b",
      });
      const c = await navItemService.create({
        type: "link",
        label: "C",
        url: "/collections",
      });

      // Move A after C
      await navItemService.move(a.id, c.id, null);

      const items = await navItemService.list();
      expect(items[0]?.label).toBe("B");
      expect(items[1]?.label).toBe("C");
      expect(items[2]?.label).toBe("A");
    });

    it("returns null for non-existent item", async () => {
      const result = await navItemService.move(
        "00000000-0000-0000-0000-000000009999",
        null,
        null,
      );
      expect(result).toBeNull();
    });
  });

  describe("collection nav items", () => {
    beforeEach(() => {
      insertTestCollection(sqlite, TEST_COLLECTION_ID, "design", "Design");
      insertTestCollection(sqlite, TEST_COLLECTION_ID_2, "reading", "Reading");
    });

    it("creates a collection nav item", async () => {
      const item = await navItemService.create({
        type: "collection",
        collectionId: TEST_COLLECTION_ID,
        label: "Design",
        url: "/design",
      });

      expect(item.type).toBe("collection");
      expect(item.collectionId).toBe(TEST_COLLECTION_ID);
      expect(item.label).toBe("Design");
      expect(item.url).toBe("/design");
      expect(item.placement).toBe("header");
    });

    it("rejects duplicate collection nav items", async () => {
      await navItemService.create({
        type: "collection",
        collectionId: TEST_COLLECTION_ID,
        label: "Design",
        url: "/design",
      });

      await expect(
        navItemService.create({
          type: "collection",
          collectionId: TEST_COLLECTION_ID,
          label: "Design Again",
          url: "/design",
        }),
      ).rejects.toThrow("Collection already added to navigation");
    });

    it("allows different collections as separate nav items", async () => {
      await navItemService.create({
        type: "collection",
        collectionId: TEST_COLLECTION_ID,
        label: "Design",
        url: "/design",
      });
      const second = await navItemService.create({
        type: "collection",
        collectionId: TEST_COLLECTION_ID_2,
        label: "Reading",
        url: "/reading",
      });

      expect(second.collectionId).toBe(TEST_COLLECTION_ID_2);
      const items = await navItemService.list();
      expect(items.filter((i) => i.type === "collection")).toHaveLength(2);
    });

    it("allows label updates for collection nav items", async () => {
      const item = await navItemService.create({
        type: "collection",
        collectionId: TEST_COLLECTION_ID,
        label: "Design",
        url: "/design",
      });

      const updated = await navItemService.update(item.id, {
        label: "Design Notes",
      });
      expect(updated?.label).toBe("Design Notes");
    });

    it("rejects URL updates for collection nav items", async () => {
      const item = await navItemService.create({
        type: "collection",
        collectionId: TEST_COLLECTION_ID,
        label: "Design",
        url: "/design",
      });

      await expect(
        navItemService.update(item.id, { url: "/other" }),
      ).rejects.toThrow("Collection navigation URLs are managed automatically");
    });
  });

  describe("page nav items", () => {
    beforeEach(() => {
      insertTestPost(sqlite, {
        id: TEST_POST_ID,
        slug: "about",
        title: "About",
      });
    });

    it("allows label updates but keeps the page URL managed", async () => {
      const item = await navItemService.create({
        type: "page",
        postId: TEST_POST_ID,
      });

      const updated = await navItemService.update(item.id, {
        label: "Start here",
      });
      expect(updated?.label).toBe("Start here");

      await expect(
        navItemService.update(item.id, { url: "/other" }),
      ).rejects.toThrow("Page navigation URLs are managed automatically");
    });
  });

  describe("getCollectionFreshness", () => {
    beforeEach(() => {
      insertTestCollection(sqlite, TEST_COLLECTION_ID, "design", "Design");
    });

    it("returns empty set when no collections have recent activity", async () => {
      const result = await navItemService.getCollectionFreshness([
        TEST_COLLECTION_ID,
      ]);
      expect(result.size).toBe(0);
    });

    it("returns collection ID when a post was recently added", async () => {
      const ts = now();
      // Insert a post
      sqlite
        .prepare(
          `INSERT INTO post (id, site_id, thread_id, format, status, visibility, created_at, updated_at, last_activity_at)
           VALUES (?, ?, ?, 'note', 'published', 'public', ?, ?, ?)`,
        )
        .run("pst_test001", DEFAULT_TEST_SITE_ID, "pst_test001", ts, ts, ts);
      // Add it to the collection recently
      sqlite
        .prepare(
          `INSERT INTO thread_collection (site_id, thread_id, collection_id, created_at, position)
           VALUES (?, ?, ?, ?, 0)`,
        )
        .run(DEFAULT_TEST_SITE_ID, "pst_test001", TEST_COLLECTION_ID, ts);

      const result = await navItemService.getCollectionFreshness([
        TEST_COLLECTION_ID,
      ]);
      expect(result.has(TEST_COLLECTION_ID)).toBe(true);
    });

    it("does not return collection with old activity", async () => {
      const oldTs = now() - 60 * 60 * 72; // 72 hours ago
      sqlite
        .prepare(
          `INSERT INTO post (id, site_id, thread_id, format, status, visibility, created_at, updated_at, last_activity_at)
           VALUES (?, ?, ?, 'note', 'published', 'public', ?, ?, ?)`,
        )
        .run(
          "pst_test002",
          DEFAULT_TEST_SITE_ID,
          "pst_test002",
          oldTs,
          oldTs,
          oldTs,
        );
      sqlite
        .prepare(
          `INSERT INTO thread_collection (site_id, thread_id, collection_id, created_at, position)
           VALUES (?, ?, ?, ?, 0)`,
        )
        .run(DEFAULT_TEST_SITE_ID, "pst_test002", TEST_COLLECTION_ID, oldTs);

      const result = await navItemService.getCollectionFreshness([
        TEST_COLLECTION_ID,
      ]);
      expect(result.has(TEST_COLLECTION_ID)).toBe(false);
    });

    it("detects freshness from a recent root edit even when Thread activity is old", async () => {
      const oldTs = now() - 60 * 60 * 72;
      const recentTs = now();
      sqlite
        .prepare(
          `INSERT INTO post (id, site_id, thread_id, format, status, visibility, created_at, updated_at, last_activity_at)
           VALUES (?, ?, ?, 'note', 'published', 'public', ?, ?, ?)`,
        )
        .run(
          "pst_edited",
          DEFAULT_TEST_SITE_ID,
          "pst_edited",
          oldTs,
          recentTs,
          oldTs,
        );
      sqlite
        .prepare(
          `INSERT INTO thread_collection (site_id, thread_id, collection_id, created_at, position)
           VALUES (?, ?, ?, ?, 0)`,
        )
        .run(DEFAULT_TEST_SITE_ID, "pst_edited", TEST_COLLECTION_ID, oldTs);

      const result = await navItemService.getCollectionFreshness([
        TEST_COLLECTION_ID,
      ]);
      expect(result.get(TEST_COLLECTION_ID)).toBe(recentTs);
    });

    it("detects freshness from recent thread replies", async () => {
      const oldTs = now() - 60 * 60 * 72; // 72 hours ago
      const recentTs = now();

      // Create a thread root post (old)
      sqlite
        .prepare(
          `INSERT INTO post (id, site_id, thread_id, format, status, visibility, created_at, updated_at, last_activity_at)
           VALUES (?, ?, ?, 'note', 'published', 'public', ?, ?, ?)`,
        )
        .run(
          "pst_root",
          DEFAULT_TEST_SITE_ID,
          "pst_root",
          oldTs,
          oldTs,
          recentTs,
        );

      // Add the root to the collection (old)
      sqlite
        .prepare(
          `INSERT INTO thread_collection (site_id, thread_id, collection_id, created_at, position)
           VALUES (?, ?, ?, ?, 0)`,
        )
        .run(DEFAULT_TEST_SITE_ID, "pst_root", TEST_COLLECTION_ID, oldTs);

      // Create a recent reply to the thread
      sqlite
        .prepare(
          `INSERT INTO post (id, site_id, thread_id, reply_to_id, format, status, visibility, created_at, updated_at, last_activity_at)
           VALUES (?, ?, ?, ?, 'note', 'published', 'public', ?, ?, ?)`,
        )
        .run(
          "pst_reply",
          DEFAULT_TEST_SITE_ID,
          "pst_root",
          "pst_root",
          recentTs,
          recentTs,
          recentTs,
        );

      const result = await navItemService.getCollectionFreshness([
        TEST_COLLECTION_ID,
      ]);
      expect(result.has(TEST_COLLECTION_ID)).toBe(true);
    });
  });
});
