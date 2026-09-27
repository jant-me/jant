import { describe, expect, it } from "vitest";
import {
  foldReplyWindows,
  foldThreadReplies,
  getThreadHiddenCount,
  THREAD_LEADING_REPLIES,
  THREAD_TRAILING_REPLIES,
} from "../thread-fold.js";

const reply = (n: number) => ({ id: `reply-${n}` });
const replies = (count: number) =>
  Array.from({ length: count }, (_unused, index) => reply(index + 1));

const ids = (list: { id: string }[]) => list.map((item) => item.id);

describe("foldThreadReplies", () => {
  it("has no fold for a thread with no replies", () => {
    expect(foldThreadReplies([])).toBeNull();
  });

  // The window is the first two plus the last three, so anything up to six
  // posts arrives whole and there is nothing for a gap link to stand for.
  it.each([1, 2, 3, 4, 5])("hides nothing with %i replies", (count) => {
    const fold = foldThreadReplies(replies(count));

    expect(fold?.hiddenCount).toBe(0);
    expect(fold?.firstHiddenReply).toBeNull();
    // Every reply is shown exactly once, the hero included.
    const shown = [
      ...ids(fold?.leadingReplies ?? []),
      ...ids(fold?.trailingReplies ?? []),
      fold?.latestReply.id,
    ];
    expect(new Set(shown).size).toBe(shown.length);
    expect(shown.length).toBe(count);
  });

  // The shortest thread puts one reply in every role at once. It must still
  // be rendered once, not three times.
  it("shows a lone reply once, as the hero", () => {
    const fold = foldThreadReplies(replies(1));

    expect(fold?.latestReply.id).toBe("reply-1");
    expect(fold?.leadingReplies).toEqual([]);
    expect(fold?.trailingReplies).toEqual([]);
  });

  it("folds the middle out of a long thread", () => {
    const fold = foldThreadReplies(replies(7));

    expect(ids(fold?.leadingReplies ?? [])).toEqual(["reply-1", "reply-2"]);
    expect(ids(fold?.trailingReplies ?? [])).toEqual(["reply-5", "reply-6"]);
    expect(fold?.latestReply.id).toBe("reply-7");
    expect(fold?.hiddenCount).toBe(2);
  });

  // The gap stands for a run of posts and opens the first of them, so a reader
  // following it lands where the missing stretch starts.
  it("points the gap at the earliest post it hides", () => {
    expect(foldThreadReplies(replies(20))?.firstHiddenReply?.id).toBe(
      "reply-3",
    );
  });

  it("keeps the window fixed however long the thread runs", () => {
    const fold = foldThreadReplies(replies(50));
    const shown =
      (fold?.leadingReplies.length ?? 0) +
      (fold?.trailingReplies.length ?? 0) +
      1;

    expect(shown).toBe(THREAD_LEADING_REPLIES + THREAD_TRAILING_REPLIES);
    expect(fold?.hiddenCount).toBe(50 - shown);
  });
});

describe("foldReplyWindows", () => {
  /**
   * The windows as `getThreadTimelineContext` ranks them in SQL: overlapping
   * on a short thread, the trailing window without the hero, and the reply one
   * past the leading window fetched whether or not it ends up hidden.
   */
  const rankedWindows = (count: number) => {
    const all = replies(count);
    return {
      leadingReplies: all.slice(0, THREAD_LEADING_REPLIES),
      trailingReplies: all.slice(
        Math.max(0, count - THREAD_TRAILING_REPLIES),
        count - 1,
      ),
      latestReply: all[count - 1] ?? reply(0),
      nextReply: all[THREAD_LEADING_REPLIES] ?? null,
      totalReplyCount: count,
    };
  };

  // The site and the API fold from ranked windows, the feed from the whole
  // chain. Both must describe the same thread the same way.
  it.each([1, 2, 3, 4, 5, 6, 7, 12])(
    "folds %i replies the way the whole chain does",
    (count) => {
      expect(foldReplyWindows(rankedWindows(count))).toEqual(
        foldThreadReplies(replies(count)),
      );
    },
  );

  // With four replies the reply after the leading window is the third-newest,
  // on screen in the trailing window. It is not a gap target.
  it("never points the gap at a reply it shows", () => {
    const fold = foldReplyWindows(rankedWindows(4));

    expect(fold.hiddenCount).toBe(0);
    expect(fold.firstHiddenReply).toBeNull();
    expect(ids(fold.trailingReplies)).toEqual(["reply-3"]);
  });
});

describe("getThreadHiddenCount", () => {
  // The site selects its buckets in SQL and they overlap on short threads, so
  // the count has to dedupe rather than subtract two lengths.
  it("counts a reply in two buckets once", () => {
    expect(
      getThreadHiddenCount({
        leadingReplies: [reply(1), reply(2)],
        trailingReplies: [reply(1)],
        latestReply: reply(2),
        totalReplyCount: 2,
      }),
    ).toBe(0);
  });

  it("counts what a long thread leaves out", () => {
    expect(
      getThreadHiddenCount({
        leadingReplies: [reply(1), reply(2)],
        trailingReplies: [reply(6), reply(7)],
        latestReply: reply(8),
        totalReplyCount: 8,
      }),
    ).toBe(3);
  });

  // A reply published between the count and the selection would otherwise
  // report a negative number of hidden posts.
  it("never goes below zero", () => {
    expect(
      getThreadHiddenCount({
        leadingReplies: [reply(1), reply(2)],
        trailingReplies: [],
        latestReply: reply(3),
        totalReplyCount: 1,
      }),
    ).toBe(0);
  });
});
