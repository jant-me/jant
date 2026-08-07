/**
 * Single Post Page
 *
 * Single post view — clean, no card border, with divider footer.
 * When `threadPosts` is provided, renders the full thread with the current
 * post highlighted and scroll-targeted. Ancestors above the current post are
 * wrapped in the same collapsible shell used on the home feed
 * (`.thread-context-shell`), driven by the shared `thread-context.ts`
 * client logic.
 */

import { msg } from "@lingui/core/macro";
import type { FC } from "hono/jsx";
import { useLingui } from "../../i18n/context.js";
import type {
  PostPageProps,
  PostView,
  TimelineCardDisplayOptions,
} from "../../types.js";
import { TimelineItemFromPost } from "../feed/TimelineItem.js";

const PREVIEW_DISPLAY: TimelineCardDisplayOptions = {
  footer: { hideActions: true, hideReply: true, hideTimestamp: false },
};

const renderThreadItem = (
  tp: PostView,
  currentId: string,
  isPreview: boolean,
) => {
  const isCurrent = tp.id === currentId;
  return (
    <div
      key={tp.id}
      id={`post-${tp.id}`}
      class={`thread-item thread-detail-item${isCurrent ? " thread-item-current" : ""}`}
      {...(isCurrent ? { "data-post-current": "" } : {})}
    >
      <TimelineItemFromPost
        post={tp}
        mode="detail"
        display={
          isPreview ? PREVIEW_DISPLAY : { footer: { hideTimestamp: false } }
        }
      />
    </div>
  );
};

const ThreadDetail: FC<{
  post: PostView;
  threadPosts: PostView[];
  isPreview: boolean;
}> = ({ post, threadPosts, isPreview }) => {
  const { i18n } = useLingui();
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

  const currentIndex = threadPosts.findIndex((tp) => tp.id === post.id);
  const ancestors = currentIndex > 0 ? threadPosts.slice(0, currentIndex) : [];
  const currentAndAfter =
    currentIndex >= 0 ? threadPosts.slice(currentIndex) : threadPosts;

  return (
    <div class="thread-group thread-group-detail" data-page="post">
      {ancestors.length > 0 && (
        <>
          <div
            class="thread-context-shell"
            data-thread-context
            data-collapsed=""
          >
            {ancestors.map((tp) => renderThreadItem(tp, post.id, isPreview))}
          </div>
          <button
            type="button"
            class="thread-context-toggle"
            data-thread-context-toggle
            data-label-more={showMoreLabel}
            data-label-less={showLessLabel}
            aria-expanded="false"
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
        </>
      )}
      {currentAndAfter.map((tp) => renderThreadItem(tp, post.id, isPreview))}
    </div>
  );
};

export const PostPage: FC<PostPageProps> = ({
  post,
  threadPosts,
  isPreview = false,
  translations = [],
}) => {
  const { i18n } = useLingui();

  return (
    <div
      data-post-view
      data-post-view-id={post.id}
      data-thread-root-id={post.threadRootId ?? post.id}
    >
      {threadPosts && threadPosts.length > 1 ? (
        <ThreadDetail
          post={post}
          threadPosts={threadPosts}
          isPreview={isPreview}
        />
      ) : (
        <TimelineItemFromPost
          post={post}
          mode="detail"
          display={isPreview ? PREVIEW_DISPLAY : undefined}
        />
      )}
      {translations.length > 0 && (
        <p class="post-translations" data-post-translations>
          {i18n._(
            msg({
              message: "Also available in",
              comment:
                "@context: Label before links to this post's translations",
            }),
          )}{" "}
          {translations.map((translation, index) => (
            <span key={translation.lang}>
              {index > 0 ? <span>, </span> : null}
              <a
                href={translation.href}
                hreflang={translation.lang}
                lang={translation.lang}
              >
                {translation.label}
              </a>
            </span>
          ))}
        </p>
      )}
      {/* Public integration slot — code injection (giscus, Webmentions, etc.) appends here. */}
      <div data-post-end />
    </div>
  );
};
