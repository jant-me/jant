import { describe, expect, it } from "vitest";
import type { Media } from "../../types.js";
import { buildMediaMap } from "../media-helpers.js";

const R2_PUBLIC_URL = "https://cdn.example.com";
const IMAGE_TRANSFORM_URL = "https://example.com/cdn-cgi/image";

function makeMedia(overrides: Partial<Media> = {}): Media {
  return {
    id: "med_01j0000000000000000000000",
    siteId: "sit_test00000000000000000000000",
    postId: "pst_01j0000000000000000000000",
    filename: "clip.mp4",
    originalName: "clip.mp4",
    mimeType: "video/mp4",
    size: 4_000_000,
    storageKey: "media/clip.mp4",
    provider: "r2",
    width: 1920,
    height: 1080,
    durationSeconds: 12,
    alt: null,
    position: "a0",
    blurhash: null,
    waveform: null,
    posterKey: "posters/clip-poster.png",
    summary: null,
    chars: null,
    mediaKind: "video",
    createdAt: 1706745600,
    updatedAt: 1706745600,
    ...overrides,
  };
}

function firstAttachment(media: Media) {
  const map = buildMediaMap(
    new Map([["pst_01j0000000000000000000000", [media]]]),
    R2_PUBLIC_URL,
    IMAGE_TRANSFORM_URL,
  );
  const list = map.get("pst_01j0000000000000000000000");
  expect(list).toHaveLength(1);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- length checked above
  return list![0]!;
}

describe("buildMediaMap", () => {
  it("sizes a video poster through the image transform", () => {
    // A poster is a still frame at the source video's resolution, so an
    // untransformed one puts the full-size original in the timeline. This is
    // the same treatment `toMediaView` gives the field.
    expect(firstAttachment(makeMedia()).posterUrl).toBe(
      "https://example.com/cdn-cgi/image/width=640,quality=80,format=auto,fit=scale-down/https://cdn.example.com/posters/clip-poster.png",
    );
  });

  it("leaves the poster URL untransformed when no transform is configured", () => {
    const map = buildMediaMap(
      new Map([["pst_01j0000000000000000000000", [makeMedia()]]]),
      R2_PUBLIC_URL,
    );
    expect(map.get("pst_01j0000000000000000000000")?.[0]?.posterUrl).toBe(
      "https://cdn.example.com/posters/clip-poster.png",
    );
  });

  it("has no poster URL without a poster key", () => {
    expect(
      firstAttachment(makeMedia({ posterKey: null })).posterUrl,
    ).toBeNull();
  });

  it("leaves a video's own URL alone", () => {
    // Only images go through the transform; asking it to resize an mp4
    // returns nothing useful.
    expect(firstAttachment(makeMedia()).previewUrl).toBe(
      "https://cdn.example.com/media/clip.mp4",
    );
  });
});
