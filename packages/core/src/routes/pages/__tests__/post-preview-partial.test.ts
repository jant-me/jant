import { describe, expect, it } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { partialPageRoutes } from "../partials.js";

function createPartialTestApp(options: { authenticated?: boolean } = {}) {
  const testApp = createTestApp(options);
  testApp.app.route("/", partialPageRoutes);
  return testApp;
}

describe("/_/post-preview/:postId", () => {
  it("renders the post the way its own page does", async () => {
    // The composer shows this while writing a translation, and the original's
    // structure is part of what gets translated — so it has to arrive as the
    // post, not as a body-only excerpt.
    const { app, services } = createPartialTestApp({ authenticated: true });
    const post = await services.posts.create({
      format: "note",
      title: "Yirgacheffe",
      bodyMarkdown: "## Brewing\n\nNinety-two degrees was too hot.",
      status: "published",
    });

    const res = await app.request(`/_/post-preview/${post.id}`);

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Yirgacheffe");
    expect(html).toContain("Brewing");
    expect(html).toContain("Ninety-two degrees was too hot.");
    // Detail styling, not the feed card's summary.
    expect(html).toContain("post-detail-title");
  });

  it("carries a quote's attribution, which a body-only preview would drop", async () => {
    const { app, services } = createPartialTestApp({ authenticated: true });
    // A Quote stores its attribution in `title` / `url`; the API surfaces the
    // same two as `sourceName` / `sourceUrl`.
    const post = await services.posts.create({
      format: "quote",
      quoteText: "Focus is about saying no.",
      title: "Some Author",
      url: "https://example.com/focus",
      status: "published",
    });

    const html = await (await app.request(`/_/post-preview/${post.id}`)).text();

    expect(html).toContain("Focus is about saying no.");
    expect(html).toContain("Some Author");
    expect(html).toContain("https://example.com/focus");
  });

  it("offers no control that would act on the post being previewed", async () => {
    // Every action in the composer belongs to the post being written. A menu
    // or reply trigger here would aim at the wrong one.
    const { app, services } = createPartialTestApp({ authenticated: true });
    const post = await services.posts.create({
      format: "note",
      title: "Yirgacheffe",
      bodyMarkdown: "Body",
      status: "published",
    });

    const html = await (await app.request(`/_/post-preview/${post.id}`)).text();

    expect(html).not.toContain("data-post-menu-trigger");
    expect(html).not.toContain("data-reply-trigger");
  });

  it("prints a titled post's date once, not in both header and footer", async () => {
    // The card drops the footer's copy for a titled detail post, but only when
    // `hideTimestamp` is left undefined — stating it either way brings it back.
    const { app, services } = createPartialTestApp({ authenticated: true });
    const post = await services.posts.create({
      format: "note",
      title: "Yirgacheffe",
      bodyMarkdown: "Body",
      status: "published",
    });

    const html = await (await app.request(`/_/post-preview/${post.id}`)).text();

    expect(html.match(/<time/g) ?? []).toHaveLength(1);
  });

  it("404s on a post that is not there", async () => {
    const { app } = createPartialTestApp({ authenticated: true });

    const res = await app.request(
      "/_/post-preview/pst_01000000000000000000000000",
    );

    expect(res.status).toBe(404);
  });
});
