import { readFileSync } from "node:fs";
import type { Context } from "hono";
import { renderToString } from "hono/jsx/dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../../i18n/context.js";
import { createI18n } from "../../../i18n/i18n.js";
import type { PostView, TimelineItemView } from "../../../types.js";
import { CuratedThreadPreview } from "../CuratedThreadPreview.js";
import { ThreadPreview } from "../ThreadPreview.js";
import {
  getThreadPreviewState,
  threadContextAssumesOverflow,
} from "../thread-preview-state.js";

function createPostView(overrides: Partial<PostView> = {}): PostView {
  return {
    id: "post-1",
    permalink: "/post-1",
    slug: "post-1",
    format: "note",
    status: "published",
    visibility: "public",
    pinned: false,
    featured: false,
    publishedAt: "2026-03-14T00:00:00.000Z",
    publishedAtFormatted: "Mar 14, 2026",
    publishedAtTime: "00:00",
    publishedAtRelative: "now",
    updatedAt: "2026-03-14T00:00:00.000Z",
    media: [],
    collections: [],
    isLastInThread: false,
    ...overrides,
  };
}

function renderWithI18n(
  render: () =>
    | ReturnType<typeof ThreadPreview>
    | ReturnType<typeof CuratedThreadPreview>,
) {
  const i18n = createI18n("en");
  const c = {
    get(key: string) {
      if (key === "i18n") return i18n;
      return undefined;
    },
  } as unknown as Context;

  I18nProvider({ c, children: "" });
  return renderToString(render());
}

/** The opening tag of the show-more toggle button, for attribute assertions. */
function toggleTag(html: string): string {
  return (
    html.match(/<button[^>]*\bdata-thread-context-toggle\b[^>]*>/)?.[0] ?? ""
  );
}

