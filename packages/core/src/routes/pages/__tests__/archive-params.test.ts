import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { archiveRoutes } from "../archive.js";

/**
 * Integration coverage for archive filter param handling.
 *
 * The page and the feed share parseArchiveParams. These tests pin down:
 * - the new single-word params (title/replies/media=any|none),
 * - the legacy hasTitle/hasReplies/hasMedia=1/0 fallback on the feed,
 *   which keeps old subscriptions and stored custom archive URLs working,
 * - the 308 canonical redirect on the page route for legacy spellings.
 */

async function fetchFeed(
  app: { request: (path: string) => Promise<Response> },
  query: string,
): Promise<string> {
  const res = await app.request(`/archive/feed${query}`);
  expect(res.status).toBe(200);
  return res.text();
}

function setupApp(rssPublishDelaySeconds = 0) {
  const { app, services } = createTestApp({
    authenticated: false,
    rssPublishDelaySeconds,
  });
  app.route("/archive", archiveRoutes);
  return { app, services };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("archive feed filter params", () => {
  it("applies the RSS publication delay", async () => {
    const currentTime = 2_000_000;
    vi.spyOn(Date, "now").mockReturnValue(currentTime * 1000);
    const { app, services } = setupApp(300);
    await services.posts.create({
      format: "note",
      title: "Eligible Archive Post",
      bodyMarkdown: "Old enough for RSS",
      status: "published",
      publishedAt: currentTime - 300,
    });
    await services.posts.create({
      format: "note",
      title: "Recent Archive Post",
      bodyMarkdown: "Still inside the edit window",
      status: "published",
      publishedAt: currentTime,
    });

    const xml = await fetchFeed(app, "");

    expect(xml).toContain("Eligible Archive Post");
    expect(xml).not.toContain("Recent Archive Post");
  });

  it("filters by title with the new param and the legacy fallback", async () => {
    const { app, services } = setupApp();
    await services.posts.create({
      format: "note",
      title: "Titled post",
      bodyMarkdown: "body with heading",
    });
    await services.posts.create({
      format: "note",
      bodyMarkdown: "body without heading",
    });

    const fresh = await fetchFeed(app, "?title=none");
    expect(fresh).toContain("body without heading");
    expect(fresh).not.toContain("body with heading");

    const legacy = await fetchFeed(app, "?hasTitle=0");
    expect(legacy).toContain("body without heading");
    expect(legacy).not.toContain("body with heading");
  });

  it("filters by replies with the new param and the legacy fallback", async () => {
    const { app, services } = setupApp();
    const root = await services.posts.create({
      format: "note",
      bodyMarkdown: "thread root body",
    });
    await services.posts.create({
      format: "note",
      bodyMarkdown: "reply body",
      replyToId: root.id,
    });
    await services.posts.create({
      format: "note",
      bodyMarkdown: "standalone body",
    });

    const threads = await fetchFeed(app, "?replies=any");
    expect(threads).toContain("thread root body");
    expect(threads).not.toContain("standalone body");

    const singles = await fetchFeed(app, "?replies=none");
    expect(singles).toContain("standalone body");
    expect(singles).not.toContain("thread root body");

    const legacySingles = await fetchFeed(app, "?hasReplies=0");
    expect(legacySingles).toContain("standalone body");
    expect(legacySingles).not.toContain("thread root body");
  });

  it("treats media=none as the legacy hasMedia=0", async () => {
    const { app, services } = setupApp();
    await services.posts.create({
      format: "note",
      bodyMarkdown: "text only body",
    });
    await services.media.create({
      filename: "unattached.jpg",
      originalName: "unattached.jpg",
      mimeType: "image/jpeg",
      size: 1024,
      storageKey: "media/unattached.jpg",
    });

    const fresh = await fetchFeed(app, "?media=none");
    expect(fresh).toContain("text only body");

    const page = await app.request("/archive?media=none");
    expect(page.status).toBe(200);
    const pageHtml = await page.text();
    expect(pageHtml).toContain('aria-label="1 thread"');
    expect(pageHtml).toContain("text only body");

    const legacy = await fetchFeed(app, "?hasMedia=0");
    expect(legacy).toContain("text only body");

    const withMedia = await fetchFeed(app, "?media=any");
    expect(withMedia).not.toContain("text only body");
  });
});

describe("archive feed ordering", () => {
  // The feed belongs to the archive page, so it uses the page's default axis.
  // Ordering by activity would let a reply to an old Thread reshuffle the
  // feed window under a fixed rssFeedLimit, and readers key entries by id
  // anyway — a moved entry is not a re-surfaced one. /latest/feed is where
  // activity ordering lives.
  it("orders by publication, not by recent replies", async () => {
    const { app, services } = setupApp();
    const oldThread = await services.posts.create({
      format: "note",
      title: "Old thread with a new reply",
      bodyMarkdown: "root from 2019",
      publishedAt: Date.UTC(2019, 0, 1) / 1000,
    });
    await services.posts.create({
      format: "note",
      bodyMarkdown: "reply from 2026",
      replyToId: oldThread.id,
      publishedAt: Date.UTC(2026, 5, 1) / 1000,
    });
    await services.posts.create({
      format: "note",
      title: "Plain newer post",
      bodyMarkdown: "root from 2025",
      publishedAt: Date.UTC(2025, 0, 1) / 1000,
    });

    const xml = await fetchFeed(app, "");

    expect(xml.indexOf("Plain newer post")).toBeLessThan(
      xml.indexOf("Old thread with a new reply"),
    );
  });

  it("honors an explicit sort=updated, quiet replies included", async () => {
    const { app, services } = setupApp();
    const oldThread = await services.posts.create({
      format: "note",
      title: "Old thread with a new reply",
      bodyMarkdown: "root from 2019",
      publishedAt: Date.UTC(2019, 0, 1) / 1000,
    });
    await services.posts.create({
      format: "note",
      bodyMarkdown: "quiet addition",
      replyToId: oldThread.id,
      publishedAt: Date.UTC(2026, 5, 1) / 1000,
      quietReply: true,
    });
    await services.posts.create({
      format: "note",
      title: "Plain newer post",
      bodyMarkdown: "root from 2025",
      publishedAt: Date.UTC(2025, 0, 1) / 1000,
    });

    const updated = await fetchFeed(app, "?sort=updated");
    expect(updated.indexOf("Old thread with a new reply")).toBeLessThan(
      updated.indexOf("Plain newer post"),
    );

    // Same URL param, same axis as the page — the default stays chronological.
    const chronological = await fetchFeed(app, "");
    expect(chronological.indexOf("Plain newer post")).toBeLessThan(
      chronological.indexOf("Old thread with a new reply"),
    );
  });

  it("scopes a year filter to the axis the feed is sorted on", async () => {
    const { app, services } = setupApp();
    const oldThread = await services.posts.create({
      format: "note",
      title: "Extended in 2026",
      bodyMarkdown: "root from 2019",
      publishedAt: Date.UTC(2019, 0, 1) / 1000,
    });
    await services.posts.create({
      format: "note",
      bodyMarkdown: "addition",
      replyToId: oldThread.id,
      publishedAt: Date.UTC(2026, 5, 1) / 1000,
    });
    await services.posts.create({
      format: "note",
      title: "Published in 2025",
      bodyMarkdown: "root from 2025",
      publishedAt: Date.UTC(2025, 0, 1) / 1000,
    });

    const byActivity = await fetchFeed(app, "?sort=updated&year=2026");
    expect(byActivity).toContain("Extended in 2026");
    expect(byActivity).not.toContain("Published in 2025");

    const byPublication = await fetchFeed(app, "?year=2025");
    expect(byPublication).toContain("Published in 2025");
    expect(byPublication).not.toContain("Extended in 2026");
  });

  it("keeps the same order after an old thread gains a reply", async () => {
    const { app, services } = setupApp();
    const first = await services.posts.create({
      format: "note",
      title: "Alpha",
      bodyMarkdown: "alpha root",
      publishedAt: Date.UTC(2020, 0, 1) / 1000,
    });
    await services.posts.create({
      format: "note",
      title: "Beta",
      bodyMarkdown: "beta root",
      publishedAt: Date.UTC(2021, 0, 1) / 1000,
    });

    const before = await fetchFeed(app, "");
    const orderBefore = before.indexOf("Beta") < before.indexOf("Alpha");

    await services.posts.create({
      format: "note",
      bodyMarkdown: "late addition",
      replyToId: first.id,
      publishedAt: Date.UTC(2026, 0, 1) / 1000,
    });

    const after = await fetchFeed(app, "");
    expect(after.indexOf("Beta") < after.indexOf("Alpha")).toBe(orderBefore);
  });
});

describe("archive page legacy param redirect", () => {
  it("redirects legacy boolean params to their single-word spelling", async () => {
    const { app } = setupApp();

    const res = await app.request("/archive?hasTitle=0");
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("/archive?title=none");
  });

  it("preserves other params and rewrites only legacy ones", async () => {
    const { app } = setupApp();

    const res = await app.request(
      "/archive?format=note&hasReplies=1&utm_source=newsletter",
    );
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(
      "/archive?format=note&utm_source=newsletter&replies=any",
    );
  });

  it("redirects visibility=latest_hidden to the hidden alias", async () => {
    const { app } = setupApp();

    const res = await app.request("/archive?visibility=latest_hidden");
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("/archive?visibility=hidden");
  });

  it("drops a legacy param without overriding an explicit new one", async () => {
    const { app } = setupApp();

    const res = await app.request("/archive?title=any&hasTitle=0");
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("/archive?title=any");
  });

  // `view` was renamed to `layout` so `view` can name the saved-selection
  // concept. Shared links and bookmarks predate the rename.
  it("redirects the legacy view param to layout", async () => {
    const { app } = setupApp();

    const res = await app.request("/archive?view=grid");
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("/archive?layout=grid");
  });

  it("keeps layout when a URL carries both spellings", async () => {
    const { app } = setupApp();

    const res = await app.request("/archive?layout=list&view=grid");
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("/archive?layout=list");
  });

  it("drops a view value it cannot render", async () => {
    const { app } = setupApp();

    const res = await app.request("/archive?view=carousel");
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("/archive");
  });

  it("leaves a canonical layout param alone", async () => {
    const { app } = setupApp();

    const res = await app.request("/archive?layout=grid");
    expect(res.status).toBe(200);
  });
});

describe("archive page ordering", () => {
  it("orders threads by their root publication time, not recent replies", async () => {
    const { app, services } = setupApp();
    const olderThread = await services.posts.create({
      format: "note",
      title: "Older active thread",
      bodyMarkdown: "older root",
      publishedAt: Date.UTC(2024, 0, 1) / 1000,
    });
    await services.posts.create({
      format: "note",
      bodyMarkdown: "recent reply",
      replyToId: olderThread.id,
      publishedAt: Date.UTC(2026, 0, 1) / 1000,
    });
    await services.posts.create({
      format: "note",
      title: "Newer root thread",
      bodyMarkdown: "newer root",
      publishedAt: Date.UTC(2025, 0, 1) / 1000,
    });

    const res = await app.request("/archive");
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html.indexOf("Newer root thread")).toBeLessThan(
      html.indexOf("Older active thread"),
    );
  });

  it("keeps newer posts ahead of older pinned posts", async () => {
    const { app, services } = setupApp();
    await services.posts.create({
      format: "note",
      title: "Older pinned post",
      bodyMarkdown: "older",
      pinned: true,
      publishedAt: Date.UTC(2025, 0, 1) / 1000,
    });
    await services.posts.create({
      format: "note",
      title: "Newer unpinned post",
      bodyMarkdown: "newer",
      publishedAt: Date.UTC(2026, 0, 1) / 1000,
    });

    const res = await app.request("/archive?layout=list");
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html.indexOf("Newer unpinned post")).toBeLessThan(
      html.indexOf("Older pinned post"),
    );
  });
});

