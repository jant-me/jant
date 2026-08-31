import { renderToString } from "hono/jsx/dom/server";
import { describe, expect, it } from "vitest";
import type { MediaView } from "../../../types.js";
import { MediaGallery } from "../MediaGallery.js";

const HASH = "LEHV6nWB2yk8pyo0adR*.7kCMdnj";

function createMediaView(overrides: Partial<MediaView> = {}): MediaView {
  return {
    id: "media-1",
    url: "/media/full.jpg",
    thumbnailUrl: "/media/thumb.jpg",
    mimeType: "image/jpeg",
    ...overrides,
  };
}

describe("MediaGallery", () => {
  it("renders intrinsic image dimensions and blurhash placeholder styles", () => {
    const html = renderToString(
      MediaGallery({
        attachments: [
          createMediaView({
            width: 1600,
            height: 900,
            blurhash: HASH,
          }),
        ],
      }),
    );

    expect(html).toContain('width="1600"');
    expect(html).toContain('height="900"');
    expect(html).toContain('decoding="async"');
    expect(html).toContain("aspect-ratio:1600/900");
    expect(html).toMatch(/background-image:url\(data:image\/bmp;base64,/);
  });

  it("keeps a single portrait image left-aligned instead of letterboxing a full-width frame", () => {
    const html = renderToString(
      MediaGallery({
        attachments: [
          createMediaView({
            width: 900,
            height: 1600,
            blurhash: HASH,
          }),
        ],
      }),
    );

    expect(html).toContain("aspect-ratio:900/1600");
    expect(html).toMatch(
      /width:min\(100%, ?calc\(24rem ?\* ?0\.5625\), ?var\(--layout-content-width\)\)/,
    );
    expect(html).not.toContain("object-contain");
  });

  it("renders intrinsic video dimensions and keeps a blurhash backdrop", () => {
    const html = renderToString(
      MediaGallery({
        attachments: [
          createMediaView({
            id: "media-2",
            url: "/media/video.mp4",
            thumbnailUrl: "/media/video.mp4",
            mimeType: "video/mp4",
            width: 1080,
            height: 1920,
            durationSeconds: 42,
            blurhash: HASH,
            posterUrl: "/media/video-poster.webp",
          }),
        ],
      }),
    );

    expect(html).toContain("<video");
    expect(html).toContain('poster="/media/video-poster.webp"');
    expect(html).toContain('width="1080"');
    expect(html).toContain('height="1920"');
    expect(html).toContain("aspect-ratio:1080/1920");
    expect(html).toMatch(/background-image:url\(data:image\/bmp;base64,/);
  });

  it("marks short videos for feed autoplay instead of the static play overlay", () => {
    const html = renderToString(
      MediaGallery({
        attachments: [
          createMediaView({
            id: "media-3",
            url: "/media/clip.mp4",
            thumbnailUrl: "/media/clip.mp4",
            mimeType: "video/mp4",
            width: 1080,
            height: 1920,
            durationSeconds: 12,
            size: 3_000_000,
            posterUrl: "/media/clip-poster.webp",
          }),
        ],
      }),
    );

    expect(html).toContain("data-feed-short-video");
    expect(html).toContain('data-video-src="/media/clip.mp4"');
    expect(html).toContain("&quot;id&quot;:&quot;media-3&quot;");
    expect(html).toContain("data-feed-video-mute-toggle");
    expect(html).not.toContain("media-video-play-overlay");
    expect(html).not.toContain("media-short-video-progress");
  });

  it("adds scroll arrows and a focusable strip for multi-item galleries", () => {
    const html = renderToString(
      MediaGallery({
        attachments: [
          createMediaView({ id: "m-1", width: 1600, height: 900 }),
          createMediaView({ id: "m-2", width: 1600, height: 900 }),
          createMediaView({ id: "m-3", width: 1600, height: 900 }),
        ],
      }),
    );

    expect(html).toContain("media-gallery-nav-prev");
    expect(html).toContain("media-gallery-nav-next");
    expect(html).toContain('aria-label="Scroll to previous media"');
    expect(html).toContain('aria-label="Scroll to next media"');
    // The strip is a keyboard tab stop so Arrow keys can scroll it.
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('role="group"');
  });

  it("omits scroll arrows and the tab stop for a single visual", () => {
    const html = renderToString(
      MediaGallery({
        attachments: [createMediaView({ width: 1600, height: 900 })],
      }),
    );

    expect(html).not.toContain("media-gallery-nav");
    expect(html).not.toContain('tabindex="0"');
  });

  // Attachments render beside `e-content`, so without these a parser reading
  // the h-entry sees a post with no media. Placement matters as much as
  // presence: mf2 takes a `u-*` value from the element's own attribute, so a
  // mark on the wrong element publishes the wrong URL.
  describe("microformats", () => {
    it("marks the image thumbnail, not the link to the original", () => {
      const html = renderToString(
        MediaGallery({
          attachments: [
            createMediaView({
              width: 1600,
              height: 900,
              altText: "A harbour at dusk",
            }),
          ],
        }),
      );

      expect(html).toMatch(
        /<img[^>]*src="\/media\/thumb\.jpg"[^>]*class="u-photo /,
      );
      expect(html).toContain('alt="A harbour at dusk"');
      // The anchor holds the full-size original — a click target, not the
      // post's photo.
      expect(html).not.toMatch(/<a[^>]*class="u-photo/);
    });

    it("marks a video by its file URL and its poster by the poster frame", () => {
      const html = renderToString(
        MediaGallery({
          attachments: [
            createMediaView({
              id: "media-video",
              url: "/media/clip.mp4",
              mimeType: "video/mp4",
              posterUrl: "/media/clip.jpg",
              width: 1280,
              height: 720,
              durationSeconds: 120,
            }),
          ],
        }),
      );

      expect(html).toMatch(
        /<a[^>]*href="\/media\/clip\.mp4"[^>]*class="u-video/,
      );
      expect(html).toMatch(/<video[^>]*class="u-photo /);
    });

    it("leaves a posterless video unmarked as a photo", () => {
      // The fallback poster is a blurhash data URL. Publishing one as
      // `u-photo` would hand a consumer a smear instead of a picture.
      const html = renderToString(
        MediaGallery({
          attachments: [
            createMediaView({
              id: "media-video",
              url: "/media/clip.mp4",
              mimeType: "video/mp4",
              blurhash: HASH,
              width: 1280,
              height: 720,
              durationSeconds: 120,
            }),
          ],
        }),
      );

      expect(html).toContain("u-video");
      expect(html).not.toContain("u-photo");
    });

    it("marks audio on the source element that carries the URL", () => {
      const html = renderToString(
        MediaGallery({
          attachments: [
            createMediaView({
              id: "media-audio",
              url: "/media/track.mp3",
              mimeType: "audio/mpeg",
            }),
          ],
        }),
      );

      // `<audio>` has no `src` of its own here, so the mark belongs on
      // `<source>` or it would resolve to nothing.
      expect(html).toMatch(
        /<source[^>]*class="u-audio"[^>]*src="\/media\/track\.mp3"/,
      );
    });

    it("leaves documents and attached texts unmarked", () => {
      const html = renderToString(
        MediaGallery({
          attachments: [
            createMediaView({
              id: "media-doc",
              url: "/media/report.pdf",
              mimeType: "application/pdf",
              originalName: "report.pdf",
            }),
            createMediaView({
              id: "media-text",
              url: "/media/notes.md",
              mimeType: "text/markdown",
              summary: "Field notes",
            }),
          ],
        }),
      );

      expect(html).not.toContain("u-photo");
      expect(html).not.toContain("u-video");
      expect(html).not.toContain("u-audio");
    });
  });
});
