/**
 * Upload Utilities
 *
 * Shared file validation and storage key generation for upload routes.
 */

import type { ContentDisposition, MediaKind } from "../types/constants.js";
import { createEntityId } from "./ids.js";

const MEDIA_ROOT_PREFIX = "media";
const MEDIA_FILES_STORAGE_PREFIX = "files";
const MEDIA_POSTERS_STORAGE_PREFIX = "posters";
const MEDIA_ASSET_STORAGE_PREFIX = "assets";
const MEDIA_PREVIEWS_STORAGE_PREFIX = "previews";

/**
 * SQL `LIKE` pattern matching site asset objects (avatars, favicons) stored
 * under `media/<siteId>/assets/<kind>/...`.
 *
 * These assets are referenced from site settings (`SITE_AVATAR`,
 * `SITE_FAVICON_*`), not from posts, so they are intentionally persisted with
 * `postId = null`. The orphan-media reaper must exclude them — otherwise it
 * deletes avatars and favicons as if they were abandoned compose uploads.
 *
 * @example
 * media.storageKey LIKE this pattern → it is a site asset, never an orphan.
 */
export const SITE_ASSET_STORAGE_KEY_LIKE_PATTERN = `%/${MEDIA_ASSET_STORAGE_PREFIX}/%`;

/** MIME types — images */
const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/avif",
  "image/bmp",
  "image/x-icon",
] as const;

/** MIME types — video */
const VIDEO_MIME_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-msvideo",
  "video/x-matroska",
  "video/mpeg",
  "video/3gpp",
  "video/x-flv",
  "video/ogg",
] as const;

/** MIME types — audio */
const AUDIO_MIME_TYPES = [
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/mp4",
  "audio/x-m4a",
  "audio/flac",
  "audio/aac",
  "audio/webm",
  "audio/x-aiff",
  "audio/opus",
  "audio/3gpp",
  "audio/midi",
] as const;

/** MIME types — documents (books, PDFs) */
const DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "application/epub+zip",
  "application/x-mobipocket-ebook",
  "application/vnd.amazon.ebook",
] as const;

/** MIME types — office documents */
const OFFICE_MIME_TYPES = [
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
  "application/vnd.apple.pages",
  "application/vnd.apple.numbers",
  "application/vnd.apple.keynote",
] as const;

/** MIME types — text & structured data */
const TEXT_MIME_TYPES = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "text/css",
  "text/javascript",
  "text/xml",
  "text/rtf",
  "text/tab-separated-values",
  "text/calendar",
  "application/json",
  "application/xml",
  "application/yaml",
  "application/toml",
] as const;

/** MIME types — archives */
const ARCHIVE_MIME_TYPES = [
  "application/zip",
  "application/x-tar",
  "application/gzip",
  "application/x-bzip2",
  "application/x-7z-compressed",
  "application/x-rar-compressed",
  "application/zstd",
] as const;

/** MIME types — fonts */
const FONT_MIME_TYPES = [
  "font/ttf",
  "font/otf",
  "font/woff",
  "font/woff2",
] as const;

/** MIME types — 3D & design */
const THREE_D_MIME_TYPES = [
  "model/gltf+json",
  "model/gltf-binary",
  "model/obj",
  "application/x-figma",
  "image/vnd.dxf",
] as const;

/** MIME types — data & code */
const CODE_MIME_TYPES = [
  "application/sql",
  "application/wasm",
  "application/x-ipynb+json",
  "application/x-sh",
  "application/x-python-code",
] as const;

/** Lookup table from MIME type to category */
const MIME_CATEGORY_MAP = new Map<string, MediaCategory>([
  ...IMAGE_MIME_TYPES.map((t) => [t, "image" as const] as const),
  ...VIDEO_MIME_TYPES.map((t) => [t, "video" as const] as const),
  ...AUDIO_MIME_TYPES.map((t) => [t, "audio" as const] as const),
  ...DOCUMENT_MIME_TYPES.map((t) => [t, "document" as const] as const),
  ...OFFICE_MIME_TYPES.map((t) => [t, "office" as const] as const),
  ...TEXT_MIME_TYPES.map((t) => [t, "text" as const] as const),
  ...ARCHIVE_MIME_TYPES.map((t) => [t, "archive" as const] as const),
  ...FONT_MIME_TYPES.map((t) => [t, "font" as const] as const),
  ...THREE_D_MIME_TYPES.map((t) => [t, "3d" as const] as const),
  ...CODE_MIME_TYPES.map((t) => [t, "code" as const] as const),
]);

