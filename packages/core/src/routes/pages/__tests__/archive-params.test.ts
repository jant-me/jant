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

    const res = await app.request("/archive?view=list");
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html.indexOf("Newer unpinned post")).toBeLessThan(
      html.indexOf("Older pinned post"),
    );
  });
});
