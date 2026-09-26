import { openAsBlob } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { resolve, join, extname, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import {
  CLI_API_TOKEN_ENV_VAR,
  getCliApiToken,
} from "../../lib/cli-api-token.js";
import {
  extractAttachmentBlocks,
  findImageUrls,
  normalizeImportedBody,
  rewriteMediaReferences,
} from "../../lib/site-media-parser.js";
import { parseFrontMatter as parseFrontMatterShared } from "../../lib/hugo-markdown.js";
import { extractZipFile } from "../../lib/zip-archive.js";
import { findPositionalUrl } from "../../lib/renamed-arguments.js";

/**
 * Parse front matter from a Markdown file.
 * Delegates to the shared hugo-markdown module.
 */
const parseFrontMatter = parseFrontMatterShared;

/**
 * Newest `data/jant.toml` format version this importer reads. `site export`
 * writes `SITE_EXPORT_FORMAT_VERSION` from `src/services/export.ts`; a test
 * keeps the two equal.
 */
export const SUPPORTED_SITE_EXPORT_VERSION = 1;

/**
 * Refuse an export written in a format newer than this importer reads.
 *
 * An export from before the version field, or from any version up to
 * {@link SUPPORTED_SITE_EXPORT_VERSION}, is accepted.
 *
 * @param {{ extra?: { jant_export?: { format?: string, version?: unknown } } } | null} siteConfig
 *   The merged config from `loadSiteConfig`
 * @returns {string | null} An error message, or null when the export can be read
 * @example
 * ```js
 * checkSiteExportVersion({ extra: { jant_export: { format: "jant-site", version: 2 } } });
 * // "This export uses format version 2, …"
 * ```
 */
function checkSiteExportVersion(siteConfig) {
  const version = siteConfig?.extra?.jant_export?.version;
  if (typeof version !== "number" || version <= SUPPORTED_SITE_EXPORT_VERSION) {
    return null;
  }
  return `This export uses format version ${version}, and this Jant reads up to version ${SUPPORTED_SITE_EXPORT_VERSION}. Upgrade @jant/core, then import again.`;
}

async function parseToml(content) {
  const { parse } = await import("smol-toml");
  return parse(content);
}

/**
 * Static directories of a Jant Hugo export, in Hugo's lookup order: the root
 * `static/` (user overrides) before `themes/jant/static/`, where Jant writes
 * `custom.css`, `favicon.ico`, and `apple-touch-icon.png`.
 */
const IMPORT_STATIC_DIRS = [["static"], ["themes", "jant", "static"]];

/**
 * Read custom.css from the first static directory of a Jant Hugo export that
 * has one.
 */
async function readImportCustomCss(rootDir) {
  for (const staticDir of IMPORT_STATIC_DIRS) {
    const css = await readFile(
      join(rootDir, ...staticDir, "custom.css"),
      "utf-8",
    ).catch(() => null);
    if (css !== null) {
      return css;
    }
  }
  return "";
}

function resolveImportUrl(url, siteConfig) {
  if (typeof url !== "string" || url.trim() === "" || url.startsWith("data:")) {
    return url;
  }

  const baseUrl =
    typeof siteConfig?.base_url === "string" ? siteConfig.base_url : "";
  if (!baseUrl) {
    return url;
  }

  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return url;
  }
}

function resolveImportSiteAssetUrl(path, siteConfig) {
  if (typeof path !== "string" || path.trim() === "") {
    return path;
  }

  const baseUrl =
    typeof siteConfig?.base_url === "string" ? siteConfig.base_url : "";
  if (!baseUrl) {
    return path;
  }

  try {
    const parsedBaseUrl = new URL(baseUrl);
    const sitePathPrefix = getImportSitePathPrefix(siteConfig);
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const publicPath =
      sitePathPrefix &&
      normalizedPath !== sitePathPrefix &&
      !normalizedPath.startsWith(`${sitePathPrefix}/`)
        ? `${sitePathPrefix}${normalizedPath}`
        : normalizedPath;
    return new URL(publicPath, parsedBaseUrl.origin).toString();
  } catch {
    return resolveImportUrl(path, siteConfig);
  }
}

function getImportSitePathPrefix(siteConfig) {
  const baseUrl =
    typeof siteConfig?.base_url === "string" ? siteConfig.base_url : "";
  if (!baseUrl) {
    return "";
  }

  try {
    const pathname = new URL(baseUrl).pathname.replace(/\/+$/, "");
    return pathname === "/" ? "" : pathname;
  } catch {
    return "";
  }
}

async function resolveImportLocalAssetPath(rawUrl, siteConfig, sourceRootDir) {
  if (
    !sourceRootDir ||
    typeof rawUrl !== "string" ||
    rawUrl.trim() === "" ||
    rawUrl.startsWith("data:")
  ) {
    return null;
  }

  const resolvedUrl = resolveImportUrl(rawUrl, siteConfig);
  if (typeof resolvedUrl !== "string" || resolvedUrl.trim() === "") {
    return null;
  }

  let pathname = "";
  try {
    pathname = new URL(
      resolvedUrl,
      typeof siteConfig?.base_url === "string" && siteConfig.base_url
        ? siteConfig.base_url
        : "https://jant.invalid",
    ).pathname;
  } catch {
    return null;
  }

  const sitePathPrefix = getImportSitePathPrefix(siteConfig);
  if (sitePathPrefix && pathname.startsWith(`${sitePathPrefix}/`)) {
    pathname = pathname.slice(sitePathPrefix.length + 1);
  } else {
    pathname = pathname.replace(/^\/+/, "");
  }

  if (!pathname) {
    return null;
  }

  for (const staticDir of IMPORT_STATIC_DIRS) {
    const fullPath = join(sourceRootDir, ...staticDir, pathname);
    const fileStat = await stat(fullPath).catch(() => null);
    if (fileStat?.isFile()) {
      return fullPath;
    }
  }

  return null;
}

/**
 * Read one asset as a Blob, from the export's files or its URL.
 *
 * A local file comes back file-backed (`openAsBlob`): an upload streams it
 * from disk. Reading every file into memory first held gigabytes during the
 * import of a real site, since Node does not count Blob memory toward the
 * garbage collector's pressure.
 *
 * @param {{ sourceUrl?: string, sourceFilePath?: string | null, mimeType?: string, originalName?: string }} options
 * @returns {Promise<{ blob: Blob, filename: string, contentType: string } | null>}
 *   The asset, or null when a remote source is missing or unreachable
 */
async function readImportAsset(options) {
  const { sourceUrl, sourceFilePath, mimeType, originalName } = options;

  if (sourceFilePath) {
    const filename =
      originalName || basename(sourceFilePath) || getFilenameFromUrl(sourceUrl);
    const contentType = mimeType || guessMimeType(filename);
    return {
      blob: await openAsBlob(sourceFilePath, { type: contentType }),
      filename,
      contentType,
    };
  }

  if (!sourceUrl) {
    return null;
  }

  const response = await fetch(sourceUrl);
  if (!response.ok) {
    return null;
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const filename = originalName || getFilenameFromUrl(sourceUrl) || "file";
  const contentType =
    mimeType ||
    response.headers.get("content-type")?.split(";")[0] ||
    guessMimeType(filename);
  return {
    blob: new Blob([bytes], { type: contentType }),
    filename,
    contentType,
  };
}

async function readMediaSpecAsset(media, field = "src") {
  if (field === "poster") {
    return readImportAsset({
      sourceUrl: media.poster,
      sourceFilePath: media.posterFilePath,
    });
  }

  return readImportAsset({
    sourceUrl: media.src,
    sourceFilePath: media.srcFilePath,
    mimeType: media.mimeType,
    originalName: media.originalName,
  });
}

function normalizeImportPathKey(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/+/g, "/");
}

function normalizeImportAliasPath(value) {
  const pathKey = normalizeImportPathKey(value);
  return pathKey ? `/${pathKey}` : null;
}

/**
 * Resolve the historical root slugs that should become custom-URL aliases
 * pointing at the current root post. Hugo's `aliases:` on a root also
 * contains every reply slug; we strip those (reply slugs are claimed by
 * their own bundles) and keep only entries that aren't the root itself.
 *
 * `root_aliases:` is the authoritative record of the root's own historical
 * slugs (the exporter writes it for round-trip), so when present we prefer
 * it. Otherwise we fall back to `aliases:` minus reply slugs.
 */
function getRootAliasPathsForImport(
  aliases,
  rootAliases,
  postSlug,
  replySlugPaths,
) {
  const rootSlugPath = normalizeImportAliasPath(postSlug);
  const aliasPaths = [];
  const seen = new Set();

  // Prefer the explicit `root_aliases:` list when the exporter wrote it.
  const source =
    Array.isArray(rootAliases) && rootAliases.length > 0
      ? rootAliases
      : Array.isArray(aliases)
        ? aliases
        : [];

  for (const alias of source) {
    const aliasPath = normalizeImportAliasPath(alias);
    if (!aliasPath) {
      continue;
    }
    if (aliasPath === rootSlugPath) {
      continue;
    }
    if (replySlugPaths.has(aliasPath)) {
      // Reply slugs live in their own bundles — never route their URL back
      // to the root as a custom alias.
      continue;
    }
    if (seen.has(aliasPath)) {
      continue;
    }
    seen.add(aliasPath);
    aliasPaths.push(aliasPath);
  }

  return aliasPaths;
}

async function assertImportSlugAvailable(target, slug, label, kind) {
  if (!slug) {
    return;
  }

  const available = await target.checkPostSlugAvailability(slug);
  if (!available) {
    console.error(
      `Import conflict: ${kind} slug "${slug}" for ${label} is already in use. Import into an empty site or remove the existing content first.`,
    );
    process.exit(1);
  }
}

/**
 * Download a media file and upload it to the Jant API.
 * Returns the new URL, or null on failure.
 */
/**
 * Upload one media file through the site's API.
 *
 * Throws when the file can't be read or the site refuses it, so a caller
 * decides whether that is fatal (the export's own media) or leaves a link in
 * place (an image in the body). It used to return null for either, and a
 * post was created without the file and without a word.
 *
 * @param {Record<string, unknown>} media - A normalized media spec
 * @param {string} apiUrl - Target site URL
 * @param {string} token - API token
 * @returns {Promise<{ url: string, id: string }>} The uploaded media
 */