/**
 * Accept string for file inputs. Accepts all file types.
 *
 * @example
 * ```ts
 * <input type="file" accept={UPLOAD_ACCEPT} />
 * ```
 */
export const UPLOAD_ACCEPT = "*/*";

export type MediaCategory =
  | "image"
  | "video"
  | "audio"
  | "document"
  | "office"
  | "text"
  | "archive"
  | "font"
  | "3d"
  | "code";

export type UploadContentDisposition = ContentDisposition;

export interface StoredUploadPolicy {
  contentDisposition: UploadContentDisposition;
  mediaKind: MediaKind;
  requiresSignatureCheck: boolean;
}

const ATTACHMENT_ONLY_MIME_TYPES = new Set([
  "text/html",
  "text/javascript",
  "application/javascript",
]);

const INLINE_SIGNATURE_MIME_TYPES = new Set([
  "image/webp",
  "image/png",
  "image/jpeg",
  "video/mp4",
  "audio/mp4",
  "application/pdf",
]);

/**
 * Returns the media category for a given MIME type.
 * Unrecognized types default to "archive".
 *
 * @param mimeType - The MIME type to classify
 * @returns The media category
 * @example
 * ```ts
 * getMediaCategory("video/mp4"); // "video"
 * getMediaCategory("text/plain"); // "text"
 * getMediaCategory("application/octet-stream"); // "archive"
 * ```
 */
export function getMediaCategory(mimeType: string): MediaCategory {
  // Exact match from known types
  const exact = MIME_CATEGORY_MAP.get(mimeType);
  if (exact) return exact;

  // Prefix-based fallback for unknown subtypes
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("font/")) return "font";
  if (mimeType.startsWith("model/")) return "3d";
  if (mimeType.startsWith("text/")) return "text";

  // Unknown types default to archive
  return "archive";
}

/**
 * Maps a MIME type to one of the five media kind categories.
 * image/video/audio/text pass through; everything else becomes "document".
 *
 * @param mimeType - The MIME type to classify
 * @returns The media kind
 * @example
 * ```ts
 * toMediaKind("image/jpeg"); // "image"
 * toMediaKind("application/pdf"); // "document"
 * toMediaKind("text/plain"); // "text"
 * ```
 */
export function toMediaKind(mimeType: string): MediaKind {
  const category = getMediaCategory(mimeType);
  switch (category) {
    case "image":
    case "video":
    case "audio":
    case "text":
      return category;
    default:
      return "document";
  }
}

/**
 * Returns true if the given MIME type is an image type.
 *
 * @param mimeType - The MIME type to check
 * @returns Whether the MIME type is an image
 * @example
 * ```ts
 * isImageMimeType("image/jpeg"); // true
 * isImageMimeType("video/mp4"); // false
 * ```
 */
export function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

/** Image MIME types accepted by the remote-image sideload path. */
const SIDELOAD_IMAGE_MIME_TYPES = new Set<string>(IMAGE_MIME_TYPES);

/** Map of sideload-accepted image MIME types to their file extensions. */
const IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/x-icon": "ico",
};

/**
 * Whether a MIME type may be rehosted via remote-image sideload.
 *
 * Unlike {@link getStoredUploadPolicy} (which only allows webp/png/jpeg because
 * the normal upload path re-encodes everything to WebP client-side), the
 * sideload path stores the original remote bytes, so it accepts the full set of
 * image formats Jant can display.
 *
 * @param contentType - The MIME type to check
 * @returns Whether the type is an accepted sideload image
 * @example
 * ```ts
 * isAllowedSideloadImageType("image/gif"); // true
 * isAllowedSideloadImageType("text/html"); // false
 * ```
 */
export function isAllowedSideloadImageType(contentType: string): boolean {
  return SIDELOAD_IMAGE_MIME_TYPES.has(contentType);
}

