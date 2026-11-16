/**
 * Which timeline items show a whole Thread, and how the page says so.
 *
 * A Thread read in full in a list counts as a view of it (`services/stats.ts`
 * has the policy, `client/list-views.ts` what "read in full" takes). The first
 * condition is the server's to decide, because only the server knows what it
 * left out: the list must render all of the Thread — every post of it, and
 * each card the whole of its post. A titled note shows its title and an
 * excerpt; a Thread longer than the fold shows "N more posts" instead of
 * them. Neither can be read in full in a list, so neither can count there:
 * the reader who wants the rest opens the page, and the page counts.
 *
 * An item that does show a whole Thread carries {@link VIEW_UNIT_ATTRIBUTE},
 * set to the Thread's root id. What is still folded on screen — a clamped
 * note, a capped thread context — is the browser's to see, since the reader
 * can unfold it in place. The view token lists the same ids, read back from
 * the rendered page ({@link viewUnitsInHtml}), so the token and the page
 * cannot disagree about what may be counted.
 */

import type { PostView, TimelineItemView } from "../types.js";
import { ID_PREFIX, isTypeId } from "./ids.js";
import { foldReplyWindows } from "./thread-fold.js";

/** The attribute that marks a timeline item showing a whole Thread. */
export const VIEW_UNIT_ATTRIBUTE = "data-view-unit";

const VIEW_UNIT_PATTERN = new RegExp(
  `\\s${VIEW_UNIT_ATTRIBUTE}="([^"]*)"`,
  "g",
);

/**
 * Whether a feed card renders the whole of its post. A titled note is an
 * article: the feed shows its title and an excerpt. Every other card in the
 * feed carries its full body — an untitled note's tail is only clamped, and
 * the reader can unfold it in place.
 */
function cardShowsWholePost(post: PostView): boolean {
  return post.format !== "note" || !post.title;
}

/**
 * The Thread a timeline item shows whole, if it does.
 *
 * A lone post is a Thread of one. A thread preview shows a whole Thread when
 * its fold hides nothing; a curated thread (Featured) when none of its
 * segments has a gap above it. Either way every card must show its whole
 * post. A post shown on its own while its Thread has others is part of a
 * Thread, never the whole of it.
 *
 * @param item - A timeline item as the feed renders it
 * @returns The Thread's root id, or `null` when the item shows only part
 * @example
 * ```ts
 * wholeThreadOf({ post: untitledNote }); // "pst_…" (the note's own id)
 * wholeThreadOf({ post: titledNote }); // null: the feed shows an excerpt
 * ```
 */
export function wholeThreadOf(item: TimelineItemView): string | null {
  if (item.curatedThread) {
    const { rootPost, segments } = item.curatedThread;
    if (segments.length === 0) return null;
    const whole = segments.every(
      (segment) =>
        segment.hiddenBeforeCount === 0 && cardShowsWholePost(segment.post),
    );
    return whole ? rootPost.id : null;
  }

  if (item.threadPreview) {
    const preview = item.threadPreview;
    // The same fold `ThreadPreview` renders.
    const fold = foldReplyWindows({
      leadingReplies: preview.leadingReplies,
      trailingReplies: preview.trailingReplies,
      latestReply: preview.latestReply,
      nextReply: null,
      totalReplyCount: preview.totalReplyCount,
    });
    if (fold.hiddenCount > 0) return null;
    const shown = [
      item.post,
      ...fold.leadingReplies,
      ...fold.trailingReplies,
      fold.latestReply,
    ];
    return shown.every(cardShowsWholePost) ? item.post.id : null;
  }

  const { post } = item;
  if (post.threadRootId || !post.isLastInThread) return null;
  return cardShowsWholePost(post) ? post.id : null;
}

/**
 * The Threads a rendered page marks as shown whole, in order, once each.
 *
 * Read from the markup itself so that the token a page carries lists exactly
 * the items the page marked. A value that is not a post id is ignored.
 *
 * @param html - The rendered page
 * @returns Root ids of the Threads the page shows whole
 * @example
 * ```ts
 * viewUnitsInHtml('<div data-view-unit="pst_01h455vb4pex5vsknk084sn02q">');
 * // ["pst_01h455vb4pex5vsknk084sn02q"]
 * ```
 */
export function viewUnitsInHtml(html: string): string[] {
  const units = new Set<string>();
  for (const match of html.matchAll(VIEW_UNIT_PATTERN)) {
    const id = match[1];
    if (id && isTypeId(id, ID_PREFIX.post)) units.add(id);
  }
  return [...units];
}
