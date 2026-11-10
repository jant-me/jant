/**
 * Shared video playback heuristics for feed autoplay and lightbox controls.
 */

export const SHORT_VIDEO_MAX_DURATION_SECONDS = 15;
export const SHORT_VIDEO_MAX_AUTOPLAY_SIZE_BYTES = 12 * 1024 * 1024;

/**
 * Normalize a media duration into a whole-second value suitable for storage
 * and heuristic checks.
 *
 * @param value - Duration in seconds, usually from video metadata
 * @returns Ceiled whole-second duration, or `undefined` when invalid
 *
 * @example
 * ```ts
 * normalizeDurationSeconds(14.2); // 15
 * ```
 */
export function normalizeDurationSeconds(
  value: number | null | undefined,
): number | undefined {
  if (!Number.isFinite(value) || !value || value <= 0) {
    return undefined;
  }

  return Math.ceil(value);
}

/**
 * Decide whether a video should use the short-video autoplay/custom-player
 * treatment.
 *
 * @param media - Minimal media fields needed for the heuristic
 * @returns `true` when the media should use the short-video experience
 *
 * @example
 * ```ts
 * shouldUseShortVideoExperience({
 *   mimeType: "video/mp4",
 *   durationSeconds: 12,
 *   size: 3_000_000,
 * });
 * ```
 */
export function shouldUseShortVideoExperience(media: {
  mimeType?: string | null;
  durationSeconds?: number | null;
  size?: number | null;
}): boolean {
  if (!media.mimeType?.startsWith("video/")) {
    return false;
  }

  if (
    !Number.isFinite(media.durationSeconds) ||
    !media.durationSeconds ||
    media.durationSeconds <= 0
  ) {
    return false;
  }

  if (media.durationSeconds > SHORT_VIDEO_MAX_DURATION_SECONDS) {
    return false;
  }

  const size = media.size;
  if (typeof size === "number" && size > SHORT_VIDEO_MAX_AUTOPLAY_SIZE_BYTES) {
    return false;
  }

  return true;
}

/**
 * Where in a clip its poster frame is taken: a tenth of the way in, so the
 * still is not the fade-from-black most clips open on, and never later than
 * the first second. With no duration to take a tenth of, the opening frame is
 * the only one to name.
 *
 * @param durationSeconds - Clip length in seconds, when known
 * @returns Offset into the clip, in seconds
 *
 * @example
 * ```ts
 * getPosterFrameSeconds(4); // 0.4
 * getPosterFrameSeconds(90); // 1
 * getPosterFrameSeconds(undefined); // 0
 * ```
 */
export function getPosterFrameSeconds(
  durationSeconds: number | null | undefined,
): number {
  if (
    !Number.isFinite(durationSeconds) ||
    !durationSeconds ||
    durationSeconds <= 0
  ) {
    return 0;
  }

  return Math.min(durationSeconds * 0.1, 1);
}

/**
 * The address a `<video>` loads to show the poster frame itself, for a clip
 * stored without a poster. The media fragment is what makes iOS Safari draw a
 * frame under `preload="metadata"` at all, and a start of 0 is no fragment, so
 * a clip of unknown length starts a tenth of a second in.
 *
 * @param url - The video file's address
 * @param durationSeconds - Clip length in seconds, when known
 * @returns The address with a `#t=` fragment at the poster frame
 *
 * @example
 * ```ts
 * getPosterFrameUrl("https://media.example/clip.mp4", 4);
 * // "https://media.example/clip.mp4#t=0.4"
 * ```
 */
export function getPosterFrameUrl(
  url: string,
  durationSeconds: number | null | undefined,
): string {
  const seconds =
    Math.round(getPosterFrameSeconds(durationSeconds) * 100) / 100;
  return `${url}#t=${seconds > 0 ? seconds : 0.1}`;
}
