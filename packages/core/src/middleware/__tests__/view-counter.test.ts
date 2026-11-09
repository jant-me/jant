/**
 * The view counter through the real page routes: a reader's navigation to a
 * page carries a view token, the token posted back is one hit in the buffer
 * under the right page and referrer, and everything that is not a reader's
 * navigation gets no token and counts for nothing.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "../../__tests__/helpers/app.js";
import { DEFAULT_TEST_SITE_ID } from "../../__tests__/helpers/db.js";
import { now } from "../../lib/time.js";
import { ViewBuffer } from "../../lib/view-buffer.js";
import { signViewToken, VIEW_TOKEN_META_NAME } from "../../lib/view-token.js";
import { homeRoutes } from "../../routes/pages/home.js";
import { pageRoutes } from "../../routes/pages/page.js";
import { createViewConfirmRoutes } from "../../routes/view-confirm.js";
import { viewCounter } from "../view-counter.js";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const SECRET = "s".repeat(40);
const TODAY = new Date().toISOString().slice(0, 10);
/** Late enough in the day to take in every hour a test could run at. */
const HOUR = `${TODAY}T23`;
const WINDOW = { days: 1, today: TODAY, hour: HOUR };

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
  const test = createTestApp({
    authenticated: options.authenticated,
    env: { AUTH_SECRET: SECRET },
  });
  test.app.use("*", viewCounter());
  test.app.route("/_", createViewConfirmRoutes(buffer));
  test.app.route("/", homeRoutes);
  test.app.route("/", pageRoutes);
  return { ...test, buffer };
}

type App = ReturnType<typeof createApp>["app"];

function tokenIn(html: string): string | null {
  const match = html.match(
    new RegExp(`<meta name="${VIEW_TOKEN_META_NAME}" content="([^"]+)">`),
  );
  return match?.[1] ?? null;
}

/** What the reader bundle does with a token it finds in the page. */
async function confirm(app: App, token: string): Promise<void> {
  const res = await app.request("/_/seen", {
    method: "POST",
    body: token,
    headers: { "content-type": "text/plain", "sec-fetch-site": "same-origin" },
  });
  expect(res.status).toBe(204);
}

/** Open a page the way a browser does and post its token back. */
async function openAndConfirm(
  app: App,
  path: string,
  headers: Record<string, string> = navigationHeaders(),
): Promise<void> {
  const res = await app.request(path, { headers });
  expect(res.status).toBe(200);
  const token = tokenIn(await res.text());
  expect(token).not.toBeNull();
  await confirm(app, token as string);
}