/**
 * Returns the file extension for a sideload-accepted image MIME type.
 *
 * @param contentType - The image MIME type
 * @returns Extension without a dot, or null if the type isn't sideloadable
 * @example
 * ```ts
 * imageExtensionForMimeType("image/jpeg"); // "jpg"
 * ```
 */
export function imageExtensionForMimeType(contentType: string): string | null {
  return IMAGE_MIME_EXTENSIONS[contentType] ?? null;
}

/** ISO BMFF `ftyp` major brands that mean a HEIC/HEIF still image. */
const HEIC_FTYP_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "mif1",
  "msf1",
]);

/**
 * Identify an image format from its leading bytes (magic numbers), so a remote
 * sideload can trust the actual content rather than the server's content-type
 * header. Recognizes every {@link isAllowedSideloadImageType} format, plus
 * HEIC/HEIF — which no browser decodes natively and no sideload accepts, but
 * which the composer converts before upload once it knows what it holds.
 *
 * @param bytes - The leading bytes of the file (≥ ~256 bytes recommended)
 * @returns The detected image MIME type, or null if unrecognized
 * @example
 * ```ts
 * sniffImageMimeType(pngBytes); // "image/png"
 * ```
 */
export function sniffImageMimeType(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    readAscii(bytes, 1, 3) === "PNG"
  ) {
    return "image/png";
  }
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(readAscii(bytes, 0, 6))) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    readAscii(bytes, 0, 4) === "RIFF" &&
    readAscii(bytes, 8, 4) === "WEBP"
  ) {
    return "image/webp";
  }
  if (bytes.length >= 12 && readAscii(bytes, 4, 4) === "ftyp") {
    const brand = readAscii(bytes, 8, 4);
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (HEIC_FTYP_BRANDS.has(brand)) return "image/heic";
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return "image/bmp";
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x00 &&
    bytes[1] === 0x00 &&
    bytes[2] === 0x01 &&
    bytes[3] === 0x00
  ) {
    return "image/x-icon";
  }
  // SVG is text — look for an <svg> root in the leading bytes.
  const head = new TextDecoder().decode(bytes.subarray(0, 1024)).toLowerCase();
  if (head.includes("<svg")) {
    return "image/svg+xml";
  }
  return null;
}

export interface ValidateUploadOptions {
  /** When true, only image MIME types are accepted (e.g. for avatar uploads). */
  imagesOnly?: boolean;
  /** Max file size in MB. */
  maxFileSizeMB: number;
}

/**
 * Validates an uploaded file's type and size.
 *
 * @param file - The uploaded File object
 * @param options - Validation constraints
 * @returns null if valid, error message string if invalid
 * @example
 * ```ts
 * const error = validateUploadFile(file, { maxFileSizeMB: 1024 });
 * if (error) return dsToast(error, "error");
 * ```
 */
export function validateUploadFile(
  file: File,
  options: ValidateUploadOptions,
): string | null {
  return validateUploadFileMetadata(file.type, file.size, options);
}

/**
 * Validates file metadata (type and size) without requiring a File object.
 * Used by the multipart upload initiation endpoint which receives JSON metadata.
 * All MIME types are accepted; unrecognized types are categorized as archive.
 *
 * @param contentType - The MIME type of the file
 * @param size - The file size in bytes
 * @param options - Validation constraints
 * @returns null if valid, error message string if invalid
 * @example
 * ```ts
 * const error = validateUploadFileMetadata("image/jpeg", 1024000, { maxFileSizeMB: 1024 });
 * ```
 */
export function validateUploadFileMetadata(
  contentType: string,
  size: number,
  options: ValidateUploadOptions,
): string | null {
  if (options?.imagesOnly) {
    if (!isImageMimeType(contentType)) {
      return "File type not allowed.";
    }
  }
  const maxMB = options.maxFileSizeMB;
  if (size > maxMB * 1024 * 1024) {
    return `File too large (max ${maxMB}MB).`;
  }
  return null;
}

/**
 * Resolve the serving policy for an uploaded object after client-side
 * processing has already produced the final file.
 *
 * Image, video, and audio uploads are intentionally strict in v1 so the
 * backend only accepts the concrete formats Jant knows how to serve today.
 * Non-preview documents remain broadly allowed and default to attachment
 * delivery, except PDFs which stay inline so browsers can render them.
 */
