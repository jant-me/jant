import { describe, expect, it } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { pageRoutes } from "../page.js";

describe("Automatic post table of contents and heading anchors", () => {
  it("automatically renders TOC and heading anchors for notes with 5+ headings including H1", async () => {
    const { app, services } = createTestApp();
    app.route("/", pageRoutes);

    const post = await services.posts.create({
      format: "note",
      title: "Field notes",
      bodyMarkdown: [
        "# Morning route",
        "First paragraph.",
        "## What to bring",
        "Notebook and pencil.",
        "## Midday stop",
        "Coffee by the river.",
        "## Afternoon notes",
        "More observations.",
        "# Evening review",
        "Final notes.",
        "> ## Quoted heading",
      ].join("\n\n"),
    });

    const response = await app.request(`/${post.slug}`);
    expect(response.status).toBe(200);
    const html = await response.text();

    expect(html).toContain("data-post-toc=");
    expect(html).toContain('data-post-toc-tick="section-morning-route"');
    expect(html).toContain('href="#section-morning-route"');
    expect(html).toContain('href="#section-what-to-bring"');
    expect(html).toContain('href="#section-evening-review"');
    expect(html).toContain('id="section-morning-route"');
    expect(html).toContain("data-heading-anchor");
    expect(html).not.toContain("section-quoted-heading");
  });

  it("adds heading anchors without TOC when a note has fewer than 5 headings", async () => {
    const { app, services } = createTestApp();
    app.route("/", pageRoutes);

    const post = await services.posts.create({
      format: "note",
      bodyMarkdown:
        "## Part one\n\nText.\n\n## Part two\n\nText.\n\n## Part three\n\nText.\n\n## Part four\n\nText.",
    });

    const response = await app.request(`/${post.slug}`);
    expect(response.status).toBe(200);
    const html = await response.text();

    expect(html).not.toContain("data-post-toc=");
    expect(html).toContain('id="section-part-one"');
    expect(html).toContain("data-heading-anchor");
  });

  it("does not render TOC on non-note formats", async () => {
    const { app, services } = createTestApp();
    app.route("/", pageRoutes);

    const post = await services.posts.create({
      format: "link",
      url: "https://example.com/article",
      title: "Shared link",
      bodyMarkdown: "## One\n\n## Two\n\n## Three\n\n## Four\n\n## Five",
    });

    const response = await app.request(`/${post.slug}`);
    expect(response.status).toBe(200);
    const html = await response.text();

    expect(html).not.toContain("data-post-toc=");
    expect(html).not.toContain("data-heading-anchor");
  });
});
