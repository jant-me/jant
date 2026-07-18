/**
 * Quote Card
 *
 * Left-border accent blockquote with full date in footer.
 *
 * Fields:
 * - quoteText: the quoted text
 * - title: attribution (who said it)
 * - url: source link
 * - bodyHtml: commentary
 */

import type { FC } from "hono/jsx";
import type { TimelineCardProps } from "../../types.js";
import { StarRating } from "../shared/StarRating.js";
import { PostFooter } from "../shared/PostFooter.js";
import { PostStatusBadges } from "./PostStatusBadges.js";
import { sanitizeUrl, extractDisplayDomain } from "../../lib/url.js";
import { DecorativeQuoteMark } from "../shared/DecorativeQuoteMark.js";
import { MediaGallery } from "../shared/MediaGallery.js";
import { getPostArticleAttributes } from "../shared/post-article-attributes.js";

export const QuoteCard: FC<TimelineCardProps> = ({
  post,
  mode = "feed",
  display,
}) => {
  const isCompact = mode === "compact";
  const isDetail = mode === "detail";
  const articleClass = `h-entry post-menu-target${isCompact ? " feed-compact" : isDetail ? " py-6" : " feed-quote-post"}`;
  const safeUrl = post.url ? sanitizeUrl(post.url) : "";
  const commentaryHtml = post.bodyHtml ?? null;

  return (
    <article
      class={articleClass}
      {...(isDetail ? { "data-page": "post" } : {})}
      {...getPostArticleAttributes(post)}
    >
      {!isCompact && !display?.hideStatusBadges && <PostStatusBadges />}
      {post.quoteText && (
        <blockquote class={`feed-quote${isCompact ? "" : " feed-quote-card"}`}>
          {!isCompact && <DecorativeQuoteMark class="feed-quote-mark" />}
          <div
            class={`e-content feed-quote-content${isCompact ? " text-sm" : isDetail ? " post-detail-quote" : ""}`}
          >
            {post.quoteText}
          </div>
        </blockquote>
      )}
      {!isCompact && (post.title || safeUrl) && (
        <div class="feed-quote-attribution">
          {safeUrl ? (
            <a
              href={safeUrl}
              class="feed-quote-source"
              target="_blank"
              rel="noopener noreferrer"
            >
              {post.title || extractDisplayDomain(safeUrl) || safeUrl}
            </a>
          ) : (
            <span>{post.title}</span>
          )}
        </div>
      )}
      {!isCompact && commentaryHtml && (
        <div
          class={`feed-quote-commentary prose${isDetail ? " post-detail-body" : " text-muted-foreground"}`}
          data-post-body
          dangerouslySetInnerHTML={{ __html: commentaryHtml }}
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
            {!isCompact && !display?.hideRating && (
              <StarRating rating={post.rating} />
            )}
            <PostFooter
              post={post}
              detail={isDetail}
              display={display?.footer}
            />
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
