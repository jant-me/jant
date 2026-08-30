import { describe, expect, it } from "vitest";
import { planVideoProcessing } from "../video-processor.js";

const OPTS = { maxLongEdge: 1920, maxShortEdge: 1080 };

const mbps = (n: number) => n * 1_000_000;

describe("planVideoProcessing", () => {
  describe("copying", () => {
    it("copies an H.264 video that already fits", () => {
      expect(
        planVideoProcessing(
          {
            width: 1280,
            height: 720,
            videoCodec: "avc",
            videoBitrate: mbps(5),
          },
          OPTS,
        ),
      ).toEqual({
        needsResize: false,
        width: 1280,
        height: 720,
        videoNeedsReencode: false,
        videoBitrate: undefined,
      });
    });

    it("copies a video sitting exactly on the caps", () => {
      const plan = planVideoProcessing(
        { width: 1920, height: 1080, videoCodec: "avc" },
        OPTS,
      );
      expect(plan.needsResize).toBe(false);
      expect(plan.videoNeedsReencode).toBe(false);
    });

    it("re-encodes an HEVC video even when it fits", () => {
      const plan = planVideoProcessing(
        { width: 1280, height: 720, videoCodec: "hevc", videoBitrate: mbps(5) },
        OPTS,
      );
      expect(plan.needsResize).toBe(false);
      expect(plan.videoNeedsReencode).toBe(true);
    });

    it("re-encodes an unknown video codec", () => {
      const plan = planVideoProcessing(
        { width: 1280, height: 720, videoCodec: null },
        OPTS,
      );
      expect(plan.videoNeedsReencode).toBe(true);
    });
  });

  describe("resizing", () => {
    it("scales 4K down to the long-edge cap", () => {
      const plan = planVideoProcessing(
        { width: 3840, height: 2160, videoCodec: "avc" },
        OPTS,
      );
      expect(plan.needsResize).toBe(true);
      expect(plan.width).toBe(1920);
      expect(plan.height).toBe(1080);
      expect(plan.videoNeedsReencode).toBe(true);
    });

    it("caps portrait video by its short edge, not its long edge", () => {
      const plan = planVideoProcessing(
        { width: 2160, height: 3840, videoCodec: "avc" },
        OPTS,
      );
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
      expect(plan.needsResize).toBe(false);
      expect(plan.width).toBe(1920);
      expect(plan.height).toBe(1080);
    });
  });

  describe("bitrate", () => {
    it("targets roughly 8 Mbps for a 1080p re-encode", () => {
      const plan = planVideoProcessing(
        {
          width: 1920,
          height: 1080,
          videoCodec: "hevc",
          videoBitrate: mbps(50),
        },
        OPTS,
      );
      expect(plan.videoBitrate).toBeGreaterThan(mbps(7));
      expect(plan.videoBitrate).toBeLessThan(mbps(9));
    });

    it("never exceeds what the source content carries", () => {
      // A 960×448 HEVC clip at 0.72 Mbps: re-encoding at the size-appropriate
      // 1.8 Mbps would spend most of those bits on the source's own artifacts.
      const plan = planVideoProcessing(
        {
          width: 960,
          height: 448,
          videoCodec: "hevc",
          videoBitrate: 717_000,
        },
        OPTS,
      );
      // 0.72 Mbps HEVC ≈ 1.2 Mbps of H.264, well under the ~1.8 Mbps target.
      expect(plan.videoBitrate).toBeGreaterThan(mbps(1));
      expect(plan.videoBitrate).toBeLessThan(mbps(1.4));
    });

    it("allows H.264 more bits than the HEVC source it replaces", () => {
      const source = { width: 1280, height: 720, videoBitrate: mbps(1) };
      const fromHevc = planVideoProcessing(
        { ...source, videoCodec: "hevc" },
        OPTS,
      );
      const fromAv1 = planVideoProcessing(
        { ...source, videoCodec: "av1" },
        OPTS,
      );
      expect(fromHevc.videoBitrate).toBeGreaterThan(mbps(1));
      expect(fromAv1.videoBitrate).toBeGreaterThan(fromHevc.videoBitrate!);
    });

    it("scales the source cap down along with a downscale", () => {
      // 4K at 40 Mbps → 1080p. The source cap must account for the quarter
      // pixel count, not wave 40 Mbps of 4K bitrate through unchanged.
      const plan = planVideoProcessing(
        {
          width: 3840,
          height: 2160,
          videoCodec: "hevc",
          videoBitrate: mbps(40),
        },
        OPTS,
      );
      expect(plan.videoBitrate).toBeLessThan(mbps(9));
    });

    it("falls back to the size target when the source bitrate is unknown", () => {
      const plan = planVideoProcessing(
        { width: 1920, height: 1080, videoCodec: "hevc" },
        OPTS,
      );
      expect(plan.videoBitrate).toBeGreaterThan(mbps(7));
    });

    it("leaves the bitrate unset when the track is copied", () => {
      const plan = planVideoProcessing(
        { width: 1280, height: 720, videoCodec: "avc", videoBitrate: mbps(3) },
        OPTS,
      );
      expect(plan.videoBitrate).toBeUndefined();
    });
  });
});