async function uploadRemoteMedia(media, apiUrl, token) {
  const asset = await readMediaSpecAsset(media);
  if (!asset) {
    throw new Error(`Couldn't read ${media.src}`);
  }

  const formData = new FormData();
  formData.append("file", asset.blob, asset.filename);
  if (media.alt) formData.append("alt", media.alt);
  if (media.summary) formData.append("summary", media.summary);
  if (media.width) formData.append("width", String(media.width));
  if (media.height) formData.append("height", String(media.height));
  if (media.blurhash) formData.append("blurhash", media.blurhash);
  if (media.waveform) formData.append("waveform", media.waveform);
  if (media.durationSeconds) {
    formData.append("durationSeconds", String(media.durationSeconds));
  }

  if (media.poster) {
    const posterAsset = await readMediaSpecAsset(media, "poster");
    if (posterAsset) {
      formData.append("poster", posterAsset.blob, posterAsset.filename);
    } else {
      console.warn(`Warning: couldn't read the poster ${media.poster}`);
    }
  }

  const uploadResponse = await fetch(`${apiUrl}/api/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (!uploadResponse.ok) {
    const detail = (await uploadResponse.text().catch(() => "")).slice(0, 300);
    throw new Error(
      `The site refused ${media.src}: HTTP ${uploadResponse.status}${detail ? ` ${detail}` : ""}`,
    );
  }
  const data = await uploadResponse.json();
  return { url: data.url, id: data.id };
}

function getFilenameFromUrl(fileUrl) {
  try {
    const pathname = new URL(fileUrl).pathname;
    return pathname.split("/").pop() || "file";
  } catch {
    return fileUrl.split("/").pop() || "file";
  }
}

function guessMimeType(filename) {
  const ext = extname(filename).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".avif":
      return "image/avif";
    case ".bmp":
      return "image/bmp";
    case ".ico":
      return "image/x-icon";
    case ".mp4":
      return "video/mp4";
    case ".mp3":
      return "audio/mpeg";
    case ".pdf":
      return "application/pdf";
    case ".json":
      return "application/json";
    case ".md":
      return "text/markdown";
    case ".csv":
      return "text/csv";
    case ".txt":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

function normalizeImportedBodySegment(markdown) {
  const extracted = extractAttachmentBlocks(markdown);
  const normalized = normalizeImportedBody(extracted.markdown);

  return {
    markdown: normalized.markdown,
    attachments: [...extracted.attachments, ...normalized.attachments],
  };
}

function isAbsoluteUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

/**
 * True when `url` points to a different location than the import target —
 * i.e. has a scheme (`https://`, `data:`) or is protocol-relative (`//cdn…`).
 * False for relative paths (`/media/x`, `./x`, `x`), which always belong to
 * the source site and must be rehosted. Used to filter the body-fallback
 * upload when `--skip-remote-media` is set.
 */
function isAbsoluteImportUrl(value) {
  if (typeof value !== "string") return false;
  return /^([a-z][a-z0-9+.\-]*:|\/\/)/i.test(value);
}

/**
 * Resolve a `media:` entry's `src` or `poster` reference to a local disk
 * path when the export bundled the bytes under `static/`. Absolute URLs
 * (remote-linked media) skip the disk lookup — the uploader fetches them
 * directly.
 */
async function resolveJantMediaDiskPath(ref, sourceRootDir) {
  if (typeof ref !== "string" || !ref.trim()) return null;
  if (isAbsoluteUrl(ref)) return null;
  const normalized = ref.startsWith("/") ? ref.slice(1) : ref;
  const fullPath = join(sourceRootDir, "static", normalized);
  const fileStat = await stat(fullPath).catch(() => null);
  return fileStat?.isFile() ? fullPath : null;
}

/**
 * Build a media spec for upload from a flat `media:` front-matter entry.
 *
 * The entry's `src` is either a site-relative path
 * (`/media/{id}.webp` — bytes live under `static/` in the exported site)
 * or an absolute public URL (the exporter linked to an existing
 * R2/S3/local-proxy host rather than re-bundling the bytes). Poster
 * frames follow the same rule. The import uploader already knows how
 * to handle both forms via `readImportAsset`.
 */
async function mediaSpecFromJantMedia(entry, sourceRootDir) {
  if (!entry || typeof entry.src !== "string" || !entry.src.trim()) {
    return null;
  }

  const srcFilePath = await resolveJantMediaDiskPath(entry.src, sourceRootDir);
  if (!srcFilePath && !isAbsoluteUrl(entry.src)) {
    // Relative src but file not on disk — can't upload.
    return null;
  }

  const poster =
    typeof entry.poster === "string" && entry.poster.trim()
      ? entry.poster
      : null;
  const posterFilePath = poster
    ? await resolveJantMediaDiskPath(poster, sourceRootDir)
    : null;

  const originalName =
    typeof entry.original_name === "string" && entry.original_name.trim()
      ? entry.original_name
      : srcFilePath
        ? basename(srcFilePath)
        : undefined;

  return {
    kind: typeof entry.kind === "string" ? entry.kind : undefined,
    src: entry.src,
    srcFilePath,
    poster,
    posterFilePath,
    mimeType: typeof entry.mime_type === "string" ? entry.mime_type : undefined,
    originalName,
    size: typeof entry.size === "number" ? entry.size : undefined,
    width: typeof entry.width === "number" ? entry.width : undefined,
    height: typeof entry.height === "number" ? entry.height : undefined,
    alt: typeof entry.alt === "string" ? entry.alt : undefined,
    position: typeof entry.position === "string" ? entry.position : undefined,
    blurhash: typeof entry.blurhash === "string" ? entry.blurhash : undefined,
    waveform: typeof entry.waveform === "string" ? entry.waveform : undefined,
    summary: typeof entry.summary === "string" ? entry.summary : undefined,
    chars: typeof entry.chars === "number" ? entry.chars : undefined,
    durationSeconds:
      typeof entry.duration_seconds === "number"
        ? entry.duration_seconds
        : undefined,
  };
}

async function normalizeMediaSpec(spec, siteConfig, sourceRootDir) {
  if (!spec || typeof spec.src !== "string" || spec.src.trim() === "") {
    return null;
  }

  const src = resolveImportUrl(spec.src, siteConfig);
  const poster =
    typeof spec.poster === "string"
      ? resolveImportUrl(spec.poster, siteConfig)
      : null;

  return {
    kind: spec.kind,
    src,
    srcFilePath:
      spec.srcFilePath ??
      (await resolveImportLocalAssetPath(spec.src, siteConfig, sourceRootDir)),
    poster,
    posterFilePath:
      spec.posterFilePath ??
      (typeof spec.poster === "string"
        ? await resolveImportLocalAssetPath(
            spec.poster,
            siteConfig,
            sourceRootDir,
          )
        : null),
    mimeType: spec.mimeType || undefined,
    originalName: spec.originalName || undefined,
    size: typeof spec.size === "number" ? spec.size : undefined,
    width: typeof spec.width === "number" ? spec.width : undefined,
    height: typeof spec.height === "number" ? spec.height : undefined,
    alt: typeof spec.alt === "string" ? spec.alt : undefined,
    position: typeof spec.position === "string" ? spec.position : undefined,
    blurhash: typeof spec.blurhash === "string" ? spec.blurhash : undefined,
    waveform: typeof spec.waveform === "string" ? spec.waveform : undefined,
    summary: typeof spec.summary === "string" ? spec.summary : undefined,
    chars: typeof spec.chars === "number" ? spec.chars : undefined,
  };
}

/**
 * Coerce a `<figure data-jant-node="attachment" data-jant-kind="text">` meta
 * block into the shape `createTextAttachment` wants on import.
 *
 * Two source shapes are supported:
 *
 * 1. Inline (legacy exports): the meta JSON carries the markdown itself under
 *    `contentFormat: "markdown"` + `content: "..."`. Used before text
 *    attachments got their own public URL.
 * 2. Reference (current exports): the meta JSON only carries `kind: "text"`
 *    + `src: <url>` pointing at the `.md` artifact. We fetch that URL
 *    (falling back to `--pull-media` local disk via
 *    `resolveImportLocalAssetPath`, same as images) and use the bytes as
 *    the markdown body.
 *
 * Returns `null` when the spec isn't a text attachment or we can't get
 * usable content (unreachable URL, empty body, etc.) — caller drops the
 * attachment rather than creating an empty one.
 */
async function normalizeTextAttachmentSpec(spec, siteConfig, sourceRootDir) {
  if (!spec || spec.kind !== "text") {
    return null;
  }

  const summary = typeof spec.summary === "string" ? spec.summary : undefined;

  // Legacy inline content path — no network fetch needed.
  if (
    spec.contentFormat === "markdown" &&
    typeof spec.content === "string" &&
    spec.content.trim() !== ""
  ) {
    return {
      type: "text",
      contentFormat: "markdown",
      content: spec.content,
      summary,
    };
  }

  // Reference path — fetch the markdown from the stored `src` URL.
  if (typeof spec.src !== "string" || spec.src.trim() === "") {
    return null;
  }

  const sourceUrl = resolveImportUrl(spec.src, siteConfig);
  if (typeof sourceUrl !== "string" || sourceUrl.trim() === "") {
    return null;
  }

  const asset = await readImportAsset({
    sourceUrl,
    sourceFilePath: await resolveImportLocalAssetPath(
      spec.src,
      siteConfig,
      sourceRootDir,
    ),
  });

  if (!asset) {
    return null;
  }

  let markdown;
  try {
    markdown = await asset.blob.text();
  } catch {
    return null;
  }

  if (markdown.trim() === "") {
    return null;
  }

  return {
    type: "text",
    contentFormat: "markdown",
    content: markdown,
    summary,
  };
}

async function buildImportedAttachments(
  attachmentSpecs,
  target,
  siteConfig,
  sourceRootDir,
) {
  const attachments = [];
  let uploaded = 0;

  for (const spec of attachmentSpecs) {
    const textAttachment = await normalizeTextAttachmentSpec(
      spec,
      siteConfig,
      sourceRootDir,
    );
    if (textAttachment) {
      attachments.push(textAttachment);
      continue;
    }

    const normalized = await normalizeMediaSpec(
      spec,
      siteConfig,
      sourceRootDir,
    );
    if (!normalized || normalized.src.startsWith("data:")) continue;
    let result;
    try {
      result = await target.uploadMedia(normalized);
    } catch (err) {
      // The post's own attachment: creating the post without it would lose
      // the file quietly.
      throw new Error(`Couldn't upload ${spec.src}: ${err.message}`, {
        cause: err,
      });
    }
    if (!result) continue;
    attachments.push({
      type: "media",
      mediaId: result.id,
      ...(typeof normalized.alt === "string" ? { alt: normalized.alt } : {}),
    });
    uploaded += 1;
  }

  return { attachments, uploaded };
}

async function uploadMediaList(mediaSpecs, target, siteConfig, sourceRootDir) {
  const urlMap = new Map();
  const mediaIds = [];
  let uploaded = 0;

  for (const spec of mediaSpecs) {
    const normalized = await normalizeMediaSpec(
      spec,
      siteConfig,
      sourceRootDir,
    );
    if (!normalized || normalized.src.startsWith("data:")) continue;
    let result;
    try {
      result = await target.uploadMedia(normalized);
    } catch (err) {
      // A body image may be a third party's; the Markdown keeps its URL.
      console.warn(`Warning: kept ${spec.src} as a link. ${err.message}`);
      continue;
    }
    if (!result) continue;
    // Key the rewrite map by the *original* URL as it appears in the body
    // (e.g. `/media/...`). `normalized.src` has been resolved against
    // `siteConfig.base_url` and becomes absolute, which would never match
    // `node.url` from the markdown AST during `rewriteMediaReferences`.
    if (typeof spec.src === "string" && spec.src.trim() !== "") {
      urlMap.set(spec.src, result.url);
    }
    if (normalized.src !== spec.src) {
      urlMap.set(normalized.src, result.url);
    }
    mediaIds.push(result.id);
    uploaded += 1;
  }

  return { urlMap, mediaIds, uploaded };
}

/**
 * Upload each media spec referenced by a bundle's front matter. Accepts
 * both site-relative entries (bytes on disk under `static/`, via
 * `srcFilePath`) and absolute-URL entries (remote-linked media — the
 * uploader fetches the URL). Returns a `urlMap` (for rewriting in-body
 * references) and an ordered `mediaIds` list for post attachment.
 */
async function uploadBundleResources(resourceSpecs, target) {
  const urlMap = new Map();
  const mediaIds = [];
  let uploaded = 0;

  for (const spec of resourceSpecs) {
    if (!spec) continue;
    if (!spec.srcFilePath && !isAbsoluteUrl(spec.src)) continue;
    let result;
    try {
      result = await target.uploadMedia(spec);
    } catch (err) {
      // The post's own attachment: creating the post without it would lose
      // the file quietly.
      throw new Error(`Couldn't upload ${spec.src}: ${err.message}`, {
        cause: err,
      });
    }
    if (!result) continue;
    urlMap.set(spec.src, result.url);
    mediaIds.push(result.id);
    uploaded += 1;
  }

  return { urlMap, mediaIds, uploaded };
}

function coerceBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  return false;
}

/**
 * Build a unified "site config" object from Hugo's split config files.
 *
 * Hugo writes two sources of truth:
 *   - `hugo.toml`: baseURL, title, languageCode, theme params
 *   - `data/jant.toml`: everything Jant owns — nav items, branding modes,
 *     site_footer, avatar urls, display preferences, and the ordered
 *     collections directory under `[[directory]]`.
 *
 * This merger normalizes them into a single shape that downstream helpers
 * (`buildSettingsUpdatesFromConfig`, `normalizeImportedNavItems`,
 * `normalizeImportedCollectionDirectory`, `buildSiteAvatarImport`) already
 * know how to read. The shape is intentionally a superset — nothing
 * depends on `hugo.toml`-only vs `data/jant.toml`-only fields, so extra
 * keys are harmless if they leak through.
 */
async function loadSiteConfig(rootDir) {
  const hugoTomlText = await readFile(
    join(rootDir, "hugo.toml"),
    "utf-8",
  ).catch(() => null);
  const jantDataText = await readFile(
    join(rootDir, "data", "jant.toml"),
    "utf-8",
  ).catch(() => null);

  if (!hugoTomlText && !jantDataText) {
    return null;
  }

  const hugoToml = hugoTomlText ? await parseToml(hugoTomlText) : {};
  const jantData = jantDataText ? await parseToml(jantDataText) : {};

  const params = hugoToml.params ?? {};

  const title =
    (typeof hugoToml.title === "string" && hugoToml.title) ||
    (typeof jantData.site_name === "string" ? jantData.site_name : "");
  const description =
    (typeof params.description === "string" && params.description) ||
    (typeof jantData.site_description === "string"
      ? jantData.site_description
      : "");
  const baseUrl =
    typeof hugoToml.baseURL === "string"
      ? hugoToml.baseURL
      : typeof hugoToml.baseurl === "string"
        ? hugoToml.baseurl
        : "";
  const language =
    (typeof hugoToml.languageCode === "string" && hugoToml.languageCode) ||
    (typeof hugoToml.defaultContentLanguage === "string" &&
      hugoToml.defaultContentLanguage) ||
    (typeof jantData.site_language === "string"
      ? jantData.site_language
      : "en");

  const directoryItems = Array.isArray(jantData.directory)
    ? jantData.directory
    : [];
  const directoryExported = Array.isArray(jantData.directory);

  return {
    // Public base URL (used for resolving relative media URLs).
    base_url: baseUrl,
    title,
    description,
    default_language: language,
    extra: {
      jant: {
        theme_id:
          (typeof params.theme_id === "string" && params.theme_id) ||
          (typeof jantData.theme_id === "string" ? jantData.theme_id : ""),
        default_theme_id:
          (typeof params.default_theme_id === "string" &&
            params.default_theme_id) ||
          (typeof jantData.default_theme_id === "string"
            ? jantData.default_theme_id
            : ""),
        font_theme_id:
          (typeof params.font_theme_id === "string" && params.font_theme_id) ||
          (typeof jantData.font_theme_id === "string"
            ? jantData.font_theme_id
            : ""),
        theme_mode:
          (typeof params.theme_mode === "string" && params.theme_mode) ||
          (typeof jantData.theme_mode === "string" ? jantData.theme_mode : ""),
        show_jant_branding_on_home: coerceBoolean(
          params.show_jant_branding_on_home ??
            jantData.show_jant_branding_on_home,
        ),
        show_header_avatar: coerceBoolean(
          params.show_header_avatar ?? jantData.show_header_avatar,
        ),
        noindex: coerceBoolean(params.noindex ?? jantData.noindex),
        public_api_enabled:
          params.public_api_enabled === undefined &&
          jantData.public_api_enabled === undefined
            ? true
            : coerceBoolean(
                params.public_api_enabled ?? jantData.public_api_enabled,
              ),
        rss_feeds_enabled:
          params.rss_feeds_enabled === undefined &&
          jantData.rss_feeds_enabled === undefined
            ? true
            : coerceBoolean(
                params.rss_feeds_enabled ?? jantData.rss_feeds_enabled,
              ),
        site_footer_markdown:
          typeof jantData.site_footer_markdown === "string"
            ? jantData.site_footer_markdown
            : "",
        site_avatar_mode:
          typeof jantData.site_avatar_mode === "string"
            ? jantData.site_avatar_mode
            : "none",
        site_avatar_url:
          typeof jantData.site_avatar_url === "string"
            ? jantData.site_avatar_url
            : typeof params.site_avatar_url === "string"
              ? params.site_avatar_url
              : "",
        favicon_mode:
          typeof jantData.favicon_mode === "string"
            ? jantData.favicon_mode
            : "default",
        favicon_url:
          typeof jantData.favicon_path === "string"
            ? jantData.favicon_path
            : "/favicon.ico",
        apple_touch_mode:
          typeof jantData.apple_touch_mode === "string"
            ? jantData.apple_touch_mode
            : "default",
        apple_touch_icon_url:
          typeof jantData.apple_touch_icon_path === "string"
            ? jantData.apple_touch_icon_path
            : "/apple-touch-icon.png",
        nav: Array.isArray(jantData.nav) ? jantData.nav : [],
        nav_exported: Array.isArray(jantData.nav),
        collections_directory: directoryItems,
        collections_directory_exported: directoryExported,
        custom_urls: Array.isArray(jantData.custom_url)
          ? jantData.custom_url
          : [],
      },
      jant_export: {
        format:
          typeof jantData.format === "string" ? jantData.format : "jant-site",
        version: jantData.version,
      },
    },
  };
}

function buildSettingsUpdatesFromConfig(siteConfig, customCss = "") {
  const jant = siteConfig?.extra?.jant || {};
  const themeId = String(jant.theme_id || "");
  const defaultThemeId = String(jant.default_theme_id || "");
  const fontThemeId = String(jant.font_theme_id || "");
  const themeMode = String(jant.theme_mode || "");
  return {
    SITE_NAME: String(siteConfig?.title || ""),
    SITE_DESCRIPTION: String(siteConfig?.description || ""),
    SITE_LANGUAGE: String(siteConfig?.default_language || "en"),
    SITE_FOOTER: String(jant.site_footer_markdown || ""),
    SHOW_JANT_BRANDING_ON_HOME: jant.show_jant_branding_on_home
      ? "true"
      : "false",
    NOINDEX: jant.noindex ? "true" : "false",
    PUBLIC_API_ENABLED: jant.public_api_enabled === false ? "false" : "true",
    RSS_FEEDS_ENABLED: jant.rss_feeds_enabled === false ? "false" : "true",
    SHOW_HEADER_AVATAR: jant.show_header_avatar ? "true" : "",
    THEME: themeId && themeId !== defaultThemeId ? themeId : "",
    FONT_THEME: fontThemeId && fontThemeId !== "default" ? fontThemeId : "",
    THEME_MODE: themeMode === "light" || themeMode === "dark" ? themeMode : "",
    CUSTOM_CSS: customCss,
  };
}

/**
 * Internal config keys that the site importer restores via the dedicated
 * `/api/settings/import` route. Must stay in sync with
 * `importableInternalSettingKeys` in `src/lib/api-settings.ts`.
 */
const IMPORTABLE_INTERNAL_SETTING_KEYS = new Set([
  "THEME",
  "FONT_THEME",
  "THEME_MODE",
  "CUSTOM_CSS",
  "SHOW_HEADER_AVATAR",
]);

function splitSettingsUpdatesForImport(updates) {
  const editable = {};
  const internal = {};
  for (const [key, value] of Object.entries(updates)) {
    if (IMPORTABLE_INTERNAL_SETTING_KEYS.has(key)) {
      internal[key] = value;
    } else {
      editable[key] = value;
    }
  }
  return { editable, internal };
}

const NAV_PLACEMENTS = new Set(["header", "more"]);
const NAV_ITEM_TYPES = new Set([
  "system",
  "link",
  "collection",
  "smart_collection",
  "page",
]);

/**
 * The slug a nav URL names, for exports older than `collection_slug` and
 * `post_slug`: `/now` or `/now/` → `now`. Anything else names no slug.
 *
 * @param {unknown} url - The exported nav URL
 * @returns {string | null} The slug, or null
 */
function getSlugFromNavUrl(url) {
  if (typeof url !== "string") return null;
  const match = url.match(/^\/([^/?#]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function normalizeImportedNavItems(siteConfig) {
  const jant = siteConfig?.extra?.jant || {};
  const navItems = jant.nav;
  if (!Array.isArray(navItems)) {
    return {
      exported: Boolean(jant.nav_exported),
      items: [],
    };
  }

  return {
    exported: true,
    items: navItems
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const type = NAV_ITEM_TYPES.has(item.type) ? item.type : "link";
        const placement = NAV_PLACEMENTS.has(item.placement)
          ? item.placement
          : "header";
        const label = typeof item.label === "string" ? item.label : "";
        const url = typeof item.url === "string" ? item.url : "";
        const customLabel =
          typeof item.custom_label === "string" && item.custom_label.trim()
            ? item.custom_label
            : null;

        if (type === "system") {
          if (typeof item.system_key !== "string" || !item.system_key) {
            return null;
          }
          return { type, systemKey: item.system_key, customLabel, placement };
        }
        if (type === "collection") {
          const slug =
            typeof item.collection_slug === "string"
              ? item.collection_slug
              : getSlugFromNavUrl(url);
          return { type, slug, customLabel, label, url, placement };
        }
        if (type === "page") {
          const slug =
            typeof item.post_slug === "string"
              ? item.post_slug
              : getSlugFromNavUrl(url);
          return { type, slug, customLabel, label, url, placement };
        }
        if (type === "smart_collection") {
          const slug =
            typeof item.smart_collection_slug === "string"
              ? item.smart_collection_slug
              : getSlugFromNavUrl(url);
          return { type, slug, customLabel, label, url, placement };
        }
        if (!label || !url) return null;
        return { type: "link", label: customLabel ?? label, url, placement };
      })
      .filter(Boolean),
  };
}

/**
 * The custom URLs an export lists that name no post or collection: redirects,
 * and legacy archive URLs the importer reports but can't recreate.
 *
 * @param {Record<string, unknown>} siteConfig - From `loadSiteConfig`
 * @returns {Array<{ path: string, kind: "redirect" | "archive", to?: string, status?: 301 | 302, archiveQuery?: string }>}
 */
function normalizeImportedCustomUrls(siteConfig) {
  const entries = siteConfig?.extra?.jant?.custom_urls;
  if (!Array.isArray(entries)) return [];

  return entries
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const path =
        typeof entry.path === "string" ? entry.path.replace(/^\/+/, "") : "";
      if (!path) return null;
      if (entry.kind === "redirect" && typeof entry.to === "string") {
        return {
          path,
          kind: "redirect",
          to: entry.to,
          status: entry.status === 302 ? 302 : 301,
        };
      }
      if (entry.kind === "archive") {
        return {
          path,
          kind: "archive",
          archiveQuery:
            typeof entry.archive_query === "string"
              ? entry.archive_query
              : undefined,
        };
      }
      return null;
    })
    .filter(Boolean);
}

