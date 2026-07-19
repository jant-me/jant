import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestDatabase,
  DEFAULT_TEST_SITE_ID,
} from "../../__tests__/helpers/db.js";
import { createSearchService } from "../search.js";
import { createPostService } from "../post.js";
import type { Database } from "../../db/index.js";
import type { RawQueryClient } from "../../db/raw-query.js";
import type BetterSqlite3 from "better-sqlite3";
import { eq } from "drizzle-orm";
import { posts } from "../../db/schema.js";
import { POST_BODY_HTML_VERSION } from "../../lib/post-body-html.js";

/** Wraps plain text in a minimal valid TipTap JSON document. */
function tiptapDoc(text: string): string {
  return JSON.stringify({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text }],
      },
    ],
  });
}

function createSearchRow(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "pst_01jpyz2pvf4m7s2k8r5c9t0qce",
    site_id: DEFAULT_TEST_SITE_ID,
    format: "note",
    status: "published",
    visibility: "public",
    effective_visibility: "public",
    pinned_at: null,
    featured_at: null,
    slug: "hello-world",
    title: "Hello World",
    url: null,
    body: tiptapDoc("Hello world"),
    body_html: "<p>Hello world</p>",
    body_html_version: POST_BODY_HTML_VERSION,
    body_text: "Hello world",
    quote_text: null,
    summary: null,
    rating: null,
    reply_to_id: null,
    thread_id: "pst_01jpyz2pvf4m7s2k8r5c9t0qce",
    published_at: 1774009100,
    last_activity_at: 1774009100,
    created_at: 1774009100,
    updated_at: 1774009100,
    rank: 0,
    snippet: null,
    ...overrides,
  };
}

