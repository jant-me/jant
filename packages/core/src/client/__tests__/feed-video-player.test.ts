// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chooseAutoplayVideo,
  initFeedVideoPlayer,
  shouldSuppressFeedVideoAutoplay,
} from "../feed-video-player.js";
import { setMediaVideoPlaybackPaused } from "../media-lightbox-events.js";

describe("chooseAutoplayVideo", () => {
  it("prefers the candidate with the largest visible area", () => {
    const winner = chooseAutoplayVideo([
      {
        video: "first",
        intersectionRatio: 0.9,
        visibleArea: 20_000,
        centerDistance: 40,
      },
      {
        video: "second",
        intersectionRatio: 0.8,
        visibleArea: 28_000,
        centerDistance: 80,
      },
    ]);

    expect(winner?.video).toBe("second");
  });

  it("breaks ties by picking the candidate closest to the viewport center", () => {
    const winner = chooseAutoplayVideo([
      {
        video: "first",
        intersectionRatio: 0.8,
        visibleArea: 24_000,
        centerDistance: 120,
      },
      {
        video: "second",
        intersectionRatio: 0.8,
        visibleArea: 24_000,
        centerDistance: 40,
      },
    ]);

    expect(winner?.video).toBe("second");
  });

  it("suppresses only media the user explicitly paused", () => {
    setMediaVideoPlaybackPaused("media-paused", true);

    expect(shouldSuppressFeedVideoAutoplay("media-paused")).toBe(true);
    expect(shouldSuppressFeedVideoAutoplay("media-playing")).toBe(false);
    expect(shouldSuppressFeedVideoAutoplay(undefined)).toBe(false);

    setMediaVideoPlaybackPaused("media-paused", false);
    expect(shouldSuppressFeedVideoAutoplay("media-paused")).toBe(false);
  });
});

describe("initFeedVideoPlayer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sets no timer on a page without a feed video", () => {
    // The module also initializes itself on import; a timer left behind by
    // either would fire after a test's document is torn down.
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    initFeedVideoPlayer(document);

    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });
});