/**
 * The create request for one imported nav item, once the posts and
 * collections it may point at exist. A target that didn't come across stays
 * in the navigation as a plain link to the same address.
 *
 * @param {Record<string, unknown>} item - From `normalizeImportedNavItems`
 * @param {{ collectionSlugToId: Map<string, string>, smartCollectionSlugToId: Map<string, string>, postSlugToId: Map<string, string> }} targets
 * @returns {{ payload: Record<string, unknown>, customLabel: string | null, warning: string | null }}
 */
function buildNavItemCreateRequest(item, targets) {
  const { placement, customLabel } = item;

  if (item.type === "system") {
    return {
      payload: { type: "system", systemKey: item.systemKey, placement },
      customLabel,
      warning: null,
    };
  }
  if (item.type === "link") {
    return {
      payload: { type: "link", label: item.label, url: item.url, placement },
      customLabel: null,
      warning: null,
    };
  }

  const targetId =
    item.type === "collection"
      ? targets.collectionSlugToId.get(item.slug)
      : item.type === "smart_collection"
        ? targets.smartCollectionSlugToId.get(item.slug)
        : item.type === "page"
          ? targets.postSlugToId.get(item.slug)
          : undefined;
  if (targetId) {
    const targetField =
      item.type === "collection"
        ? "collectionId"
        : item.type === "smart_collection"
          ? "smartCollectionId"
          : "postId";
    return {
      payload: {
        type: item.type,
        [targetField]: targetId,
        ...(customLabel ? { label: customLabel } : {}),
        placement,
      },
      customLabel: null,
      warning: null,
    };
  }

  return {
    payload: {
      type: "link",
      label: customLabel ?? item.label,
      url: item.url,
      placement,
    },
    customLabel: null,
    warning: `The ${item.type.replace("_", " ")} behind "${item.label}" wasn't imported; it stays in the navigation as a link to ${item.url}.`,
  };
}

