/**
 * Media Helper Utilities
 *
 * Shared logic for building MediaAttachment maps from raw media data.
 */

import type { Media, MediaAttachment } from "../types.js";
import { getMediaUrl, getImageUrl, getPublicUrlForProvider } from "./image.js";

/**
 * Builds a map of post IDs to MediaAttachment arrays from raw media data.
 *
 * Transforms raw Media objects (with storage keys) into MediaAttachment objects
 * (with public URLs and preview URLs) suitable for rendering.
 * Automatically resolves the correct public URL based on each media item's
 * storage provider (`"r2"` or `"s3"`).
 *
 * @param rawMediaMap - Map of post IDs to raw Media arrays from the media service
 * @param r2PublicUrl - Optional R2 public URL for direct CDN access
 * @param imageTransformUrl - Optional image transformation service URL
 * @param s3PublicUrl - Optional S3 public URL for direct CDN access
 * @param localPublicUrl - Optional local media public URL
 * @returns Map of post IDs to MediaAttachment arrays
 *
 * @example
 * ```ts
 * const rawMediaMap = await services.media.getByPostIds(postIds);
 * const mediaMap = buildMediaMap(rawMediaMap, c.env.R2_PUBLIC_URL, c.env.IMAGE_TRANSFORM_URL, c.env.S3_PUBLIC_URL);
 * ```
 */
export function buildMediaMap(
  rawMediaMap: Map<string, Media[]>,
  r2PublicUrl?: string,
  imageTransformUrl?: string,
  s3PublicUrl?: string,
  localPublicUrl?: string,
  sitePathPrefix?: string,
): Map<string, MediaAttachment[]> {
  const mediaMap = new Map<string, MediaAttachment[]>();
  for (const [postId, mediaList] of rawMediaMap) {
    mediaMap.set(
      postId,
      mediaList.map((m) => {
        const publicUrl = getPublicUrlForProvider(
          m.provider,
          r2PublicUrl,
          s3PublicUrl,
          localPublicUrl,
        );
        const mediaUrl = getMediaUrl(m.storageKey, publicUrl, sitePathPrefix);
        // Only apply image transforms for image MIME types
        const previewUrl = m.mimeType.startsWith("image/")
          ? getImageUrl(mediaUrl, imageTransformUrl, {
              width: 1200,
              height: 768,
              quality: 80,
              format: "auto",
              fit: "scale-down",
            })
          : mediaUrl;
        // A poster is a still frame at whatever resolution the source video
        // had, so it needs the same transform as any other image — without it
        // a 4K clip puts a multi-megabyte PNG in the feed. Matches the limits
        // `toMediaView` uses for the same field.
        const posterRawUrl = m.posterKey
          ? getMediaUrl(m.posterKey, publicUrl, sitePathPrefix)
          : null;
        const posterUrl = posterRawUrl
          ? getImageUrl(posterRawUrl, imageTransformUrl, {
              width: 640,
              quality: 80,
              format: "auto",
              fit: "scale-down",
            })
          : null;
        return {
          id: m.id,
          url: mediaUrl,
          previewUrl,
          alt: m.alt,
          blurhash: m.blurhash,
          waveform: m.waveform,
          posterUrl,
          width: m.width,
          height: m.height,
          durationSeconds: m.durationSeconds,
          position: m.position,
          mimeType: m.mimeType,
          originalName: m.originalName,
          size: m.size,
          summary: m.summary,
          chars: m.chars,
        };
      }),
    );
  }
  return mediaMap;
}
