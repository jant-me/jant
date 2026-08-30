/**
 * Client-side Audio Processor
 *
 * Remuxes audio files into an M4A container (MP4 audio-only) using
 * mediabunny, transcoding to AAC only when the source is not already AAC.
 * A source that needs nothing has its encoded packets copied across, so it
 * arrives without a generation of re-encoding loss. Mirrors the
 * video-processor pattern but discards any video track and skips
 * poster/blurhash extraction.
 *
 * Requires WebCodecs API support — check `isSupported()` before use.
 */

import {
  Input,
  Output,
  Mp4OutputFormat,
  BufferTarget,
  BlobSource,
  Conversion,
  ALL_FORMATS,
} from "mediabunny";

export interface AudioProcessResult {
  file: File;
}

/**
 * Check if the browser supports WebCodecs-based audio processing.
 *
 * @returns `true` if `AudioEncoder` is available in the current environment
 */
function isSupported(): boolean {
  return typeof AudioEncoder !== "undefined";
}

/**
 * Process an audio file: remux into an M4A (MP4) container, transcoding to
 * AAC only when the source is not already AAC.
 *
 * @param file - Source audio file
 * @param onProgress - Optional callback receiving progress from 0 to 1
 * @returns Processed M4A file
 */
async function processToFile(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<AudioProcessResult> {
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
    // Setting a quality on the track is what disables mediabunny's copy fast
    // path, and a needless decode/encode round trip costs a generation of
    // quality. Leaving it unset lets an AAC source be copied outright;
    // anything else falls back to mediabunny's default, which for AAC lands
    // on 192 kbps — the highest rate it will pick at any quality level.
    const conversion = await Conversion.init({
      input,
      output,
      video: { discard: true },
      audio: { codec: "aac" },
    });

    if (onProgress) {
      conversion.onProgress = onProgress;
    }

    await conversion.execute();

    const buffer = target.buffer;
    if (!buffer) throw new Error("Audio processing produced no output");

    const originalName = file.name.replace(/\.[^.]+$/, "");
    const m4aFile = new File([buffer], `${originalName}.m4a`, {
      type: "audio/mp4",
    });

    return { file: m4aFile };
  } finally {
    input.dispose();
  }
}

export const AudioProcessor = { isSupported, processToFile };
