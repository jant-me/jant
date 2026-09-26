/**
 * Thread Fold
 *
 * How much of a thread the timeline shows, and how much it folds away.
 *
 * A thread appears in two places that cannot select its posts the same way.
 * The site paints a page of timeline items and must not load whole threads to
 * do it, so `getThreadTimelineContext` ranks replies in SQL and hands the
 * buckets down. The feed already holds every reply — `<content>` carries the
 * whole chain — so it slices the array it has. Two access paths, one rule.
 *
 * This module owns what they share: the thresholds, and the arithmetic that
 * turns a selection into a hidden count. Whoever changes the shape of the fold
 * changes it here, and both surfaces move together.
 *
 * ## The fold
 *
 * ```
 * root · reply 1 · reply 2 · [N more posts] · 3rd-newest · 2nd-newest · newest
 * ```
 *
 * Six posts at most. A thread that fits arrives whole, with no gap at all —
 * the gap appears only once something is actually left out.
 *
 * ## Where the gap points
 *
 * **At the first post it hides.** The link stands for a run of posts, and it
 * opens the earliest of them, so a reader following "3 more posts" lands on
 * the first of those three.
 *
 * It used to open the last *visible* post instead, on the reasoning that the
 * detail page would then start just above the missing stretch, like a
 * bookmark. That was a deliberate choice and it reads well on the site — but
 * it makes the link mean something other than what its label says, and the
 * feed cannot follow it: `<jant:thread>`'s `gap` attribute is documented as
 * the first hidden post, and a consumer joining it against the `<jant:post>`
 * rows would be handed a post that is on screen. One rule beats two, so both
 * surfaces open the first hidden post.
 */

import type { Post, PostView } from "../types.js";

/**
 * Replies kept from the start of a thread, as context for the newest post.
 *
 * Also fixes where the SQL path's rank cut-off falls, so the two selections
 * stay the same fold.
 */
export const THREAD_LEADING_REPLIES = 2;

/**
 * Replies kept from the end of a thread, the newest one included — it is the
 * hero, and the two before it are its immediate context.
 */
export const THREAD_TRAILING_REPLIES = 3;

/** Anything with an id, which is all the dedupe needs. */
type Identified = Pick<Post, "id"> | Pick<PostView, "id">;

/**
 * How many replies a fold leaves unshown.
 *
 * Deduplicated, because on a short thread the buckets overlap: with four
 * replies the first is also the third-newest, and counting it twice would
 * report posts hidden that are on screen.
 *
 * @param selection - The replies the fold shows, and the thread's total
 * @returns Replies the fold hides, never negative
 * @example
 * getThreadHiddenCount({ leadingReplies: [r1, r2], trailingReplies: [r6, r7],
 *   latestReply: r8, totalReplyCount: 8 }); // 3
 */
export function getThreadHiddenCount({
  leadingReplies,
  trailingReplies,
  latestReply,
  totalReplyCount,
}: {
  leadingReplies: Identified[];
  trailingReplies: Identified[];
  latestReply: Identified;
  totalReplyCount: number;
}): number {
  const shown = new Set(
    [...leadingReplies, ...trailingReplies, latestReply].map((post) => post.id),
  );
  return Math.max(0, totalReplyCount - shown.size);
}

/** What the fold shows of a thread, and what it hides. */
export interface ThreadFold<T> {
  /** Earliest replies, kept as context above the gap. */
  leadingReplies: T[];
  /** Replies just before the newest, kept as its immediate context. */
  trailingReplies: T[];
  /** The newest reply — the hero the timeline builds the card around. */
  latestReply: T;
  /** First reply the fold hides, which is where the gap link points. */
  firstHiddenReply: T | null;
  /** How many replies the fold hides. */
  hiddenCount: number;
}

/**
 * Fold a thread whose replies are already in hand.
 *
 * Takes the same slices the SQL path ranks for: the first
 * `THREAD_LEADING_REPLIES`, and the last `THREAD_TRAILING_REPLIES` with the
 * newest as the hero. `getPublishedThreads` returns each Thread in Thread
 * order, the same `threadOrder` the window functions rank by, so once the root
 * is set aside position in this array *is* the rank — no approximation.
 *
 * @param replies - Every published reply, oldest first
 * @returns The fold, or null when the thread has no replies
 * @example
 * foldThreadReplies([r1, r2, r3, r4, r5, r6, r7, r8]);
 * // leading [r1, r2], trailing [r6, r7], latest r8, firstHidden r3, hidden 3
 */
export function foldThreadReplies<T extends Identified>(
  replies: T[],
): ThreadFold<T> | null {
  const latestReply = replies.at(-1);
  if (!latestReply) return null;

  // A short thread's windows overlap, and the hero is inside both of them on
  // the shortest ones: with a single reply, that reply is the newest *and* the
  // whole leading window. Each list therefore drops whatever an earlier one
  // already shows, hero first — the same order `ThreadPreview` dedupes in when
  // it walks the buckets the SQL path hands it.
  const leadingReplies = replies
    .slice(0, THREAD_LEADING_REPLIES)
    .filter((reply) => reply.id !== latestReply.id);

  const leadingIds = new Set(leadingReplies.map((reply) => reply.id));
  const trailingReplies = replies
    .slice(-THREAD_TRAILING_REPLIES, -1)
    .filter(
      (reply) => reply.id !== latestReply.id && !leadingIds.has(reply.id),
    );

  const shown = new Set([
    ...leadingIds,
    ...trailingReplies.map((reply) => reply.id),
    latestReply.id,
  ]);

  return {
    leadingReplies,
    trailingReplies,
    latestReply,
    // In thread order, so the gap link lands on the earliest post it stands
    // for rather than somewhere in the middle of the run it hides.
    firstHiddenReply: replies.find((reply) => !shown.has(reply.id)) ?? null,
    hiddenCount: getThreadHiddenCount({
      leadingReplies,
      trailingReplies,
      latestReply,
      totalReplyCount: replies.length,
    }),
  };
}
