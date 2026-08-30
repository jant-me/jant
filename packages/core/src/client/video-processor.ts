/**
 * Client-side Video Processor
 *
 * Processes videos before upload using mediabunny:
 * - Remuxes to MP4, transcoding to H.264/AAC only when the source is not
 *   already in those codecs or does not fit the size caps. A source that
 *   needs nothing has its encoded packets copied straight across, so it
 *   reaches the server without a generation of re-encoding loss
 * - Resizes to max 1920px long edge / 1080px short edge
 * - Strips spurious rotation metadata from the output (mediabunny may
 *   bake rotation into pixels AND write a display matrix, causing the
 *   browser to double-rotate)
 * - Clears the alternate_group track flag (mediabunny sets it non-zero,
 *   which stops Safari's native video controls from auto-hiding)
 * - Extracts poster frame + blurhash during processing
 *
 * Requires WebCodecs API support — check `isSupported()` before use.
 */

import {
  Input,
  Output,
  Mp4OutputFormat,
  BufferTarget,
  BlobSource,
  CanvasSink,
  Conversion,
  Quality,
  ALL_FORMATS,
  type VideoCodec,
} from "mediabunny";
import { encode } from "blurhash";
import { normalizeDurationSeconds } from "../lib/video-playback.js";
import { zeroTrackAlternateGroups } from "../lib/mp4-track-flags.js";

/** Maximum pixels for the long edge of the output video. */
const MAX_LONG_EDGE = 1920;
/** Maximum pixels for the short edge of the output video. */
const MAX_SHORT_EDGE = 1080;
const POSTER_WIDTH = 640;
const BLURHASH_SIZE = 32;

/**
 * Bitrate targeted for a 1080p H.264 re-encode; every other size scales from
 * here. Around 8 Mbps — enough to hold up against the source on a phone or a
 * laptop, low enough that a clip stays servable over the web.
 *
 * This is expressed as a bitrate on purpose. Given a quality *level*,
 * mediabunny prefers quantizer-based encoding, which has no size ceiling at
 * all: a frugally-encoded source gets faithfully reproduced — its own
 * compression artifacts included — at several times its original size. A
 * bitrate keeps the output predictable.
 */
const REFERENCE_BITRATE = 7_900_000;
const REFERENCE_PIXELS = 1920 * 1080;

/** Bitrate scales slightly sub-linearly with pixel count. */
const PIXEL_SCALE_EXPONENT = 0.95;

/**
 * Bits H.264 needs to carry one bit of the source codec at the same quality.
 * H.264 is the baseline; HEVC and VP9 fit roughly 40% more picture into a
 * bit, AV1 around 60%. Used to cap the target at what the source content
 * actually carries — spending more than that reproduces the source's
 * artifacts in high fidelity and buys nothing, because the detail was never
 * there to begin with.
 */
const CODEC_BITRATE_RATIO: Partial<Record<VideoCodec, number>> = {
  avc: 1,
  hevc: 1 / 0.6,
  vp9: 1 / 0.6,
  av1: 1 / 0.4,
  vp8: 1 / 1.2,
};

/**
 * Pick the bitrate for a re-encode: the size-appropriate target, but never
 * more than the source content itself warrants.
 */
function reencodeBitrate(
  source: {
    pixels: number;
    bitrate: number | undefined;
    codec: VideoCodec | null | undefined;
  },
  targetPixels: number,
): number {
  const target =
    REFERENCE_BITRATE *
    (targetPixels / REFERENCE_PIXELS) ** PIXEL_SCALE_EXPONENT;

  if (!source.bitrate || !source.pixels) return Math.round(target);

  const ratio = (source.codec && CODEC_BITRATE_RATIO[source.codec]) ?? 1;
  const sourceCap =
    source.bitrate *
    ratio *
    (targetPixels / source.pixels) ** PIXEL_SCALE_EXPONENT;

  return Math.round(Math.min(target, sourceCap));
}

export interface VideoProcessResult {
  file: File;
  width: number;
  height: number;
  durationSeconds?: number;
  poster?: Blob;
  blurhash?: string;
}

/**
 * Check if the browser supports WebCodecs-based video processing.
 *
 * @returns `true` if `VideoEncoder` is available in the current environment
 */
function isSupported(): boolean {
  return typeof VideoEncoder !== "undefined";
}