/**
 * The create request for one exported smart collection.
 *
 * The conditions arrive as the export spells them, with the collection one
 * naming a slug; it becomes this site's ID. When that collection didn't come
 * across, the smart collection is skipped rather than created without the
 * condition, which would widen it to posts it never held.
 *
 * @param {{ slug: string, frontMatter: Record<string, unknown> }} bundle - A `type: smart_collection` section
 * @param {Map<string, string>} collectionSlugToId - Imported collections
 * @returns {{ payload: Record<string, unknown> | null, warning: string | null }}
 * @example
 * buildSmartCollectionCreateRequest(bundle, new Map([["ideas", "col_01…"]]));
 */
function buildSmartCollectionCreateRequest(bundle, collectionSlugToId) {
  const frontMatter = bundle.frontMatter;
  const exported = frontMatter.selection;
  const selection =
    exported && typeof exported === "object" && !Array.isArray(exported)
      ? { ...exported }
      : {};

  if (selection.collection !== undefined) {
    const collectionId =
      typeof selection.collection === "string"
        ? collectionSlugToId.get(selection.collection)
        : undefined;
    if (!collectionId) {
      return {
        payload: null,
        warning: `skipped the smart collection /${bundle.slug}: the collection it filters by, "${selection.collection}", wasn't imported.`,
      };
    }
    selection.collection = [collectionId];
  }

  const title =
    typeof frontMatter.title === "string" && frontMatter.title.trim()
      ? frontMatter.title
      : bundle.slug;
  return {
    payload: {
      slug: bundle.slug,
      title,
      ...(typeof frontMatter.summary_text === "string" &&
      frontMatter.summary_text.trim()
        ? { description: frontMatter.summary_text }
        : {}),
      selection,
      ...(typeof frontMatter.sort_order === "string"
        ? { sort: frontMatter.sort_order }
        : {}),
      ...(typeof frontMatter.display_layout === "string"
        ? { layout: frontMatter.display_layout }
        : {}),
    },
    warning: null,
  };
}

function normalizeImportedCollectionDirectory(siteConfig) {
  const jant = siteConfig?.extra?.jant || {};
  const directoryItems = jant.collections_directory;
  if (!Array.isArray(directoryItems)) {
    return {
      exported: Boolean(jant.collections_directory_exported),
      items: [],
    };
  }

  return {
    exported: true,
    items: directoryItems
      .map((item) => {
        if (!item || typeof item !== "object") return null;

        if (
          (item.type === "collection" || item.type === "smart_collection") &&
          typeof item.slug === "string" &&
          item.slug.trim()
        ) {
          return {
            type: item.type,
            slug: item.slug.trim(),
          };
        }

        if (item.type === "divider") {
          return {
            type: "divider",
            label: typeof item.label === "string" ? item.label : null,
          };
        }

        if (
          item.type === "link" &&
          typeof item.label === "string" &&
          typeof item.url === "string"
        ) {
          return {
            type: "link",
            label: item.label,
            url: item.url,
            description:
              typeof item.description === "string" && item.description.trim()
                ? item.description
                : null,
          };
        }

        return null;
      })
      .filter(Boolean),
  };
}

async function buildSiteAvatarImport(siteConfig, sourceRootDir) {
  const exportInfo = siteConfig?.extra?.jant_export || {};
  if (exportInfo.format !== "jant-site") {
    return null;
  }

  const jant = siteConfig?.extra?.jant || {};
  const siteAvatarMode =
    jant.site_avatar_mode === "custom" ||
    (typeof jant.site_avatar_url === "string" && jant.site_avatar_url.trim())
      ? "custom"
      : "none";
  const faviconMode = jant.favicon_mode === "custom" ? "custom" : "default";
  const appleTouchMode =
    jant.apple_touch_mode === "custom" ||
    (typeof jant.apple_touch_icon_url === "string" &&
      jant.apple_touch_icon_url.trim())
      ? "custom"
      : "default";

  if (siteAvatarMode !== "custom") {
    return { mode: "remove" };
  }

  if (!jant.site_avatar_url || typeof jant.site_avatar_url !== "string") {
    throw new Error(
      'Jant export marked site_avatar_mode="custom" but site_avatar_url is missing',
    );
  }

  const faviconRawUrl =
    faviconMode === "custom"
      ? typeof jant.favicon_url === "string" && jant.favicon_url.trim()
        ? jant.favicon_url
        : "/favicon.ico"
      : null;
  const appleTouchRawUrl =
    appleTouchMode === "custom"
      ? typeof jant.apple_touch_icon_url === "string" &&
        jant.apple_touch_icon_url.trim()
        ? jant.apple_touch_icon_url
        : "/apple-touch-icon.png"
      : null;

  return {
    mode: "set",
    avatarUrl: resolveImportUrl(jant.site_avatar_url, siteConfig),
    avatarFilePath: await resolveImportLocalAssetPath(
      jant.site_avatar_url,
      siteConfig,
      sourceRootDir,
    ),
    faviconUrl: faviconRawUrl
      ? resolveImportSiteAssetUrl(faviconRawUrl, siteConfig)
      : null,
    faviconFilePath: faviconRawUrl
      ? await resolveImportLocalAssetPath(
          faviconRawUrl,
          siteConfig,
          sourceRootDir,
        )
      : null,
    appleTouchUrl: appleTouchRawUrl
      ? resolveImportSiteAssetUrl(appleTouchRawUrl, siteConfig)
      : null,
    appleTouchFilePath: appleTouchRawUrl
      ? await resolveImportLocalAssetPath(
          appleTouchRawUrl,
          siteConfig,
          sourceRootDir,
        )
      : null,
  };
}

async function reorderCollectionDirectoryItems(target, orderedIds) {
  const dedupedIds = [];
  const seenIds = new Set();
  for (const id of orderedIds) {
    if (typeof id !== "string" || !id || seenIds.has(id)) continue;
    seenIds.add(id);
    dedupedIds.push(id);
  }

  let moves = 0;

  for (let index = 0; index < dedupedIds.length; index += 1) {
    const itemId = dedupedIds[index];
    const currentItems = await target.listCollectionDirectoryItems();
    const currentIds = currentItems.map((item) => item.id);
    const currentIndex = currentIds.indexOf(itemId);
    if (currentIndex === -1) continue;

    if (index === 0) {
      if (currentIndex === 0) continue;
      const beforeId = currentIds.find((id) => id !== itemId) ?? null;
      await target.moveCollectionDirectoryItem(itemId, null, beforeId);
      moves += 1;
      continue;
    }

    const afterId = dedupedIds[index - 1];
    const afterIndex = currentIds.indexOf(afterId);
    if (afterIndex === -1) continue;
    if (currentIds[afterIndex + 1] === itemId) continue;

    const beforeId =
      currentIds.slice(afterIndex + 1).find((id) => id !== itemId) ?? null;
    await target.moveCollectionDirectoryItem(itemId, afterId, beforeId);
    moves += 1;
  }

  return moves;
}

async function syncImportedCollectionDirectory(
  target,
  importedDirectory,
  collectionSlugToId,
  smartCollectionSlugToId,
) {
  if (!importedDirectory.exported) {
    return { created: 0, deleted: 0, moved: 0 };
  }

  let deleted = 0;
  const existingItems = await target.listCollectionDirectoryItems();
  // Collections and smart collections get their row when they are created;
  // dividers and links exist only in the directory and are rebuilt from it.
  for (const item of existingItems) {
    if (item.type === "collection" || item.type === "smart_collection") {
      continue;
    }
    const removed = await target.deleteCollectionDirectoryItem(item.id);
    if (removed !== false) {
      deleted += 1;
    }
  }

  let currentItems = await target.listCollectionDirectoryItems();
  // Directory rows by what they list: `collection:<id>` or
  // `smart_collection:<id>`.
  const rowIdsByTarget = new Map();
  for (const item of currentItems) {
    if (item.type === "collection" && item.collectionId) {
      rowIdsByTarget.set(`collection:${item.collectionId}`, item.id);
    } else if (item.type === "smart_collection" && item.smartCollectionId) {
      rowIdsByTarget.set(`smart_collection:${item.smartCollectionId}`, item.id);
    }
  }

  const desiredIds = [];
  const seenTargets = new Set();
  let created = 0;

  for (const item of importedDirectory.items) {
    if (item.type === "collection" || item.type === "smart_collection") {
      const targetId =
        item.type === "collection"
          ? collectionSlugToId.get(item.slug)
          : smartCollectionSlugToId.get(item.slug);
      const key = `${item.type}:${targetId}`;
      if (!targetId || seenTargets.has(key)) {
        continue;
      }
      seenTargets.add(key);
      const directoryItemId = rowIdsByTarget.get(key);
      if (directoryItemId) {
        desiredIds.push(directoryItemId);
      }
      continue;
    }

    const createdItem = await target.createCollectionDirectoryItem(
      item.type === "divider"
        ? {
            type: "divider",
            ...(item.label !== null ? { label: item.label } : {}),
          }
        : {
            type: "link",
            label: item.label,
            url: item.url,
            ...(item.description ? { description: item.description } : {}),
          },
    );
    desiredIds.push(createdItem.id);
    created += 1;
  }

  currentItems = await target.listCollectionDirectoryItems();
  const currentIds = currentItems.map((item) => item.id);
  const desiredIdSet = new Set(desiredIds);
  const moved = await reorderCollectionDirectoryItems(target, [
    ...desiredIds,
    ...currentIds.filter((id) => !desiredIdSet.has(id)),
  ]);

  return { created, deleted, moved };
}

function buildIncompleteSetupError(targetLabel) {
  return [
    `${targetLabel} has not completed setup.`,
    "Finish /setup first to create the site and admin account, then run the import again.",
    "Until setup is finished, imports cannot write site settings, navigation, collections, or posts.",
  ].join("\n");
}

async function detectRemoteSetupStatus(apiUrl) {
  try {
    const response = await fetch(`${apiUrl}/setup`, {
      redirect: "manual",
    });

    if (response.status === 200) {
      return false;
    }

    if (response.status >= 300 && response.status < 400) {
      return true;
    }
  } catch {
    return null;
  }

  return null;
}

