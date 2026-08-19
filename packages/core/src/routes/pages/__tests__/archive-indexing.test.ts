/**
 * What the archive tells crawlers about each of its URLs.
 *
 * The filter space has no ceiling — `media` alone is a comma-joined subset of
 * kinds, multiplied by every other dimension — and the page sits in no cache,
 * so each facet a crawler walks costs a Worker invocation and seven D1
 * queries. None of those URLs is a page the site publishes. The ones that are
 * — the bare path, a stored archive path, and the same page rendered
 * differently — consolidate onto one canonical instead.
 */

import { describe, expect, it } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { archiveRoutes } from "../archive.js";
import { pageRoutes } from "../page.js";

const SITE_URL = "http://localhost:3000";

function setupApp() {
  const { app, services } = createTestApp({ authenticated: false });
  app.route("/archive", archiveRoutes);
  return { app, services };
}

function setupPageApp() {
  const testApp = createTestApp({ authenticated: false });
  const { app } = testApp;
  app.use("*", async (c, next) => {
    c.set("publicPath", c.req.path);
    c.set("publicRequestUrl", c.req.url);
    await next();
  });
  app.route("/", pageRoutes);
  return testApp;
}

function readCanonical(html: string): string | null {
  return html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? null;
}

function readRobotsMeta(html: string): string | null {
  return html.match(/<meta name="robots" content="([^"]+)"/)?.[1] ?? null;
}

/**
 * The `<link rel="alternate" hreflang>` set only. The language switcher in the
 * nav also carries `hreflang`, on ordinary `<a>` links — that is navigation
 * chrome, not the annotation search engines read.
 */
function readAlternates(html: string): string[] {
  return [
    ...html.matchAll(
      /<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g,
    ),
  ].map((m) => `${m[1]} ${m[2]}`);
}

async function seed(services: {
  posts: { create: (input: Record<string, unknown>) => Promise<unknown> };
}) {
  await services.posts.create({
    format: "note",
    bodyMarkdown: "a note in the archive",
    status: "published",
  });
}

describe("archive indexing", () => {
  it("publishes the bare archive with a self-canonical", async () => {
    const { app, services } = setupApp();
    await seed(services);

    const res = await app.request("/archive");
    const html = await res.text();

    expect(readRobotsMeta(html)).toBeNull();
    expect(res.headers.get("X-Robots-Tag")).toBeNull();
    expect(readCanonical(html)).toBe(`${SITE_URL}/archive`);
  });

  // `layout` changes the markup, not the posts or their order, so the two
  // renderings are one page with one canonical.
  it("consolidates layout, the cleared visibility chip, and tracking params", async () => {
    const { app, services } = setupApp();
    await seed(services);

    for (const query of ["?layout=grid", "?visibility=all", "?utm_source=nl"]) {
      const html = await (await app.request(`/archive${query}`)).text();
      expect(readRobotsMeta(html)).toBeNull();
      expect(readCanonical(html)).toBe(`${SITE_URL}/archive`);
    }
  });

  // Pagination is genuinely different content, not a different rendering of
  // the same content, so the canonical keeps it.
  it("keeps the page number in the canonical", async () => {
    const { app, services } = setupApp();
    await seed(services);

    const html = await (await app.request("/archive?page=2")).text();
    expect(readCanonical(html)).toBe(`${SITE_URL}/archive?page=2`);
  });

  it("keeps a reader's facet out of the index while leaving its links crawlable", async () => {
    const { app, services } = setupApp();
    await seed(services);

    const res = await app.request("/archive?format=note");
    const html = await res.text();

    expect(readRobotsMeta(html)).toBe("noindex, follow");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, follow");
    expect(readCanonical(html)).toBeNull();
  });

  // `sort` is a filter, not a presentation toggle: the year filter follows the
  // sort axis, and under pagination a different order is a different page one.
  it("treats sort as a facet rather than a rendering", async () => {
    const { app, services } = setupApp();
    await seed(services);

    const html = await (await app.request("/archive?sort=updated")).text();
    expect(readRobotsMeta(html)).toBe("noindex, follow");
    expect(readCanonical(html)).toBeNull();
  });

  // A site that asked not to be indexed at all has made the stricter
  // statement, and a page policy may only narrow further. `follow` would
  // otherwise reopen the site's links on exactly the URLs it never wanted
  // crawled.
  it("lets a site-wide noindex override the facet policy", async () => {
    const { app, services } = createTestApp({
      authenticated: false,
      demoMode: true,
    });
    app.route("/archive", archiveRoutes);
    await seed(services);

    const facet = await (await app.request("/archive?format=note")).text();
    expect(readRobotsMeta(facet)).toBe("noindex, nofollow");

    const bare = await (await app.request("/archive")).text();
    expect(readRobotsMeta(bare)).toBe("noindex, nofollow");
  });

  // Every member of an hreflang set has to be a canonical URL. Left alone, the
  // self-referential alternate would carry the very params the canonical
  // strips, giving one page two identities.
  it("builds the hreflang set from the canonical, not the raw URL", async () => {
    const { app, services } = setupApp();
    await services.settings.set("SITE_LANGUAGE", "zh-Hans");
    await services.settings.set("ADDITIONAL_LANGUAGES", "en");
    await services.settings.set("MULTILINGUAL_ENABLED", "true");
    await seed(services);

    const html = await (await app.request("/archive?utm_source=nl")).text();

    expect(readCanonical(html)).toBe(`${SITE_URL}/archive`);
    expect(readAlternates(html)).toEqual([
      `zh-Hans ${SITE_URL}/archive`,
      `en ${SITE_URL}/en/archive`,
      `x-default ${SITE_URL}/archive`,
    ]);
  });

  // A facet has no canonical, so there is no set to build.
  it("emits no hreflang set on a facet", async () => {
    const { app, services } = setupApp();
    await services.settings.set("SITE_LANGUAGE", "zh-Hans");
    await services.settings.set("ADDITIONAL_LANGUAGES", "en");
    await services.settings.set("MULTILINGUAL_ENABLED", "true");
    await seed(services);

    const facet = await (await app.request("/archive?format=note")).text();
    expect(readAlternates(facet)).toEqual([]);

    const bare = await (await app.request("/archive")).text();
    expect(readAlternates(bare)).toContain(`en ${SITE_URL}/en/archive`);
  });

  // The author declared this path, so it is a page even though its stored
  // query is a filter. Same seam the auth guard uses.
  it("publishes a stored archive path despite its filter", async () => {
    const { app, services } = setupPageApp();
    await seed(services);
    await services.customUrls.create({
      path: "/every-note",
      targetType: "archive",
      archiveQuery: "format=note&sort=updated",
    });

    const res = await app.request("/every-note");
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(readRobotsMeta(html)).toBeNull();
    expect(res.headers.get("X-Robots-Tag")).toBeNull();
    expect(readCanonical(html)).toBe(`${SITE_URL}/every-note`);
  });
});