interface SourceProbe {
  poster?: Blob;
  blurhash?: string;
  sourceWidth?: number;
  sourceHeight?: number;
  rotation?: number;
  durationSeconds?: number;
  /** Source video codec, or `null` when it could not be determined. */
  videoCodec?: VideoCodec | null;
  /** Average bitrate of the source video track, in bits per second. */
  videoBitrate?: number;
}

/**
 * Probe a video file and extract its poster frame and blurhash in one pass.
 * Seeks to `min(duration × 0.1, 1s)` and captures the frame.
 *
 * Returns the source dimensions, codec, and bitrate alongside, so the caller
 * can decide whether a re-encode is needed at all — and at what bitrate —
 * without opening a second Input instance.
 *
 * @param file - Source video file
 * @returns Poster blob (640px-wide WebP), blurhash, dimensions, codec, bitrate
 */
async function probeSource(file: File): Promise<SourceProbe> {
  const input = new Input({
    source: new BlobSource(file),
    formats: ALL_FORMATS,
  });
  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) return {};

    const sourceWidth = videoTrack.displayWidth;
    const sourceHeight = videoTrack.displayHeight;
    const rotation = videoTrack.rotation;
    const videoCodec = await videoTrack.getCodec();
    // Metadata-only scan of the sample table — milliseconds even on a large
    // file, and exact, unlike dividing file size by duration.
    const videoBitrate = (await videoTrack.computePacketStats()).averageBitrate;

    const duration = await input.computeDuration();
    const durationSeconds = normalizeDurationSeconds(duration);
    const seekTime = Math.min(duration * 0.1, 1);

    // Everything the caller needs to plan the conversion. Poster and blurhash
    // are best-effort on top — each bail-out below still returns this much.
    const base: SourceProbe = {
      sourceWidth,
      sourceHeight,
      rotation,
      durationSeconds,
      videoCodec,
      videoBitrate,
    };

    const sink = new CanvasSink(videoTrack);
    const wrapped = await sink.getCanvas(seekTime);
    if (!wrapped) return base;

    const canvas = wrapped.canvas as HTMLCanvasElement;

    // Poster: 640px wide WebP
    const srcW = canvas.width;
    const srcH = canvas.height;
    const posterScale = Math.min(POSTER_WIDTH / srcW, 1);
    const pw = Math.round(srcW * posterScale);
    const ph = Math.round(srcH * posterScale);

    const posterCanvas = document.createElement("canvas");
    posterCanvas.width = pw;
    posterCanvas.height = ph;
    const pCtx = posterCanvas.getContext("2d");
    if (!pCtx) return base;
    pCtx.drawImage(canvas, 0, 0, pw, ph);

    const poster = await new Promise<Blob | undefined>((resolve) => {
      posterCanvas.toBlob(
        (blob) => resolve(blob ?? undefined),
        "image/webp",
        0.8,
      );
    });

    // Blurhash: 32px canvas, 4×3 components
    const bhScale = Math.min(BLURHASH_SIZE / srcW, BLURHASH_SIZE / srcH, 1);
    const bw = Math.max(Math.round(srcW * bhScale), 1);
    const bh = Math.max(Math.round(srcH * bhScale), 1);

    const bhCanvas = document.createElement("canvas");
    bhCanvas.width = bw;
    bhCanvas.height = bh;
    const bhCtx = bhCanvas.getContext("2d");
    if (!bhCtx) return { ...base, poster };
    bhCtx.drawImage(canvas, 0, 0, bw, bh);

    const imageData = bhCtx.getImageData(0, 0, bw, bh);
    const blurhash = encode(imageData.data, bw, bh, 4, 3);

    return { ...base, poster, blurhash };
  } catch {
    return {};
  } finally {
    input.dispose();
  }
}

/** What a given source needs done to it before upload. */
export interface VideoProcessPlan {
  /** True when the video must be scaled down to fit the size caps. */
  needsResize: boolean;
  /** Target dimensions — equal to the source dimensions when not resizing. */
  width: number;
  height: number;
  /** True when the video track must be decoded and re-encoded. */
  videoNeedsReencode: boolean;
  /**
   * Target video bitrate in bits per second, or `undefined` when the track
   * is copied rather than re-encoded.
   */
  videoBitrate?: number;
}