describe("viewCounter", () => {
  let fixture: ReturnType<typeof createApp>;

  beforeEach(async () => {
    fixture = createApp();
  });

  it("marks a reader's page with a token and counts the view once the browser confirms it", async () => {
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
    const token = tokenIn(await res.text());
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[0-9a-f]{32}$/);
    // Opening the page counts nothing by itself.
    expect(buffer.size).toBe(0);

    await confirm(app, token as string);
    expect(buffer.size).toBe(1);

    await buffer.flush();
    const detail = await services.stats.getPage(post.id, WINDOW);
    expect(detail?.total).toBe(1);
    expect(detail?.referrers.top).toEqual([
      { host: "news.ycombinator.com", views: 1 },
    ]);
  });

  it("files the home page under its path, a same-site link as internal", async () => {
    const { app, services, buffer } = fixture;

    await openAndConfirm(
      app,
      "/",
      navigationHeaders({ referer: "http://localhost:3000/some-post" }),
    );
    // The second page of the feed is the same page.
    await openAndConfirm(app, "/?page=2");

    await buffer.flush();
    const overview = await services.stats.getOverview(WINDOW);
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

  it("files a tagged link under its tag, even without a referrer", async () => {
    const { app, services, buffer } = fixture;
    const post = await services.posts.create({
      format: "note",
      title: "Tagged",
      bodyMarkdown: "Body",
      status: "published",
    });

    // ChatGPT's apps open links without a Referer, but tag them.
    await openAndConfirm(app, `/${post.slug}?utm_source=chatgpt.com`);
    // A tag beats the host the browser reports.
    await openAndConfirm(
      app,
      `/${post.slug}?ref=newsletter`,
      navigationHeaders({ referer: "https://mail.google.com/" }),
    );

    await buffer.flush();
    const detail = await services.stats.getPage(post.id, WINDOW);
    expect(detail?.total).toBe(2);
    expect(detail?.referrers.direct).toBe(0);
    expect(detail?.referrers.top).toEqual(
      expect.arrayContaining([
        { host: "chatgpt.com", views: 1 },
        { host: "newsletter", views: 1 },
      ]),
    );
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

    await openAndConfirm(app, "/reading");
    await openAndConfirm(app, "/quotes");

    await buffer.flush();
    const overview = await services.stats.getOverview(WINDOW);
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

  it("two readers in one slot share a token, and are two views", async () => {
    const { app, buffer } = fixture;
    const first = await (
      await app.request("/", { headers: navigationHeaders() })
    ).text();
    const second = await (
      await app.request("/", { headers: navigationHeaders() })
    ).text();
    expect(tokenIn(first)).toBe(tokenIn(second));

    await confirm(app, tokenIn(first) as string);
    await confirm(app, tokenIn(second) as string);
    expect(buffer.size).toBe(1);
    await buffer.flush();
  });

  it("marks nothing that is not a reader's navigation", async () => {
    const { app, buffer } = fixture;

    // No Sec-Fetch headers: curl, crawlers, HTTP libraries.
    const plain = await app.request("/", {
      headers: { "user-agent": BROWSER_UA },
    });
    expect(plain.status).toBe(200);
    expect(tokenIn(await plain.text())).toBeNull();
    // A machine that says so.
    const bot = await app.request("/", {
      headers: navigationHeaders({
        "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)",
      }),
    });
    expect(tokenIn(await bot.text())).toBeNull();
    // A prefetch.
    const prefetch = await app.request("/", {
      headers: navigationHeaders({ "sec-purpose": "prefetch" }),
    });
    expect(tokenIn(await prefetch.text())).toBeNull();
    // A page that does not exist.
    const missing = await app.request("/no-such-page", {
      headers: navigationHeaders(),
    });
    expect(missing.status).toBe(404);
    expect(tokenIn(await missing.text())).toBeNull();

    expect(buffer.size).toBe(0);
  });

  it("never marks the signed-in author", async () => {
    const { app, buffer } = createApp({ authenticated: true });

    const res = await app.request("/", { headers: navigationHeaders() });
    expect(res.status).toBe(200);
    expect(tokenIn(await res.text())).toBeNull();
    expect(buffer.size).toBe(0);
  });

  it("marks nothing and counts nothing while stats are off", async () => {
    const { app, services, buffer } = fixture;
    await services.stats.setEnabled(false, { today: TODAY });

    const res = await app.request("/", { headers: navigationHeaders() });
    expect(res.status).toBe(200);
    expect(tokenIn(await res.text())).toBeNull();

    // A token minted before the switch is worth nothing after it.
    const token = await signViewToken(
      SECRET,
      { siteId: DEFAULT_TEST_SITE_ID, page: "/", referrer: "" },
      now(),
    );
    await confirm(app, token);
    expect(buffer.size).toBe(0);
  });

  it("counts no token it did not sign, none from another site, and none past its time", async () => {
    const { app, buffer } = fixture;
    const siteId = DEFAULT_TEST_SITE_ID;

    await confirm(app, "nonsense.00000000000000000000000000000000");
    await confirm(
      app,
      await signViewToken(
        "t".repeat(40),
        { siteId, page: "/", referrer: "" },
        now(),
      ),
    );
    await confirm(
      app,
      await signViewToken(
        SECRET,
        { siteId: "sit_00000000000000000000000000", page: "/", referrer: "" },
        now(),
      ),
    );
    await confirm(
      app,
      await signViewToken(
        SECRET,
        { siteId, page: "/", referrer: "" },
        now() - 3 * 3600,
      ),
    );
    expect(buffer.size).toBe(0);

    // The real thing, for contrast.
    await confirm(
      app,
      await signViewToken(SECRET, { siteId, page: "/", referrer: "" }, now()),
    );
    expect(buffer.size).toBe(1);
  });
});
