import { toPublicPath } from "./url.js";

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
 * A root-relative source is written without its leading slash, the form the
 * transformation service resolves against its own host. Kept, it would produce
 * `…/width=200//media/abc123`, which Cloudflare cannot fetch (`err=9404`).
 *
 * @param originalUrl - The original image URL, absolute or root-relative
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
 * // With transform URL and a root-relative source
 * getImageUrl("/media/abc123", "https://example.com/cdn-cgi/image", { width: 200, quality: 80 });
 * // Returns: "https://example.com/cdn-cgi/image/width=200,quality=80/media/abc123"
 *
 * // With transform URL and an absolute source
 * getImageUrl("https://cdn.example.com/media/abc123", "https://example.com/cdn-cgi/image", { width: 200 });
 * // Returns: "https://example.com/cdn-cgi/image/width=200/https://cdn.example.com/media/abc123"
 * ```
 */
export function getImageUrl(
  originalUrl: string,
  transformUrl?: string,
  options?: ImageOptions,
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

  const base = transformUrl.replace(/\/+$/, "");
  const source =
    originalUrl.startsWith("/") && !originalUrl.startsWith("//")
      ? originalUrl.slice(1)
      : originalUrl;
  return `${base}/${params.join(",")}/${source}`;
}

/**
 * Returns the appropriate public URL base for a given storage provider.
 *
 * For `"s3"` provider, returns `s3PublicUrl`. For all other providers
 * (including `"r2"`), returns `r2PublicUrl`. Falls back to `undefined`
 * if the matching URL is not configured.
 *
 * @param provider - The storage provider identifier (e.g., `"r2"`, `"s3"`)
 * @param r2PublicUrl - Optional R2 public URL
 * @param s3PublicUrl - Optional S3 public URL
 * @returns The public URL base for the provider, or undefined
 *
 * @example
 * ```ts
 * getPublicUrlForProvider("r2", "https://r2.example.com", "https://s3.example.com");
 * // Returns: "https://r2.example.com"
 *
 * getPublicUrlForProvider("s3", "https://r2.example.com", "https://s3.example.com");
 * // Returns: "https://s3.example.com"
 * ```
 */
export function getPublicUrlForProvider(
  provider: string,
  r2PublicUrl?: string,
  s3PublicUrl?: string,
  localPublicUrl?: string,
): string | undefined {
  if (provider === "s3") return s3PublicUrl;
  if (provider === "local") return localPublicUrl;
  return r2PublicUrl;
}

/**
 * Generates a media URL from a storage key.
 *
 * Both proxy and CDN paths use the same structure — only the domain differs.
 * Without a public URL, returns a root-relative path for the local proxy.
 * With a public URL, prefixes that domain.
 *
 * @param storageKey - The storage object key (e.g. `"media/med_01jpx7gb2w4rcg9w82g5r8kkx3.webp"`)
 * @param publicUrl - Optional public URL base for direct CDN access
 * @returns The public URL for the media file
 *
 * @example
 * ```ts
 * // Without public URL - local proxy
 * getMediaUrl("media/med_01jpx7gb2w4rcg9w82g5r8kkx3.webp");
 * // Returns: "/media/med_01jpx7gb2w4rcg9w82g5r8kkx3.webp"
 *
 * // With public URL - CDN
 * getMediaUrl("media/med_01jpx7gb2w4rcg9w82g5r8kkx3.webp", "https://cdn.example.com");
 * // Returns: "https://cdn.example.com/media/med_01jpx7gb2w4rcg9w82g5r8kkx3.webp"
 * ```
 */
export function getMediaUrl(
  storageKey: string,
  publicUrl?: string,
  sitePathPrefix = "",
): string {
  const base = publicUrl ? publicUrl.replace(/\/+$/, "") : "";
  if (base) {
    return `${base}/${storageKey}`;
  }
  return toPublicPath(`/${storageKey}`, sitePathPrefix);
}