/**
 * Decide what a source video needs: a resize, a re-encode, or nothing at all.
 *
 * Asking for a size or a quality is what disables mediabunny's copy fast
 * path, so anything already within the caps and already in H.264 must come
 * back with `videoNeedsReencode` false — its encoded packets are then copied
 * across untouched, sparing it a generation of quality. An unknown codec
 * (`null`) counts as needing a re-encode, since we can't vouch for it playing
 * everywhere.
 *
 * When a re-encode is unavoidable, the bitrate is the smaller of what the
 * output size warrants and what the source content actually carries. The
 * second half matters: an efficiently-encoded source re-encoded at constant
 * quality can come out several times larger than it went in, all of those
 * bits spent preserving its own compression artifacts.
 *
 * Dimensions are the source's *display* dimensions, i.e. post-rotation, so
 * the caps apply orientation-agnostically.
 *
 * @param source - Display dimensions, codec, and bitrate of the source
 * @param options - `maxLongEdge` and `maxShortEdge` caps
 * @returns The processing plan
 *
 * @example
 * ```ts
 * // Already H.264 and within the caps — copied, not re-encoded
 * planVideoProcessing(
 *   { width: 1280, height: 720, videoCodec: "avc" },
 *   { maxLongEdge: 1920, maxShortEdge: 1080 },
 * );
 * // { needsResize: false, width: 1280, height: 720,
 * //   videoNeedsReencode: false, videoBitrate: undefined }
 * ```
 */
export function planVideoProcessing(
  source: {
    width?: number;
    height?: number;
    videoCodec?: VideoCodec | null;
    videoBitrate?: number;
  },
  options: { maxLongEdge: number; maxShortEdge: number },
): VideoProcessPlan {
  const { width: sourceWidth, height: sourceHeight } = source;

  // Fall back to the caps when the probe could not read the dimensions;
  // without a source size there is nothing to scale against.
  let width = sourceWidth || options.maxLongEdge;
  let height = sourceHeight || options.maxShortEdge;
  let needsResize = false;

  if (sourceWidth && sourceHeight) {
    const longSide = Math.max(sourceWidth, sourceHeight);
    const shortSide = Math.min(sourceWidth, sourceHeight);
    const scale = Math.min(
      options.maxLongEdge / longSide,
      options.maxShortEdge / shortSide,
      1,
    );
    needsResize = scale < 1;
    if (needsResize) {
      width = Math.round(sourceWidth * scale);
      height = Math.round(sourceHeight * scale);
      // H.264 requires even dimensions
      width += width % 2;
      height += height % 2;
    }
  }

  const videoNeedsReencode = needsResize || source.videoCodec !== "avc";

  return {
    needsResize,
    width,
    height,
    videoNeedsReencode,
    videoBitrate: videoNeedsReencode
      ? reencodeBitrate(
          {
            pixels: (sourceWidth ?? 0) * (sourceHeight ?? 0),
            bitrate: source.videoBitrate,
            codec: source.videoCodec,
          },
          width * height,
        )
      : undefined,
  };
}

/**
 * Process a video file: remux to MP4, re-encoding to H.264/AAC only when the
 * source needs it, resize to fit within 1920×1080, and extract poster frame
 * + blurhash.
 *
 * @param file - Source video file
 * @param onProgress - Optional callback receiving progress from 0 to 1
 * @returns Processed MP4 file with dimensions, poster, and blurhash
 */
