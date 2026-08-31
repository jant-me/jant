/**
 * Media Gallery Component
 *
 * Renders media attachments in a unified horizontal row: images with
 * lightbox support, videos with play overlay, audio/documents as 3:4
 * styled card tiles, and attached texts as summary cards.
 *
 * Attachments sit beside `e-content`, not inside it, so a consumer reading
 * the h-entry would otherwise see a post with no media at all. The visual
 * ones carry `u-photo` / `u-video` / `u-audio` — the standard microformats2
 * properties, the same ones W3C Post Type Discovery reads — so what the
 * timeline shows is what a parser gets. Placement follows the mf2 implied
 * value rules: on the element whose own attribute already holds the URL,
 * never on a wrapper that would resolve to something else.
 *
 * Documents and attached texts stay unmarked. There is no standard property
 * for them, and inventing one would put a private vocabulary in public
 * markup.
 */

import type { FC } from "hono/jsx";
import type { MediaView } from "../../types.js";
import { getMediaCategory } from "../../lib/upload.js";
import { shouldUseShortVideoExperience } from "../../lib/video-playback.js";
import {
  blurhashToDataUrl,
  getBlurhashDecodeSize,
} from "../../lib/blurhash-placeholder.js";

export interface MediaGalleryProps {
  attachments: MediaView[];
  /** Post permalink — used to build shareable text-attachment URLs */
  postPermalink?: string;
}

const DEFAULT_VISUAL_RATIO = 4 / 3;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatChars(count: number): string {
  if (count < 1000) return `${count} chars`;
  if (count < 1_000_000) {
    return `${parseFloat((count / 1000).toFixed(1))}k chars`;
  }
  return `${parseFloat((count / 1_000_000).toFixed(1))}M chars`;
}

export function getMediaAspectRatio(width?: number, height?: number): number {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !width ||
    !height ||
    width <= 0 ||
    height <= 0
  ) {
    return DEFAULT_VISUAL_RATIO;
  }

  return width / height;
}

export function getMediaPlaceholderDataUrl(
  blurhash?: string,
  width?: number,
  height?: number,
): string | undefined {
  if (!blurhash) return undefined;

  const decodeSize = getBlurhashDecodeSize(width, height);
  return blurhashToDataUrl(blurhash, decodeSize.width, decodeSize.height);
}

function getSingleVisualWidth(ratio: number): string {
  return `min(100%, calc(24rem * ${ratio}), var(--layout-content-width))`;
}

/** Shortest a gallery strip gets, in CSS pixels. */
const ROW_MIN = 240;
/** Tallest a gallery strip gets — the 24rem cap a lone visual already has. */
const ROW_MAX = 384;
/** No single item in a strip is wider than this, in CSS pixels. */
const ITEM_MAX_WIDTH = 520;
/** Width the opening visual is measured at when it sets the row height. */
const NOMINAL_ITEM_WIDTH = 320;

/**
 * Shared height for a multi-item gallery strip.
 *
 * Every visual in a strip gets this height and a width of
 * `rowHeight * its own aspect ratio`, so one number decides the whole row.
 * Three rules pick it, in order:
 *
 * 1. **The opener leads.** `NOMINAL_ITEM_WIDTH / leadRatio` is the height the
 *    first visual would have at a nominal 320px width, so a portrait opener
 *    earns a taller row than a landscape one.
 * 2. **Nothing outgrows the strip.** The widest visual is held to
 *    `ITEM_MAX_WIDTH`, which stops a 16:9 video following a portrait picture
 *    from swallowing the whole content column.
 * 3. **One band.** `ROW_MAX` matches the cap a lone visual gets on its own, so
 *    a second attachment never makes the first picture grow.
 *
 * Non-visual attachments stay out of this deliberately: a text file beside a
 * picture is no reason to resize the picture. Their cards are sized *from* the
 * result instead.
 *
 * @param visualRatios - Aspect ratios of the strip's images and videos in
 *   display order, each from {@link getMediaAspectRatio} so every value is
 *   finite and positive. Empty when the strip holds no visuals at all.
 * @returns Row height in CSS pixels.
 * @example
 * getGalleryRowHeight([0.53, 1.78]); // 292 - portrait opener, then a 16:9 video
 * getGalleryRowHeight([0.53, 0.53]); // 384 - two portraits
 * getGalleryRowHeight([1.78, 1.78]); // 240 - two landscapes
 * getGalleryRowHeight([]); // 240 - documents only
 */
