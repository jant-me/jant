import type { Context } from "hono";
import { renderToString } from "hono/jsx/dom/server";
import { describe, expect, it } from "vitest";
import type {
  CollectionTagView,
  PostFooterDisplayOptions,
  PostView,
} from "../../../types.js";
import { I18nProvider } from "../../../i18n/context.js";
import { createI18n } from "../../../i18n/i18n.js";
import { PostFooter } from "../PostFooter.js";

function createCollection(slug: string, title: string): CollectionTagView {
  return {
    slug,
    title,
    url: `/${slug}`,
  };
}

function createPostView(overrides: Partial<PostView> = {}): PostView {
  return {
    id: "post-1",
    permalink: "/hello-world",
    slug: "hello-world",
    format: "note",
    status: "published",
    visibility: "public",
    pinned: false,
    featured: false,
    publishedAt: "2026-03-17T10:00:00.000Z",
    publishedAtFormatted: "Mar 17, 2026",
    publishedAtTime: "10:00",
    publishedAtRelative: "1h",
    updatedAt: "2026-03-17T10:00:00.000Z",
    media: [],
    collections: [
      createCollection("notes", "Notes"),
      createCollection("writing", "Writing"),
      createCollection("studio", "Studio"),
    ],
    isLastInThread: true,
    ...overrides,
  };
}

function renderPostFooter(
  post: PostView,
  detail = false,
  locale: "en" = "en",
  display?: PostFooterDisplayOptions,
  isAuthenticated = true,
): string {
  const i18n = createI18n(locale);
  const c = {
    get(key: string) {
      if (key === "i18n") return i18n;
      if (key === "isAuthenticated") return isAuthenticated;
      return undefined;
    },
  } as unknown as Context;

  I18nProvider({ c, children: "" });
  return renderToString(PostFooter({ post, detail, display }));
}

describe("PostFooter", () => {
  it("links the detail timestamp and shows a +N trigger after the first two collections", () => {
    const html = renderPostFooter(createPostView(), true);

    expect(html).toContain('href="/hello-world"');
    expect(html).not.toContain(">Permalink<");
    expect(html).toContain("Notes");
    expect(html).toContain("Writing");
    expect(html).toContain(">+1<");
    expect(html).toContain("data-collection-popover-trigger");
    expect(html).toContain('title="Published on Mar 17, 2026 at 10:00"');
    expect(html).toContain('class="post-collection-primary-icon"');
  });

  it("shows both collections inline when exactly two are assigned", () => {
    const post = createPostView({
      collections: [
        createCollection("notes", "Notes"),
        createCollection("writing", "Writing"),
      ],
    });
    const html = renderPostFooter(post);

    expect(html).toContain('href="/notes"');
    expect(html).toContain('href="/writing"');
    expect(html).toContain("Notes");
    expect(html).toContain("Writing");
    expect(html).not.toContain("more");
    expect(html).not.toContain("data-collection-popover-trigger");
  });

  it("shows only hidden collections inside the +N popover when three or more", () => {
    const html = renderPostFooter(createPostView());

    expect(html).toContain(">+1<");
    expect(html).toContain("data-collection-popover-trigger");
    expect(html).toContain('class="post-collection-tag-text"');
    expect(html).not.toContain('class="post-collection-primary-icon"');
    expect(html.match(/class="post-collection-popover-item"/g)).toHaveLength(1);
    expect(html.match(/href="\/notes"/g)).toHaveLength(1);
    expect(html.match(/href="\/writing"/g)).toHaveLength(1);
    expect(html.match(/href="\/studio"/g)).toHaveLength(1);
  });

  it("shows collection tags only on the thread root", () => {
    const html = renderPostFooter(
      createPostView({
        id: "post-child",
        replyToId: "post-root",
      }),
    );

    expect(html).not.toContain('class="post-collection-tags"');
    expect(html).not.toContain('href="/notes"');
    expect(html).not.toContain("data-collection-popover-trigger");
    expect(html).toContain('aria-label="More actions"');
    expect(html).toContain("data-post-menu-trigger");
  });

  it("renders the featured icon before the timestamp for client-side toggles", () => {
    const html = renderPostFooter(
      createPostView({
        featured: true,
        featuredAt: "2026-03-18T09:45:00.000Z",
        featuredAtFormatted: "Mar 18, 2026",
        featuredAtTime: "09:45",
      }),
    );

    expect(html).toContain('class="post-footer-featured"');
    expect(html).toContain('aria-label="Featured on Mar 18, 2026 at 09:45"');
    expect(html).toContain('data-tooltip="Featured on Mar 18, 2026 at 09:45"');
    expect(html).not.toContain("data-side=");
    expect(html.indexOf('class="post-footer-featured"')).toBeLessThan(
      html.indexOf('class="u-url post-footer-link"'),
    );
  });

  it("can hide the timestamp without leaving a leading separator", () => {
    const html = renderPostFooter(createPostView(), true, "en", {
      hideTimestamp: true,
    });

    expect(html).not.toContain('class="dt-published"');
    expect(html).not.toContain('class="post-collection-sep"');
    expect(html).toContain('href="/notes"');
    expect(html).toContain("data-post-menu-trigger");
  });

  it("can hide reply without hiding the more menu", () => {
    const html = renderPostFooter(createPostView(), false, "en", {
      hideReply: true,
    });

    expect(html).not.toContain("data-reply-trigger");
    expect(html).toContain("data-post-menu-trigger");
  });

  it("omits the action group for a reader, who can never see it", () => {
    const html = renderPostFooter(
      createPostView(),
      false,
      "en",
      undefined,
      false,
    );

    expect(html).not.toContain("data-post-menu-trigger");
    expect(html).not.toContain("data-reply-trigger");
    expect(html).not.toContain("post-menu-actions");
    // The reader still gets the footer itself.
    expect(html).toContain('href="/hello-world"');
  });

  it("keeps the featured mark for the author and drops it for a reader", () => {
    const featured = createPostView({ featured: true });

    expect(renderPostFooter(createPostView())).toContain(
      "post-footer-featured",
    );
    expect(
      renderPostFooter(createPostView(), false, "en", undefined, false),
    ).not.toContain("post-footer-featured");
    expect(renderPostFooter(featured, false, "en", undefined, false)).toContain(
      "post-footer-featured",
    );
  });
});
