/**
 * Post Footer
 *
 * Shared footer for all post cards (feed + detail page).
 * Shows timestamp, collection tags, reply button, and menu trigger.
 */

import type { FC } from "hono/jsx";
import { msg } from "@lingui/core/macro";
import type {
  PostView,
  CollectionTagView,
  PostFooterDisplayOptions,
} from "../../types.js";
import { useLingui } from "../../i18n/context.js";
import { sanitizeUrl } from "../../lib/url.js";
import { useViewer } from "../../lib/viewer-context.js";
import { Icon } from "./Icon.js";

interface PostFooterProps {
  post: PostView;
  /** Detail page variant: border-top styling */
  detail?: boolean;
  display?: PostFooterDisplayOptions;
}

export const CompactCollectionTags: FC<{
  collections: CollectionTagView[];
  showSeparator?: boolean;
  showIcon?: boolean;
}> = ({ collections, showSeparator = true, showIcon = false }) => {
  if (collections.length === 0) return null;

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- length checked above
  const first = collections[0]!;
  const second = collections.length >= 2 ? collections[1] : undefined;
  const hiddenCollections = collections.length > 2 ? collections.slice(2) : [];
  const hiddenTitles = hiddenCollections.map((c) => c.title).join(", ");

  return (
    <span class="post-collection-tags">
      {showSeparator && (
        <span class="post-collection-sep" aria-hidden="true">
          &middot;
        </span>
      )}
      <a href={first.url} class="post-collection-tag">
        {showIcon && (
          <span class="post-collection-primary-icon" aria-hidden="true">
            <Icon name="post-collection-lock" />
          </span>
        )}
        <span class="post-collection-tag-text">{first.title}</span>
      </a>
      {second && (
        <span class="post-collection-second-sep" aria-hidden="true">
          ,{" "}
        </span>
      )}
      {second && (
        <a href={second.url} class="post-collection-tag">
          <span class="post-collection-tag-text">{second.title}</span>
        </a>
      )}
      {hiddenCollections.length > 0 && (
        <>
          <span class="post-collection-second-sep" aria-hidden="true">
            ,{" "}
          </span>
          <span class="post-collection-more-wrap">
            <button
              type="button"
              class="post-collection-more"
              data-collection-popover-trigger
              aria-label={hiddenTitles}
              title={hiddenTitles}
            >
              +{hiddenCollections.length}
            </button>
            <div class="post-collection-popover" data-collection-popover>
              {hiddenCollections.map((c) => (
                <a
                  key={c.slug}
                  href={c.url}
                  class="post-collection-popover-item"
                >
                  {c.title}
                </a>
              ))}
            </div>
          </span>
        </>
      )}
    </span>
  );
};

interface PostPublishedLinkProps {
  post: Pick<
    PostView,
    | "permalink"
    | "publishedAt"
    | "publishedAtFormatted"
    | "publishedAtTime"
    | "status"
  >;
  className: string;
}

export const PostPublishedLink: FC<PostPublishedLinkProps> = ({
  post,
  className,
}) => {
  const { i18n } = useLingui();
  // A draft has never been published; `publishedAt` is standing in for its
  // last edit. The link still matters (it is how you open the post), so keep
  // it and tell the truth about what the date means.
  const publishedLabel =
    post.status === "draft"
      ? i18n._(
          msg({
            message: "Last edited on {date} at {time}",
            comment:
              "@context: Tooltip text for the timestamp on an unpublished draft",
          }),
          {
            date: post.publishedAtFormatted,
            time: post.publishedAtTime,
          },
        )
      : i18n._(
          msg({
            message: "Published on {date} at {time}",
            comment:
              "@context: Tooltip text for the published timestamp in post metadata",
          }),
          {
            date: post.publishedAtFormatted,
            time: post.publishedAtTime,
          },
        );

  return (
    <a href={post.permalink} class={className}>
      <time
        class="dt-published"
        datetime={post.publishedAt}
        title={publishedLabel}
      >
        {post.publishedAtFormatted}
      </time>
    </a>
  );
};

