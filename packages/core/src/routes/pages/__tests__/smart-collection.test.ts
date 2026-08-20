import { describe, expect, it } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { pageRoutes } from "../page.js";

/**
 * The smart collection page, end to end through the path registry.
 *
 * The property these guard is the one the design turns on: a smart collection
 * is always public, and the posts inside it are exactly as visible as they are
 * anywhere else. Those are different sentences, and confusing them is how a
 * page ends up either 404ing for readers or leaking a draft.
 */

function setup(authenticated = false) {
  const { app, services } = createTestApp({ authenticated });
  app.route("/", pageRoutes);
  return { app, services };
}

async function seedQuotes(services: {
  posts: {
    create: (input: Record<string, unknown>) => Promise<{ id: string }>;
  };
}) {
  await services.posts.create({
    format: "quote",
    quoteText: "A public quote",
    bodyMarkdown: "public quote body",
    status: "published",
  });
  await services.posts.create({
    format: "quote",
    quoteText: "A private quote",
    bodyMarkdown: "private quote body",
    status: "published",
    visibility: "private",
  });
  await services.posts.create({
    format: "note",
    bodyMarkdown: "a plain note body",
    status: "published",
  });
}

describe("smart collection page", () => {
  it("renders for a signed-out reader, with title, count, and conditions", async () => {
    const { app, services } = setup();
    await seedQuotes(services);
    await services.smartCollections.create({
      slug: "quotes",
      title: "Quotes",
      description: "Things worth keeping.",
      selection: { format: "quote" },
    });

    const res = await app.request("/quotes");
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain("Quotes");
    expect(html).toContain("Things worth keeping.");
    expect(html).toContain("Automatically collects Quotes");
    expect(html).toContain("public quote body");
    expect(html).not.toContain("a plain note body");
    // The archive has a chip bar; this page does not.
    expect(html).not.toContain("archive-filters-chips");
  });

  it("links its conditions to the archive showing the same posts", async () => {
    const { app, services } = setup();
    await seedQuotes(services);
    await services.smartCollections.create({
      slug: "quotes",
      title: "Quotes",
      selection: { format: "quote", media: "none" },
    });

    const html = await (await app.request("/quotes")).text();
    expect(html).toContain("/archive?format=quote&amp;media=none");
  });

  it("says so when nothing matches, rather than rendering blank", async () => {
    const { app, services } = setup();
    await seedQuotes(services);
    await services.smartCollections.create({
      slug: "links",
      title: "Links",
      selection: { format: "link" },
    });

    const html = await (await app.request("/links")).text();
    expect(html).toContain("Nothing matches these conditions yet.");
  });

  it("collects every post when no condition narrows it", async () => {
    const { app, services } = setup();
    await seedQuotes(services);
    await services.smartCollections.create({
      slug: "everything",
      title: "Everything",
    });

    const html = await (await app.request("/everything")).text();
    expect(html).toContain("Automatically collects every post.");
    expect(html).toContain("public quote body");
    expect(html).toContain("a plain note body");
  });

  // The whole point of forbidding private conditions: there is no smart
  // collection page that answers 404 to a reader.
  it("shows the private post to its author and to nobody else", async () => {
    const reader = setup(false);
    await seedQuotes(reader.services);
    await reader.services.smartCollections.create({
      slug: "quotes",
      title: "Quotes",
      selection: { format: "quote" },
    });
    const readerHtml = await (await reader.app.request("/quotes")).text();
    expect(readerHtml).toContain("public quote body");
    expect(readerHtml).not.toContain("private quote body");
    expect(readerHtml).toContain("1 thread");

    const authorApp = setup(true);
    await seedQuotes(authorApp.services);
    await authorApp.services.smartCollections.create({
      slug: "quotes",
      title: "Quotes",
      selection: { format: "quote" },
    });
    const authorHtml = await (await authorApp.app.request("/quotes")).text();
    expect(authorHtml).toContain("private quote body");
    expect(authorHtml).toContain("2 threads");
  });

  it("ignores condition parameters in the URL", async () => {
    const { app, services } = setup();
    await seedQuotes(services);
    await services.smartCollections.create({
      slug: "quotes",
      title: "Quotes",
      selection: { format: "quote" },
    });

    // Membership is edited in the dialog. A reader appending `?format=note`
    // must not be able to redefine what the page collects.
    const html = await (await app.request("/quotes?format=note")).text();
    expect(html).toContain("public quote body");
    expect(html).not.toContain("a plain note body");
  });

  it("honors ?sort= over the stored default", async () => {
    const { app, services } = setup();
    await services.posts.create({
      format: "quote",
      quoteText: "Older",
      bodyMarkdown: "older body",
      status: "published",
      publishedAt: Date.UTC(2024, 0, 1) / 1000,
    });
    await services.posts.create({
      format: "quote",
      quoteText: "Newer",
      bodyMarkdown: "newer body",
      status: "published",
      publishedAt: Date.UTC(2026, 0, 1) / 1000,
    });
    await services.smartCollections.create({
      slug: "quotes",
      title: "Quotes",
      selection: { format: "quote" },
      sort: "newest",
    });

    const stored = await (await app.request("/quotes")).text();
    expect(stored.indexOf("newer body")).toBeLessThan(
      stored.indexOf("older body"),
    );

    const flipped = await (await app.request("/quotes?sort=oldest")).text();
    expect(flipped.indexOf("older body")).toBeLessThan(
      flipped.indexOf("newer body"),
    );
  });

  it("404s an address no smart collection holds", async () => {
    const { app } = setup();
    expect((await app.request("/nothing-here")).status).toBe(404);
  });
});

describe("smart collection feed", () => {
  it("serves an anonymous feed with no guard to trip over", async () => {
    const { app, services } = setup();
    await seedQuotes(services);
    await services.smartCollections.create({
      slug: "quotes",
      title: "Quotes",
      selection: { format: "quote" },
    });

    const res = await app.request("/quotes/feed");
    expect(res.status).toBe(200);
    const xml = await res.text();

    expect(xml).toContain("A public quote");
    // A feed carries no session, so the private quote can never appear in one.
    expect(xml).not.toContain("A private quote");
    expect(xml).toContain('rel="self"');
    expect(xml).toContain("/quotes/feed");
  });

  it("404s a feed for an address no smart collection holds", async () => {
    const { app } = setup();
    expect((await app.request("/nothing-here/feed")).status).toBe(404);
  });
});
