/**
 * Image URL utilities
 *
 * Provides helpers for generating image URLs with optional transformations.
 */

/**
 * Options for image transformations
 */
export interface ImageOptions {
  /** Target width in pixels */
  width?: number;
  /** Target height in pixels */
  height?: number;
  /** Quality (1-100) */
  quality?: number;
  /** Output format */
  format?: "webp" | "avif" | "auto";
  /** Fit mode for resizing */
  fit?: "cover" | "contain" | "scale-down";
}

/**
 * Generates an image URL with optional transformations.
 *
 * If `transformUrl` is provided and options are specified, returns a transformed image URL.
 * Otherwise, returns the original URL unchanged.
 *
 * Compatible with:
 * - Cloudflare Image Transformations (`/cdn-cgi/image/...`)
 * - imgproxy
 * - Cloudinary
 * - Any service with similar URL-based transformation API
 *
 * @param originalUrl - The original image URL
 * @param transformUrl - The base URL for transformations (e.g., `https://example.com/cdn-cgi/image`)
 * @param options - Transformation options (width, height, quality, format, fit)
 * @returns The transformed URL or original URL if transformations are not configured
 *
 * @example
 * ```ts
 * // Without transform URL - returns original
 * getImageUrl("/media/abc123", undefined, { width: 200 });
 * // Returns: "/media/abc123"
 *
 * // With transform URL - returns transformed
 * getImageUrl("/media/abc123", "https://example.com/cdn-cgi/image", { width: 200, quality: 80 });
 * // Returns: "https://example.com/cdn-cgi/image/width=200,quality=80/https://example.com/media/abc123"
 * ```
 */
export function getImageUrl(
  originalUrl: string,
  transformUrl?: string,
  options?: ImageOptions
): string {
  if (!transformUrl || !options || Object.keys(options).length === 0) {
    return originalUrl;
  }

  const params: string[] = [];
  if (options.width) params.push(`width=${options.width}`);
  if (options.height) params.push(`height=${options.height}`);
  if (options.quality) params.push(`quality=${options.quality}`);
  if (options.format) params.push(`format=${options.format}`);
  if (options.fit) params.push(`fit=${options.fit}`);

  if (params.length === 0) {
    return originalUrl;
  }

  return `${transformUrl}/${params.join(",")}/${originalUrl}`;
}

/**
 * Generates a media URL using UUIDv7-based paths.
 *
 * Returns a public URL for a media file. If `r2PublicUrl` is set, uses that directly
 * with the r2Key. Otherwise, generates a `/media/{id}.{ext}` URL.
 *
 * @param mediaId - The UUIDv7 database ID of the media
 * @param r2Key - The R2 storage key (used to extract extension)
 * @param r2PublicUrl - Optional R2 public URL for direct CDN access
 * @returns The public URL for the media file
 *
 * @example
 * ```ts
 * // Without R2 public URL - uses UUID with extension
 * getMediaUrl("01902a9f-1a2b-7c3d-8e4f-5a6b7c8d9e0f", "uploads/file.webp");
 * // Returns: "/media/01902a9f-1a2b-7c3d-8e4f-5a6b7c8d9e0f.webp"
 *
 * // With R2 public URL - uses direct CDN
 * getMediaUrl("01902a9f-1a2b-7c3d-8e4f-5a6b7c8d9e0f", "uploads/file.webp", "https://cdn.example.com");
 * // Returns: "https://cdn.example.com/uploads/file.webp"
 * ```
 */
export function getMediaUrl(mediaId: string, r2Key: string, r2PublicUrl?: string): string {
  if (r2PublicUrl) {
    return `${r2PublicUrl}/${r2Key}`;
  }
  // Extract extension from r2Key
  const ext = r2Key.split(".").pop() || "bin";
  return `/media/${mediaId}.${ext}`;
}
