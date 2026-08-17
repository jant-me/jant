import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { collectionRoutes } from "../collection.js";
import { collectionsPageRoutes } from "../collections.js";
import { pageRoutes } from "../page.js";

function createCollectionRoutingTestApp(rssPublishDelaySeconds = 0) {
  const testApp = createTestApp({ rssPublishDelaySeconds });
  const { app } = testApp;

  app.use("*", async (c, next) => {
    c.set("publicPath", c.req.path);
    c.set("publicRequestUrl", c.req.url);
    await next();
  });

  app.route("/collections", collectionsPageRoutes);
  app.route("/collections", collectionRoutes);
  app.route("/", pageRoutes);

  return testApp;
}

afterEach(() => {
  vi.restoreAllMocks();
});

async function createCollectionWithPost(
  services: ReturnType<typeof createTestApp>["services"],
  {
    slug,
    title,
    postTitle,
    bodyMarkdown,
  }: {
    slug: string;
    title: string;
    postTitle: string;
    bodyMarkdown?: string;
  },
) {
  const collection = await services.collections.create({ slug, title });
  const post = await services.posts.create({
    format: "note",
    title: postTitle,
    bodyMarkdown: bodyMarkdown ?? postTitle,
    status: "published",
  });
  await services.collections.addThread(collection.id, post.id);
  return { collection, post };
}

describe("Collection Routing", () => {
  it("renders a single collection at its root path", async () => {
    const { app, services } = createCollectionRoutingTestApp();

    const { post } = await createCollectionWithPost(services, {
      slug: "reading",
      title: "Reading",
      postTitle: "Book log",
    });
    await services.posts.create({
      format: "note",
      bodyMarkdown: "Thread follow-up",
      status: "published",
      replyToId: post.id,
    });

    const res = await app.request("/reading");

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");

    const html = await res.text();
    expect(html).toContain("Reading");
    expect(html).toContain("Book log");
    expect(html).toContain("Thread follow-up");
  });

  it("hides the collection feed button when feeds are disabled", async () => {
    const { app, services } = createCollectionRoutingTestApp();
    await services.settings.set("RSS_FEEDS_ENABLED", "false");
    await createCollectionWithPost(services, {
      slug: "reading",
      title: "Reading",
      postTitle: "Book log",
    });

    const response = await app.request("/reading");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).not.toContain('class="feed-link"');
  });

  it("redirects namespaced single-collection paths to the root canonical URL", async () => {
    const { app, services } = createCollectionRoutingTestApp();

    await services.collections.create({
      slug: "reading",
      title: "Reading",
    });

    const res = await app.request("/collections/reading?sort=oldest", {
      redirect: "manual",
    });

    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("/reading?sort=oldest");
  });

  it("renders aggregate collection selections under /collections", async () => {
    const { app, services } = createCollectionRoutingTestApp();

    await createCollectionWithPost(services, {
      slug: "reading",
      title: "Reading",
      postTitle: "Book log",
    });
    await createCollectionWithPost(services, {
      slug: "movies",
      title: "Movies",
      postTitle: "Film log",
    });

    const res = await app.request("/collections/reading+movies");

    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain("Reading");
    expect(html).toContain("Movies");
    expect(html).toContain("Book log");
    expect(html).toContain("Film log");
  });

  it("serves collection feeds from the root single path and namespaced aggregate path", async () => {
    const { app, services } = createCollectionRoutingTestApp();

    await createCollectionWithPost(services, {
      slug: "reading",
      title: "Reading",
      postTitle: "Book log",
    });
    await createCollectionWithPost(services, {
      slug: "movies",
      title: "Movies",
      postTitle: "Film log",
    });

    const singleRes = await app.request("/reading/feed");
    expect(singleRes.status).toBe(200);
    expect(singleRes.headers.get("Content-Type")).toBe(
      "application/atom+xml; charset=utf-8",
    );
    expect(await singleRes.text()).toContain("Book log");

    const aggregateRes = await app.request("/collections/reading+movies/feed");
    expect(aggregateRes.status).toBe(200);
    expect(aggregateRes.headers.get("Content-Type")).toBe(
      "application/atom+xml; charset=utf-8",
    );

    const xml = await aggregateRes.text();
    expect(xml).toContain("Book log");
    expect(xml).toContain("Film log");
  });

  it("leads the collection feed title with the site name", async () => {
    // A reader's sidebar sorts by feed title, so every Jant feed leads with
    // the site name — otherwise one site's feeds scatter across the alphabet.
    const { app, services } = createCollectionRoutingTestApp();
    await services.settings.set("SITE_NAME", "Jant");
    await createCollectionWithPost(services, {
      slug: "reading",
      title: "Reading",
      postTitle: "Book log",
    });

    const xml = await (await app.request("/reading/feed")).text();

    expect(xml).toContain("<title>Jant - Reading</title>");
  });

  it("applies the RSS publication delay to Collection feeds", async () => {
    const currentTime = 2_000_000;
    vi.spyOn(Date, "now").mockReturnValue(currentTime * 1000);
    const { app, services } = createCollectionRoutingTestApp(300);
    const collection = await services.collections.create({
      slug: "reading",
      title: "Reading",
    });
    const eligible = await services.posts.create({
      format: "note",
      title: "Eligible Book Log",
      bodyMarkdown: "Old enough for RSS",
      status: "published",
      publishedAt: currentTime - 300,
    });
    const recent = await services.posts.create({
      format: "note",
      title: "Recent Book Log",
      bodyMarkdown: "Still inside the edit window",
      status: "published",
      publishedAt: currentTime,
    });
    await services.collections.addThread(collection.id, eligible.id);
    await services.collections.addThread(collection.id, recent.id);

    const xml = await (await app.request("/reading/feed")).text();

    expect(xml).toContain("Eligible Book Log");
    expect(xml).not.toContain("Recent Book Log");
  });

  it("redirects canonical collection pages and feeds to collection aliases", async () => {
    const { app, services } = createCollectionRoutingTestApp();

    const { collection } = await createCollectionWithPost(services, {
      slug: "reading",
      title: "Reading",
      postTitle: "Book log",
    });
    await services.customUrls.create({
      path: "notes",
      targetType: "collection",
      targetId: collection.id,
    });

    const canonicalPageRes = await app.request("/reading", {
      redirect: "manual",
    });
    expect(canonicalPageRes.status).toBe(301);
    expect(canonicalPageRes.headers.get("Location")).toBe("/notes");

    const aliasPageRes = await app.request("/notes");
    expect(aliasPageRes.status).toBe(200);
    expect(await aliasPageRes.text()).toContain("Reading");

    const canonicalFeedRes = await app.request("/reading/feed", {
      redirect: "manual",
    });
    expect(canonicalFeedRes.status).toBe(301);
    expect(canonicalFeedRes.headers.get("Location")).toBe("/notes/feed");

    const aliasFeedRes = await app.request("/notes/feed");
    expect(aliasFeedRes.status).toBe(200);
    expect(await aliasFeedRes.text()).toContain("Book log");
  });
});
