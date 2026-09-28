/**
 * Public storage path helpers.
 *
 * Public media URLs may point at the current `media/{siteId}/...` layout or
 * older legacy keys kept readable for backwards compatibility.
 */

const CURRENT_MEDIA_SEGMENTS = [
  "files",
  "posters",
  "assets",
  "previews",
] as const;
const LEGACY_SITE_STORAGE_SEGMENTS = ["media", "site-assets"] as const;

/**
 * Returns whether a storage key is safe to expose for the current site.
 *
 * Current site-scoped media keys must stay within the current site's
 * `media/{siteId}/files|posters|assets` namespace. Legacy keys remain readable
 * for backwards compatibility.
 *
 * @param storageKey - Requested storage key without a leading slash
 * @param siteId - Current site ID
 * @returns Whether the key can be served to the current request
 *
 * @example
 * ```ts
 * isPublicStorageKeyAllowed(
 *   "media/sit_123/files/file.webp",
 *   "sit_123",
 * ); // true
 * ```
 */
export function isPublicStorageKeyAllowed(
  storageKey: string,
  siteId: string,
): boolean {
  if (!storageKey || storageKey.startsWith("/") || storageKey.includes("..")) {
    return false;
  }

  const segments = storageKey.split("/");
  if (segments[0] === "media") {
    const keySiteId = segments[1];
    const keyNamespace = segments[2];

    if (keySiteId === siteId) {
      return CURRENT_MEDIA_SEGMENTS.includes(
        keyNamespace as (typeof CURRENT_MEDIA_SEGMENTS)[number],
      );
    }

    // Legacy unscoped media keys remain readable. New site-scoped keys for
    // other sites must not be exposed publicly.
    return !keySiteId?.startsWith("sit_");
  }

  return LEGACY_SITE_STORAGE_SEGMENTS.some((segment) =>
    storageKey.startsWith(`sites/${siteId}/${segment}/`),
  );
}

/**
 * Whether a request path is one the public storage proxy answers.
 *
 * @param path - Request path, without the site path prefix
 * @returns `true` for `/media/*` and the older `/sites/*` layout
 *
 * @example
 * ```ts
 * isPublicStoragePath("/media/sit_1/files/med_1.webp"); // true
 * isPublicStoragePath("/about"); // false
 * ```
 */
export function isPublicStoragePath(path: string): boolean {
  return path.startsWith("/media/") || path.startsWith("/sites/");
}

/**
 * The Content-Security-Policy a stored file is served with when opened.
 *
 * Every stored file runs sandboxed with nothing allowed but inline styles,
 * which image and video viewers use for their own layout. PDFs are the
 * exception: a sandboxed PDF won't open in Chrome's viewer, and that viewer
 * runs isolated from the page already.
 *
 * @param contentType - The stored file's MIME type
 * @returns The policy, or `null` when the file is served without one
 *
 * @example
 * ```ts
 * getStoredFileContentSecurityPolicy("text/html");
 * // "default-src 'none'; style-src 'unsafe-inline'; sandbox"
 * getStoredFileContentSecurityPolicy("application/pdf"); // null
 * ```
 */
export function getStoredFileContentSecurityPolicy(
  contentType: string,
): string | null {
  if (contentType.split(";")[0]?.trim().toLowerCase() === "application/pdf") {
    return null;
  }
  return "default-src 'none'; style-src 'unsafe-inline'; sandbox";
}