export function getGalleryRowHeight(visualRatios: number[]): number {
  const leadRatio = visualRatios[0];
  if (leadRatio === undefined) return ROW_MIN;

  const byLead = NOMINAL_ITEM_WIDTH / leadRatio;
  const byWidestItem = ITEM_MAX_WIDTH / Math.max(...visualRatios);

  return Math.round(
    Math.min(ROW_MAX, Math.max(ROW_MIN, Math.min(byLead, byWidestItem))),
  );
}

/**
 * Format-specific file icon. Each MIME type gets a visually distinct icon
 * built on the same document silhouette base.
 */
const FileIcon = ({
  mimeType,
  size = 24,
}: {
  mimeType: string;
  size?: number;
}) => {
  const base = {
    width: `${size}`,
    height: `${size}`,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.5",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  } as const;

  // PDF — bold "PDF" label
  if (mimeType === "application/pdf") {
    return (
      <svg {...base}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <text
          x="12"
          y="16.5"
          text-anchor="middle"
          fill="currentColor"
          stroke="none"
          font-size="6"
          font-weight="700"
          font-family="system-ui, sans-serif"
        >
          PDF
        </text>
      </svg>
    );
  }

  // Markdown — "#" heading symbol
  if (mimeType === "text/markdown") {
    return (
      <svg {...base}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <text
          x="12"
          y="16.5"
          text-anchor="middle"
          fill="currentColor"
          stroke="none"
          font-size="10"
          font-weight="700"
          font-family="system-ui, sans-serif"
        >
          #
        </text>
      </svg>
    );
  }

  // CSV — 3x2 grid/table
  if (mimeType === "text/csv") {
    return (
      <svg {...base}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        {/* Horizontal lines */}
        <line x1="8" y1="12" x2="16" y2="12" />
        <line x1="8" y1="15" x2="16" y2="15" />
        <line x1="8" y1="18" x2="16" y2="18" />
        {/* Vertical dividers */}
        <line x1="10.7" y1="12" x2="10.7" y2="18" />
        <line x1="13.3" y1="12" x2="13.3" y2="18" />
      </svg>
    );
  }

  // Archive — vertical zipper dashes
  if (getMediaCategory(mimeType) === "archive") {
    return (
      <svg {...base}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="12" y1="10" x2="12" y2="11.5" />
        <line x1="12" y1="13" x2="12" y2="14.5" />
        <line x1="12" y1="16" x2="12" y2="17.5" />
      </svg>
    );
  }

  // Text attachment (pre-rendered HTML) — notepad with paragraph lines
  if (mimeType === "text/html; charset=utf-8") {
    return (
      <svg {...base}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="11" x2="8" y2="11" />
        <line x1="16" y1="14" x2="8" y2="14" />
        <line x1="12" y1="17" x2="8" y2="17" />
      </svg>
    );
  }

  // Plain text (default) — 3 horizontal text lines
  return (
    <svg {...base}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <line x1="10" y1="9" x2="8" y2="9" />
    </svg>
  );
};

/*
 * No `h-*` Tailwind utility belongs on anything inside a post: a microformats2
 * parser treats every `h-`-prefixed class as a microformat root, so `h-auto` on
 * a single image published a phantom `h-auto` child microformat — carrying the
 * thumbnail as its `photo` — on the h-entry of every post with a picture.
 * Nothing was lost by dropping it: Preflight already declares
 * `img, video { max-width: 100%; height: auto }`.
 */
export const MediaGallery: FC<MediaGalleryProps> = ({
  attachments,
  postPermalink,
}) => {
  if (attachments.length === 0) return null;

  // Build lightbox group from images + videos in position order
  // (documents/texts don't use lightbox)
  const lightboxItems = attachments
    .filter((a) => {
      const cat = getMediaCategory(a.mimeType);
      return cat === "image" || cat === "video";
    })
    .map((a) => ({
      id: a.id,
      url: a.url,
      alt: a.altText || "",
      width: a.width,
      height: a.height,
      ...(getMediaCategory(a.mimeType) === "video"
        ? {
            mimeType: a.mimeType,
            posterUrl: a.posterUrl || undefined,
            durationSeconds: a.durationSeconds,
            size: a.size,
          }
        : {}),
    }));

  // Build gallery items preserving position order from the database
  type GalleryItem =
    | (MediaView & { _kind: "image" | "video"; _lbIdx: number })
    | (MediaView & { _kind: "document" })
    | (MediaView & { _kind: "text" })
    | (MediaView & { _kind: "audio" });

  let lbIdx = 0;
  const galleryItems: GalleryItem[] = attachments.map((a) => {
    const cat = getMediaCategory(a.mimeType);
    if (cat === "image" || cat === "video") {
      return { ...a, _kind: cat, _lbIdx: lbIdx++ } as GalleryItem;
    }
    if (cat === "audio")
      return { ...a, _kind: "audio" as const } as GalleryItem;
    if (cat === "text") return { ...a, _kind: "text" as const } as GalleryItem;
    return { ...a, _kind: "document" as const } as GalleryItem;
  });

  const hasGalleryItems = galleryItems.length > 0;
  const singleItem = galleryItems.length === 1;
  // Documents/texts have no intrinsic size — treat as single only if the one item is visual
  const firstItem = galleryItems[0];
  const singleVisual =
    singleItem &&
    firstItem !== undefined &&
    (firstItem._kind === "image" || firstItem._kind === "video");

  // Strip geometry. A lone visual never reads this — it keeps its natural
  // ratio — but every other shape does, cards included.
  const rowHeight = getGalleryRowHeight(
    galleryItems
      .filter((item) => item._kind === "image" || item._kind === "video")
      .map((item) => getMediaAspectRatio(item.width, item.height)),
  );

  // Document card: 3:4 portrait, same height as row
  const DOC_RATIO = 3 / 4;
  const docCardWidth = Math.round(rowHeight * DOC_RATIO);

  return (
    <>
      {/* Unified gallery row */}
      {hasGalleryItems && (
        <div class={`mt-3 ${singleVisual ? "" : "media-gallery-scroll-wrap"}`}>
          <div
            data-post-media
            data-lightbox-group={
              lightboxItems.length > 0
                ? JSON.stringify(lightboxItems)
                : undefined
            }
            class={`flex gap-3 ${singleVisual ? "" : "overflow-x-auto scroll-smooth"}`}
            style={
              singleVisual
                ? undefined
                : "scrollbar-width: none; -ms-overflow-style: none;"
            }
            tabindex={singleVisual ? undefined : 0}
            role={singleVisual ? undefined : "group"}
            aria-label={singleVisual ? undefined : "Media gallery"}
          >
            {galleryItems.map((item) => {
              if (item._kind === "image") {
                const ratio = getMediaAspectRatio(item.width, item.height);
                const placeholder = getMediaPlaceholderDataUrl(
                  item.blurhash,
                  item.width,
                  item.height,
                );
                const itemWidth = singleVisual
                  ? undefined
                  : `${Math.round(Math.max(160, rowHeight * ratio))}px`;
                const aspectRatio =
                  item.width && item.height
                    ? `${item.width}/${item.height}`
                    : "4/3";
                const imageStyle = {
                  ...(singleVisual
                    ? { aspectRatio, backgroundSize: "cover" }
                    : { height: `${rowHeight}px`, backgroundSize: "cover" }),
                  ...(placeholder
                    ? {
                        backgroundImage: `url(${placeholder})`,
                        backgroundPosition: "center",
                        backgroundRepeat: "no-repeat",
                      }
                    : {}),
                };

                return (
                  <a
                    key={item.id}
                    href={item.url}
                    data-lightbox-index={item._lbIdx}
                    class={`${singleVisual ? "" : "shrink-0"} media-visual-frame`}
                    style={{
                      ...(singleVisual
                        ? {
                            width: getSingleVisualWidth(ratio),
                            maxWidth: "100%",
                          }
                        : { width: itemWidth, maxWidth: "85%" }),
                    }}
                  >
                    <img
                      src={item.thumbnailUrl}
                      alt={item.altText || ""}
                      width={item.width}
                      height={item.height}
                      style={imageStyle}
                      /* `u-photo` here rather than on the enclosing link:
                         `img.u-photo` resolves to `src` and carries `alt`
                         with it, so a consumer gets the same thumbnail the
                         timeline shows and the text describing it. The link
                         wraps the full-size original, which is a click
                         target rather than the post's photo. */
                      class={`u-photo ${
                        singleVisual
                          ? "media-visual w-full rounded-lg"
                          : "media-visual w-full object-cover"
                      }`}
                      loading="lazy"
                      decoding="async"
                    />
                  </a>
                );
              }

              if (item._kind === "video") {
                const useShortVideoExperience =
                  shouldUseShortVideoExperience(item);
                const ratio = getMediaAspectRatio(item.width, item.height);
                const placeholder = getMediaPlaceholderDataUrl(
                  item.blurhash,
                  item.width,
                  item.height,
                );
                const itemWidth = singleVisual
                  ? undefined
                  : `${Math.round(Math.max(160, rowHeight * ratio))}px`;
                const posterSrc = item.posterUrl || placeholder;
                /* `video.u-photo` resolves to `poster`, which is the still
                   the timeline already shows. Only a real poster qualifies:
                   the blurhash fallback is a data URL, and publishing one as
                   a photo would hand a consumer a 20-pixel smear. */
                const posterClass = item.posterUrl ? "u-photo " : "";
                const aspectRatio =
                  item.width && item.height
                    ? `${item.width}/${item.height}`
                    : "4/3";
                const videoStyle = {
                  ...(singleVisual
                    ? { aspectRatio, backgroundSize: "cover" }
                    : { height: `${rowHeight}px`, backgroundSize: "cover" }),
                  ...(placeholder
                    ? {
                        backgroundImage: `url(${placeholder})`,
                        backgroundPosition: "center",
                        backgroundRepeat: "no-repeat",
                      }
                    : {}),
                };

                if (useShortVideoExperience) {
                  return (
                    <div
                      key={item.id}
                      class={`${singleVisual ? "" : "shrink-0"} media-video-wrap media-video-wrap-short`}
                      style={
                        singleVisual
                          ? {
                              width: getSingleVisualWidth(ratio),
                              maxWidth: "100%",
                            }
                          : { width: itemWidth, maxWidth: "85%" }
                      }
                    >
                      <a
                        href={item.url}
                        data-lightbox-index={item._lbIdx}
                        class="u-video media-visual-frame media-video-link"
                      >
                        <video
                          preload="none"
                          muted
                          playsinline
                          loop
                          poster={posterSrc}
                          width={item.width}
                          height={item.height}
                          data-feed-short-video=""
                          data-video-src={item.url}
                          data-feed-video-id={item.id}
                          style={videoStyle}
                          class={`${posterClass}${
                            singleVisual
                              ? "media-visual w-full"
                              : "media-visual w-full object-cover"
                          }`}
                        />
                      </a>
                      <button
                        type="button"
                        class="media-feed-video-mute"
                        data-feed-video-mute-toggle
                        data-muted="true"
                        aria-label="Play with sound"
                      >
                        <svg
                          class="media-feed-video-icon media-feed-video-icon-muted"
                          width="12"
                          height="12"
                          viewBox="0 0 48 48"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <path d="M1.5 13.3c-.8 0-1.5.7-1.5 1.5v18.4c0 .8.7 1.5 1.5 1.5h8.7l12.9 12.9c.9.9 2.5.3 2.5-1v-9.8c0-.4-.2-.8-.4-1.1l-22-22c-.3-.3-.7-.4-1.1-.4h-.6zm46.8 31.4-5.5-5.5C44.9 36.6 48 31.4 48 24c0-11.4-7.2-17.4-7.2-17.4-.6-.6-1.6-.6-2.2 0L37.2 8c-.6.6-.6 1.6 0 2.2 0 0 5.7 5 5.7 13.8 0 5.4-2.1 9.3-3.8 11.6L35.5 32c1.1-1.7 2.3-4.4 2.3-8 0-6.8-4.1-10.3-4.1-10.3-.6-.6-1.6-.6-2.2 0l-1.4 1.4c-.6.6-.6 1.6 0 2.2 0 0 2.6 2 2.6 6.7 0 1.8-.4 3.2-.9 4.3L25.5 22V1.4c0-1.3-1.6-1.9-2.5-1L13.5 10 3.3-.3c-.6-.6-1.5-.6-2.1 0L-.2 1.1c-.6.6-.6 1.5 0 2.1L4 7.6l26.8 26.8 13.9 13.9c.6.6 1.5.6 2.1 0l1.4-1.4c.7-.6.7-1.6.1-2.2z" />
                        </svg>
                        <svg
                          class="media-feed-video-icon media-feed-video-icon-unmuted"
                          width="12"
                          height="12"
                          viewBox="0 0 48 48"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <path d="M1.5 13.3c-.8 0-1.5.7-1.5 1.5v18.4c0 .8.7 1.5 1.5 1.5h8.7l12.9 12.9c.9.9 2.5.3 2.5-1V1.4c0-1.3-1.6-1.9-2.5-1L10.2 13.3H1.5z" />
                          <path d="M30.1 15.9c-.6-.6-.6-1.6 0-2.2l1.4-1.4c.6-.6 1.6-.6 2.2 0 0 0 4.1 3.5 4.1 11.7s-4.1 11.7-4.1 11.7c-.6.6-1.6.6-2.2 0l-1.4-1.4c-.6-.6-.6-1.6 0-2.2 0 0 2.6-2 2.6-8.1s-2.6-8.1-2.6-8.1z" />
                          <path d="M37.2 8c-.6-.6-.6-1.6 0-2.2l1.4-1.4c.6-.6 1.6-.6 2.2 0 0 0 5.7 5.1 5.7 19.6s-5.7 19.6-5.7 19.6c-.6.6-1.6.6-2.2 0L37.2 42c-.6-.6-.6-1.6 0-2.2 0 0 4.3-4.4 4.3-15.8S37.2 8 37.2 8z" />
                        </svg>
                      </button>
                    </div>
                  );
                }

                return (
                  <a
                    key={item.id}
                    href={item.url}
                    data-lightbox-index={item._lbIdx}
                    class={`u-video ${singleVisual ? "" : "shrink-0"} media-video-wrap media-visual-frame`}
                    style={
                      singleVisual
                        ? {
                            width: getSingleVisualWidth(ratio),
                            maxWidth: "100%",
                          }
                        : { width: itemWidth, maxWidth: "85%" }
                    }
                  >
                    <video
                      preload="none"
                      muted
                      playsinline
                      poster={posterSrc}
                      width={item.width}
                      height={item.height}
                      style={videoStyle}
                      class={`${posterClass}${
                        singleVisual
                          ? "media-visual w-full"
                          : "media-visual w-full object-cover"
                      }`}
                    />
                    <div class="media-video-play-overlay">
                      <svg viewBox="0 0 24 24" fill="white">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                  </a>
                );
              }

              if (item._kind === "audio") {
                const audioName = item.originalName || item.altText || "Audio";
                return (
                  <div
                    key={item.id}
                    class={`media-gallery-card media-audio-card shrink-0${item.waveform ? " has-waveform" : ""}`}
                    style={{
                      width: `${docCardWidth}px`,
                      height: `${rowHeight}px`,
                    }}
                  >
                    {/* Hidden audio element — JS controls it */}
                    <audio preload="none" class="media-audio-el">
                      <source
                        class="u-audio"
                        src={item.url}
                        type={item.mimeType}
                      />
                    </audio>

                    {/* Artwork area */}
                    <div class="media-audio-artwork">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d="M9 18V5l12-2v13" />
                        <circle cx="6" cy="18" r="3" />
                        <circle cx="18" cy="16" r="3" />
                      </svg>
                    </div>

                    {/* Bottom control strip */}
                    <div class="media-audio-controls">
                      {/* Range fallback — hidden when waveform loads */}
                      <input
                        type="range"
                        min="0"
                        max="1000"
                        value="0"
                        class="media-audio-range"
                        data-audio-range
                        aria-label="Seek"
                      />
                      {/* Waveform canvas — replaces range after first play */}
                      <canvas
                        class="media-audio-waveform"
                        data-audio-waveform
                        data-audio-peaks={item.waveform || undefined}
                      />

                      {/* Title + play button row */}
                      <div class="media-audio-row">
                        <div class="media-audio-info">
                          <div class="media-audio-title" title={audioName}>
                            {audioName}
                          </div>
                          <div class="media-audio-time" data-audio-time>
                            0:00
                          </div>
                        </div>

                        <button
                          type="button"
                          class="media-audio-play-btn"
                          data-audio-play
                          aria-label="Play"
                        >
                          <svg
                            class="media-audio-icon-play"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                          >
                            <path d="M8 5v14l11-7z" />
                          </svg>
                          <svg
                            class="media-audio-icon-pause"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                          >
                            <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }

              if (item._kind === "document") {
                return (
                  <a
                    key={item.id}
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="media-gallery-card shrink-0"
                    style={{
                      width: `${docCardWidth}px`,
                      height: `${rowHeight}px`,
                    }}
                  >
                    <div class="media-gallery-card-inner">
                      <div class="media-gallery-card-icon">
                        <FileIcon mimeType={item.mimeType} />
                      </div>
                      <span class="media-gallery-card-summary">
                        {item.originalName || item.altText || "Document"}
                      </span>
                      {item.size != null && (
                        <span class="media-gallery-card-meta">
                          {formatSize(item.size)}
                        </span>
                      )}
                    </div>
                  </a>
                );
              }

              // Text card — 3:4 portrait, matching document cards
              return (
                <button
                  key={item.id}
                  type="button"
                  data-text-preview-id={item.id}
                  data-text-preview-href={
                    postPermalink
                      ? `${postPermalink}/text/${item.id}`
                      : undefined
                  }
                  class="media-gallery-card shrink-0"
                  style={{
                    width: `${docCardWidth}px`,
                    height: `${rowHeight}px`,
                  }}
                >
                  <div class="media-gallery-card-inner">
                    <div class="media-gallery-card-icon">
                      <FileIcon mimeType={item.mimeType} />
                    </div>
                    <span class="media-gallery-card-summary">
                      {item.summary || item.originalName || "Attached text"}
                    </span>
                    {typeof item.chars === "number" && item.chars > 0 && (
                      <span class="media-gallery-card-meta">
                        {formatChars(item.chars)}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          {!singleVisual && (
            <>
              <button
                type="button"
                class="media-gallery-nav media-gallery-nav-prev"
                tabindex={-1}
                aria-label="Scroll to previous media"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
              <button
                type="button"
                class="media-gallery-nav media-gallery-nav-next"
                tabindex={-1}
                aria-label="Scroll to next media"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
};
