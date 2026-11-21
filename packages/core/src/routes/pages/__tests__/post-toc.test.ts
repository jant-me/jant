import { describe, expect, it } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { postsApiRoutes } from "../../api/posts.js";
import { composeRoutes } from "../../compose.js";
import { pageRoutes } from "../page.js";

describe("Post table of contents", () => {
  it("persists through create and edit and adds links only on the enabled detail page", async () => {
    const { app } = createTestApp({ authenticated: true });
    app.route("/compose", composeRoutes);
    app.route("/api/posts", postsApiRoutes);
    app.route("/", pageRoutes);

    const headers = {
      "content-type": "application/json",
      accept: "application/json",
    };
    const bodyMarkdown = [
      "## Start & *continue*",
      "### 中文",
      "## Start & continue",
      "> ## Quoted heading",
    ].join("\n\n");
    const response = await app.request("/compose", {
      method: "POST",
      headers,
      body: JSON.stringify({
        format: "note",
        slug: "contents-page",
        bodyMarkdown,
        showToc: true,
      }),
    });
    expect(response.status).toBe(200);
    const { permalink } = await response.json();
    const enabled = await (await app.request(permalink)).text();
    expect(enabled).toContain("data-post-toc=");
    expect(enabled).toContain('href="#section-start-continue"');
    expect(enabled).toContain('href="#section-start-continue-2"');
    expect(enabled).toContain(`href="#section-${encodeURIComponent("中文")}"`);
    expect(enabled).toContain('id="section-start-continue"');
    expect(enabled).not.toContain('href="#section-quoted-heading"');

    const list = await app.request("/api/posts");
    const { posts } = await list.json();
    expect(posts[0].showToc).toBe(true);
    const update = await app.request(`/api/posts/${posts[0].id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ showToc: false }),
    });
    expect(update.status).toBe(200);
    expect((await update.json()).showToc).toBe(false);
    expect(await (await app.request(permalink)).text()).not.toContain(
      "data-post-toc=",
    );
  });

  it("leaves the directory off by default and omits it without section headings", async () => {
    const { app, services } = createTestApp();
    app.route("/", pageRoutes);
    const defaultPost = await services.posts.create({
      format: "note",
      bodyMarkdown: "## Start",
    });
    const withoutHeadings = await services.posts.create({
      format: "note",
      bodyMarkdown: "Just a paragraph.",
      showToc: true,
    });
    expect(defaultPost.showToc).toBe(false);
    for (const { slug } of [defaultPost, withoutHeadings]) {
      const response = await app.request(`/${slug}`);
      expect(response.status).toBe(200);
      expect(await response.text()).not.toContain("data-post-toc=");
    }
  });
});
