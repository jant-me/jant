import type { Context } from "hono";
import { renderToString } from "hono/jsx/dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../../i18n/context.js";
import { createI18n } from "../../../i18n/i18n.js";
import type { PostView } from "../../../types.js";
import { PostPage } from "../PostPage.js";

function createPostView(overrides: Partial<PostView> = {}): PostView {
  return {
    id: "pst_root",
    permalink: "/root",
    slug: "root",
    bodyHtml: "<p>Post body</p>",
    format: "note",
    status: "published",
    visibility: "public",
    pinned: false,
    featured: false,
    publishedAt: "2026-07-18T00:00:00.000Z",
    publishedAtFormatted: "Jul 18, 2026",
    publishedAtTime: "08:00",
    publishedAtRelative: "now",
    updatedAt: "2026-07-18T00:00:00.000Z",
    media: [],
    collections: [],
    isLastInThread: false,
    ...overrides,
  };
}

function renderPostPage(post: PostView, threadPosts: PostView[]): string {
  const i18n = createI18n("en");
  const c = {
    get(key: string) {
      if (key === "i18n") return i18n;
      return undefined;
    },
  } as unknown as Context;

  I18nProvider({ c, children: "" });
  return renderToString(PostPage({ post, threadPosts }));
}

function getArticleTag(html: string, postId: string): string {
  const article = (html.match(/<article\b[^>]*>/g) ?? []).find((tag) =>
    tag.includes(`data-post-id="${postId}"`),
  );
  if (!article) throw new Error(`Missing article for ${postId}`);
  return article;
}

describe("PostPage", () => {
  it("preserves Root-versus-Child action context in detail mode", () => {
    const root = createPostView();
    const child = createPostView({
      id: "pst_child",
      permalink: "/child",
      slug: "child",
      format: "link",
      title: "Child link",
      url: "https://example.com/child",
      replyToId: root.id,
      threadRootId: root.id,
    });
    const grandchild = createPostView({
      id: "pst_grandchild",
      permalink: "/grandchild",
      slug: "grandchild",
      format: "quote",
      quoteText: "Child quote",
      replyToId: child.id,
      threadRootId: root.id,
      isLastInThread: true,
    });

    const html = renderPostPage(child, [root, child, grandchild]);
    const rootArticle = getArticleTag(html, root.id);
    const childArticle = getArticleTag(html, child.id);
    const grandchildArticle = getArticleTag(html, grandchild.id);

    expect(rootArticle).not.toContain("data-post-reply");
    expect(childArticle).toContain('data-post-reply=""');
    expect(childArticle).toContain(`data-thread-root-id="${root.id}"`);
    expect(grandchildArticle).toContain('data-post-reply=""');
    expect(grandchildArticle).toContain(`data-thread-root-id="${root.id}"`);
  });
});