export const PostMenuTriggerButton: FC<{ className?: string }> = ({
  className = "post-menu-trigger",
}) => {
  const { i18n } = useLingui();

  return (
    <button
      type="button"
      class={className}
      aria-haspopup="menu"
      aria-label={i18n._(
        msg({
          message: "More actions",
          comment: "@context: Post menu trigger label in post actions",
        }),
      )}
      aria-expanded="false"
      data-post-menu-trigger
    >
      <Icon name="post-menu-dots" size={15} />
    </button>
  );
};

export const PostFooter: FC<PostFooterProps> = ({ post, detail, display }) => {
  const { i18n } = useLingui();
  const { isAuthor } = useViewer();
  const featuredLabel =
    post.featuredAtFormatted && post.featuredAtTime
      ? i18n._(
          msg({
            message: "Featured on {date} at {time}",
            comment:
              "@context: Tooltip and screen reader label for the featured-post icon in the post footer",
          }),
          {
            date: post.featuredAtFormatted,
            time: post.featuredAtTime,
          },
        )
      : i18n._(
          msg({
            message: "Featured",
            comment:
              "@context: Tooltip and screen reader label for the featured-post icon in the post footer when no featured date is available",
          }),
        );
  const safeExternalUrl =
    post.format === "link" && post.url ? sanitizeUrl(post.url) : "";
  // Drafts get an ordinary footer — the Draft badge above already says what
  // they are, and their lifecycle actions live in the post menu next to Edit
  // and Delete rather than in a bespoke button row.
  const showTimestamp = !display?.hideTimestamp;
  const hideActions = !!display?.hideActions;
  const hideReply = !!display?.hideReply;
  const showReply = !hideReply && post.isLastInThread;
  const showCollectionSeparator =
    showTimestamp || !!safeExternalUrl || post.featured;
  const visibleCollections =
    post.replyToId || post.threadRootId ? [] : post.collections;

  return (
    <footer
      class={`post-menu-footer${detail ? " post-footer-detail" : ""}`}
      data-post-meta
    >
      <div class="post-footer-meta">
        {/* Shown only under `article[data-post-featured]`, which the post menu
            toggles in place — so the author's card keeps the icon ready and a
            reader's carries it only when the post really is featured. */}
        {(isAuthor || post.featured) && (
          <span
            class="post-footer-featured"
            tabindex={0}
            role="img"
            aria-label={featuredLabel}
            data-tooltip={featuredLabel}
            data-align="center"
          >
            <Icon name="featured-sparkle" />
          </span>
        )}
        {showTimestamp && (
          <PostPublishedLink post={post} className="u-url post-footer-link" />
        )}
        {safeExternalUrl && (
          <a
            href={safeExternalUrl}
            class="post-footer-external-link"
            target="_blank"
            rel="noopener noreferrer"
            aria-label={i18n._(
              msg({
                message: "Open external link",
                comment:
                  "@context: Accessible label for the external-link icon in the post footer",
              }),
            )}
          >
            <Icon name="post-external-link" />
          </a>
        )}
        <CompactCollectionTags
          collections={visibleCollections}
          showSeparator={showCollectionSeparator}
          showIcon={detail}
        />
      </div>
      {/* Both triggers are revealed by `body[data-authenticated]` alone, so for
          a reader this whole group is markup nothing can ever surface. */}
      {!hideActions && isAuthor && (
        <div class="post-menu-actions">
          {showReply && (
            <button
              type="button"
              class="reply-trigger"
              aria-label={i18n._(
                msg({
                  message: "Reply",
                  comment: "@context: Reply button label in the post footer",
                }),
              )}
              data-reply-trigger
            >
              <Icon name="post-reply" size={14} />
            </button>
          )}
          <PostMenuTriggerButton />
        </div>
      )}
    </footer>
  );
};
