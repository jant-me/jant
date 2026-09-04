/**
 * Link Card
 *
 * The link reference (domain, title, preview) comes first, then the author's
 * commentary as first-class prose (same level as a Note body) — the reader
 * sees what is being referenced before what is said about it. Feed, compact
 * and detail differ only in heading level, never in that order.
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

  const titleLinkEl = post.title && (
    <a
      href={safeUrl || post.permalink}
      class={titleLinkClass}
      target={safeUrl ? "_blank" : undefined}
      rel={safeUrl ? "noopener noreferrer" : undefined}
    >
      {post.title}
    </a>
  );

  /* Detail promotes the title to the page heading and carries the rating with
     it; feed and compact keep it a card heading. Only the wrapper differs —
     the link itself, and where the title sits in the reference, do not. */
  const titleEl =
    post.title &&
    (isDetail ? (
      <div class="post-header-block">
        <h1 class="p-name post-detail-title feed-link-title">{titleLinkEl}</h1>
        {showHeaderRating && <StarRating rating={post.rating} />}
      </div>
    ) : (
      <h2 class={`p-name feed-link-title ${isCompact ? "text-sm" : ""}`}>
        {titleLinkEl}
      </h2>
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

  /* -- Link reference: domain + title + preview, in that order in every mode.
     The preview is part of what is being referenced, so the author's
     commentary always follows it — a detail page that led with the body read
     as a comment on something the reader had not seen yet. -- */
  const linkRef = (
    <>
      {domainEl}
      {titleEl}
      {previewEl}
    </>
  );

  return (
    <article
      class={articleClass}
      {...(isDetail ? { "data-page": "post" } : {})}
      {...getPostArticleAttributes(post)}
    >
      {!isCompact && !display?.hideStatusBadges && (
        <PostStatusBadges post={post} />
      )}
      {linkRef}
      {bodyEl}
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
