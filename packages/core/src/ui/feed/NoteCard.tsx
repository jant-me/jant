/**
 * Note Card
 *
 * Without title: plain text note with full date in footer.
 * With title: article-style rendering with summary excerpt and "Read more" link.
 */

import type { FC } from "hono/jsx";
import type { TimelineCardProps } from "../../types.js";
import { MediaGallery } from "../shared/MediaGallery.js";
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
  const isCompact = mode === "compact";
  const isDetail = mode === "detail";
  const isArticle = !!post.title;
  const showFullBody =
    !isCompact && !isDetail && display?.showFullBody === true;
  const fullBodyHtml = showFullBody
    ? stripContinueAnchor(post.bodyHtml)
    : post.bodyHtml;
  const displayHtml =
    isDetail || !isArticle || showFullBody ? fullBodyHtml : post.summaryHtml;
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
      data-post
      data-format="note"
      data-post-id={post.id}
      data-post-slug={post.slug}
      data-thread-root-id={post.threadRootId ?? post.id}
      {...(post.pinned ? { "data-post-pinned": "" } : {})}
      {...(post.pinnedInCollection
        ? { "data-post-pinned-in-collection": "" }
        : {})}
      {...(post.featured ? { "data-post-featured": "" } : {})}
      data-post-visibility={post.visibility}
      {...(!isDetail && post.threadRootId ? { "data-post-reply": "" } : {})}
    >
      {!isCompact && !display?.hideStatusBadges && <PostStatusBadges />}
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
            class={`p-name ${isCompact ? "text-sm mb-1" : "feed-note-title"}`}
          >
            <a href={post.permalink} class="u-url hover:underline">
              {post.title}
            </a>
          </h2>
        ))}
      {displayHtml && (
        <div
          class={`e-content prose ${isCompact ? "prose-sm" : isDetail || showFullBody ? "post-detail-body" : isArticle ? "post-body-summary" : ""}`}
          data-post-body
          dangerouslySetInnerHTML={{ __html: displayHtml }}
        />
      )}
      {(() => {
        const tail = (
          <>
            {!isCompact && post.media.length > 0 && (
              <div class="mt-3" data-post-media>
                <MediaGallery
                  attachments={post.media}
                  postPermalink={post.permalink}
                />
              </div>
            )}
            {!isDetail &&
              !isCompact &&
              !showFullBody &&
              isArticle &&
              post.summaryHasMore && (
                <a href={getContinueHref(post)} class="feed-continue-link">
                  Continue →
                </a>
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
