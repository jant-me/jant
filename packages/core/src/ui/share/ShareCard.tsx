/**
 * Share Card
 *
 * The post as "Share as image" paints it: a sheet of paper on a mat tinted
 * from the site's theme, so the picture reads as a mounted card even on the
 * white of a chat or a feed. Images run across the top of the paper; below
 * them the date, the post set large in the site's fonts with each format's
 * own marks, the files a picture cannot show, and a footer that says whose
 * site it is and how to get there. A lone image keeps its own shape, cut
 * only past 4:5 tall; two or more share a grid of fixed frames.
 *
 * A post in a Thread sits on the Thread's rail, as the timeline shows a
 * Thread's newest post: the Thread's first post above it in up to three
 * lines, the posts between folded to a few dots on the rail, a line of the
 * post after below, and its place in the Thread beside its date. Its images
 * then go after its text, inside its column, so the card reads top to
 * bottom.
 *
 * 540 px wide, captured at 3x. Render it inside `renderIconsInline()`: the
 * capture copies the card on its own, without the page's icon sprite.
 */

import type { FC } from "hono/jsx";
import type {
  ShareCardFile,
  ShareCardThreadPost,
  ShareCardView,
} from "../../lib/share-card.js";
import { DecorativeQuoteMark } from "../shared/DecorativeQuoteMark.js";
import { Icon } from "../shared/Icon.js";
import { formatChars, formatSize } from "../shared/MediaGallery.js";

