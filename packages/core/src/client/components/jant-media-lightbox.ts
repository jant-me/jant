/**
 * Media Lightbox
 *
 * Fullscreen overlay carousel for post media galleries.
 * Intercepts clicks on [data-post-media] a[data-lightbox-index] via
 * delegated listener, reads image data from [data-lightbox-group],
 * and displays images in a native <dialog>.
 *
 * Light DOM only — BaseCoat and Tailwind classes apply directly.
 */

import { LitElement, html, nothing, svg } from "lit";
import { shouldUseShortVideoExperience } from "../../lib/video-playback.js";
import {
  isMediaVideoPlaybackPaused,
  MEDIA_LIGHTBOX_TOGGLE_EVENT,
  setMediaVideoPlaybackPaused,
} from "../media-lightbox-events.js";

interface LightboxImage {
  id?: string;
  url: string;
  alt: string;
  width?: number;
  height?: number;
  mimeType?: string;
  posterUrl?: string;
  durationSeconds?: number;
  size?: number;
}

interface LightboxContainedSize {
  width: number;
  height: number;
}

const LIGHTBOX_MOBILE_BREAKPOINT = 640;
const LIGHTBOX_MOBILE_STAGE_PADDING_X = 8;
const LIGHTBOX_DESKTOP_STAGE_PADDING_X = 72;
const LIGHTBOX_STAGE_PADDING_Y = 16;
const LIGHTBOX_DESKTOP_READING_WIDTH = 704;
const LIGHTBOX_SCROLL_RATIO_THRESHOLD = 0.9;
const LIGHTBOX_SCROLL_WIDTH_THRESHOLD = 0.85;

function getPositiveDimension(value?: number): number | undefined {
  if (!Number.isFinite(value) || !value || value <= 0) return undefined;
  return value;
}

function getViewportSize(): { width: number; height: number } {
  const width =
    globalThis.innerWidth || document.documentElement.clientWidth || 0;
  const height =
    globalThis.innerHeight || document.documentElement.clientHeight || 0;

  return { width, height };
}

function getLightboxStageSize(
  viewportWidth: number,
  viewportHeight: number,
): LightboxContainedSize {
  const isMobile = viewportWidth <= LIGHTBOX_MOBILE_BREAKPOINT;
  const stagePaddingX = isMobile
    ? LIGHTBOX_MOBILE_STAGE_PADDING_X
    : LIGHTBOX_DESKTOP_STAGE_PADDING_X;

  return {
    width: Math.max(0, viewportWidth - stagePaddingX * 2),
    height: Math.max(0, viewportHeight - LIGHTBOX_STAGE_PADDING_Y * 2),
  };
}

function getContainedLightboxMediaSize(
  image: Pick<LightboxImage, "width" | "height"> | undefined,
  viewportWidth: number,
  viewportHeight: number,
): LightboxContainedSize | null {
  const mediaWidth = getPositiveDimension(image?.width);
  const mediaHeight = getPositiveDimension(image?.height);
  if (!mediaWidth || !mediaHeight) {
    return null;
  }

  const stage = getLightboxStageSize(viewportWidth, viewportHeight);
  if (stage.width <= 0 || stage.height <= 0) {
    return null;
  }

  const scale = Math.min(stage.width / mediaWidth, stage.height / mediaHeight);
  return {
    width: Math.max(1, Math.round(mediaWidth * scale)),
    height: Math.max(1, Math.round(mediaHeight * scale)),
  };
}