export function getStoredUploadPolicy(
  contentType: string,
): StoredUploadPolicy | null {
  if (contentType.startsWith("image/")) {
    if (
      contentType !== "image/webp" &&
      contentType !== "image/png" &&
      contentType !== "image/jpeg"
    )
      return null;
    return {
      contentDisposition: "inline",
      mediaKind: "image",
      requiresSignatureCheck: true,
    };
  }

  if (contentType.startsWith("video/")) {
    if (contentType !== "video/mp4") return null;
    return {
      contentDisposition: "inline",
      mediaKind: "video",
      requiresSignatureCheck: true,
    };
  }

  if (contentType.startsWith("audio/")) {
    if (contentType !== "audio/mp4") return null;
    return {
      contentDisposition: "inline",
      mediaKind: "audio",
      requiresSignatureCheck: true,
    };
  }

  if (contentType === "application/pdf") {
    return {
      contentDisposition: "inline",
      mediaKind: "document",
      requiresSignatureCheck: true,
    };
  }

  if (ATTACHMENT_ONLY_MIME_TYPES.has(contentType)) {
    return {
      contentDisposition: "attachment",
      mediaKind: "text",
      requiresSignatureCheck: false,
    };
  }

  return {
    contentDisposition: "attachment",
    mediaKind: toMediaKind(contentType),
    requiresSignatureCheck: false,
  };
}

export function validateStoredUploadMetadata(
  contentType: string,
  size: number,
  options: ValidateUploadOptions,
): string | null {
  const basicError = validateUploadFileMetadata(contentType, size, options);
  if (basicError) {
    return basicError;
  }

  if (!getStoredUploadPolicy(contentType)) {
    return `File type "${contentType}" is not supported.`;
  }

  return null;
}

export function getStoredUploadSignaturePeekLength(
  contentType: string,
): number {
  return INLINE_SIGNATURE_MIME_TYPES.has(contentType) ? 64 : 0;
}

export function validateStoredUploadSignature(
  contentType: string,
  bytes: Uint8Array,
): string | null {
  switch (contentType) {
    case "image/webp":
      return bytes.length >= 12 &&
        readAscii(bytes, 0, 4) === "RIFF" &&
        readAscii(bytes, 8, 4) === "WEBP"
        ? null
        : "File does not match the expected WebP format.";
    case "image/jpeg":
      return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8
        ? null
        : "File does not match the expected JPEG format.";
    case "image/png":
      return bytes.length >= 8 &&
        bytes[0] === 0x89 &&
        readAscii(bytes, 1, 3) === "PNG"
        ? null
        : "File does not match the expected PNG format.";
    case "video/mp4":
    case "audio/mp4":
      return bytes.length >= 12 && readAscii(bytes, 4, 4) === "ftyp"
        ? null
        : "Only MP4 uploads are supported.";
    case "application/pdf":
      return bytes.length >= 5 && readAscii(bytes, 0, 5) === "%PDF-"
        ? null
        : "Only PDF documents are supported.";
    default:
      return null;
  }
}

/** Allowed poster MIME types and their file extensions. */
const POSTER_FORMATS = {
  "image/webp": "webp",
  "image/png": "png",
} as const;

export type PosterMimeType = keyof typeof POSTER_FORMATS;

/**
 * Returns the file extension for a poster MIME type, or null if unsupported.
 *
 * @param contentType - The poster MIME type to check
 * @returns File extension string
 */
export function getPosterExtension(contentType: PosterMimeType): string {
  return POSTER_FORMATS[contentType];
}

/**
 * Detects the poster image format from the first bytes of the file.
 * Returns the MIME type if recognized, null otherwise.
 *
 * @param bytes - First few bytes of the file
 * @returns MIME type string or null
 */
export function detectPosterMimeType(bytes: Uint8Array): PosterMimeType | null {
  if (
    bytes.length >= 12 &&
    readAscii(bytes, 0, 4) === "RIFF" &&
    readAscii(bytes, 8, 4) === "WEBP"
  ) {
    return "image/webp";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    readAscii(bytes, 1, 3) === "PNG"
  ) {
    return "image/png";
  }
  return null;
}