async function processToFile(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<VideoProcessResult> {
  // Probe the source and grab poster + blurhash (separate Input instance,
  // so the conversion Input below starts with clean demuxer state).
  const {
    poster,
    blurhash,
    sourceWidth,
    sourceHeight,
    rotation,
    durationSeconds,
    videoCodec,
    videoBitrate,
  } = await probeSource(file);

  const {
    needsResize,
    width: targetW,
    height: targetH,
    videoBitrate: targetBitrate,
  } = planVideoProcessing(
    {
      width: sourceWidth,
      height: sourceHeight,
      videoCodec,
      videoBitrate,
    },
    { maxLongEdge: MAX_LONG_EDGE, maxShortEdge: MAX_SHORT_EDGE },
  );

  // Convert to MP4 (fresh Input — not shared with probeSource)
  const input = new Input({
    source: new BlobSource(file),
    formats: ALL_FORMATS,
  });
  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target,
  });

  try {
    const conversion = await Conversion.init({
      input,
      output,
      video: {
        codec: "avc",
        ...(needsResize
          ? { width: targetW, height: targetH, fit: "contain" as const }
          : {}),
        ...(targetBitrate !== undefined
          ? { quality: new Quality({ bitrate: targetBitrate }) }
          : {}),
      },
      // No quality set: an AAC track is copied, and anything else falls back
      // to mediabunny's default, which for AAC lands on 192 kbps either way.
      audio: { codec: "aac" },
    });

    if (onProgress) {
      conversion.onProgress = onProgress;
    }

    await conversion.execute();

    const buffer = target.buffer;
    if (!buffer) throw new Error("Video processing produced no output");

    // Mediabunny tags each track with a non-zero alternate_group, which makes
    // Safari treat tracks as mutually exclusive alternates and never auto-hide
    // the native <video> control bar during playback. Zero it so the controls
    // behave like any other MP4.
    zeroTrackAlternateGroups(buffer);

    // Detect whether this browser double-rotates.  Chrome's WebCodecs
    // bakes rotation into the pixel data AND mediabunny writes a display
    // matrix → the browser applies the matrix again (double-rotation).
    // Safari's WebCodecs does NOT bake rotation, so the matrix is needed.
    // Strategy: probe the output as-is; if the dimensions already match
    // the expected display size, leave the file alone.  Otherwise strip
    // the matrix and re-probe.  A copied (not re-encoded) track never hits
    // this — no encoder touched the pixels — so it falls out via dimsMatch.
    const originalName = file.name.replace(/\.[^.]+$/, "");
    let mp4File = new File([buffer], `${originalName}.mp4`, {
      type: "video/mp4",
    });
    let actual = await probeVideoDimensions(mp4File);

    const dimsMatch =
      Math.abs(actual.width - targetW) <= 2 &&
      Math.abs(actual.height - targetH) <= 2;

    if (rotation && !dimsMatch) {
      resetMp4DisplayMatrix(buffer);
      mp4File = new File([buffer], `${originalName}.mp4`, {
        type: "video/mp4",
      });
      actual = await probeVideoDimensions(mp4File);
    }

    return {
      file: mp4File,
      width: actual.width,
      height: actual.height,
      durationSeconds,
      poster,
      blurhash,
    };
  } finally {
    input.dispose();
  }
}

// --- MP4 display matrix reset ---

/** Identity transformation matrix for tkhd (no rotation/scaling). */
const IDENTITY_MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];

/**
 * Walk the box tree of an MP4 file and invoke a callback for each box.
 * Recurses into standard ISO BMFF container boxes.
 */
function walkMp4Boxes(
  view: DataView,
  start: number,
  end: number,
  cb: (offset: number, size: number, type: string) => void,
): void {
  let pos = start;
  while (pos + 8 <= end) {
    let size = view.getUint32(pos);
    const type = String.fromCharCode(
      view.getUint8(pos + 4),
      view.getUint8(pos + 5),
      view.getUint8(pos + 6),
      view.getUint8(pos + 7),
    );

    if (size === 0) size = end - pos;
    if (size < 8 || pos + size > end) break;

    cb(pos, size, type);

    if (
      type === "moov" ||
      type === "trak" ||
      type === "mdia" ||
      type === "edts"
    )
      walkMp4Boxes(view, pos + 8, pos + size, cb);

    pos += size;
  }
}

/**
 * Reset the display matrix in all tkhd boxes to identity.
 * This removes rotation metadata while preserving the encoded pixel data
 * and the tkhd width/height (which match the encoded dimensions).
 * Operates in-place on the buffer.
 */
function resetMp4DisplayMatrix(buffer: ArrayBuffer): void {
  const view = new DataView(buffer);

  walkMp4Boxes(view, 0, buffer.byteLength, (boxOffset, _size, type) => {
    if (type !== "tkhd") return;

    const dataStart = boxOffset + 8; // past size + type
    const version = view.getUint8(dataStart);
    // Matrix offset from data start: version 0 → 40, version 1 → 52
    const matrixOff = dataStart + (version === 0 ? 40 : 52);

    if (matrixOff + 36 > buffer.byteLength) return;

    // Check if already identity — skip if so
    let isIdentity = true;
    for (let i = 0; i < 9; i++) {
      if (view.getInt32(matrixOff + i * 4) !== IDENTITY_MATRIX[i]) {
        isIdentity = false;
        break;
      }
    }
    if (isIdentity) return;

    // Reset to identity (no rotation)
    for (let i = 0; i < 9; i++) {
      view.setInt32(matrixOff + i * 4, IDENTITY_MATRIX[i]);
    }
  });
}

/**
 * Load a video file in a temporary `<video>` element and return the
 * browser-reported dimensions (which include any rotation metadata).
 */
function probeVideoDimensions(
  file: File,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve({ width: video.videoWidth, height: video.videoHeight });
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to probe transcoded video dimensions"));
    };
    video.src = url;
  });
}

export const VideoProcessor = { isSupported, processToFile };