async function getIncompleteSetupError(target, targetLabel) {
  const isSetupComplete = await target.getSetupStatus();
  if (isSetupComplete !== false) {
    return null;
  }

  return buildIncompleteSetupError(targetLabel);
}

class ApiError extends Error {
  constructor(status, text) {
    super(`HTTP ${status}: ${text}`);
    this.status = status;
  }
}

async function apiCall(method, path, apiUrl, token, body) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  let response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    const cause = err.cause?.code || err.cause?.message || err.message;
    if (
      cause === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
      cause?.includes("certificate")
    ) {
      console.error(`\nCertificate error connecting to ${apiUrl}`);
      console.error(
        "The certificate is not signed by a CA that Node trusts. For a local",
      );
      console.error("or self-signed target, trust this machine's CA store:");
      console.error("  NODE_OPTIONS=--use-system-ca jant site import ...");
      process.exit(1);
    }
    throw new Error(
      `Network error calling ${method} ${apiUrl}${path}: ${cause}`,
    );
  }

  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(response.status, text);
  }

  return response.json();
}

function toRemotePostPayload(data) {
  if (data?.format !== "quote") {
    return data;
  }

  const { title, url, ...rest } = data;
  return {
    ...rest,
    ...(typeof title === "string" && title.trim() ? { sourceName: title } : {}),
    ...(typeof url === "string" && url.trim() ? { sourceUrl: url } : {}),
  };
}

function createRemoteTarget(apiUrl, token) {
  return {
    async close() {},
    async getSetupStatus() {
      return detectRemoteSetupStatus(apiUrl);
    },
    async updateSettings(updates) {
      return apiCall("PUT", "/api/settings", apiUrl, token, updates);
    },
    async updateImportSettings(updates) {
      return apiCall("PUT", "/api/settings/import", apiUrl, token, updates);
    },
    async listNavItems() {
      const result = await apiCall("GET", "/api/nav-items", apiUrl, token);
      return result.navItems || [];
    },
    async createNavItem(data) {
      return apiCall("POST", "/api/nav-items", apiUrl, token, data);
    },
    async deleteNavItem(id) {
      return apiCall("DELETE", `/api/nav-items/${id}`, apiUrl, token);
    },
    async updateNavItem(id, data) {
      return apiCall("PUT", `/api/nav-items/${id}`, apiUrl, token, data);
    },
    async createCustomUrl(data) {
      return apiCall("POST", "/api/custom-urls", apiUrl, token, data);
    },
    async removeSiteAvatar() {
      return apiCall("DELETE", "/api/settings/avatar", apiUrl, token);
    },
    async uploadSiteAvatar(data) {
      const avatarAsset = await readImportAsset({
        sourceUrl: data.avatarUrl,
        sourceFilePath: data.avatarFilePath,
      });
      if (!avatarAsset) {
        throw new Error(`Failed to read site avatar: ${data.avatarUrl}`);
      }

      const formData = new FormData();
      formData.append("file", avatarAsset.blob, avatarAsset.filename);

      if (data.faviconUrl || data.faviconFilePath) {
        const faviconAsset = await readImportAsset({
          sourceUrl: data.faviconUrl,
          sourceFilePath: data.faviconFilePath,
          mimeType: "image/x-icon",
          originalName: "favicon.ico",
        });
        if (faviconAsset) {
          formData.append("favicon", faviconAsset.blob, faviconAsset.filename);
        }
      }

      if (data.appleTouchUrl) {
        const appleTouchAsset = await readImportAsset({
          sourceUrl: data.appleTouchUrl,
          sourceFilePath: data.appleTouchFilePath,
        });
        if (appleTouchAsset) {
          formData.append(
            "appleTouch",
            appleTouchAsset.blob,
            appleTouchAsset.filename,
          );
        }
      }

      const response = await fetch(`${apiUrl}/api/settings/avatar`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      return response.json();
    },
    async syncSiteAvatar(data) {
      await this.removeSiteAvatar();
      if (!data) {
        return { success: true };
      }
      return this.uploadSiteAvatar(data);
    },
    async listCollections() {
      const existing = await apiCall("GET", "/api/collections", apiUrl, token);
      return existing.collections || [];
    },
    async listCollectionDirectoryItems() {
      const existing = await apiCall("GET", "/api/collections", apiUrl, token);
      return existing.directoryItems || [];
    },
    async createCollection(data) {
      return apiCall("POST", "/api/collections", apiUrl, token, data);
    },
    async listSmartCollections() {
      const result = await apiCall(
        "GET",
        "/api/smart-collections",
        apiUrl,
        token,
      );
      return result.smartCollections || [];
    },
    async createSmartCollection(data) {
      const result = await apiCall(
        "POST",
        "/api/smart-collections",
        apiUrl,
        token,
        data,
      );
      return result.smartCollection;
    },
    async createCollectionDirectoryItem(data) {
      return apiCall(
        "POST",
        "/api/collections/directory-items",
        apiUrl,
        token,
        data,
      );
    },
    async moveCollectionDirectoryItem(id, after, before) {
      return apiCall(
        "PUT",
        `/api/collections/directory-items/${id}/move`,
        apiUrl,
        token,
        { after, before },
      );
    },
    async deleteCollectionDirectoryItem(id) {
      return apiCall(
        "DELETE",
        `/api/collections/directory-items/${id}`,
        apiUrl,
        token,
      );
    },
    async createPost(data) {
      return apiCall(
        "POST",
        "/api/posts",
        apiUrl,
        token,
        toRemotePostPayload(data),
      );
    },
    async linkTranslation(postId, otherPostId) {
      return apiCall(
        "POST",
        `/api/posts/${postId}/translations`,
        apiUrl,
        token,
        { postId: otherPostId },
      );
    },
    async createAlias(path, targetSlug) {
      return apiCall("POST", "/api/custom-urls", apiUrl, token, {
        path,
        targetType: "post",
        targetId: targetSlug,
      });
    },
    async uploadMedia(media) {
      return uploadRemoteMedia(media, apiUrl, token);
    },
    async checkPostSlugAvailability(slug) {
      const result = await apiCall(
        "GET",
        `/api/posts/slug?mode=check&slug=${encodeURIComponent(slug)}`,
        apiUrl,
        token,
      );
      return Boolean(result.available);
    },
  };
}

function getBundleTimestamp(bundle) {
  return parseImportTimestamp(bundle.frontMatter.date);
}

function getBundleSourceId(bundle) {
  return typeof bundle.frontMatter.id === "string" ? bundle.frontMatter.id : "";
}

/**
 * Order bundles by `date`, then by the original TypeID (time-sortable, so it
 * breaks a same-second tie the way the source site did), then by directory.
 *
 * @param {{ frontMatter: Record<string, unknown>, dir: string }} a
 * @param {{ frontMatter: Record<string, unknown>, dir: string }} b
 * @returns {number} Negative when `a` comes first
 */
function compareBundlesByDateThenId(a, b) {
  const aDate = getBundleTimestamp(a);
  const bDate = getBundleTimestamp(b);
  if (aDate !== null && bDate !== null && aDate !== bDate) return aDate - bDate;
  if (aDate !== null && bDate === null) return -1;
  if (aDate === null && bDate !== null) return 1;

  const aId = getBundleSourceId(a);
  const bId = getBundleSourceId(b);
  if (aId && bId && aId !== bId) return aId < bId ? -1 : 1;

  return basename(a.dir).localeCompare(basename(b.dir));
}

/**
 * Order reply bundles by their exported `weight` (position in the Thread),
 * falling back to {@link compareBundlesByDateThenId} for older exports.
 *
 * @param {{ frontMatter: Record<string, unknown>, dir: string }} a
 * @param {{ frontMatter: Record<string, unknown>, dir: string }} b
 * @returns {number} Negative when `a` comes first
 */
function compareReplyBundles(a, b) {
  const aWeight = a.frontMatter.weight;
  const bWeight = b.frontMatter.weight;
  if (
    typeof aWeight === "number" &&
    typeof bWeight === "number" &&
    aWeight !== bWeight
  ) {
    return aWeight - bWeight;
  }
  return compareBundlesByDateThenId(a, b);
}

/**
 * Walk `content/` and classify each `_index.md` / `index.md` bundle by its
 * front-matter `type`. Returns ordered root-post bundles (with child reply
 * bundles attached), collection landing pages, and smart collection pages.
 *
 * Algorithm:
 *   1. Recurse into `content/` collecting every directory that has either
 *      `_index.md` (branch bundle / section) or `index.md` (leaf bundle).
 *   2. For each `_index.md`, read front matter. `type: "post"` (or a
 *      missing `type` with post-shaped keys) → root bundle. `type:
 *      "collection"` → collection landing page, `type: "smart_collection"` →
 *      smart collection conditions. Other known section types
 *      (`home`, `featured`, `archive`, `collections`) are recorded and
 *      skipped for post import.
 *   3. For each root bundle, enumerate immediate child directories; any
 *      child dir containing `index.md` becomes a reply leaf bundle.
 *   4. Reply bundles are sorted by `weight` (Thread position), then `date`,
 *      then the original ID; root bundles by `date`, then the original ID.
 *      Creating posts in that order keeps same-second ties as they were.
 */
async function walkHugoContent(rootDir) {
  const contentDir = join(rootDir, "content");
  const contentStat = await stat(contentDir).catch(() => null);
  if (!contentStat?.isDirectory()) {
    console.error(`No content/ directory found in ${rootDir}`);
    process.exit(1);
  }

  // Map of absolute dir → { frontMatter, body, kind, slug, dir, children[] }
  const dirs = new Map();

  async function readBundle(dir, fileName) {
    const filePath = join(dir, fileName);
    const content = await readFile(filePath, "utf-8").catch(() => null);
    if (content === null) return null;
    const { frontMatter, body } = await parseFrontMatter(content);
    return { frontMatter, body };
  }

  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(
      () => null,
    );
    if (!entries) return;

    const hasIndex = entries.some(
      (entry) => entry.isFile() && entry.name === "_index.md",
    );
    const hasLeaf = entries.some(
      (entry) => entry.isFile() && entry.name === "index.md",
    );

    if (hasIndex) {
      const parsed = await readBundle(dir, "_index.md");
      if (parsed) {
        const type =
          typeof parsed.frontMatter.type === "string"
            ? parsed.frontMatter.type
            : null;
        const slug =
          typeof parsed.frontMatter.slug === "string"
            ? parsed.frontMatter.slug
            : basename(dir);
        dirs.set(dir, {
          kind: type || "post",
          slug,
          dir,
          frontMatter: parsed.frontMatter,
          body: parsed.body,
          file: "_index.md",
          children: [],
        });
      }
    } else if (hasLeaf) {
      const parsed = await readBundle(dir, "index.md");
      if (parsed) {
        const slug =
          typeof parsed.frontMatter.slug === "string"
            ? parsed.frontMatter.slug
            : basename(dir);
        dirs.set(dir, {
          kind: "leaf",
          slug,
          dir,
          frontMatter: parsed.frontMatter,
          body: parsed.body,
          file: "index.md",
          children: [],
        });
      }
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name));
      }
    }
  }

  await walk(contentDir);

  // Attach leaf children to their parent root bundles.
  const rootBundles = [];
  const collectionBundles = [];
  const smartCollectionBundles = [];

  for (const record of dirs.values()) {
    if (record.kind === "leaf") {
      const parentDir = dirname(record.dir);
      const parent = dirs.get(parentDir);
      if (parent && (parent.kind === "post" || parent.kind === null)) {
        parent.children.push(record);
      }
      continue;
    }
    if (record.kind === "collection") {
      collectionBundles.push(record);
      continue;
    }
    if (record.kind === "smart_collection") {
      smartCollectionBundles.push(record);
      continue;
    }
    if (record.kind === "post") {
      rootBundles.push(record);
      continue;
    }
    // home / featured / archive / collections / anything else — skip.
  }

  // Replies in Thread order: the exported `weight`, which follows Jant's own
  // order (creation time, then ID). Older exports have no weight; `date` then
  // the original ID come next, since replies written in one second tie on
  // `date`, and the directory name last.
  for (const root of rootBundles) {
    root.children.sort(compareReplyBundles);
  }

  // Roots in creation order, oldest first, so the new IDs keep the original
  // order among posts that share a second: lists break those ties by ID.
  rootBundles.sort(compareBundlesByDateThenId);

  return { rootBundles, collectionBundles, smartCollectionBundles };
}