describe("SearchService", () => {
  let db: Database;
  let sqlite: BetterSqlite3.Database;
  let postService: ReturnType<typeof createPostService>;

  // Create a mock D1Database interface wrapping better-sqlite3
  function createMockD1(sqliteDb: BetterSqlite3.Database) {
    return {
      prepare(query: string) {
        return {
          bind(...params: unknown[]) {
            return {
              async all<T>() {
                const stmt = sqliteDb.prepare(query);
                const rows = stmt.all(...(params as never[])) as T[];
                return { results: rows };
              },
            };
          },
        };
      },
    } as unknown as D1Database;
  }

  beforeEach(() => {
    const testDb = createTestDatabase({ fts: true });
    db = testDb.db as unknown as Database;
    sqlite = testDb.sqlite;
    postService = createPostService(
      db,
      { slugIdLength: 5 },
      DEFAULT_TEST_SITE_ID,
    );
  });

  it("returns empty results for empty query", async () => {
    const d1 = createMockD1(sqlite);
    const searchService = createSearchService(d1, DEFAULT_TEST_SITE_ID);

    const results = await searchService.search("");
    expect(results).toEqual([]);
  });

  it("returns empty results for whitespace-only query", async () => {
    const d1 = createMockD1(sqlite);
    const searchService = createSearchService(d1, DEFAULT_TEST_SITE_ID);

    const results = await searchService.search("   ");
    expect(results).toEqual([]);
  });

  it("finds posts by content", async () => {
    await postService.create({
      format: "note",
      body: tiptapDoc("Hello world from jant"),
    });
    await postService.create({
      format: "note",
      body: tiptapDoc("Another post entirely"),
    });

    const d1 = createMockD1(sqlite);
    const searchService = createSearchService(d1, DEFAULT_TEST_SITE_ID);

    const results = await searchService.search("jant");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]?.post.bodyText).toContain("jant");
  });

  it("finds posts by title", async () => {
    await postService.create({
      format: "note",
      title: "Introduction to TypeScript",
      body: tiptapDoc("Some article body"),
    });

    const d1 = createMockD1(sqlite);
    const searchService = createSearchService(d1, DEFAULT_TEST_SITE_ID);

    const results = await searchService.search("TypeScript");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]?.post.title).toContain("TypeScript");
  });

  it("resolves stale body HTML on the raw search read path", async () => {
    const body = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "semanticneedle" },
            { type: "footnoteReference", attrs: { label: "1" } },
          ],
        },
        {
          type: "footnoteDefinition",
          attrs: { label: "1" },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Definition" }],
            },
          ],
        },
      ],
    });
    const post = await postService.create({ format: "note", body });
    await db
      .update(posts)
      .set({
        bodyHtml: '<span class="sidenote">legacy</span>',
        bodyHtmlVersion: 1,
      })
      .where(eq(posts.id, post.id));

    const searchService = createSearchService(
      createMockD1(sqlite),
      DEFAULT_TEST_SITE_ID,
    );
    const results = await searchService.search("semanticneedle");

    expect(results[0]?.post.bodyHtml).toContain('role="doc-noteref"');
    expect(results[0]?.post.bodyHtml).toMatch(/id="fn-[a-z0-9]{13}-1"/);
    expect(results[0]?.post.bodyHtml).not.toContain(post.id);
    expect(results[0]?.post.bodyHtml).not.toContain("legacy");
  });

  it("respects status filter", async () => {
    await postService.create({
      format: "note",
      body: tiptapDoc("published post about testing"),
    });
    await postService.create({
      format: "note",
      body: tiptapDoc("draft post about testing"),
      status: "draft",
    });

    const d1 = createMockD1(sqlite);
    const searchService = createSearchService(d1, DEFAULT_TEST_SITE_ID);

    const results = await searchService.search("testing", {
      status: ["published"],
    });

    expect(results.every((r) => r.post.status === "published")).toBe(true);
  });

  it("excludes deleted posts", async () => {
    const post = await postService.create({
      format: "note",
      body: tiptapDoc("deleted post with unique search term xyzzy"),
    });
    await postService.delete(post.id);

    const d1 = createMockD1(sqlite);
    const searchService = createSearchService(d1, DEFAULT_TEST_SITE_ID);

    const results = await searchService.search("xyzzy");
    expect(results).toHaveLength(0);
  });

  it("supports limit and offset", async () => {
    for (let i = 0; i < 5; i++) {
      await postService.create({
        format: "note",
        body: tiptapDoc(`searchable post number ${i}`),
      });
    }

    const d1 = createMockD1(sqlite);
    const searchService = createSearchService(d1, DEFAULT_TEST_SITE_ID);

    const limited = await searchService.search("searchable", { limit: 2 });
    expect(limited.length).toBeLessThanOrEqual(2);
  });

  it("finds link posts by URL", async () => {
    await postService.create({
      format: "link",
      title: "Example Site",
      url: "https://example.com/article",
    });

    const d1 = createMockD1(sqlite);
    const searchService = createSearchService(d1, DEFAULT_TEST_SITE_ID);

    const results = await searchService.search("example.com");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]?.post.url).toContain("example.com");
  });

  it("finds posts by URL embedded in inline markdown links", async () => {
    // TipTap stores markdown links as marks on text nodes. Their href
    // must reach body_text so users can search for the URL, not just
    // the visible link text.
    const bodyWithLink = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "See " },
            {
              type: "text",
              text: "this page",
              marks: [
                {
                  type: "link",
                  attrs: { href: "https://inline-link.example/article" },
                },
              ],
            },
            { type: "text", text: " for details." },
          ],
        },
      ],
    });

    await postService.create({
      format: "note",
      body: bodyWithLink,
    });

    const d1 = createMockD1(sqlite);
    const searchService = createSearchService(d1, DEFAULT_TEST_SITE_ID);

    // Searching by the link's URL host should match.
    const byUrl = await searchService.search("inline-link.example");
    expect(byUrl.length).toBeGreaterThanOrEqual(1);

    // Regression guard: the visible link text still matches too.
    const byText = await searchService.search("this page");
    expect(byText.length).toBeGreaterThanOrEqual(1);
  });

  it("finds posts with short queries (< 3 chars) via LIKE fallback", async () => {
    await postService.create({
      format: "note",
      body: tiptapDoc("自由软件"),
    });

    const d1 = createMockD1(sqlite);
    const searchService = createSearchService(d1, DEFAULT_TEST_SITE_ID);

    // "自由" is 2 Chinese characters — below trigram minimum, uses LIKE
    const results = await searchService.search("自由");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]?.snippet).toContain("<mark>自由</mark>");
  });

  it("does not match TipTap JSON structural tokens", async () => {
    await postService.create({
      format: "note",
      body: tiptapDoc("Hello world"),
    });

    const d1 = createMockD1(sqlite);
    const searchService = createSearchService(d1, DEFAULT_TEST_SITE_ID);

    // "paragraph" is a JSON key in TipTap but not user content
    const results = await searchService.search("paragraph");
    expect(results).toHaveLength(0);
  });

  it("uses weighted FTS for Postgres searches with ts_headline snippets", async () => {
    const calls: { params: unknown[]; query: string }[] = [];
    const rawQuery: RawQueryClient = {
      prepare(query) {
        const call = { params: [], query };
        calls.push(call);

        return {
          bind(...params: unknown[]) {
            call.params = params;
            return this;
          },
          async all() {
            return { results: [createSearchRow()] };
          },
        };
      },
    };

    const searchService = createSearchService(
      rawQuery,
      DEFAULT_TEST_SITE_ID,
      "pg",
    );
    const results = await searchService.search("jant");

    expect(results).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.query).toContain("search_document @@");
    expect(calls[0]?.query).toContain("ts_headline");
    expect(calls[0]?.params[0]).toBe("jant:*");
  });

  it("keeps Postgres searches on the LIKE path for short queries", async () => {
    const calls: string[] = [];
    const rawQuery: RawQueryClient = {
      prepare(query) {
        calls.push(query);
        return {
          bind() {
            return this;
          },
          async all() {
            return { results: [createSearchRow()] };
          },
        };
      },
    };

    const searchService = createSearchService(
      rawQuery,
      DEFAULT_TEST_SITE_ID,
      "pg",
    );
    await searchService.search("自由");

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("search_text ILIKE");
  });

  it("builds fallback snippets for Postgres LIKE searches", async () => {
    const rawQuery: RawQueryClient = {
      prepare() {
        return {
          bind() {
            return this;
          },
          async all() {
            return {
              results: [
                createSearchRow({
                  body_text: "Hello from the Postgres fallback path",
                  snippet: null,
                }),
              ],
            };
          },
        };
      },
    };

    const searchService = createSearchService(
      rawQuery,
      DEFAULT_TEST_SITE_ID,
      "pg",
    );
    const results = await searchService.search("Postgres");

    expect(results[0]?.snippet).toContain("<mark>Postgres</mark>");
  });
});
