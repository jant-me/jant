/**
 * Thread Preview
 *
 * Shows latest reply as the hero post with ancestor context above.
 * Thread line connects all posts via `.thread-group` / `.thread-item`.
 */

import { msg } from "@lingui/core/macro";
import type { FC } from "hono/jsx";
import { useLingui } from "../../i18n/context.js";
import type { ThreadPreviewProps } from "../../types.js";
import { TimelineItem } from "./TimelineItem.js";
import { TimelineItemFromPost } from "./TimelineItem.js";
import { getThreadPreviewState } from "./thread-preview-state.js";

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
  secondReply,
  penultimateReply,
  latestReply,
  totalReplyCount,
}) => {
  const { i18n } = useLingui();
  const { hiddenCount } = getThreadPreviewState({
    secondReply,
    penultimateReply,
    latestReply,
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
  const renderedSecondReply =
    secondReply && secondReply.id !== latestReply.id ? secondReply : undefined;
  const renderedPenultimateReply =
    penultimateReply &&
    penultimateReply.id !== latestReply.id &&
    penultimateReply.id !== secondReply?.id
      ? penultimateReply
      : undefined;
  const gapHref = renderedSecondReply?.permalink ?? latestReply.permalink;

  return (
    <div class="thread-group thread-group-preview">
      {/* Root post */}
      <div class="thread-item thread-item-context">
        <TimelineItemFromPost
          post={rootPost}
          mode="feed"
          display={ROOT_CONTEXT_DISPLAY}
        />
      </div>

      {/* Second post in the thread */}
      {renderedSecondReply && (
        <div class="thread-item thread-item-context">
          <TimelineItemFromPost
            post={renderedSecondReply}
            mode="feed"
            display={CONTEXT_DISPLAY}
          />
        </div>
      )}

      {/* Hidden posts gap */}
      {hiddenCount > 0 && (
        <div class="thread-item thread-item-gap">
          <a href={gapHref} class="thread-gap-link">
            {hiddenPostsLabel}
          </a>
        </div>
      )}

      {/* Penultimate post in the thread */}
      {renderedPenultimateReply && (
        <div class="thread-item thread-item-context">
          <TimelineItemFromPost
            post={renderedPenultimateReply}
            mode="feed"
            display={CONTEXT_DISPLAY}
          />
        </div>
      )}

      {/* Latest reply (full card, hero) */}
      <div class="thread-item thread-item-hero">
        <TimelineItem item={{ post: latestReply }} display={HERO_DISPLAY} />
      </div>
    </div>
  );
};
