import { describe, expect, it } from "vitest";
import type { PostView, TimelineItemView } from "../../types.js";
import { viewUnitsInHtml, wholeThreadOf } from "../list-views.js";

const ROOT = "pst_01h455vb4pex5vsknk084sn02q";

function post(overrides: Partial<PostView> = {}): PostView {
  return {
    id: ROOT,
    permalink: "/root",
    slug: "root",
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
    isLastInThread: true,
    ...overrides,
  };
}

function reply(n: number, overrides: Partial<PostView> = {}): PostView {
  return post({
    id: `reply-${n}`,
    permalink: `/reply-${n}`,
    slug: `reply-${n}`,
    threadRootId: ROOT,
    replyToId: ROOT,
    isLastInThread: false,
    ...overrides,
  });
}

/** A thread preview item of a root and `count` replies, as the feed gets it. */
function thread(
  count: number,
  latest: Partial<PostView> = {},
): TimelineItemView {
  const replies = Array.from({ length: count }, (_, i) => reply(i + 1));
  const latestReply = { ...replies.at(-1), ...latest } as PostView;
  return {
    post: post({ isLastInThread: false }),
    threadPreview: {
      leadingReplies: replies.slice(0, 2),
      trailingReplies: replies.slice(-3, -1),
      latestReply,
      gapHref: count > 5 ? "/reply-3" : null,
      totalReplyCount: count,
    },
  };
}

describe("wholeThreadOf", () => {
  it("takes a lone untitled note, link or quote, and never a titled note", () => {
    expect(wholeThreadOf({ post: post() })).toBe(ROOT);
    expect(
      wholeThreadOf({ post: post({ format: "link", title: "A page" }) }),
    ).toBe(ROOT);
    expect(wholeThreadOf({ post: post({ format: "quote" }) })).toBe(ROOT);
    expect(wholeThreadOf({ post: post({ title: "An article" }) })).toBeNull();
  });

  it("never takes a post shown on its own while its Thread has others", () => {
    expect(wholeThreadOf({ post: reply(1) })).toBeNull();
    expect(wholeThreadOf({ post: post({ isLastInThread: false }) })).toBeNull();
  });

  it("takes a Thread the fold shows whole, and none it shortens", () => {
    expect(wholeThreadOf(thread(1))).toBe(ROOT);
    // Six posts fit; a seventh leaves a gap.
    expect(wholeThreadOf(thread(5))).toBe(ROOT);
    expect(wholeThreadOf(thread(6))).toBeNull();
    // A titled post anywhere in it shows only an excerpt.
    expect(wholeThreadOf(thread(2, { title: "An article" }))).toBeNull();
  });

  it("takes a curated Thread only without gaps", () => {
    const segments = (hidden: number) => [
      {
        post: post(),
        hiddenBeforeCount: 0,
        gapHref: null,
        highlighted: false,
      },
      {
        post: reply(1),
        hiddenBeforeCount: hidden,
        gapHref: hidden > 0 ? "/reply-1" : null,
        highlighted: true,
      },
    ];
    const curated = (hidden: number): TimelineItemView => ({
      post: post(),
      curatedThread: {
        rootPost: post(),
        showContextRatings: false,
        segments: segments(hidden),
      },
    });
    expect(wholeThreadOf(curated(0))).toBe(ROOT);
    expect(wholeThreadOf(curated(2))).toBeNull();
  });
});

describe("viewUnitsInHtml", () => {
  it("reads the marked Threads once each, in order, and nothing else", () => {
    const other = "pst_01h455vb4pex5vsknk084sn02r";
    const html = [
      `<div data-view-unit="${ROOT}">`,
      `<div data-view-unit="${other}">`,
      `<div data-view-unit="${ROOT}">`,
      `<div data-view-unit="/not-an-id">`,
      `<div data-thread-root-id="${other}">`,
    ].join("");
    expect(viewUnitsInHtml(html)).toEqual([ROOT, other]);
    expect(viewUnitsInHtml("<main></main>")).toEqual([]);
  });
});
