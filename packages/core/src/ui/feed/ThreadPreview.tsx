/**
 * Thread Preview
 *
 * Shows latest reply as the hero post with collapsible faded ancestor context above.
 * Thread line connects all posts via `.thread-group` / `.thread-item`.
 */

import { msg } from "@lingui/core/macro";
import type { FC } from "hono/jsx";
import { useLingui } from "../../i18n/context.js";
import type { ThreadPreviewProps } from "../../types.js";
import { TimelineItem } from "./TimelineItem.js";
import { TimelineItemFromPost } from "./TimelineItem.js";
import {
  getThreadPreviewState,
  threadContextAssumesOverflow,
} from "./thread-preview-state.js";

const ROOT_CONTEXT_DISPLAY = {
  footer: {
    hideReply: true,
  },
} as const;

const CONTEXT_DISPLAY = {
  hideRating: true,
  footer: {
    hideReply: true,
  },
} as const;

const HERO_DISPLAY = {} as const;

export const ThreadPreview: FC<ThreadPreviewProps> = ({
  rootPost,
  leadingReplies,
  trailingReplies,
  latestReply,
  gapHref,
  totalReplyCount,
}) => {
  const { i18n } = useLingui();
  const { hiddenCount } = getThreadPreviewState({
    leadingReplies,
    trailingReplies,
    latestReply,
    totalReplyCount,
  });
  const assumeOverflow = threadContextAssumesOverflow({
    rootPost,
    totalReplyCount,
  });
  const hiddenPostsLabel = i18n._(
    msg({
      message: "{count, plural, one {# more post} other {# more posts}}",
      comment:
        "@context: Link showing count of hidden thread posts between root and latest",
    }),
    {
      count: hiddenCount,
    },
  );
  const showMoreLabel = i18n._(
    msg({
      message: "Show more",
      comment: "@context: Expand faded thread ancestor context in the feed",
    }),
  );
  const showLessLabel = i18n._(
    msg({
      message: "Show less",
      comment:
        "@context: Collapse expanded thread ancestor context in the feed",
    }),
  );
  const visibleReplyIds = new Set([latestReply.id]);
  const dedupeReplies = (replies: typeof leadingReplies) =>
    replies.filter((reply) => {
      if (visibleReplyIds.has(reply.id)) return false;
      visibleReplyIds.add(reply.id);
      return true;
    });
  const renderedLeadingReplies = dedupeReplies(leadingReplies);
  const renderedTrailingReplies = dedupeReplies(trailingReplies);
  // The gap opens the first post it hides — the rule in `lib/thread-fold.ts`,
  // which the feed follows too. The fallback only covers a gap target that
  // went unpublished between the count and the fetch.
  const gapLinkHref = gapHref ?? latestReply.permalink;

  // Always render the collapsible shell + toggle: the cap and fade are a
  // constant "this is context" affordance. The toggle's *initial* visibility
  // is a server-side guess (threadContextAssumesOverflow) — the real rendered
  // height is unknown until the client measures. Guessing matters because a
  // 2-post thread's shell holds only the root, and a short root genuinely
  // fits the cap; rendering the toggle visible anyway makes it flash in then
  // out on load. Client-side measurement (thread-context.ts) re-measures and
  // corrects, so the guess only ever affects that first paint.

  const rootItem = (
    <div class="thread-item thread-item-context">
      <TimelineItemFromPost
        post={rootPost}
        mode="feed"
        display={ROOT_CONTEXT_DISPLAY}
      />
    </div>
  );

  const renderContextReplies = (replies: typeof leadingReplies) =>
    replies.map((reply) => (
      <div class="thread-item thread-item-context">
        <TimelineItemFromPost
          post={reply}
          mode="feed"
          display={CONTEXT_DISPLAY}
        />
      </div>
    ));

  const gapItem =
    hiddenCount > 0 ? (
      <div class="thread-item thread-item-gap">
        <a href={gapLinkHref} class="thread-gap-link">
          {hiddenPostsLabel}
        </a>
      </div>
    ) : null;

  return (
    <div class="thread-group thread-group-preview">
      <div class="thread-context-shell" data-thread-context data-collapsed="">
        {rootItem}
        {renderContextReplies(renderedLeadingReplies)}
        {gapItem}
        {renderContextReplies(renderedTrailingReplies)}
      </div>
      <button
        type="button"
        class="thread-context-toggle"
        data-thread-context-toggle
        data-label-more={showMoreLabel}
        data-label-less={showLessLabel}
        aria-expanded="false"
        hidden={!assumeOverflow}
      >
        <span class="thread-context-toggle-label">{showMoreLabel}</span>
        <svg
          class="thread-context-toggle-chevron"
          viewBox="0 0 16 16"
          aria-hidden="true"
        >
          <path
            d="M4 6l4 4 4-4"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>

      {/* Latest reply (full card, hero) */}
      <div class="thread-item thread-item-hero">
        <TimelineItem item={{ post: latestReply }} display={HERO_DISPLAY} />
      </div>
    </div>
  );
};
