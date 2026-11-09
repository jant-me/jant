/**
 * The view counter through the real page routes: a reader's navigation to a
 * page is one hit in the buffer, filed under the right page and referrer,
 * and everything that is not one leaves the buffer alone.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "../../__tests__/helpers/app.js";
import { ViewBuffer } from "../../lib/view-buffer.js";
import { homeRoutes } from "../../routes/pages/home.js";
import { pageRoutes } from "../../routes/pages/page.js";
import { viewCounter } from "../view-counter.js";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

function navigationHeaders(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "user-agent": BROWSER_UA,
    ...overrides,
  };
}

function createApp(options: { authenticated?: boolean } = {}) {
  const buffer = new ViewBuffer({ delayMs: 60_000 });
  const test = createTestApp({ authenticated: options.authenticated });
  test.app.use("*", viewCounter(buffer));
  test.app.route("/", homeRoutes);
  test.app.route("/", pageRoutes);
  return { ...test, buffer };
}

const TODAY = new Date().toISOString().slice(0, 10);
/** Late enough in the day to take in every hour a test could run at. */
const HOUR = `${TODAY}T23`;

describe("viewCounter", () => {
  let fixture: ReturnType<typeof createApp>;

  beforeEach(async () => {
    fixture = createApp();
  });

  it("counts a reader opening a post, with the referring host", async () => {
    const { app, services, buffer } = fixture;
    const post = await services.posts.create({
      format: "note",
      title: "Hello",
      bodyMarkdown: "Body",
      status: "published",
    });

    const res = await app.request(`/${post.slug}`, {
      headers: navigationHeaders({
        referer: "https://news.ycombinator.com/item?id=1",
      }),
    });
    expect(res.status).toBe(200);
    expect(buffer.size).toBe(1);

    await buffer.flush();
    const detail = await services.stats.getPage(post.id, {
      days: 1,
      today: TODAY,
      hour: HOUR,
    });
    expect(detail?.total).toBe(1);
    expect(detail?.referrers.top).toEqual([
      { host: "news.ycombinator.com", views: 1 },
    ]);
  });

  it("files the home page under its path, a same-site link as internal", async () => {
    const { app, services, buffer } = fixture;

    const res = await app.request("/", {
      headers: navigationHeaders({
        referer: "http://localhost:3000/some-post",
      }),
    });
    expect(res.status).toBe(200);
    // The second page of the feed is the same page.
    const second = await app.request("/?page=2", {
      headers: navigationHeaders(),
    });
    expect(second.status).toBe(200);

    await buffer.flush();
    const overview = await services.stats.getOverview({
      days: 1,
      today: TODAY,
      hour: HOUR,
    });
    expect(overview.total).toBe(2);
    // The first came from a page of the site, the second from nowhere.
    expect(overview.referrers).toEqual({
      direct: 1,
      internal: 1,
      top: [],
      other: 0,
    });
    expect(overview.pages).toEqual([{ kind: "path", key: "/", views: 2 }]);
  });

  it("counts a collection and a smart collection under their ids", async () => {
    const { app, services, buffer } = fixture;
    const reading = await services.collections.create({
      slug: "reading",
      title: "Reading",
    });
    const quotes = await services.smartCollections.create({
      slug: "quotes",
      title: "Quotes",
      selection: { format: "quote" },
    });

    for (const path of ["/reading", "/quotes"]) {
      const res = await app.request(path, { headers: navigationHeaders() });
      expect(res.status).toBe(200);
    }

    await buffer.flush();
    const overview = await services.stats.getOverview({
      days: 1,
      today: TODAY,
      hour: HOUR,
    });
    expect(overview.pages).toEqual([
      {
        kind: "collection",
        key: reading.id,
        collection: { title: "Reading", slug: "reading" },
        views: 1,
      },
      {
        kind: "collection",
        key: quotes.id,
        collection: { title: "Quotes", slug: "quotes" },
        views: 1,
      },
    ]);
  });

  it("files a tagged link under its tag, even without a referrer", async () => {
    const { app, services, buffer } = fixture;
    const post = await services.posts.create({
      format: "note",
      title: "Tagged",
      bodyMarkdown: "Body",
      status: "published",
    });

    // ChatGPT's apps open links without a Referer, but tag them.
    await app.request(`/${post.slug}?utm_source=chatgpt.com`, {
      headers: navigationHeaders(),
    });
    // A tag beats the host the browser reports.
    await app.request(`/${post.slug}?ref=newsletter`, {
      headers: navigationHeaders({ referer: "https://mail.google.com/" }),
    });
    expect(buffer.size).toBe(2);

    await buffer.flush();
    const detail = await services.stats.getPage(post.id, {
      days: 1,
      today: TODAY,
      hour: HOUR,
    });
    expect(detail?.total).toBe(2);
    expect(detail?.referrers.direct).toBe(0);
    expect(detail?.referrers.top).toHaveLength(2);
    expect(detail?.referrers.top).toEqual(
      expect.arrayContaining([
        { host: "chatgpt.com", views: 1 },
        { host: "newsletter", views: 1 },
      ]),
    );
  });

  it("ignores requests that are not a reader's navigation", async () => {
    const { app, buffer } = fixture;

    // No Sec-Fetch headers: curl, crawlers, HTTP libraries.
    await app.request("/", { headers: { "user-agent": BROWSER_UA } });
    // A machine that says so.
    await app.request("/", {
      headers: navigationHeaders({
        "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)",
      }),
    });
    // A prefetch.
    await app.request("/", {
      headers: navigationHeaders({ "sec-purpose": "prefetch" }),
    });
    // A page that does not exist.
    const missing = await app.request("/no-such-page", {
      headers: navigationHeaders(),
    });
    expect(missing.status).toBe(404);

    expect(buffer.size).toBe(0);
  });

  it("never counts the signed-in author", async () => {
    const { app, buffer } = createApp({ authenticated: true });

    const res = await app.request("/", { headers: navigationHeaders() });
    expect(res.status).toBe(200);
    expect(buffer.size).toBe(0);
  });

  it("counts nothing while stats are off", async () => {
    const { app, services, buffer } = fixture;
    await services.stats.setEnabled(false, { today: TODAY });

    const res = await app.request("/", { headers: navigationHeaders() });
    expect(res.status).toBe(200);
    expect(buffer.size).toBe(0);
  });
});
