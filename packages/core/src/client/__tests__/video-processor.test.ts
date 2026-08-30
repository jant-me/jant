import { describe, expect, it } from "vitest";
import { planVideoProcessing } from "../video-processor.js";

const OPTS = { maxLongEdge: 1920, maxShortEdge: 1080 };

describe("planVideoProcessing", () => {
  it("copies an H.264/AAC video that already fits", () => {
    expect(
      planVideoProcessing(
        { width: 1280, height: 720, videoCodec: "avc", audioCodec: "aac" },
        OPTS,
      ),
    ).toEqual({
      needsResize: false,
      width: 1280,
      height: 720,
      videoNeedsReencode: false,
      audioNeedsReencode: false,
    });
  });

  it("copies a video sitting exactly on the caps", () => {
    const plan = planVideoProcessing(
      { width: 1920, height: 1080, videoCodec: "avc", audioCodec: "aac" },
      OPTS,
    );
    expect(plan.needsResize).toBe(false);
    expect(plan.videoNeedsReencode).toBe(false);
  });

  it("copies a silent video with no audio track", () => {
    const plan = planVideoProcessing(
      { width: 1280, height: 720, videoCodec: "avc" },
      OPTS,
    );
    expect(plan.videoNeedsReencode).toBe(false);
    expect(plan.audioNeedsReencode).toBe(false);
  });

  it("re-encodes an HEVC video even when it fits", () => {
    const plan = planVideoProcessing(
      { width: 1280, height: 720, videoCodec: "hevc", audioCodec: "aac" },
      OPTS,
    );
    expect(plan.needsResize).toBe(false);
    expect(plan.videoNeedsReencode).toBe(true);
    expect(plan.audioNeedsReencode).toBe(false);
  });

  it("re-encodes an unknown video codec", () => {
    const plan = planVideoProcessing(
      { width: 1280, height: 720, videoCodec: null, audioCodec: "aac" },
      OPTS,
    );
    expect(plan.videoNeedsReencode).toBe(true);
  });

  it("re-encodes an Opus audio track but copies the video", () => {
    const plan = planVideoProcessing(
      { width: 1280, height: 720, videoCodec: "avc", audioCodec: "opus" },
      OPTS,
    );
    expect(plan.videoNeedsReencode).toBe(false);
    expect(plan.audioNeedsReencode).toBe(true);
  });

  it("scales 4K down to the long-edge cap", () => {
    const plan = planVideoProcessing(
      { width: 3840, height: 2160, videoCodec: "avc", audioCodec: "aac" },
      OPTS,
    );
    expect(plan).toEqual({
      needsResize: true,
      width: 1920,
      height: 1080,
      videoNeedsReencode: true,
      audioNeedsReencode: false,
    });
  });

  it("caps portrait video by its short edge, not its long edge", () => {
    const plan = planVideoProcessing(
      { width: 2160, height: 3840, videoCodec: "avc" },
      OPTS,
    );
    expect(plan.needsResize).toBe(true);
    expect(plan.width).toBe(1080);
    expect(plan.height).toBe(1920);
  });

  it("caps an ultra-wide video by its long edge", () => {
    const plan = planVideoProcessing(
      { width: 3840, height: 1080, videoCodec: "avc" },
      OPTS,
    );
    expect(plan.width).toBe(1920);
    expect(plan.height).toBe(540);
  });

  it("rounds scaled dimensions up to even numbers for H.264", () => {
    const plan = planVideoProcessing(
      { width: 3840, height: 2158, videoCodec: "avc" },
      OPTS,
    );
    expect(plan.width % 2).toBe(0);
    expect(plan.height % 2).toBe(0);
  });

  it("falls back to the caps when dimensions are unknown", () => {
    const plan = planVideoProcessing({ videoCodec: "avc" }, OPTS);
    expect(plan).toEqual({
      needsResize: false,
      width: 1920,
      height: 1080,
      videoNeedsReencode: false,
      audioNeedsReencode: false,
    });
  });
});