export function shouldUseScrollableLightboxImage(
  image: Pick<LightboxImage, "width" | "height" | "mimeType"> | undefined,
  viewportWidth: number,
  viewportHeight: number,
): boolean {
  // Switch to a fixed reading width only when contain-mode would make a
  // portrait image materially narrower than the intended viewing width.
  if (
    !image ||
    image.mimeType?.startsWith("video/") ||
    !getPositiveDimension(image.width) ||
    !getPositiveDimension(image.height) ||
    viewportWidth <= 0 ||
    viewportHeight <= 0
  ) {
    return false;
  }

  const imageWidth = getPositiveDimension(image.width);
  const imageHeight = getPositiveDimension(image.height);
  if (!imageWidth || !imageHeight) return false;

  const isMobile = viewportWidth <= LIGHTBOX_MOBILE_BREAKPOINT;
  const stage = getLightboxStageSize(viewportWidth, viewportHeight);
  const stageWidth = stage.width;
  const stageHeight = stage.height;

  if (stageWidth <= 0 || stageHeight <= 0) return false;

  const aspectRatio = imageWidth / imageHeight;
  const containWidth = Math.min(stageWidth, stageHeight * aspectRatio);
  const targetWidth = isMobile
    ? stageWidth
    : Math.min(stageWidth, LIGHTBOX_DESKTOP_READING_WIDTH);

  return (
    aspectRatio < LIGHTBOX_SCROLL_RATIO_THRESHOLD &&
    containWidth < targetWidth * LIGHTBOX_SCROLL_WIDTH_THRESHOLD
  );
}

export class JantMediaLightbox extends LitElement {
  static properties = {
    _images: { state: true },
    _currentIndex: { state: true },
    _open: { state: true },
    _viewportWidth: { state: true },
    _viewportHeight: { state: true },
    _videoCurrentTime: { state: true },
    _videoDuration: { state: true },
    _videoMuted: { state: true },
    _videoPaused: { state: true },
    _imageZoomed: { state: true },
  };

  declare _images: LightboxImage[];
  declare _currentIndex: number;
  declare _open: boolean;
  declare _viewportWidth: number;
  declare _viewportHeight: number;
  declare _videoCurrentTime: number;
  declare _videoDuration: number;
  declare _videoMuted: boolean;
  declare _videoPaused: boolean;
  declare _imageZoomed: boolean;

  createRenderRoot() {
    this.innerHTML = "";
    return this;
  }

  constructor() {
    super();
    const viewport = getViewportSize();
    this._images = [];
    this._currentIndex = 0;
    this._open = false;
    this._viewportWidth = viewport.width;
    this._viewportHeight = viewport.height;
    this._videoCurrentTime = 0;
    this._videoDuration = 0;
    this._videoMuted = false;
    this._videoPaused = false;
    this._imageZoomed = false;
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("click", this.#handleDocumentClick);
    window.addEventListener("resize", this.#handleViewportChange);
    this.#syncViewport();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("click", this.#handleDocumentClick);
    window.removeEventListener("resize", this.#handleViewportChange);
  }

  open(images: LightboxImage[], index: number) {
    this.#syncViewport();
    this.#pauseCurrentVideo();
    this._images = images;
    this._currentIndex = Math.max(0, Math.min(index, images.length - 1));
    this.#resetShortVideoState(this._images[this._currentIndex]);
    this._imageZoomed = false;
    this._open = true;
    document.dispatchEvent(
      new CustomEvent(MEDIA_LIGHTBOX_TOGGLE_EVENT, {
        detail: { open: true },
      }),
    );
    this.updateComplete.then(() => {
      const dialog = this.querySelector<HTMLDialogElement>(".media-lightbox");
      dialog?.showModal();
      this.#focusCurrentMedia();
    });
  }

  close() {
    this.#pauseCurrentVideo();
    this.querySelector<HTMLDialogElement>(".media-lightbox")?.close();
    this._open = false;
    document.dispatchEvent(
      new CustomEvent(MEDIA_LIGHTBOX_TOGGLE_EVENT, {
        detail: { open: false },
      }),
    );
  }

  #handleDocumentClick = (e: Event) => {
    const target = e.target as HTMLElement;

    // Find the closest anchor with data-lightbox-index inside [data-post-media]
    // Media gallery lightbox (existing)
    const anchor = target.closest<HTMLAnchorElement>(
      "[data-post-media] a[data-lightbox-index]",
    );
    if (anchor) {
      const group = anchor.closest<HTMLElement>("[data-lightbox-group]");
      if (!group) return;

      e.preventDefault();

      const index = parseInt(anchor.dataset.lightboxIndex ?? "0", 10);
      try {
        const images: LightboxImage[] = JSON.parse(
          group.dataset.lightboxGroup ?? "[]",
        );
        if (images.length > 0) {
          this.open(images, index);
        }
      } catch {
        // JSON parse failed — fall through to default link behavior
      }
      return;
    }

    // Inline body images — collect all <img> within the same [data-post-body]
    const img = target.closest<HTMLImageElement>("[data-post-body] img");
    if (img) {
      e.preventDefault();
      const container = img.closest<HTMLElement>("[data-post-body]");
      if (!container) return;
      const allImages = Array.from(
        container.querySelectorAll<HTMLImageElement>("img"),
      );
      const images: LightboxImage[] = allImages.map((i) => ({
        url: i.src,
        alt: i.alt || "",
        width: getPositiveDimension(
          i.naturalWidth || Number(i.getAttribute("width")),
        ),
        height: getPositiveDimension(
          i.naturalHeight || Number(i.getAttribute("height")),
        ),
      }));
      const index = allImages.indexOf(img);
      if (images.length > 0) this.open(images, Math.max(0, index));
    }
  };

  #prev() {
    if (this._images.length <= 1) return;
    this.#pauseCurrentVideo();
    this._imageZoomed = false;
    this._currentIndex =
      (this._currentIndex - 1 + this._images.length) % this._images.length;
  }

  #next() {
    if (this._images.length <= 1) return;
    this.#pauseCurrentVideo();
    this._imageZoomed = false;
    this._currentIndex = (this._currentIndex + 1) % this._images.length;
  }

