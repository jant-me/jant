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
  type AudioCodec,
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
 * Quality used when a re-encode is unavoidable (non-H.264 source, or a
 * source above the size caps). Maps to AVC quantizer 16 — visually close
 * to the source, at the cost of a larger file. Sources that need no
 * re-encode never reach an encoder at all, so this only ever applies to
 * material that was going to lose a generation regardless.
 */
const REENCODE_QUALITY = new Quality("very-high");

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
  /** Source audio codec; `undefined` when the file carries no audio track. */
  audioCodec?: AudioCodec | null;
}

/**
 * Probe a video file and extract its poster frame and blurhash in one pass.
 * Seeks to `min(duration × 0.1, 1s)` and captures the frame.
 *
 * Returns the source dimensions and track codecs alongside, so the caller can
 * decide whether a re-encode is needed at all — and compute the output size —
 * without opening a second Input instance.
 *
 * @param file - Source video file
 * @returns Poster blob (640px-wide WebP), blurhash, dimensions, and codecs
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
    const audioTrack = await input.getPrimaryAudioTrack();
    const audioCodec = audioTrack ? await audioTrack.getCodec() : undefined;

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
      audioCodec,
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
  /** True when the audio track must be decoded and re-encoded. */
  audioNeedsReencode: boolean;
}

/**
 * Decide what a source video needs: a resize, a video re-encode, an audio
 * re-encode, or nothing at all.
 *
 * Asking for a size or a quality is what disables mediabunny's copy fast
 * path, so anything already within the caps and already in the target codecs
 * must come back with every flag false — its encoded packets are then copied
 * across untouched, sparing it a generation of quality. An unknown codec
 * (`null`) counts as needing a re-encode, since we can't vouch for it playing
 * everywhere. A missing audio track (`undefined`) needs nothing.
 *
 * Dimensions are the source's *display* dimensions, i.e. post-rotation, so
 * the caps apply orientation-agnostically.
 *
 * @param source - Display dimensions and track codecs of the source
 * @param options - `maxLongEdge` and `maxShortEdge` caps
 * @returns The processing plan
 *
 * @example
 * ```ts
 * // Already H.264/AAC and within the caps — copied, not re-encoded
 * planVideoProcessing(
 *   { width: 1280, height: 720, videoCodec: "avc", audioCodec: "aac" },
 *   { maxLongEdge: 1920, maxShortEdge: 1080 },
 * );
 * // { needsResize: false, width: 1280, height: 720,
 * //   videoNeedsReencode: false, audioNeedsReencode: false }
 * ```
 */
export function planVideoProcessing(
  source: {
    width?: number;
    height?: number;
    videoCodec?: VideoCodec | null;
    audioCodec?: AudioCodec | null;
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

  return {
    needsResize,
    width,
    height,
    videoNeedsReencode: needsResize || source.videoCodec !== "avc",
    audioNeedsReencode:
      source.audioCodec !== undefined && source.audioCodec !== "aac",
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
    audioCodec,
  } = await probeSource(file);

  const {
    needsResize,
    width: targetW,
    height: targetH,
    videoNeedsReencode,
    audioNeedsReencode,
  } = planVideoProcessing(
    {
      width: sourceWidth,
      height: sourceHeight,
      videoCodec,
      audioCodec,
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
        ...(videoNeedsReencode ? { quality: REENCODE_QUALITY } : {}),
      },
      audio: {
        codec: "aac",
        ...(audioNeedsReencode ? { quality: REENCODE_QUALITY } : {}),
      },
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