/** "3:07", or "1:02:45" past an hour. */
function formatDuration(totalSeconds: number): string {
  const seconds = Math.round(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}`
    : `${minutes}:${rest}`;
}

/** The one number that says how much of a file there is. */
function fileMeta(file: ShareCardFile): string | null {
  if (file.size !== undefined) return formatSize(file.size);
  if (file.durationSeconds !== undefined) {
    return formatDuration(file.durationSeconds);
  }
  if (file.chars !== undefined && file.chars > 0)
    return formatChars(file.chars);
  return null;
}

const Files: FC<{ card: ShareCardView }> = ({ card }) => {
  if (card.files.length === 0) return null;
  return (
    <ul class="share-card-files">
      {card.files.map((file) => {
        const meta = fileMeta(file);
        return (
          <li class="share-card-file" data-kind={file.kind}>
            <span class="share-card-file-format">{file.format}</span>
            <span class="share-card-file-text">
              <span class="share-card-file-title">{file.title}</span>
              {meta && <span class="share-card-file-meta">{meta}</span>}
            </span>
          </li>
        );
      })}
      {card.moreFiles > 0 && (
        <li class="share-card-file-more">+{card.moreFiles}</li>
      )}
    </ul>
  );
};

const Images: FC<{ card: ShareCardView }> = ({ card }) => {
  if (card.images.length === 0) return null;
  const last = card.images.length - 1;
  return (
    <div class="share-card-images" data-count={String(card.images.length)}>
      {card.images.map((image, index) => (
        <div class="share-card-image">
          <img
            src={image.url}
            alt=""
            width={image.width}
            height={image.height}
          />
          {image.video && (
            <span class="share-card-play" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          )}
          {index === last && card.moreImages > 0 && (
            <span class="share-card-more-images">+{card.moreImages}</span>
          )}
        </div>
      ))}
    </div>
  );
};

const Avatar: FC<{ card: ShareCardView }> = ({ card }) => {
  if (card.avatarUrl) {
    return <img class="share-card-avatar" src={card.avatarUrl} alt="" />;
  }
  const initial = Array.from(card.siteName.trim())[0];
  return initial ? (
    <span class="share-card-avatar" aria-hidden="true">
      {initial}
    </span>
  ) : null;
};

/** The words; when the summary stops short of the post, its end fades. */
const Body: FC<{ card: ShareCardView }> = ({ card }) =>
  card.bodyHtml ? (
    <div
      class={card.hasMore ? "share-card-body has-more" : "share-card-body"}
      data-share-card-body
      dangerouslySetInnerHTML={{ __html: card.bodyHtml }}
    />
  ) : null;

/** The post itself: its format's marks, its text, and its files. */
const PostContent: FC<{ card: ShareCardView; imagesInside?: boolean }> = ({
  card,
  imagesInside,
}) => {
  const thread = card.thread;
  const quoteSource = [card.quote?.attribution, card.quote?.source]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <div class="share-card-date">
        {card.date}
        {thread && (
          <span class="share-card-thread-position">
            {thread.position} / {thread.total}
          </span>
        )}
      </div>

      {card.link && (card.link.domain || card.link.title) && (
        <div class="share-card-link">
          {card.link.domain && (
            <div class="share-card-link-domain">
              <Icon name="link-domain" />
              <span>{card.link.domain}</span>
            </div>
          )}
          {card.link.title && (
            <h2 class="share-card-link-title">{card.link.title}</h2>
          )}
        </div>
      )}

      {card.quote && (
        <figure class="share-card-quote">
          <DecorativeQuoteMark class="share-card-quote-mark" />
          <blockquote class="share-card-quote-text" data-size={card.quote.size}>
            {card.quote.text}
          </blockquote>
          {quoteSource && (
            <figcaption class="share-card-quote-source">
              {quoteSource}
            </figcaption>
          )}
        </figure>
      )}

      {card.title && <h2 class="share-card-title">{card.title}</h2>}

      <Body card={card} />

      {card.hasMore && !card.bodyHtml && (
        <div class="share-card-more" aria-hidden="true">
          …
        </div>
      )}

      {imagesInside && <Images card={card} />}

      <Files card={card} />
    </>
  );
};

/** A wordless post's images: a few tiles, the last counting the rest. */
const ContextImages: FC<{ post: ShareCardThreadPost }> = ({ post }) => {
  const images = post.images ?? [];
  if (images.length === 0) return null;
  const last = images.length - 1;
  const more = post.moreImages ?? 0;
  return (
    <div class="share-card-context-images" data-count={String(images.length)}>
      {images.map((image, index) => (
        <span class="share-card-context-image">
          <img src={image.url} alt="" />
          {image.video && (
            <span class="share-card-play" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          )}
          {index === last && more > 0 && (
            <span class="share-card-more-images">+{more}</span>
          )}
        </span>
      ))}
    </div>
  );
};

/** The Thread's first post or the post after the shared one, quieter. */
const ContextPost: FC<{ post: ShareCardThreadPost; next?: boolean }> = ({
  post,
  next,
}) => (
  <div
    class={`share-card-thread-item share-card-context${next ? " is-next" : " is-root"}${post.source ? " has-source" : ""}`}
    data-format={post.format}
  >
    {post.title || post.text ? (
      <div class="share-card-context-text">
        {post.title && (
          <span class="share-card-context-title">{post.title}</span>
        )}
        {post.text && <span class="share-card-context-body">{post.text}</span>}
        {post.source && (
          <span class="share-card-context-source">{post.source}</span>
        )}
      </div>
    ) : (
      <ContextImages post={post} />
    )}
  </div>
);

const Thread: FC<{ card: ShareCardView }> = ({ card }) => {
  const thread = card.thread;
  if (!thread) return null;
  return (
    <div class="share-card-thread">
      {thread.root && <ContextPost post={thread.root} />}
      {thread.hidden > 0 && (
        <div
          class="share-card-thread-item share-card-thread-gap"
          data-hidden={String(thread.hidden)}
          aria-hidden="true"
        />
      )}
      <div class="share-card-thread-item share-card-thread-current">
        <PostContent card={card} imagesInside />
      </div>
      {thread.next && <ContextPost post={thread.next} next />}
    </div>
  );
};

export const ShareCard: FC<{ card: ShareCardView }> = ({ card }) => (
  <div
    class="share-card"
    data-share-card
    data-file-name={card.fileName}
    data-layout={card.layout}
    data-thread={card.thread ? "" : undefined}
    lang={card.language}
  >
    <div class="share-card-paper">
      {!card.thread && <Images card={card} />}
      <div class="share-card-inner">
        {card.thread ? <Thread card={card} /> : <PostContent card={card} />}

        <footer class="share-card-foot">
          <Avatar card={card} />
          <div class="share-card-source">
            <span class="share-card-site">{card.siteName}</span>
            {card.siteAddress && (
              <span class="share-card-address">{card.siteAddress}</span>
            )}
          </div>
          <span
            class="share-card-qr"
            dangerouslySetInnerHTML={{ __html: card.qrSvg }}
          />
        </footer>
      </div>
    </div>
  </div>
);
