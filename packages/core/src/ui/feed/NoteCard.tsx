/**
 * Note Card
 *
 * Without title: plain text note with full date in footer.
 * With title: article-style rendering with summary excerpt and "Read more" link.
 */

import { msg } from "@lingui/core/macro";
import type { FC } from "hono/jsx";
import { useLingui } from "../../i18n/context.js";
import type { TimelineCardProps } from "../../types.js";
import { EmptyPostContent } from "../shared/EmptyPostContent.js";
import { MediaGallery } from "../shared/MediaGallery.js";
import { getPostArticleAttributes } from "../shared/post-article-attributes.js";
import { StarRating } from "../shared/StarRating.js";
import { PostFooter, PostPublishedLink } from "../shared/PostFooter.js";
import { PostStatusBadges } from "./PostStatusBadges.js";

function stripContinueAnchor(html?: string): string | undefined {
  if (!html) return undefined;
  return html.replace(/<span id="continue"><\/span>/g, "");
}

function getContinueHref(post: TimelineCardProps["post"]): string {
  const rendersPermalinkThread = !!post.threadRootId || !post.isLastInThread;
  return rendersPermalinkThread ? post.permalink : `${post.permalink}`;
}

export const NoteCard: FC<TimelineCardProps> = ({
  post,
  mode = "feed",
  display,
}) => {
  const { i18n } = useLingui();
  const isCompact = mode === "compact";
  const isDetail = mode === "detail";
  const isArticle = !!post.title;
  const showFullBody =
    !isCompact && !isDetail && display?.showFullBody === true;
  const fullBodyHtml = showFullBody
    ? stripContinueAnchor(post.bodyHtml)
    : post.bodyHtml;
  // Untitled notes only carry summaryHtml when their body was truncated; fall
  // back to the full body so non-truncated notes render every block.
  const displayHtml =
    isDetail || showFullBody
      ? fullBodyHtml
      : (post.summaryHtml ?? fullBodyHtml);
  const continueLabel = i18n._(
    msg({
      message: "Continue →",
      comment:
        "@context: Feed link from a truncated article excerpt to its full page",
    }),
  );
  const readMoreLabel = i18n._(
    msg({
      message: "Read more",
      comment:
        "@context: Expand the rest of a truncated untitled note in place in the feed",
    }),
  );
  const readLessLabel = i18n._(
    msg({
      message: "Read less",
      comment:
        "@context: Collapse an expanded untitled note back to its preview in the feed",
    }),
  );
  // Untitled notes long enough to truncate render their full body with a
  // `data-note-break` marker; this flag tells CSS to clamp the tail until the
  // reader expands it in place.
  const clampNote =
    !isArticle &&
    !isDetail &&
    !isCompact &&
    !showFullBody &&
    post.summaryHasMore === true;
  const hasVisibleRating =
    !!post.rating && post.rating > 0 && !display?.hideRating;
  const showHeaderRating = isDetail && isArticle && hasVisibleRating;
  const footerDisplay =
    isDetail && isArticle && display?.footer?.hideTimestamp === undefined
      ? { ...display?.footer, hideTimestamp: true }
      : display?.footer;

  return (
    <article
      class={`h-entry post-menu-target${isCompact ? " feed-compact" : isDetail ? " py-6" : ""}`}
      {...(isDetail ? { "data-page": "post" } : {})}
      {...getPostArticleAttributes(post)}
    >
      {!isCompact && !display?.hideStatusBadges && (
        <PostStatusBadges post={post} />
      )}
      {isArticle &&
        (isDetail ? (
          <div class="post-header-block post-header-block-detail">
            <h1 class="p-name post-detail-title">{post.title}</h1>
            <div class="post-header-meta-row">
              <PostPublishedLink
                post={post}
                className="u-url post-header-meta-link"
              />
            </div>
            {showHeaderRating && <StarRating rating={post.rating} />}
          </div>
        ) : (
          <h2
            class={`p-name ${isCompact ? "feed-compact-title text-sm mb-1" : "feed-note-title"}`}
          >
            <a href={post.permalink} class="hover:underline">
              {post.title}
            </a>
          </h2>
        ))}
      {displayHtml ? (
        <div
          class={`e-content prose ${isCompact ? "prose-sm" : isDetail || showFullBody ? "post-detail-body" : isArticle ? "post-body-summary" : ""}`}
          data-post-body
          {...(clampNote ? { "data-note-clamp": "" } : {})}
          dangerouslySetInnerHTML={{ __html: displayHtml }}
        />
      ) : (
        !isArticle && <EmptyPostContent />
      )}
      {(() => {
        const tail = (
          <>
            {!isDetail &&
              !isCompact &&
              !showFullBody &&
              post.summaryHasMore &&
              (isArticle ? (
                <a href={getContinueHref(post)} class="feed-continue-link">
                  {continueLabel}
                </a>
              ) : (
                <a
                  href={getContinueHref(post)}
                  class="feed-continue-link"
                  data-note-expand
                  aria-expanded="false"
                  data-label-more={readMoreLabel}
                  data-label-less={readLessLabel}
                >
                  {readMoreLabel}
                </a>
              ))}
            {!isCompact && post.media.length > 0 && (
              <div class="mt-3" data-post-media>
                <MediaGallery
                  attachments={post.media}
                  postPermalink={post.permalink}
                />
              </div>
            )}
            {!isCompact && !showHeaderRating && !display?.hideRating && (
              <StarRating rating={post.rating} />
            )}
            <PostFooter post={post} detail={isDetail} display={footerDisplay} />
          </>
        );
        return !isCompact && post.media.length > 1 ? (
          <div class="post-attached-group">{tail}</div>
        ) : (
          tail
        );
      })()}
    </article>
  );
};