describe("archive page sort=updated", () => {
  /**
   * An old thread that recently gained a reply, plus a younger standalone
   * thread. The two axes disagree about their order, which is the whole point
   * of the toggle.
   */
  async function seedDivergingThreads(services: {
    posts: {
      create: (data: Record<string, unknown>) => Promise<{ id: string }>;
    };
  }) {
    const olderThread = await services.posts.create({
      format: "note",
      title: "Growing thread",
      bodyMarkdown: "root from 2019",
      publishedAt: Date.UTC(2019, 2, 5) / 1000,
    });
    await services.posts.create({
      format: "note",
      bodyMarkdown: "reply from 2026",
      replyToId: olderThread.id,
      publishedAt: Date.UTC(2026, 7, 1) / 1000,
    });
    await services.posts.create({
      format: "note",
      title: "Untouched newer thread",
      bodyMarkdown: "root from 2025",
      publishedAt: Date.UTC(2025, 0, 1) / 1000,
    });
  }

  it("puts recently extended threads first", async () => {
    const { app, services } = setupApp();
    await seedDivergingThreads(services);

    const res = await app.request("/archive?sort=updated");
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html.indexOf("Growing thread")).toBeLessThan(
      html.indexOf("Untouched newer thread"),
    );
  });

  // Month headers are a grid affordance, so the bucketing axis is asserted
  // through the grid layout rather than the site default.
  it("buckets months on the same axis it sorts by", async () => {
    const { app, services } = setupApp();
    await seedDivergingThreads(services);

    const byPublished = await (
      await app.request("/archive?layout=grid")
    ).text();
    expect(byPublished).toContain("March 2019");
    expect(byPublished).not.toContain("August 2026");

    const byActivity = await (
      await app.request("/archive?layout=grid&sort=updated")
    ).text();
    expect(byActivity).toContain("August 2026");
    expect(byActivity).not.toContain("March 2019");
  });

  it("scopes the year filter to the active axis", async () => {
    const { app, services } = setupApp();
    await seedDivergingThreads(services);

    const activityYear = await (
      await app.request("/archive?sort=updated&year=2026")
    ).text();
    expect(activityYear).toContain("Growing thread");
    expect(activityYear).not.toContain("Untouched newer thread");

    const publishedYear = await (
      await app.request("/archive?year=2026")
    ).text();
    expect(publishedYear).not.toContain("Growing thread");
  });

  it("keeps the default axis unchanged without the param", async () => {
    const { app, services } = setupApp();
    await seedDivergingThreads(services);

    const html = await (await app.request("/archive")).text();
    expect(html.indexOf("Untouched newer thread")).toBeLessThan(
      html.indexOf("Growing thread"),
    );
  });

  it("distinguishes the updated view in the document title", async () => {
    const { app, services } = setupApp();
    await seedDivergingThreads(services);

    const byPublished = await (await app.request("/archive")).text();
    expect(byPublished).toContain("<title>All posts - ");
    expect(byPublished).not.toContain("Recently updated");

    const byActivity = await (
      await app.request("/archive?sort=updated")
    ).text();
    expect(byActivity).toContain("<title>All posts - Recently updated - ");
  });

  it("says how much a filter removed, and stays quiet when none did", async () => {
    const { app, services } = setupApp();
    await seedDivergingThreads(services);

    // Two thread roots; asking for threads with replies leaves one of them.
    const filtered = await (await app.request("/archive?replies=any")).text();
    expect(filtered).toContain("of 2");

    // Nothing filtered, so there is no baseline worth comparing against.
    const unfiltered = await (await app.request("/archive")).text();
    expect(unfiltered).not.toContain("of 2");
  });

  it("names the active filter in the document title", async () => {
    const { app, services } = setupApp();
    await seedDivergingThreads(services);

    const byFormat = await (await app.request("/archive?format=note")).text();
    expect(byFormat).toContain("<title>Notes - ");

    // Title presence absorbs the format it refines, as the filter chip does.
    const untitled = await (
      await app.request("/archive?format=note&title=none")
    ).text();
    expect(untitled).toContain("<title>Untitled - ");

    // A tab truncates from the right, so the description stops at two parts.
    const capped = await (
      await app.request("/archive?format=note&year=2019&replies=any")
    ).text();
    expect(capped).toContain("<title>Notes, 2019 - ");
  });

  it("ignores an unknown sort value", async () => {
    const { app, services } = setupApp();
    await seedDivergingThreads(services);

    const html = await (await app.request("/archive?sort=nonsense")).text();
    expect(html.indexOf("Untouched newer thread")).toBeLessThan(
      html.indexOf("Growing thread"),
    );
  });

  // The quiet-reply switch promises "won't move the thread to the top of
  // latest". The archive is not Latest — it is the canonical all-posts view,
  // and it already shows Hidden-from-Latest content. So its updated sort
  // reports when the Thread actually changed.
  it("surfaces quietly extended threads even though Latest does not", async () => {
    const { app, services } = setupApp();
    const quietThread = await services.posts.create({
      format: "note",
      title: "Quietly extended thread",
      bodyMarkdown: "root from 2019",
      publishedAt: Date.UTC(2019, 2, 5) / 1000,
    });
    await services.posts.create({
      format: "note",
      bodyMarkdown: "quiet addendum",
      replyToId: quietThread.id,
      publishedAt: Date.UTC(2026, 7, 1) / 1000,
      quietReply: true,
    });
    await services.posts.create({
      format: "note",
      title: "Untouched newer thread",
      bodyMarkdown: "root from 2025",
      publishedAt: Date.UTC(2025, 0, 1) / 1000,
    });

    const html = await (
      await app.request("/archive?layout=grid&sort=updated")
    ).text();
    expect(html.indexOf("Quietly extended thread")).toBeLessThan(
      html.indexOf("Untouched newer thread"),
    );
    expect(html).toContain("August 2026");

    // Latest still honors the quiet flag.
    const roots = await services.posts.list({
      status: "published",
      excludeReplies: true,
      excludeLatestHidden: true,
    });
    expect(roots[0]?.title).toBe("Untouched newer thread");
  });
});