describe("getThreadPreviewState", () => {
  it("has no hidden posts for a 2-post thread", () => {
    const latestReply = createPostView({
      id: "post-2",
      permalink: "/post-2",
      slug: "post-2",
    });

    expect(
      getThreadPreviewState({
        leadingReplies: [latestReply],
        trailingReplies: [],
        latestReply,
        totalReplyCount: 1,
      }),
    ).toEqual({
      hiddenCount: 0,
    });
  });

  it("has no hidden posts for a 6-post thread when all slots are visible", () => {
    const firstReply = createPostView({
      id: "post-2",
      permalink: "/post-2",
      slug: "post-2",
    });
    const secondReply = createPostView({
      id: "post-3",
      permalink: "/post-3",
      slug: "post-3",
    });
    const antepenultimateReply = createPostView({
      id: "post-4",
      permalink: "/post-4",
      slug: "post-4",
    });
    const penultimateReply = createPostView({
      id: "post-5",
      permalink: "/post-5",
      slug: "post-5",
    });
    const latestReply = createPostView({
      id: "post-6",
      permalink: "/post-6",
      slug: "post-6",
    });

    expect(
      getThreadPreviewState({
        leadingReplies: [firstReply, secondReply],
        trailingReplies: [antepenultimateReply, penultimateReply],
        latestReply,
        totalReplyCount: 5,
      }),
    ).toEqual({
      hiddenCount: 0,
    });
  });

  it("counts hidden posts for longer threads after deduping visible slots", () => {
    const firstReply = createPostView({
      id: "post-2",
      permalink: "/post-2",
      slug: "post-2",
    });
    const secondReply = createPostView({
      id: "post-3",
      permalink: "/post-3",
      slug: "post-3",
    });
    const antepenultimateReply = createPostView({
      id: "post-7",
      permalink: "/post-7",
      slug: "post-7",
    });
    const penultimateReply = createPostView({
      id: "post-8",
      permalink: "/post-8",
      slug: "post-8",
    });
    const latestReply = createPostView({
      id: "post-9",
      permalink: "/post-9",
      slug: "post-9",
    });

    expect(
      getThreadPreviewState({
        leadingReplies: [firstReply, secondReply],
        trailingReplies: [antepenultimateReply, penultimateReply],
        latestReply,
        totalReplyCount: 8,
      }),
    ).toEqual({
      hiddenCount: 3,
    });
  });

  it("keeps thread preview items shrinkable within the grid track", () => {
    const css = readFileSync(
      new URL("../../../styles/ui.css", import.meta.url),
      "utf8",
    );

    expect(css).toMatch(
      /\.thread-item\s*\{[\s\S]*min-width:\s*0;[\s\S]*max-width:\s*100%;/,
    );
  });

  it("adds extra mobile inset before the thread rail reaches the viewport edge", () => {
    const css = readFileSync(
      new URL("../../../styles/ui.css", import.meta.url),
      "utf8",
    );

    expect(css).toMatch(
      /@media\s*\(max-width:\s*760px\)\s*\{[\s\S]*\.thread-group-preview,\s*\.thread-group-detail\s*\{[\s\S]*--site-thread-rail-indent:\s*8px;[\s\S]*--site-thread-rail-line-left:\s*-11px;/,
    );
    // dot-left is no longer hardcoded — derived via calc() from line-left
    expect(css).not.toMatch(
      /@media\s*\(max-width:\s*760px\)\s*\{[\s\S]*--site-thread-rail-dot-left:/,
    );
  });

  it("renders article summaries in thread previews", () => {
    const rootPost = createPostView({
      title: "Threaded article",
      bodyHtml: '<p>Intro</p><span id="continue"></span><p>Rest</p>',
      summaryHtml: "<p>Intro</p>",
      summaryHasMore: true,
    });
    const latestReply = createPostView({
      id: "post-4",
      permalink: "/post-4",
      slug: "post-4",
      title: "Reply article",
      bodyHtml: "<p>Full reply body</p>",
      summaryHtml: "<p>Reply summary</p>",
      summaryHasMore: true,
      isLastInThread: true,
    });
    const secondReply = createPostView({
      id: "post-2",
      permalink: "/post-2",
      slug: "post-2",
      title: "Second article",
      bodyHtml: "<p>Second full body</p>",
      summaryHtml: "<p>Second summary</p>",
      summaryHasMore: true,
    });

    const html = renderWithI18n(() =>
      ThreadPreview({
        rootPost,
        leadingReplies: [secondReply],
        trailingReplies: [],
        latestReply,
        totalReplyCount: 3,
      }),
    );

    expect(html).toContain("<p>Intro</p>");
    expect(html).toContain("<p>Second summary</p>");
    expect(html).toContain("<p>Reply summary</p>");
    expect(html).not.toContain("<p>Rest</p>");
    expect(html).not.toContain("<p>Second full body</p>");
    expect(html).not.toContain("<p>Full reply body</p>");
    expect(html).not.toContain('id="continue"');
  });

  it("wraps ancestor context in a collapsible shell with a show-more toggle when 2+ extra items precede the latest reply", () => {
    const html = renderWithI18n(() =>
      ThreadPreview({
        rootPost: createPostView({
          title: "Long root",
          summaryHtml: "<p>Root summary</p>",
          summaryHasMore: true,
        }),
        leadingReplies: [
          createPostView({
            id: "post-2",
            permalink: "/post-2",
            slug: "post-2",
            bodyHtml: "<p>Second</p>",
          }),
        ],
        trailingReplies: [
          createPostView({
            id: "post-4",
            permalink: "/post-4",
            slug: "post-4",
            bodyHtml: "<p>Penultimate</p>",
          }),
        ],
        latestReply: createPostView({
          id: "post-5",
          permalink: "/post-5",
          slug: "post-5",
          bodyHtml: "<p>Latest</p>",
          isLastInThread: true,
        }),
        totalReplyCount: 4,
      }),
    );

    expect(html).toContain("thread-context-shell");
    expect(html).toContain("data-thread-context");
    expect(html).toContain("data-collapsed");
    expect(html).toContain("data-thread-context-toggle");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/data-label-more="[^"]+"/);
    expect(html).toMatch(/data-label-less="[^"]+"/);
  });

  it("renders at most six ordered posts with a gap between leading and trailing replies", () => {
    const reply = (id: number) =>
      createPostView({
        id: `post-${id}`,
        permalink: `/post-${id}`,
        slug: `post-${id}`,
        bodyHtml: `<p>Post ${id}</p>`,
      });

    const html = renderWithI18n(() =>
      ThreadPreview({
        rootPost: createPostView({ bodyHtml: "<p>Post 1</p>" }),
        leadingReplies: [reply(2), reply(3)],
        trailingReplies: [reply(6), reply(7)],
        latestReply: reply(8),
        totalReplyCount: 7,
      }),
    );

    const visiblePosts = [1, 2, 3, 6, 7, 8];
    for (const id of visiblePosts) {
      expect(html).toContain(`<p>Post ${id}</p>`);
    }
    expect(html).toContain("2 more posts");
    expect(visiblePosts.map((id) => html.indexOf(`<p>Post ${id}</p>`))).toEqual(
      [...visiblePosts]
        .map((id) => html.indexOf(`<p>Post ${id}</p>`))
        .sort((left, right) => left - right),
    );
  });

  it("hides the show-more toggle on first paint for a short lone root that fits the cap", () => {
    // 2-post thread: the shell holds only the root. A short root genuinely
    // fits the height cap, so the toggle is rendered hidden to avoid flashing
    // it in then out. Client-side measurement (thread-context.ts) re-reveals
    // it if the rendered height actually overflows.
    const html = renderWithI18n(() =>
      ThreadPreview({
        rootPost: createPostView({
          bodyHtml: "<p>Root</p>",
          summary: "Root",
        }),
        leadingReplies: [],
        trailingReplies: [],
        latestReply: createPostView({
          id: "post-2",
          permalink: "/post-2",
          slug: "post-2",
          bodyHtml: "<p>Latest</p>",
          isLastInThread: true,
        }),
        totalReplyCount: 1,
      }),
    );

    expect(html).toContain("thread-context-shell");
    expect(html).toContain("data-collapsed");
    expect(html).toContain("data-thread-context-toggle");
    expect(toggleTag(html)).toContain("hidden");
    expect(html).toContain("<p>Root</p>");
    expect(html).toContain("<p>Latest</p>");
  });

  it("shows the show-more toggle on first paint for a long lone root", () => {
    // 2-post thread with a long root — the shell almost certainly overflows
    // the cap, so the toggle is rendered visible immediately (no flash).
    const html = renderWithI18n(() =>
      ThreadPreview({
        rootPost: createPostView({
          bodyHtml: "<p>Root</p>",
          summary: "word ".repeat(60),
        }),
        leadingReplies: [],
        trailingReplies: [],
        latestReply: createPostView({
          id: "post-2",
          permalink: "/post-2",
          slug: "post-2",
          bodyHtml: "<p>Latest</p>",
          isLastInThread: true,
        }),
        totalReplyCount: 1,
      }),
    );

    expect(html).toContain("data-thread-context-toggle");
    expect(toggleTag(html)).not.toContain("hidden");
  });

  it("renders the collapsible shell even when just one extra item precedes the latest reply", () => {
    // root + secondReply + hero — one extra context item. The server can't
    // measure actual height, so it renders the shell assuming overflow (the
    // common case). Client-side JS then removes the cap + hides the toggle
    // if the rendered content actually fits without cropping.
    const html = renderWithI18n(() =>
      ThreadPreview({
        rootPost: createPostView({ bodyHtml: "<p>Root</p>" }),
        leadingReplies: [
          createPostView({
            id: "post-2",
            permalink: "/post-2",
            slug: "post-2",
            bodyHtml: "<p>Second</p>",
          }),
        ],
        trailingReplies: [],
        latestReply: createPostView({
          id: "post-3",
          permalink: "/post-3",
          slug: "post-3",
          bodyHtml: "<p>Latest</p>",
          isLastInThread: true,
        }),
        totalReplyCount: 2,
      }),
    );

    expect(html).toContain("thread-context-shell");
    expect(html).toContain("data-collapsed");
    expect(html).toContain("data-thread-context-toggle");
    expect(html).toContain("<p>Root</p>");
    expect(html).toContain("<p>Second</p>");
    expect(html).toContain("<p>Latest</p>");
    // 3-post thread (totalReplyCount 2): the shell stacks 2 cards, so the
    // toggle is rendered visible on first paint.
    expect(toggleTag(html)).not.toContain("hidden");
  });

  it("points the hidden-posts gap link to the second reply so the detail page opens just above the hidden range", () => {
    const html = renderWithI18n(() =>
      ThreadPreview({
        rootPost: createPostView({ bodyHtml: "<p>Root</p>" }),
        leadingReplies: [
          createPostView({
            id: "post-2",
            permalink: "/post-2",
            slug: "post-2",
            bodyHtml: "<p>Second</p>",
          }),
        ],
        trailingReplies: [
          createPostView({
            id: "post-4",
            permalink: "/post-4",
            slug: "post-4",
            bodyHtml: "<p>Penultimate</p>",
          }),
        ],
        latestReply: createPostView({
          id: "post-5",
          permalink: "/post-5",
          slug: "post-5",
          bodyHtml: "<p>Latest</p>",
          isLastInThread: true,
        }),
        totalReplyCount: 4,
      }),
    );

    expect(html).toMatch(
      /<a[^>]*\bhref="\/post-2"[^>]*\bclass="thread-gap-link"|<a[^>]*\bclass="thread-gap-link"[^>]*\bhref="\/post-2"/,
    );
  });

  it("falls back to the latest reply for the gap link when there is no second reply", () => {
    const html = renderWithI18n(() =>
      ThreadPreview({
        rootPost: createPostView({ bodyHtml: "<p>Root</p>" }),
        leadingReplies: [],
        trailingReplies: [
          createPostView({
            id: "post-4",
            permalink: "/post-4",
            slug: "post-4",
            bodyHtml: "<p>Penultimate</p>",
          }),
        ],
        latestReply: createPostView({
          id: "post-5",
          permalink: "/post-5",
          slug: "post-5",
          bodyHtml: "<p>Latest</p>",
          isLastInThread: true,
        }),
        totalReplyCount: 3,
      }),
    );

    expect(html).toMatch(
      /<a[^>]*\bhref="\/post-5"[^>]*\bclass="thread-gap-link"|<a[^>]*\bclass="thread-gap-link"[^>]*\bhref="\/post-5"/,
    );
  });

  it("renders curated thread previews without a collapsible context shell", () => {
    // Curated previews render each segment in flow — no shell, no toggle —
    // so the overflow heuristic never applies to them.
    const post = createPostView({ summary: "Curated note" });
    const html = renderWithI18n(() =>
      CuratedThreadPreview({
        curatedThread: {
          rootPost: post,
          showContextRatings: false,
          segments: [{ post, hiddenBeforeCount: 0, highlighted: true }],
        },
      }),
    );

    expect(html).not.toContain("data-thread-context-toggle");
  });

  it("renders article summaries in curated thread previews", () => {
    const articlePost = createPostView({
      title: "Curated article",
      bodyHtml: '<p>Lead</p><span id="continue"></span><p>Body</p>',
      summaryHtml: "<p>Lead</p>",
      summaryHasMore: true,
    });
    const curatedThread: NonNullable<TimelineItemView["curatedThread"]> = {
      rootPost: articlePost,
      showContextRatings: false,
      segments: [
        {
          post: articlePost,
          hiddenBeforeCount: 0,
          highlighted: true,
        },
      ],
    };

    const html = renderWithI18n(() =>
      CuratedThreadPreview({
        curatedThread,
      }),
    );

    expect(html).toContain("<p>Lead</p>");
    expect(html).not.toContain("<p>Body</p>");
    expect(html).not.toContain('id="continue"');
  });

  it("shows ratings on every post in a complete Collection Thread", () => {
    const root = createPostView({
      id: "post-root",
      slug: "post-root",
      permalink: "/post-root",
      rating: 3,
    });
    const reply = createPostView({
      id: "post-reply",
      slug: "post-reply",
      permalink: "/post-reply",
      replyToId: root.id,
      threadRootId: root.id,
      rating: 5,
      isLastInThread: true,
    });

    const html = renderWithI18n(() =>
      CuratedThreadPreview({
        curatedThread: {
          rootPost: root,
          showContextRatings: true,
          segments: [
            { post: root, hiddenBeforeCount: 0, highlighted: false },
            { post: reply, hiddenBeforeCount: 0, highlighted: false },
          ],
        },
      }),
    );

    expect(html.match(/class="post-rating"/g)).toHaveLength(2);
    expect(html).not.toContain("thread-item-curated");
  });

  it("keeps non-selected Featured context ratings hidden", () => {
    const featured = createPostView({
      id: "post-featured",
      slug: "post-featured",
      permalink: "/post-featured",
      rating: 4,
    });
    const context = createPostView({
      id: "post-context",
      slug: "post-context",
      permalink: "/post-context",
      rating: 5,
      isLastInThread: true,
    });

    const html = renderWithI18n(() =>
      CuratedThreadPreview({
        curatedThread: {
          rootPost: featured,
          showContextRatings: false,
          segments: [
            { post: featured, hiddenBeforeCount: 0, highlighted: true },
            { post: context, hiddenBeforeCount: 0, highlighted: false },
          ],
        },
      }),
    );

    expect(html.match(/class="post-rating"/g)).toHaveLength(1);
    expect(html).toContain("thread-item-curated");
    expect(html).toContain("thread-item-context");
  });
});

describe("threadContextAssumesOverflow", () => {
  it("assumes overflow for 3+ post threads (the shell stacks 2+ cards)", () => {
    expect(
      threadContextAssumesOverflow({
        rootPost: createPostView({ summary: "short" }),
        totalReplyCount: 2,
      }),
    ).toBe(true);
  });

  it("assumes a short lone root fits the cap (2-post thread)", () => {
    expect(
      threadContextAssumesOverflow({
        rootPost: createPostView({
          summary: "Took the long way home because the light was good.",
        }),
        totalReplyCount: 1,
      }),
    ).toBe(false);
  });

  it("assumes overflow for a long lone root", () => {
    expect(
      threadContextAssumesOverflow({
        rootPost: createPostView({ summary: "x".repeat(200) }),
        totalReplyCount: 1,
      }),
    ).toBe(true);
  });

  it("assumes overflow for a short lone root that carries media", () => {
    expect(
      threadContextAssumesOverflow({
        rootPost: createPostView({
          summary: "short",
          media: [{} as PostView["media"][number]],
        }),
        totalReplyCount: 1,
      }),
    ).toBe(true);
  });

  it("assumes overflow for a short lone root with a link preview image", () => {
    expect(
      threadContextAssumesOverflow({
        rootPost: createPostView({
          format: "link",
          summary: "short",
          previewImageUrl: "https://example.com/cover.jpg",
        }),
        totalReplyCount: 1,
      }),
    ).toBe(true);
  });

  it("counts plain-text code points, not UTF-16 units, against the limit", () => {
    // 130 CJK code points — comfortably over the 120 limit even though each
    // is a single BMP character. Confirms the threshold reads real length.
    expect(
      threadContextAssumesOverflow({
        rootPost: createPostView({ summary: "字".repeat(130) }),
        totalReplyCount: 1,
      }),
    ).toBe(true);
  });
});
