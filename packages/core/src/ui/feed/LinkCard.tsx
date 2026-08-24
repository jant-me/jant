/**
 * Link Card
 *
 * Author commentary renders as first-class prose (same level as Note body).
 * The link reference (domain, title, preview) sits in a compact card below,
 * keeping the author's voice visually distinct from the referenced content.
 */

import type { FC } from "hono/jsx";
import type { TimelineCardProps } from "../../types.js";
import { EmptyPostContent } from "../shared/EmptyPostContent.js";
import { StarRating } from "../shared/StarRating.js";
import { getPostArticleAttributes } from "../shared/post-article-attributes.js";
import { PostFooter } from "../shared/PostFooter.js";
import { PostStatusBadges } from "./PostStatusBadges.js";
import { sanitizeUrl, extractDisplayDomain } from "../../lib/url.js";
import { MediaGallery } from "../shared/MediaGallery.js";
import { LinkPreview } from "./LinkPreview.js";
import { Icon } from "../shared/Icon.js";

export const LinkCard: FC<TimelineCardProps> = ({
  post,
  mode = "feed",
  display,
}) => {
  const isCompact = mode === "compact";
  const isDetail = mode === "detail";
  const articleClass = `h-entry post-menu-target${isCompact ? " feed-compact" : isDetail ? " py-6" : ""}`;
  const hasVisibleRating =
    !!post.rating && post.rating > 0 && !display?.hideRating;
  const showHeaderRating = isDetail && !!post.title && hasVisibleRating;

  const safeUrl = post.url ? sanitizeUrl(post.url) : "";
  const domain = safeUrl ? extractDisplayDomain(safeUrl) : null;

  /* The h-entry's own `u-url` is the permalink, emitted once by PostFooter.
     The title points at the referenced article instead, which is what
     `u-bookmark-of` means — and only when there is one: without a link the
     href falls back to the permalink, and a post cannot bookmark itself. */
  const titleLinkClass = safeUrl
    ? "u-bookmark-of feed-link-title-link"
    : "feed-link-title-link";

  const domainEl =
    domain &&
    (safeUrl ? (
      <a
        href={safeUrl}
        class="feed-link-domain"
        target="_blank"
        rel="noopener noreferrer"
      >
        <Icon name="link-domain" class="feed-link-domain-icon" />
        <span>{domain}</span>
      </a>
    ) : (
      <div class="feed-link-domain">
        <Icon name="link-domain" class="feed-link-domain-icon" />
        <span>{domain}</span>
      </div>
    ));

  const previewEl = !isCompact && post.previewImageUrl && (
    <LinkPreview
      imageUrl={post.previewImageUrl}
      linkUrl={safeUrl}
      kind={post.previewKind}
      provider={post.previewProvider}
    />
  );

  const bodyEl = !isCompact && post.bodyHtml && (
    <div
      class={`e-content prose${isDetail ? " post-detail-body" : ""}`}
      data-post-body
      dangerouslySetInnerHTML={{ __html: post.bodyHtml }}
    />
  );

  /* No title and no commentary leaves the entry with neither `p-name` nor
     `e-content`, which is the shape a parser fills in by guessing. The title
     is the `p-name`, so this only ever renders when there is none. */
  const emptyContentEl = !post.title && !bodyEl && <EmptyPostContent />;

  const mediaEl = !isCompact && post.media.length > 0 && (
    <div class="mt-3" data-post-media>
      <MediaGallery attachments={post.media} postPermalink={post.permalink} />
    </div>
  );

  const ratingEl = !isCompact && !showHeaderRating && !display?.hideRating && (
    <StarRating rating={post.rating} />
  );

  /* -- Link reference: domain + title + preview (feed & compact only) -- */
  const linkRef = (
    <>
      {domainEl}
      {post.title && (
        <h2 class={`p-name feed-link-title ${isCompact ? "text-sm" : ""}`}>
          <a
            href={safeUrl || post.permalink}
            class={titleLinkClass}
            target={safeUrl ? "_blank" : undefined}
            rel={safeUrl ? "noopener noreferrer" : undefined}
          >
            {post.title}
          </a>
        </h2>
      )}
      {previewEl}
    </>
  );

  return (
    <article
      class={articleClass}
      {...(isDetail ? { "data-page": "post" } : {})}
      {...getPostArticleAttributes(post)}
    >
      {!isCompact && !display?.hideStatusBadges && <PostStatusBadges />}
      {isDetail ? (
        <>
          {domainEl}
          {post.title && (
            <div class="post-header-block">
              <h1 class="p-name post-detail-title feed-link-title">
                <a
                  href={safeUrl || post.permalink}
                  class={titleLinkClass}
                  target={safeUrl ? "_blank" : undefined}
                  rel={safeUrl ? "noopener noreferrer" : undefined}
                >
                  {post.title}
                </a>
              </h1>
              {showHeaderRating && <StarRating rating={post.rating} />}
            </div>
          )}
          {bodyEl}
          {previewEl}
        </>
      ) : isCompact ? (
        linkRef
      ) : (
        <>
          {linkRef}
          {bodyEl}
        </>
      )}
      {(() => {
        const tail = (
          <>
            {emptyContentEl}
            {mediaEl}
            {ratingEl}
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