function readAscii(bytes: Uint8Array, start: number, length: number): string {
  return new TextDecoder("ascii").decode(bytes.slice(start, start + length));
}

/**
 * Generates a unique storage key for an uploaded media object.
 * Format: `media/{siteId}/files/{typeid}.{ext}`
 *
 * @param siteId - Owning site ID
 * @param originalFilename - Original filename to extract extension from
 * @returns Object with generated id, filename, and storageKey
 * @example
 * ```ts
 * const { id, filename, storageKey } = generateStorageKey("sit_...", "photo.jpg");
 * // { id: "med_...", filename: "med_....jpg", storageKey: "media/sit_.../files/med_....jpg" }
 * ```
 */
export function generateStorageKey(
  siteId: string,
  originalFilename: string,
): {
  id: string;
  filename: string;
  storageKey: string;
} {
  const ext = originalFilename.split(".").pop() || "bin";
  const id = createEntityId("media");
  return generateStorageKeyForId(siteId, id, ext);
}

export function generateStorageKeyForId(
  siteId: string,
  mediaId: string,
  originalFilenameOrExtension: string,
): {
  id: string;
  filename: string;
  storageKey: string;
} {
  const ext = originalFilenameOrExtension.includes(".")
    ? originalFilenameOrExtension.split(".").pop() || "bin"
    : originalFilenameOrExtension;
  const filename = `${mediaId}.${ext}`;
  const storageKey = [
    MEDIA_ROOT_PREFIX,
    siteId,
    MEDIA_FILES_STORAGE_PREFIX,
    filename,
  ].join("/");
  return { id: mediaId, filename, storageKey };
}

export function generateSiteAssetStorageKey(
  siteId: string,
  assetKind: "avatar" | "favicon",
  originalFilename: string,
): {
  id: string;
  filename: string;
  storageKey: string;
} {
  const ext = originalFilename.split(".").pop() || "bin";
  const id = createEntityId("media");
  const filename = `${id}.${ext}`;
  const storageKey = getSiteStorageKey(siteId, assetKind, filename);
  return { id, filename, storageKey };
}

export function getPosterStorageKey(
  siteId: string,
  mediaId: string,
  ext = "webp",
): string {
  return `${MEDIA_ROOT_PREFIX}/${siteId}/${MEDIA_POSTERS_STORAGE_PREFIX}/${mediaId}.${ext}`;
}

export function getTemporaryUploadStorageKey(
  siteId: string,
  uploadSessionId: string,
  originalFilename: string,
): string {
  const ext = originalFilename.split(".").pop() || "bin";
  return `${MEDIA_ROOT_PREFIX}/${siteId}/tmp/${uploadSessionId}/source.${ext}`;
}

export function getTemporaryPosterStorageKey(
  siteId: string,
  uploadSessionId: string,
  ext = "webp",
): string {
  return `${MEDIA_ROOT_PREFIX}/${siteId}/tmp/${uploadSessionId}/poster.${ext}`;
}

export function getSiteStorageKey(
  siteId: string,
  assetKind: "avatar" | "favicon",
  filename: string,
): string {
  return `${MEDIA_ROOT_PREFIX}/${siteId}/${MEDIA_ASSET_STORAGE_PREFIX}/${assetKind}/${filename}`;
}

/**
 * Generates a storage key for a link preview image.
 *
 * Uses a unique suffix to avoid cache staleness when the preview is replaced.
 *
 * @param siteId - The site ID
 * @param postId - The post ID
 * @param suffix - A short random string to make the key unique across updates
 * @param ext - File extension (default: "jpg")
 * @returns Storage key like `media/{siteId}/previews/{postId}-{suffix}.jpg`
 *
 * @example
 * ```ts
 * getPreviewStorageKey("sit_123", "pst_456", "a3k9m");
 * // "media/sit_123/previews/pst_456-a3k9m.jpg"
 * ```
 */
export function getPreviewStorageKey(
  siteId: string,
  postId: string,
  suffix: string,
  ext = "jpg",
): string {
  return `${MEDIA_ROOT_PREFIX}/${siteId}/${MEDIA_PREVIEWS_STORAGE_PREFIX}/${postId}-${suffix}.${ext}`;
}
