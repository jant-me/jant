/**
 * Quote Card
 *
 * Left-border accent blockquote with full date in footer.
 *
 * Fields, and the microformats2 property each maps to:
 * - quoteText: the quoted text — the h-cite's `p-content`
 * - title: attribution (who said it) — the h-cite's `p-name`
 * - url: source link — the h-cite's `u-url`
 * - bodyHtml: commentary — the h-entry's `e-content`
 *
 * `p-name` for the attribution is deliberately loose: the field may hold a
 * person, a work, or a site, and a person would strictly be a `p-author` with
 * a nested h-card. `p-name` covers all three without inventing that h-card.
 */

import type { FC } from "hono/jsx";
import type { TimelineCardProps } from "../../types.js";
import { StarRating } from "../shared/StarRating.js";
import { PostFooter } from "../shared/PostFooter.js";
import { PostStatusBadges } from "./PostStatusBadges.js";
import { sanitizeUrl, extractDisplayDomain } from "../../lib/url.js";
import { DecorativeQuoteMark } from "../shared/DecorativeQuoteMark.js";
import { EmptyPostContent } from "../shared/EmptyPostContent.js";
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
  const showCite =
    !!post.quoteText || (!isCompact && !!(post.title || safeUrl));
  const showCommentary = !isCompact && !!commentaryHtml;

  return (
    <article
      class={articleClass}
      {...(isDetail ? { "data-page": "post" } : {})}
      {...getPostArticleAttributes(post)}
    >
      {!isCompact && !display?.hideStatusBadges && <PostStatusBadges />}
      {showCite && (
        /* The h-cite spans both the quoted text and its attribution, because
           mf2 properties bind to descendants: a `u-url` on the source link
           left outside would attach to the h-entry and shadow the permalink,
           and `p-name` would become this post's own name. `<figure>` with a
           `<figcaption>` is also how HTML pairs a blockquote with its source. */
        <figure class="feed-quote-cite h-cite">
          {post.quoteText && (
            <blockquote
              class={`feed-quote${isCompact ? "" : " feed-quote-card"}`}
            >
              {!isCompact && <DecorativeQuoteMark class="feed-quote-mark" />}
              <div
                class={`p-content feed-quote-content${isCompact ? " text-sm" : isDetail ? " post-detail-quote" : ""}`}
              >
                {post.quoteText}
              </div>
            </blockquote>
          )}
          {!isCompact && (post.title || safeUrl) && (
            <figcaption class="feed-quote-attribution">
              {safeUrl ? (
                <a
                  href={safeUrl}
                  class="u-url p-name feed-quote-source"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {post.title || extractDisplayDomain(safeUrl) || safeUrl}
                </a>
              ) : (
                <span class="p-name">{post.title}</span>
              )}
            </figcaption>
          )}
        </figure>
      )}
      {/* Nothing quoted and nothing said leaves the entry with no `p-name`,
          no `e-content`, and no nested h-cite — the shape a parser fills in by
          guessing. */}
      {!showCite && !showCommentary && <EmptyPostContent />}
      {showCommentary && (
        <div
          class={`e-content feed-quote-commentary prose${isDetail ? " post-detail-body" : " text-muted-foreground"}`}
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