  #handleImageClick = (e: Event) => {
    const img = this._images[this._currentIndex];
    const eligible = shouldUseScrollableLightboxImage(
      img,
      this._viewportWidth,
      this._viewportHeight,
    );
    if (!eligible) return;
    e.stopPropagation();
    this._imageZoomed = !this._imageZoomed;
  };

  #handleKeydown = (e: Event) => {
    const ke = e as globalThis.KeyboardEvent;
    const target = e.target as HTMLElement | null;

    if (ke.key === "Escape") {
      e.preventDefault();
      this.close();
      return;
    }

    // Don't hijack keys aimed at a focused control — the short-video progress
    // slider, the mute/close/nav buttons, or the <video> itself (when focused,
    // its native shortcuts already handle these keys). Let their native
    // behavior run instead of double-handling.
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLButtonElement ||
      target instanceof HTMLVideoElement
    ) {
      return;
    }

    const currentImage = this._images[this._currentIndex];
    if (!currentImage?.mimeType?.startsWith("video/")) {
      // Image galleries: arrow keys switch items.
      if (ke.key === "ArrowLeft") {
        e.preventDefault();
        this.#prev();
      } else if (ke.key === "ArrowRight") {
        e.preventDefault();
        this.#next();
      }
      return;
    }

    const video = this.querySelector<HTMLVideoElement>(".media-lightbox-video");
    if (video) this.#handleVideoKeydown(ke, video);
  };

  // Video shortcuts — play/pause, seek, volume, mute, fullscreen — handled at
  // the dialog level so they work regardless of what's focused. Item switching
  // happens via the on-screen prev/next buttons, matching YouTube/native
  // player conventions.
  #handleVideoKeydown(ke: globalThis.KeyboardEvent, video: HTMLVideoElement) {
    const duration =
      Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : null;
    const seekTo = (time: number) => {
      const next =
        duration != null
          ? Math.max(0, Math.min(time, duration))
          : Math.max(0, time);
      video.currentTime = next;
      this._videoCurrentTime = next;
    };
    const key = ke.key;
    const lower = key.toLowerCase();

    if (key === " " || lower === "k") {
      ke.preventDefault();
      this.#toggleVideoPlayback(video);
    } else if (key === "ArrowLeft") {
      ke.preventDefault();
      seekTo(video.currentTime - 2);
    } else if (key === "ArrowRight") {
      ke.preventDefault();
      seekTo(video.currentTime + 2);
    } else if (key === "Home") {
      ke.preventDefault();
      seekTo(0);
    } else if (key === "End") {
      if (duration != null) {
        ke.preventDefault();
        seekTo(duration);
      }
    } else if (key.length === 1 && key >= "0" && key <= "9") {
      if (duration != null) {
        ke.preventDefault();
        seekTo((Number(key) / 10) * duration);
      }
    } else if (key === "ArrowUp") {
      ke.preventDefault();
      video.volume = Math.min(1, video.volume + 0.05);
    } else if (key === "ArrowDown") {
      ke.preventDefault();
      video.volume = Math.max(0, video.volume - 0.05);
    } else if (lower === "m") {
      ke.preventDefault();
      const muted = !video.muted;
      video.muted = muted;
      this._videoMuted = muted;
    } else if (lower === "f") {
      ke.preventDefault();
      this.#toggleVideoFullscreen(video);
    }
  }

  #toggleVideoFullscreen(video: HTMLVideoElement) {
    const doc = document as globalThis.Document & {
      webkitFullscreenElement?: globalThis.Element | null;
      webkitExitFullscreen?: () => void;
    };
    const el = video as HTMLVideoElement & {
      webkitRequestFullscreen?: () => void;
      webkitEnterFullscreen?: () => void;
    };

    if (document.fullscreenElement ?? doc.webkitFullscreenElement) {
      if (document.exitFullscreen) {
        void document.exitFullscreen().catch(() => {});
      } else {
        doc.webkitExitFullscreen?.();
      }
      return;
    }

    if (video.requestFullscreen) {
      void video.requestFullscreen().catch(() => {});
    } else if (el.webkitRequestFullscreen) {
      el.webkitRequestFullscreen();
    } else if (el.webkitEnterFullscreen) {
      el.webkitEnterFullscreen();
    }
  }

  #handleDialogClick = (e: Event) => {
    const target = e.target as HTMLElement;
    // Close on backdrop click (dialog itself or the content wrapper, not media/buttons)
    if (
      target === e.currentTarget ||
      target.classList.contains("media-lightbox-content") ||
      target.classList.contains("media-lightbox-stage")
    ) {
      this.close();
    }
  };

  #handleClose = () => {
    this.#pauseCurrentVideo();
    if (this._open) {
      document.dispatchEvent(
        new CustomEvent(MEDIA_LIGHTBOX_TOGGLE_EVENT, {
          detail: { open: false },
        }),
      );
    }
    this._open = false;
  };

  #handleViewportChange = () => {
    this.#syncViewport();
  };

  #syncViewport() {
    const viewport = getViewportSize();
    if (
      viewport.width === this._viewportWidth &&
      viewport.height === this._viewportHeight
    ) {
      return;
    }

    this._viewportWidth = viewport.width;
    this._viewportHeight = viewport.height;
  }

  #pauseCurrentVideo() {
    this.querySelector<HTMLVideoElement>(".media-lightbox-video")?.pause();
  }

  // Move focus to the content wrapper on open / item change — not the close
  // button (its focus ring would show during arrow-key nav) and not the
  // <video> (a focused <video> routes keydown to its own native handler,
  // bypassing the dialog-level shortcuts in #handleVideoKeydown).
  #focusCurrentMedia() {
    this.querySelector<HTMLElement>(".media-lightbox-content")?.focus();
  }

  // Browsers focus a <video> when it's clicked. Bounce focus back to the
  // content wrapper so keydown keeps reaching the dialog-level shortcut
  // handler instead of the video's native key handling.
  #handleVideoFocus = () => {
    this.querySelector<HTMLElement>(".media-lightbox-content")?.focus({
      preventScroll: true,
    });
  };

  #resetShortVideoState(image?: LightboxImage) {
    this._videoCurrentTime = 0;
    this._videoDuration =
      image?.durationSeconds && image.durationSeconds > 0
        ? image.durationSeconds
        : 0;
    this._videoMuted = false;
    this._videoPaused = isMediaVideoPlaybackPaused(image?.id);
  }

  #syncCurrentVideo() {
    const currentImage = this._images[this._currentIndex];
    if (!shouldUseShortVideoExperience(currentImage)) {
      this.#resetShortVideoState(currentImage);
      return;
    }

    const video = this.querySelector<HTMLVideoElement>(".media-lightbox-video");
    if (!video) return;

    video.currentTime = 0;
    video.muted = this._videoMuted;
    this._videoPaused = isMediaVideoPlaybackPaused(currentImage.id);
    if (this._videoPaused) {
      video.pause();
      return;
    }

    void video.play().catch(() => {
      this._videoPaused = true;
    });
  }

  #handleShortVideoLoadedMetadata = (e: Event) => {
    const video = e.currentTarget as HTMLVideoElement;
    if (Number.isFinite(video.duration) && video.duration > 0) {
      this._videoDuration = video.duration;
    }
    this._videoCurrentTime = video.currentTime;
    video.muted = this._videoMuted;
  };

  #handleShortVideoTimeUpdate = (e: Event) => {
    const video = e.currentTarget as HTMLVideoElement;
    this._videoCurrentTime = video.currentTime;
    if (Number.isFinite(video.duration) && video.duration > 0) {
      this._videoDuration = video.duration;
    }
  };

  #handleShortVideoPlay = () => {
    this._videoPaused = false;
  };

  #handleShortVideoPause = () => {
    this._videoPaused = true;
  };

  #dispatchVideoPlaybackIntent(paused: boolean) {
    const currentImage = this._images[this._currentIndex];
    const mediaId = currentImage?.id?.trim();
    if (!mediaId || !shouldUseShortVideoExperience(currentImage)) {
      return;
    }

    setMediaVideoPlaybackPaused(mediaId, paused);
  }

  #toggleVideoPlayback(video: HTMLVideoElement) {
    if (video.paused) {
      this._videoPaused = false;
      this.#dispatchVideoPlaybackIntent(false);
      void video.play().catch(() => {
        this._videoPaused = true;
        this.#dispatchVideoPlaybackIntent(true);
      });
      return;
    }

    video.pause();
    this._videoPaused = true;
    this.#dispatchVideoPlaybackIntent(true);
  }

  #handleShortVideoPlaybackToggle = () => {
    const video = this.querySelector<HTMLVideoElement>(".media-lightbox-video");
    if (video) {
      this.#toggleVideoPlayback(video);
    }
  };

  #handleShortVideoSeek = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const video = this.querySelector<HTMLVideoElement>(".media-lightbox-video");
    const nextTime = Number.parseFloat(input.value);
    if (!video || !Number.isFinite(nextTime) || nextTime < 0) {
      return;
    }

    video.currentTime = nextTime;
    this._videoCurrentTime = nextTime;
  };

  #handleShortVideoMuteToggle = () => {
    this._videoMuted = !this._videoMuted;
    const video = this.querySelector<HTMLVideoElement>(".media-lightbox-video");
    if (video) {
      video.muted = this._videoMuted;
    }
  };

  protected updated(changed: Map<string, unknown>) {
    super.updated(changed);

    if (!this._open) return;
    if (
      !changed.has("_currentIndex") &&
      !changed.has("_open") &&
      !changed.has("_imageZoomed")
    ) {
      return;
    }

    const stage = this.querySelector<HTMLElement>(".media-lightbox-stage");
    if (!stage) return;
    stage.scrollTop = 0;
    stage.scrollLeft = 0;
    if (changed.has("_currentIndex") || changed.has("_open")) {
      this.#syncCurrentVideo();
      this.#focusCurrentMedia();
    }
  }

  render() {
    if (!this._open) return nothing;

    const img = this._images[this._currentIndex];
    const multiple = this._images.length > 1;
    const isVideo = img?.mimeType?.startsWith("video/");
    const usesShortVideoControls = shouldUseShortVideoExperience(img);
    const isScrollableEligible = shouldUseScrollableLightboxImage(
      img,
      this._viewportWidth,
      this._viewportHeight,
    );
    const isScrollableImage = isScrollableEligible && this._imageZoomed;
    const shortVideoFrameSize = usesShortVideoControls
      ? getContainedLightboxMediaSize(
          img,
          this._viewportWidth,
          this._viewportHeight,
        )
      : null;
    const isPortraitShortVideo =
      usesShortVideoControls &&
      !!shortVideoFrameSize &&
      shortVideoFrameSize.height > shortVideoFrameSize.width;
    const shortVideoFrameStyle = shortVideoFrameSize
      ? `--media-lightbox-short-width:${shortVideoFrameSize.width}px;--media-lightbox-short-height:${shortVideoFrameSize.height}px;`
      : nothing;
    const progressMax =
      this._videoDuration > 0
        ? this._videoDuration
        : (img?.durationSeconds ?? 1);
    const progressValue = Math.min(this._videoCurrentTime, progressMax);
    const progressPercent =
      progressMax > 0 ? (progressValue / progressMax) * 100 : 0;

    return html`
      <dialog
        class=${`media-lightbox${usesShortVideoControls ? " media-lightbox-short" : ""}`}
        @keydown=${this.#handleKeydown}
        @click=${this.#handleDialogClick}
        @close=${this.#handleClose}
      >
        <div class="media-lightbox-content" tabindex="-1">
          <button
            type="button"
            class="media-lightbox-close"
            @click=${() => this.close()}
            aria-label="Close"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>

          ${
            multiple
              ? html`<div class="media-lightbox-counter">
                  ${this._currentIndex + 1} / ${this._images.length}
                </div>`
              : nothing
          }
          <div
            class=${`media-lightbox-stage${isScrollableImage ? " media-lightbox-stage-scroll" : ""}`}
          >
            ${
              isVideo
                ? usesShortVideoControls
                  ? html`<div
                      class=${`media-lightbox-short-frame${shortVideoFrameSize ? " media-lightbox-short-frame-contained" : ""}${isPortraitShortVideo ? " media-lightbox-short-frame-portrait" : " media-lightbox-short-frame-landscape"}`}
                      style=${shortVideoFrameStyle}
                    >
                      <div class="media-lightbox-short-viewport">
                        <video
                          class="media-lightbox-video media-lightbox-video-short"
                          src=${img?.url ?? ""}
                          poster=${img?.posterUrl ?? ""}
                          ?autoplay=${!this._videoPaused}
                          playsinline
                          loop
                          ?muted=${this._videoMuted}
                          @click=${this.#handleShortVideoPlaybackToggle}
                          @focus=${this.#handleVideoFocus}
                          @loadedmetadata=${this.#handleShortVideoLoadedMetadata}
                          @timeupdate=${this.#handleShortVideoTimeUpdate}
                          @play=${this.#handleShortVideoPlay}
                          @pause=${this.#handleShortVideoPause}
                        ></video>
                      </div>
                      <div
                        class=${`media-lightbox-short-controls${isPortraitShortVideo ? " media-lightbox-short-controls-portrait" : ""}`}
                      >
                        <button
                          type="button"
                          class="media-lightbox-short-playback"
                          @click=${this.#handleShortVideoPlaybackToggle}
                          aria-label=${
                            this._videoPaused ? "Play video" : "Pause video"
                          }
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            aria-hidden="true"
                          >
                            ${
                              this._videoPaused
                                ? svg`<path d="M8 5v14l11-7z" />`
                                : svg`<path d="M6 5h4v14H6zM14 5h4v14h-4z" />`
                            }
                          </svg>
                        </button>
                        <input
                          class="media-lightbox-short-progress"
                          type="range"
                          min="0"
                          max=${progressMax}
                          step="0.01"
                          .value=${String(progressValue)}
                          style=${`--media-progress:${progressPercent}%`}
                          aria-label="Video progress"
                          @input=${this.#handleShortVideoSeek}
                        />
                        <button
                          type="button"
                          class="media-lightbox-short-mute"
                          @click=${this.#handleShortVideoMuteToggle}
                          aria-label=${
                            this._videoMuted ? "Unmute video" : "Mute video"
                          }
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 48 48"
                            fill="currentColor"
                            color="#fff"
                            aria-hidden="true"
                          >
                            ${
                              this._videoMuted
                                ? svg`
                                <path d="M1.5 13.3c-.8 0-1.5.7-1.5 1.5v18.4c0 .8.7 1.5 1.5 1.5h8.7l12.9 12.9c.9.9 2.5.3 2.5-1v-9.8c0-.4-.2-.8-.4-1.1l-22-22c-.3-.3-.7-.4-1.1-.4h-.6zm46.8 31.4-5.5-5.5C44.9 36.6 48 31.4 48 24c0-11.4-7.2-17.4-7.2-17.4-.6-.6-1.6-.6-2.2 0L37.2 8c-.6.6-.6 1.6 0 2.2 0 0 5.7 5 5.7 13.8 0 5.4-2.1 9.3-3.8 11.6L35.5 32c1.1-1.7 2.3-4.4 2.3-8 0-6.8-4.1-10.3-4.1-10.3-.6-.6-1.6-.6-2.2 0l-1.4 1.4c-.6.6-.6 1.6 0 2.2 0 0 2.6 2 2.6 6.7 0 1.8-.4 3.2-.9 4.3L25.5 22V1.4c0-1.3-1.6-1.9-2.5-1L13.5 10 3.3-.3c-.6-.6-1.5-.6-2.1 0L-.2 1.1c-.6.6-.6 1.5 0 2.1L4 7.6l26.8 26.8 13.9 13.9c.6.6 1.5.6 2.1 0l1.4-1.4c.7-.6.7-1.6.1-2.2z" />
                              `
                                : svg`
                                <path d="M1.5 13.3c-.8 0-1.5.7-1.5 1.5v18.4c0 .8.7 1.5 1.5 1.5h8.7l12.9 12.9c.9.9 2.5.3 2.5-1V1.4c0-1.3-1.6-1.9-2.5-1L10.2 13.3H1.5z" />
                                <path d="M30.1 15.9c-.6-.6-.6-1.6 0-2.2l1.4-1.4c.6-.6 1.6-.6 2.2 0 0 0 4.1 3.5 4.1 11.7s-4.1 11.7-4.1 11.7c-.6.6-1.6.6-2.2 0l-1.4-1.4c-.6-.6-.6-1.6 0-2.2 0 0 2.6-2 2.6-8.1s-2.6-8.1-2.6-8.1z" />
                                <path d="M37.2 8c-.6-.6-.6-1.6 0-2.2l1.4-1.4c.6-.6 1.6-.6 2.2 0 0 0 5.7 5.1 5.7 19.6s-5.7 19.6-5.7 19.6c-.6.6-1.6.6-2.2 0L37.2 42c-.6-.6-.6-1.6 0-2.2 0 0 4.3-4.4 4.3-15.8S37.2 8 37.2 8z" />
                              `
                            }
                          </svg>
                        </button>
                      </div>
                    </div>`
                  : html`<video
                      class="media-lightbox-video"
                      src=${img?.url ?? ""}
                      poster=${img?.posterUrl ?? ""}
                      controls
                      autoplay
                      playsinline
                      @focus=${this.#handleVideoFocus}
                    ></video>`
                : html`<img
                    class=${`media-lightbox-img${isScrollableEligible ? " media-lightbox-img-zoomable" : ""}${isScrollableImage ? " media-lightbox-img-scroll" : ""}`}
                    src=${img?.url ?? ""}
                    alt=${img?.alt ?? ""}
                    @click=${this.#handleImageClick}
                  />`
            }
          </div>
          ${
            multiple
              ? html`
                  <button
                    type="button"
                    class="media-lightbox-nav media-lightbox-nav-prev"
                    @click=${() => this.#prev()}
                    aria-label="Previous"
                  >
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="m15 18-6-6 6-6" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    class="media-lightbox-nav media-lightbox-nav-next"
                    @click=${() => this.#next()}
                    aria-label="Next"
                  >
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </button>
                `
              : nothing
          }
        </div>
      </dialog>
    `;
  }
}

customElements.define("jant-media-lightbox", JantMediaLightbox);