/**
 * Resolve the collection memberships listed in a post bundle's top-level
 * `collections:` front-matter array into `{collectionId, createdAt,
 * position, pinnedAt}` records the post-create APIs expect.
 *
 * Drops entries whose slug doesn't map to a known collection — the
 * importer prints no warning (collections without slugs are already
 * filtered by the exporter).
 */
function resolveCollectionMemberships(frontMatter, collectionSlugToId) {
  const collections = Array.isArray(frontMatter.collections)
    ? frontMatter.collections
    : [];
  const entries = [];
  const ids = [];
  for (const raw of collections) {
    if (!raw || typeof raw.slug !== "string") continue;
    const id = collectionSlugToId.get(raw.slug);
    if (!id) continue;
    const entry = { collectionId: id };
    const createdAt = parseImportTimestamp(raw.collected_at);
    if (createdAt !== null) {
      entry.createdAt = createdAt;
    }
    if (typeof raw.position === "number" && Number.isFinite(raw.position)) {
      entry.position = raw.position;
    }
    const pinnedAt = parseImportTimestamp(raw.pinned_at);
    if (pinnedAt !== null) {
      entry.pinnedAt = pinnedAt;
    }
    entries.push(entry);
    ids.push(id);
  }
  return { entries, ids };
}

/**
 * Resolve one Thread's collection memberships from its root and every reply.
 *
 * Current exports write `collections:` only on the root bundle. Older exports
 * wrote it per post, so import must take the union before creating the root.
 * Duplicate memberships retain all historical information by taking the
 * greatest collected/pinned timestamps and the smallest position.
 */
function resolveThreadCollectionMemberships(rootBundle, collectionSlugToId) {
  const byCollectionId = new Map();
  const bundles = [rootBundle, ...(rootBundle.children ?? [])];

  for (const bundle of bundles) {
    const { entries } = resolveCollectionMemberships(
      bundle.frontMatter,
      collectionSlugToId,
    );

    for (const entry of entries) {
      const current = byCollectionId.get(entry.collectionId);
      if (!current) {
        byCollectionId.set(entry.collectionId, { ...entry });
        continue;
      }

      if (entry.createdAt !== undefined) {
        current.createdAt =
          current.createdAt === undefined
            ? entry.createdAt
            : Math.max(current.createdAt, entry.createdAt);
      }
      if (entry.position !== undefined) {
        current.position =
          current.position === undefined
            ? entry.position
            : Math.min(current.position, entry.position);
      }
      if (entry.pinnedAt !== undefined) {
        current.pinnedAt =
          current.pinnedAt === undefined
            ? entry.pinnedAt
            : Math.max(current.pinnedAt, entry.pinnedAt);
      }
    }
  }

  const entries = [...byCollectionId.values()];
  return {
    entries,
    ids: entries.map((entry) => entry.collectionId),
  };
}

function parseImportTimestamp(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null;
}

function getImportedRootLastActivityAt(frontMatter) {
  return (
    parseImportTimestamp(frontMatter.last_activity_at) ??
    parseImportTimestamp(frontMatter.date)
  );
}

function getImportedPostStatus(frontMatter) {
  if (frontMatter.status === "draft" || frontMatter.status === "published") {
    return frontMatter.status;
  }
  return frontMatter.draft ? "draft" : "published";
}

function shouldImportReplyQuietly(rootFrontMatter, replyFrontMatter) {
  if (getImportedPostStatus(replyFrontMatter) !== "published") return false;

  // Exports since quiet_reply became a stored column say so explicitly.
  if (typeof replyFrontMatter.quiet_reply === "boolean") {
    return replyFrontMatter.quiet_reply;
  }

  // Older bundles: a reply published after the root's recorded last activity
  // can only have gotten there by skipping the bump, so it was quiet.
  const rootLastActivityAt = getImportedRootLastActivityAt(rootFrontMatter);
  const replyPublishedAt = parseImportTimestamp(replyFrontMatter.date);
  return (
    rootLastActivityAt !== null &&
    replyPublishedAt !== null &&
    replyPublishedAt > rootLastActivityAt
  );
}

/**
 * The post a Thread's next reply has to answer: the site's rule, the last post
 * in Thread order. The root comes first whatever its creation time, so the
 * first reply always ends the Thread; after that the newest reply by creation
 * time, then by ID, does.
 *
 * @param {{ id: string, createdAt: number, replyToId?: string | null }} tail - The current end
 * @param {{ id: string, createdAt: number, replyToId?: string | null } | null | undefined} created - The post just created
 * @returns {{ id: string, createdAt: number, replyToId?: string | null }} The new end
 * @example
 * getNextThreadTail(
 *   { id: "root", createdAt: 20, replyToId: null },
 *   { id: "r1", createdAt: 10, replyToId: "root" },
 * );
 * // r1: a reply older than the root still ends the Thread
 */
function getNextThreadTail(tail, created) {
  if (!created?.id) return tail;
  return compareThreadOrder(created, tail) > 0 ? created : tail;
}

/**
 * Compare two posts of one Thread the way the site orders them (`threadOrder`
 * in the post service): the root first, then creation time, then ID.
 *
 * @param {{ id: string, createdAt: number, replyToId?: string | null }} a
 * @param {{ id: string, createdAt: number, replyToId?: string | null }} b
 * @returns {number} Negative when `a` comes first, positive when `b` does
 * @example
 * compareThreadOrder({ id: "r1", createdAt: 10, replyToId: "root" },
 *   { id: "root", createdAt: 20, replyToId: null }); // 1
 */
