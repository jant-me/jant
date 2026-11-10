import { describe, expect, it } from "vitest";
import {
  getPosterFrameSeconds,
  getPosterFrameUrl,
  normalizeDurationSeconds,
  shouldUseShortVideoExperience,
} from "../video-playback.js";

describe("normalizeDurationSeconds", () => {
  it("rounds up fractional durations for storage and heuristics", () => {
    expect(normalizeDurationSeconds(14.2)).toBe(15);
  });

  it("returns undefined for invalid durations", () => {
    expect(normalizeDurationSeconds(0)).toBeUndefined();
    expect(normalizeDurationSeconds(undefined)).toBeUndefined();
  });
});

describe("shouldUseShortVideoExperience", () => {
  it("accepts short lightweight videos", () => {
    expect(
      shouldUseShortVideoExperience({
        mimeType: "video/mp4",
        durationSeconds: 12,
        size: 3_000_000,
      }),
    ).toBe(true);
  });

  it("rejects longer videos", () => {
    expect(
      shouldUseShortVideoExperience({
        mimeType: "video/mp4",
        durationSeconds: 16,
        size: 3_000_000,
      }),
    ).toBe(false);
  });

  it("rejects oversized videos even when short", () => {
    expect(
      shouldUseShortVideoExperience({
        mimeType: "video/mp4",
        durationSeconds: 12,
        size: 20 * 1024 * 1024,
      }),
    ).toBe(false);
  });
});

describe("getPosterFrameSeconds", () => {
  it("takes a tenth of the clip, never later than the first second", () => {
    expect(getPosterFrameSeconds(4)).toBeCloseTo(0.4);
    expect(getPosterFrameSeconds(10)).toBe(1);
    expect(getPosterFrameSeconds(600)).toBe(1);
  });

  it("names the opening frame when the length is unknown", () => {
    expect(getPosterFrameSeconds(undefined)).toBe(0);
    expect(getPosterFrameSeconds(null)).toBe(0);
    expect(getPosterFrameSeconds(0)).toBe(0);
    expect(getPosterFrameSeconds(Number.NaN)).toBe(0);
  });
});

describe("getPosterFrameUrl", () => {
  it("points the file at its poster frame", () => {
    expect(getPosterFrameUrl("/media/clip.mp4", 3)).toBe(
      "/media/clip.mp4#t=0.3",
    );
    expect(getPosterFrameUrl("/media/clip.mp4", 42)).toBe(
      "/media/clip.mp4#t=1",
    );
  });

  it("starts a clip of unknown length a tenth of a second in", () => {
    // `#t=0` is no fragment at all, and iOS Safari draws nothing without one.
    expect(getPosterFrameUrl("/media/clip.mp4", undefined)).toBe(
      "/media/clip.mp4#t=0.1",
    );
  });
});