function compareThreadOrder(a, b) {
  const rank = (post) => (post.replyToId ? 1 : 0);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Build the payload for `target.createPost()` from a parsed bundle. Works
 * for both root bundles (`forReply: false`) and reply leaf bundles — the
 * front-matter shape is identical aside from `build:` and the parent link.
 */
function buildPostPayloadFromBundle(bundle, options) {
  const { frontMatter } = bundle;
  const format =
    typeof frontMatter.format === "string" ? frontMatter.format : "note";
  const slug =
    typeof frontMatter.slug === "string" ? frontMatter.slug : undefined;
  const status =
    frontMatter.status === "draft" || frontMatter.status === "published"
      ? frontMatter.status
      : frontMatter.draft
        ? "draft"
        : "published";
  // Accept every canonical visibility value (see `VISIBILITIES` in
  // `src/types/constants.ts`). Anything else — or missing — falls back to
  // the service default (`public`).
  const visibility =
    frontMatter.visibility === "public" ||
    frontMatter.visibility === "latest_hidden" ||
    frontMatter.visibility === "private"
      ? frontMatter.visibility
      : undefined;
  const { entries: collectionEntries, ids: collectionIds } =
    options.memberships;

  const data = {
    format,
    title:
      format === "quote"
        ? typeof frontMatter.source_name === "string"
          ? frontMatter.source_name
          : undefined
        : typeof frontMatter.title === "string"
          ? frontMatter.title
          : undefined,
    bodyMarkdown: options.bodyMarkdown || undefined,
    slug,
    status,
    visibility,
    collectionIds:
      collectionEntries.length === 0 && collectionIds.length > 0
        ? collectionIds
        : undefined,
    collectionEntries:
      collectionEntries.length > 0 ? collectionEntries : undefined,
    attachments:
      options.attachments.length > 0 ? options.attachments : undefined,
    publishedAt:
      status === "published" && typeof frontMatter.date === "string"
        ? Math.floor(new Date(frontMatter.date).getTime() / 1000)
        : undefined,
    // `date` holds the publish time of a published post and the creation
    // time of a draft; `created` and `updated` are written when they differ.
    createdAt:
      parseImportTimestamp(frontMatter.created) ??
      parseImportTimestamp(frontMatter.date) ??
      undefined,
    updatedAt:
      parseImportTimestamp(frontMatter.updated) ??
      parseImportTimestamp(frontMatter.date) ??
      undefined,
    featuredAt:
      typeof frontMatter.featured_at === "string" && frontMatter.featured_at
        ? Math.floor(new Date(frontMatter.featured_at).getTime() / 1000)
        : undefined,
    pinnedAt:
      typeof frontMatter.pinned_at === "string" && frontMatter.pinned_at
        ? Math.floor(new Date(frontMatter.pinned_at).getTime() / 1000)
        : undefined,
    rating:
      typeof frontMatter.rating === "number" ? frontMatter.rating : undefined,
    // Roots only: replies take the root's language from the service, and a
    // reply bundle has no language of its own in the export.
    language:
      !options.replyToId && typeof frontMatter.language === "string"
        ? frontMatter.language
        : undefined,
    quietReply: options.quietReply ? true : undefined,
  };

  if (options.replyToId) {
    data.replyToId = options.replyToId;
  }

  if (format === "link" && typeof frontMatter.link_url === "string") {
    data.url = frontMatter.link_url;
  }
  if (format === "quote") {
    if (typeof frontMatter.quote_text === "string") {
      data.quoteText = frontMatter.quote_text;
    }
    if (
      typeof frontMatter.source_url === "string" &&
      frontMatter.source_url.trim()
    ) {
      data.url = frontMatter.source_url;
    }
  }

  return data;
}

export const __test__ = {
  isAbsoluteImportUrl,
  resolveImportUrl,
  readMediaSpecAsset,
  normalizeMediaSpec,
  normalizeTextAttachmentSpec,
  extractAttachmentBlocks,
  buildImportedAttachments,
  uploadMediaList,
  uploadBundleResources,
  buildSettingsUpdatesFromConfig,
  splitSettingsUpdatesForImport,
  normalizeImportedNavItems,
  buildNavItemCreateRequest,
  buildSmartCollectionCreateRequest,
  normalizeImportedCustomUrls,
  normalizeImportedCollectionDirectory,
  buildSiteAvatarImport,
  reorderCollectionDirectoryItems,
  syncImportedCollectionDirectory,
  getRootAliasPathsForImport,
  toRemotePostPayload,
  buildIncompleteSetupError,
  detectRemoteSetupStatus,
  getIncompleteSetupError,
  loadSiteConfig,
  checkSiteExportVersion,
  walkHugoContent,
  mediaSpecFromJantMedia,
  resolveCollectionMemberships,
  resolveThreadCollectionMemberships,
  buildPostPayloadFromBundle,
  shouldImportReplyQuietly,
  getNextThreadTail,
};

function printImportUsage() {
  console.log("Usage: jant site import --url <url> [options]");
  console.log("");
  console.log("Import a Hugo export directory or ZIP into a Jant site.");
  console.log("");
  console.log("Options:");
  console.log("  --url         Jant site URL (required)");
  console.log(
    "  --path        Path to export directory or ZIP file (default: .)",
  );
  console.log("  --dry-run     Parse and validate without making API calls");
  console.log(
    "  --skip-remote-media  Skip uploading absolute-URL images found in body (relative paths and declared media still import)",
  );
  console.log("  --token       API token (overrides JANT_API_TOKEN)");
  console.log("");
  console.log(
    "Import expects an empty target site and fails on slug or alias conflicts.",
  );
  console.log("");
  console.log("Authentication:");
  console.log(`  export ${CLI_API_TOKEN_ENV_VAR}=jnt_your_token`);
  console.log(
    "  jant site import --url https://your-site.example --path ./export",
  );
  console.log("");
  console.log("Examples:");
  console.log(
    "  jant site import --url https://your-site.example --path ./jant-site",
  );
  console.log(
    "  jant site import --url https://your-site.example --path ./jant-site-export.zip",
  );
}

export async function run(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      url: { type: "string" },
      token: { type: "string" },
      path: { type: "string", default: "." },
      "dry-run": { type: "boolean", default: false },
      "skip-remote-media": { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    printImportUsage();
    process.exit(0);
  }

  const positionalError = findPositionalUrl("site import", positionals);
  if (positionalError) {
    console.error(`Error: ${positionalError}`);
    process.exit(1);
  }

  const url = values.url?.trim();
  if (!url) {
    console.error("Error: --url is required");
    console.error("");
    printImportUsage();
    process.exit(1);
  }

  const dryRun = values["dry-run"];
  const token = getCliApiToken(process.env, values.token);
  if (!token && !dryRun) {
    console.error(
      `Error: site import requires ${CLI_API_TOKEN_ENV_VAR} or --token (unless using --dry-run)`,
    );
    console.error("");
    console.error(`  export ${CLI_API_TOKEN_ENV_VAR}=jnt_your_token`);
    process.exit(1);
  }

  const apiUrl = url.replace(/\/$/, "");
  const skipRemoteMedia = values["skip-remote-media"];
  const target = dryRun ? null : createRemoteTarget(apiUrl, token);
  /** Exported translation-group ID → IDs of the posts created for it. */
  const translationGroups = new Map();

  // 1. Read source — directory or ZIP
  const inputPath = resolve(process.cwd(), values.path);
  const inputStat = await stat(inputPath).catch(() => null);

  if (!inputStat) {
    console.error(`Path not found: ${inputPath}`);
    process.exit(1);
  }

  let sourceRootDir = inputPath;
  let tempSourceRootDir = null;

  if (inputStat.isFile()) {
    console.log(`Reading ZIP ${inputPath}...`);
    tempSourceRootDir = await mkdtemp(join(tmpdir(), "jant-site-import-"));
    sourceRootDir = tempSourceRootDir;
    await extractZipFile(inputPath, sourceRootDir);
  } else {
    console.log(`Reading directory ${inputPath}...`);
  }

  const { rootBundles, collectionBundles, smartCollectionBundles } =
    await walkHugoContent(sourceRootDir);
  const siteConfig = await loadSiteConfig(sourceRootDir);
  const versionError = checkSiteExportVersion(siteConfig);
  if (versionError) {
    console.error(`Error: ${versionError}`);
    if (tempSourceRootDir) {
      await rm(tempSourceRootDir, { recursive: true, force: true });
    }
    process.exit(1);
  }
  const customCss = await readImportCustomCss(sourceRootDir);

  try {
    const replyCount = rootBundles.reduce(
      (sum, root) => sum + root.children.length,
      0,
    );
    console.log(
      `Found ${rootBundles.length} posts (+${replyCount} replies), ${collectionBundles.length} collections, and ${smartCollectionBundles.length} smart collections`,
    );
    const importedCollectionDirectory = siteConfig
      ? normalizeImportedCollectionDirectory(siteConfig)
      : { exported: false, items: [] };
    const importedNav = siteConfig
      ? normalizeImportedNavItems(siteConfig)
      : { exported: false, items: [] };
    const importedCustomUrls = siteConfig
      ? normalizeImportedCustomUrls(siteConfig)
      : [];

    if (target) {
      const setupError = await getIncompleteSetupError(
        target,
        `Target site at ${apiUrl}`,
      );
      if (setupError) {
        console.error("");
        console.error(setupError);
        console.error("");
        process.exit(1);
      }
    }

    if (siteConfig) {
      const settingsUpdates = buildSettingsUpdatesFromConfig(
        siteConfig,
        customCss,
      );
      const avatarImport = await buildSiteAvatarImport(
        siteConfig,
        sourceRootDir,
      );

      if (dryRun) {
        console.log("[dry-run] Would apply exported site settings");
        if (importedNav.exported) {
          console.log(
            `[dry-run] Would replace navigation with ${importedNav.items.length} items`,
          );
        }
        if (avatarImport) {
          if (avatarImport.mode === "remove") {
            console.log("[dry-run] Would remove existing site avatar");
          } else {
            console.log("[dry-run] Would import exported site avatar");
          }
        }
      } else {
        const { editable, internal } =
          splitSettingsUpdatesForImport(settingsUpdates);
        try {
          const result = await target.updateSettings(editable);
          if (result?.rejectedKeys?.length) {
            console.warn(
              `Warning: Some site settings were rejected: ${result.rejectedKeys.join(", ")}`,
            );
          }
        } catch (err) {
          console.error(
            `Error applying exported site settings: ${err.message}`,
          );
          process.exit(1);
        }

        if (Object.keys(internal).length > 0) {
          try {
            const result = await target.updateImportSettings(internal);
            if (result?.rejectedKeys?.length) {
              console.warn(
                `Warning: Some internal site settings were rejected: ${result.rejectedKeys.join(", ")}`,
              );
            }
          } catch (err) {
            console.error(
              `Error applying exported internal site settings: ${err.message}`,
            );
            process.exit(1);
          }
        }

        if (avatarImport) {
          try {
            await target.syncSiteAvatar(
              avatarImport.mode === "set" ? avatarImport : null,
            );
          } catch (err) {
            // Non-fatal: continue the rest of the import even if the avatar
            // source asset is unreachable (e.g. unreadable file, stale URL).
            // The rest of the site data is far more valuable than losing the
            // entire import over a single image.
            console.warn(
              `Warning: Could not import site avatar — continuing without it. (${err.message})`,
            );
          }
        }
      }
    }

    // 3. Fetch existing collections and create missing ones
    const collectionSlugToId = new Map();
    // Root posts by slug, for navigation entries that point at a page.
    const postSlugToId = new Map();

    if (!dryRun) {
      try {
        const existingCollections = await target.listCollections();
        for (const col of existingCollections) {
          collectionSlugToId.set(col.slug, col.id);
        }
      } catch (err) {
        console.error(`Error fetching existing collections: ${err.message}`);
        process.exit(1);
      }
    }

    for (const bundle of collectionBundles) {
      const slug = bundle.slug;

      if (collectionSlugToId.has(slug)) {
        console.error(
          `Import conflict: collection slug "${slug}" is already in use. Import into an empty site or remove the existing collection first.`,
        );
        process.exit(1);
      }

      if (dryRun) {
        console.log(
          `[dry-run] Would create collection: ${bundle.frontMatter.title || slug}`,
        );
        collectionSlugToId.set(slug, `dry-run-${slug}`);
        continue;
      }

      try {
        const result = await target.createCollection({
          title: bundle.frontMatter.title || slug,
          slug,
          description:
            typeof bundle.frontMatter.summary_text === "string"
              ? bundle.frontMatter.summary_text
              : undefined,
          sortOrder:
            typeof bundle.frontMatter.sort_order === "string"
              ? bundle.frontMatter.sort_order
              : undefined,
        });
        collectionSlugToId.set(slug, result.id);
        console.log(`Created collection: ${bundle.frontMatter.title || slug}`);
      } catch (err) {
        console.error(`Error creating collection "${slug}": ${err.message}`);
        process.exit(1);
      }
    }

    // Smart collections after collections, which their conditions may name.
    // They hold no posts, so nothing about them waits for the posts below.
    const smartCollectionSlugToId = new Map();
    if (!dryRun) {
      try {
        for (const existing of await target.listSmartCollections()) {
          smartCollectionSlugToId.set(existing.slug, existing.id);
        }
      } catch (err) {
        console.error(
          `Error fetching existing smart collections: ${err.message}`,
        );
        process.exit(1);
      }
    }

    for (const bundle of smartCollectionBundles) {
      const slug = bundle.slug;
      if (smartCollectionSlugToId.has(slug)) {
        console.error(
          `Import conflict: smart collection slug "${slug}" is already in use. Import into an empty site or remove the existing smart collection first.`,
        );
        process.exit(1);
      }

      const request = buildSmartCollectionCreateRequest(
        bundle,
        collectionSlugToId,
      );
      if (!request.payload) {
        console.warn(`Warning: ${request.warning}`);
        continue;
      }

      if (dryRun) {
        console.log(
          `[dry-run] Would create smart collection: ${request.payload.title}`,
        );
        smartCollectionSlugToId.set(slug, `dry-run-${slug}`);
        continue;
      }

      try {
        const created = await target.createSmartCollection(request.payload);
        smartCollectionSlugToId.set(slug, created.id);
        console.log(`Created smart collection: ${request.payload.title}`);
      } catch (err) {
        console.error(
          `Error creating smart collection "${slug}": ${err.message}`,
        );
        process.exit(1);
      }
    }

    if (importedCollectionDirectory.exported) {
      if (dryRun) {
        console.log(
          `[dry-run] Would restore collection directory with ${importedCollectionDirectory.items.length} items`,
        );
      } else {
        try {
          await syncImportedCollectionDirectory(
            target,
            importedCollectionDirectory,
            collectionSlugToId,
            smartCollectionSlugToId,
          );
        } catch (err) {
          console.error(
            `Error restoring collections directory: ${err.message}`,
          );
          process.exit(1);
        }
      }
    }

    // 4. Process posts — root bundle first, then each reply leaf, then aliases.
    let postsCreated = 0;
    let repliesCreated = 0;
    let mediaUploaded = 0;
    let aliasesCreated = 0;

    for (const rootBundle of rootBundles) {
      const { frontMatter: rootFm } = rootBundle;
      const postSlug = rootBundle.slug;
      const format = typeof rootFm.format === "string" ? rootFm.format : "note";
      const postLabel =
        (format === "quote"
          ? typeof rootFm.source_name === "string"
            ? rootFm.source_name
            : null
          : typeof rootFm.title === "string"
            ? rootFm.title
            : null) ||
        postSlug ||
        "(untitled)";

      if (!dryRun) {
        await assertImportSlugAvailable(target, postSlug, postLabel, "post");
      }

      // Normalize body + extract embedded attachment blocks.
      const normalizedRoot = normalizeImportedBodySegment(rootBundle.body);
      let rootBody = normalizedRoot.markdown;
      let importedAttachments = [];

      // Upload media declared in flat `media:` front matter. Each entry's
      // `src` is either a site-relative path (bytes under `static/`) or an
      // absolute URL (media still served by the original provider).
      // Text attachments (`kind: "text"`) live under the same `media:` key
      // but must be imported via `normalizeTextAttachmentSpec` so the body
      // is decoded and stored as a text attachment rather than uploaded as
      // a generic media file.
      const rootResourceSpecs = [];
      const rootTextAttachmentEntries = [];
      if (Array.isArray(rootFm.media)) {
        for (const entry of rootFm.media) {
          if (entry && typeof entry === "object" && entry.kind === "text") {
            rootTextAttachmentEntries.push(entry);
            continue;
          }
          const spec = await mediaSpecFromJantMedia(entry, sourceRootDir);
          if (spec) rootResourceSpecs.push(spec);
        }
      }

      const rootResourceIds = [];
      if (!dryRun && rootResourceSpecs.length > 0) {
        const result = await uploadBundleResources(rootResourceSpecs, target);
        mediaUploaded += result.uploaded;
        if (result.urlMap.size > 0) {
          rootBody = rewriteMediaReferences(rootBody, result.urlMap);
        }
        rootResourceIds.push(...result.mediaIds);
      }

      // Fallback: rewrite any leftover in-body image URLs (covers hand-
      // authored Hugo content where the exporter didn't declare resources).
      // `--skip-remote-media` filters out absolute URLs here so we only
      // rehost relative paths (the source site's own files).
      if (!dryRun) {
        const fallbackUrls = findImageUrls(rootBody).filter(
          (url) => !skipRemoteMedia || !isAbsoluteImportUrl(url),
        );
        const imageMedia = fallbackUrls.map((src) => ({ src }));
        const uploadResult = await uploadMediaList(
          imageMedia,
          target,
          siteConfig,
          sourceRootDir,
        );
        mediaUploaded += uploadResult.uploaded;
        if (uploadResult.urlMap.size > 0) {
          rootBody = rewriteMediaReferences(rootBody, uploadResult.urlMap);
        }
      }

      if (!dryRun) {
        const attachmentResult = await buildImportedAttachments(
          normalizedRoot.attachments,
          target,
          siteConfig,
          sourceRootDir,
        );
        importedAttachments = attachmentResult.attachments;
        mediaUploaded += attachmentResult.uploaded;
      }

      // Also attach every uploaded root page-resource as a media attachment
      // so the post record carries them even when none appear in body text.
      for (const mediaId of rootResourceIds) {
        importedAttachments.push({ type: "media", mediaId });
      }

      // Build text attachments declared in the flat `media:` front matter.
      // These reference a `.md` artifact that holds the full body; the
      // normalizer fetches the bytes (local disk first, then remote URL)
      // and decodes them.
      if (!dryRun) {
        for (const textEntry of rootTextAttachmentEntries) {
          const textAttachment = await normalizeTextAttachmentSpec(
            textEntry,
            siteConfig,
            sourceRootDir,
          );
          if (textAttachment) importedAttachments.push(textAttachment);
        }
      }

      const memberships = resolveThreadCollectionMemberships(
        rootBundle,
        collectionSlugToId,
      );
      const postData = buildPostPayloadFromBundle(rootBundle, {
        bodyMarkdown: rootBody,
        attachments: importedAttachments,
        memberships,
        replyToId: null,
      });

      if (dryRun) {
        console.log(`[dry-run] Would create post: ${postLabel} (${format})`);
        if (rootBundle.children.length > 0) {
          console.log(`  [dry-run] With ${rootBundle.children.length} replies`);
        }
        postsCreated++;
        repliesCreated += rootBundle.children.length;
        continue;
      }

      const progress = `[${postsCreated + 1}/${rootBundles.length}]`;
      let post;
      try {
        post = await target.createPost(postData);
        postsCreated++;
        if (post?.id && post.slug) postSlugToId.set(post.slug, post.id);
        // Translation groups are rebuilt after every post exists: the group ID
        // in the export is opaque and its members can appear in any order, so
        // there is nothing to link to until the whole run is done.
        const groupKey =
          typeof rootFm.translation_group === "string"
            ? rootFm.translation_group.trim()
            : "";
        if (groupKey && post?.id) {
          const members = translationGroups.get(groupKey) ?? [];
          members.push(post.id);
          translationGroups.set(groupKey, members);
        }
        const replyInfo =
          rootBundle.children.length > 0
            ? ` (+${rootBundle.children.length} replies)`
            : "";
        console.log(`${progress} Created: ${postLabel}${replyInfo}`);
      } catch (err) {
        console.error(`Error creating post "${postLabel}": ${err.message}`);
        process.exit(1);
      }

      // Create replies before aliases so reply slugs can claim their paths.
      if (!post) continue;
      const replySlugPaths = new Set();
      // Jant threads are linear: a reply must point at the current end of the
      // thread, which the site reads as its last post in Thread order — the
      // root first, then replies by creation time, then ID. Creation times
      // are restored from the export (or taken from `date` in an older one),
      // so a reply sent after another can carry the earlier time; the end is
      // then the one with the later time, not the one sent last. Track it by
      // the site's rule.
      let threadTail = post;
      for (const replyBundle of rootBundle.children) {
        const replyFm = replyBundle.frontMatter;
        const replySlug = replyBundle.slug;
        const replyFormat =
          typeof replyFm.format === "string" ? replyFm.format : "note";
        const replyLabel =
          (replyFormat === "quote"
            ? typeof replyFm.source_name === "string"
              ? replyFm.source_name
              : null
            : typeof replyFm.title === "string"
              ? replyFm.title
              : null) ||
          replySlug ||
          "(untitled reply)";

        const replySlugPath = normalizeImportAliasPath(replySlug);
        if (replySlugPath) replySlugPaths.add(replySlugPath);

        await assertImportSlugAvailable(
          target,
          replySlug,
          `${replyLabel} in ${postLabel}`,
          "reply",
        );

        const normalizedReply = normalizeImportedBodySegment(replyBundle.body);
        let replyBody = normalizedReply.markdown;
        let replyAttachments = [];

        const replyResourceSpecs = [];
        const replyTextAttachmentEntries = [];
        if (Array.isArray(replyFm.media)) {
          for (const entry of replyFm.media) {
            if (entry && typeof entry === "object" && entry.kind === "text") {
              replyTextAttachmentEntries.push(entry);
              continue;
            }
            const spec = await mediaSpecFromJantMedia(entry, sourceRootDir);
            if (spec) replyResourceSpecs.push(spec);
          }
        }

        const replyResourceIds = [];
        if (replyResourceSpecs.length > 0) {
          const result = await uploadBundleResources(
            replyResourceSpecs,
            target,
          );
          mediaUploaded += result.uploaded;
          if (result.urlMap.size > 0) {
            replyBody = rewriteMediaReferences(replyBody, result.urlMap);
          }
          replyResourceIds.push(...result.mediaIds);
        }

        {
          const fallbackUrls = findImageUrls(replyBody).filter(
            (url) => !skipRemoteMedia || !isAbsoluteImportUrl(url),
          );
          const imageMedia = fallbackUrls.map((src) => ({ src }));
          const uploadResult = await uploadMediaList(
            imageMedia,
            target,
            siteConfig,
            sourceRootDir,
          );
          mediaUploaded += uploadResult.uploaded;
          if (uploadResult.urlMap.size > 0) {
            replyBody = rewriteMediaReferences(replyBody, uploadResult.urlMap);
          }
        }

        const attachmentResult = await buildImportedAttachments(
          normalizedReply.attachments,
          target,
          siteConfig,
          sourceRootDir,
        );
        replyAttachments = attachmentResult.attachments;
        mediaUploaded += attachmentResult.uploaded;
        for (const mediaId of replyResourceIds) {
          replyAttachments.push({ type: "media", mediaId });
        }

        for (const textEntry of replyTextAttachmentEntries) {
          const textAttachment = await normalizeTextAttachmentSpec(
            textEntry,
            siteConfig,
            sourceRootDir,
          );
          if (textAttachment) replyAttachments.push(textAttachment);
        }

        const replyData = buildPostPayloadFromBundle(replyBundle, {
          bodyMarkdown: replyBody,
          attachments: replyAttachments,
          memberships: { entries: [], ids: [] },
          replyToId: threadTail.id,
          quietReply: shouldImportReplyQuietly(rootFm, replyFm),
        });

        try {
          const createdReply = await target.createPost(replyData);
          repliesCreated++;
          threadTail = getNextThreadTail(threadTail, createdReply);
        } catch (err) {
          console.error(`  Error creating reply: ${err.message}`);
          process.exit(1);
        }
      }

      // Create exported root aliases after replies. Historical root slugs
      // round-trip via `root_aliases:`; reply slugs are handled by their
      // own bundles so we strip them from the alias list.
      const rootTargetSlug = postSlug || post.slug;
      const aliases = Array.isArray(rootFm.aliases) ? rootFm.aliases : [];
      const rootAliases = Array.isArray(rootFm.root_aliases)
        ? rootFm.root_aliases
        : [];
      const aliasPaths = getRootAliasPathsForImport(
        aliases,
        rootAliases,
        rootTargetSlug,
        replySlugPaths,
      );
      for (const aliasPath of aliasPaths) {
        try {
          await target.createAlias(aliasPath, rootTargetSlug);
          aliasesCreated++;
        } catch (err) {
          console.error(
            `Error creating alias "${aliasPath}" for "${postLabel}": ${err.message}`,
          );
          process.exit(1);
        }
      }
    }

    // Rebuild translation groups. Each member is linked to the first one, so a
    // group of N takes N-1 calls and never asks the server to merge two groups
    // — which it refuses, on purpose.
    let translationsLinked = 0;
    for (const [groupKey, members] of translationGroups) {
      if (members.length < 2) continue;
      const [anchor, ...rest] = members;
      for (const memberId of rest) {
        try {
          await target.linkTranslation(anchor, memberId);
          translationsLinked++;
        } catch (err) {
          // A clash here means the export itself held two posts in the same
          // language for one group. Say so and keep going: the posts are
          // imported either way, they are just not linked.
          console.warn(
            `Warning: could not link a translation in group "${groupKey}": ${err.message}`,
          );
        }
      }
    }

    // Navigation and custom URLs go last: they point at posts and
    // collections, which exist by now.
    let customUrlsCreated = 0;
    if (!dryRun && target) {
      if (importedNav.exported) {
        try {
          const existingNavItems = await target.listNavItems();
          for (const item of existingNavItems) {
            await target.deleteNavItem(item.id);
          }
          for (const item of importedNav.items) {
            const request = buildNavItemCreateRequest(item, {
              collectionSlugToId,
              smartCollectionSlugToId,
              postSlugToId,
            });
            if (request.warning) console.warn(`Warning: ${request.warning}`);
            const created = await target.createNavItem(request.payload);
            if (request.customLabel && created?.id) {
              await target.updateNavItem(created.id, {
                label: request.customLabel,
              });
            }
          }
        } catch (err) {
          console.error(`Error importing navigation: ${err.message}`);
          process.exit(1);
        }
      }

      for (const customUrl of importedCustomUrls) {
        if (customUrl.kind === "archive") {
          console.warn(
            `Warning: skipped /${customUrl.path}, an archive URL (${customUrl.archiveQuery ?? "no filter"}). Archive URLs can no longer be created. Create a smart collection at /${customUrl.path} with the same conditions, here or on the source site before exporting.`,
          );
          continue;
        }
        try {
          await target.createCustomUrl({
            path: customUrl.path,
            targetType: "redirect",
            toPath: customUrl.to,
            redirectType: String(customUrl.status),
          });
          customUrlsCreated++;
        } catch (err) {
          console.warn(
            `Warning: couldn't recreate the redirect /${customUrl.path} → ${customUrl.to}: ${err.message}`,
          );
        }
      }
    } else if (dryRun && importedCustomUrls.length > 0) {
      console.log(
        `[dry-run] Would recreate ${importedCustomUrls.length} custom URLs`,
      );
    }

    await target?.close();

    // 5. Summary
    console.log("");
    console.log("Import complete:");
    console.log(`  Posts created: ${postsCreated}`);
    console.log(`  Replies created: ${repliesCreated}`);
    console.log(`  Media uploaded: ${mediaUploaded}`);
    if (translationsLinked > 0) {
      console.log(`  Translations linked: ${translationsLinked}`);
    }
    if (aliasesCreated > 0) {
      console.log(`  Aliases created: ${aliasesCreated}`);
    }
    if (customUrlsCreated > 0) {
      console.log(`  Redirects created: ${customUrlsCreated}`);
    }
    if (dryRun) {
      console.log("  (dry-run mode — no changes were made)");
    }
  } finally {
    if (tempSourceRootDir) {
      await rm(tempSourceRootDir, { recursive: true, force: true });
    }
  }
}
