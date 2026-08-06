import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { resolve, join, extname, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import { typeidUnboxed } from "typeid-js";
import { CLI_API_TOKEN_ENV_VAR, getCliApiToken } from "../lib/cli-api-token.js";
import {
  extractAttachmentBlocks,
  findImageUrls,
  normalizeImportedBody,
  rewriteMediaReferences,
} from "../lib/site-media-parser.js";
import { parseFrontMatter as parseFrontMatterShared } from "../lib/hugo-markdown.js";

/**
 * Parse front matter from a Markdown file.
 * Delegates to the shared hugo-markdown module.
 */
const parseFrontMatter = parseFrontMatterShared;

async function parseToml(content) {
  const { parse } = await import("smol-toml");
  return parse(content);
}

/**
 * Read custom.css from a Jant Hugo export. Prefers the root
 * `static/custom.css` (user override) and falls back to
 * `themes/jant/static/custom.css` (the default location Jant writes).
 */
async function readImportCustomCss(rootDir) {
  const rootCss = await readFile(
    join(rootDir, "static", "custom.css"),
    "utf-8",
  ).catch(() => null);
  if (rootCss !== null) {
    return rootCss;
  }
  return readFile(
    join(rootDir, "themes", "jant", "static", "custom.css"),
    "utf-8",
  ).catch(() => "");
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

  const fullPath = join(sourceRootDir, "static", pathname);
  const fileStat = await stat(fullPath).catch(() => null);
  if (!fileStat?.isFile()) {
    return null;
  }

  return fullPath;
}

async function readImportAsset(options) {
  const { sourceUrl, sourceFilePath, mimeType, originalName } = options;

  if (sourceFilePath) {
    const bytes = new Uint8Array(await readFile(sourceFilePath));
    const filename =
      originalName || basename(sourceFilePath) || getFilenameFromUrl(sourceUrl);
    return {
      bytes,
      filename,
      contentType: mimeType || guessMimeType(filename),
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
  return {
    bytes,
    filename,
    contentType:
      mimeType ||
      response.headers.get("content-type")?.split(";")[0] ||
      guessMimeType(filename),
  };
}

function toArrayBuffer(bytes) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
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
async function uploadRemoteMedia(media, apiUrl, token) {
  try {
    const asset = await readMediaSpecAsset(media);
    if (!asset) return null;

    const blob = new Blob([asset.bytes], { type: asset.contentType });

    const formData = new FormData();
    formData.append("file", blob, asset.filename);
    if (media.alt) formData.append("alt", media.alt);
    if (media.summary) formData.append("summary", media.summary);
    if (media.width) formData.append("width", String(media.width));
    if (media.height) formData.append("height", String(media.height));
    if (media.blurhash) formData.append("blurhash", media.blurhash);
    if (media.waveform) formData.append("waveform", media.waveform);

    if (media.poster) {
      const posterAsset = await readMediaSpecAsset(media, "poster");
      if (posterAsset) {
        formData.append(
          "poster",
          new Blob([posterAsset.bytes], { type: posterAsset.contentType }),
          posterAsset.filename,
        );
      }
    }

    const uploadResponse = await fetch(`${apiUrl}/api/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    if (!uploadResponse.ok) return null;
    const data = await uploadResponse.json();
    return { url: data.url, id: data.id };
  } catch {
    return null;
  }
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

function generateImportedStorageKey(originalName) {
  const id = typeidUnboxed("med");
  const extension = extname(originalName) || "";
  const filename = `${id}${extension}`;
  return {
    id,
    filename,
    storageKey: `media/${filename}`,
  };
}

function getMediaPublicUrl(storageKey, provider, appConfig) {
  const base =
    provider === "s3"
      ? appConfig.s3PublicUrl
      : provider === "local"
        ? appConfig.localPublicUrl
        : appConfig.r2PublicUrl;

  if (base) {
    return `${base.replace(/\/+$/, "")}/${storageKey}`;
  }

  const prefix = appConfig.sitePathPrefix || "";
  return `${prefix}/${storageKey}`.replace(/\/{2,}/g, "/");
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
    markdown = new TextDecoder("utf-8", { fatal: false }).decode(asset.bytes);
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
    const result = await target.uploadMedia(normalized);
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
    const result = await target.uploadMedia(normalized);
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
    const result = await target.uploadMedia(spec);
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
      },
      jant_export: {
        format:
          typeof jantData.format === "string" ? jantData.format : "jant-site",
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
    SHOW_JANT_BRANDING_ON_HOME: jant.show_jant_branding_on_home ? "true" : "",
    NOINDEX: jant.noindex ? "true" : "",
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
        const type = item.type === "system" ? "system" : "link";
        if (type === "system" && typeof item.system_key === "string") {
          return { type, systemKey: item.system_key };
        }
        if (
          type === "link" &&
          typeof item.label === "string" &&
          typeof item.url === "string"
        ) {
          return { type, label: item.label, url: item.url };
        }
        return null;
      })
      .filter(Boolean),
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
          item.type === "collection" &&
          typeof item.slug === "string" &&
          item.slug.trim()
        ) {
          return {
            type: "collection",
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
) {
  if (!importedDirectory.exported) {
    return { created: 0, deleted: 0, moved: 0 };
  }

  let deleted = 0;
  const existingItems = await target.listCollectionDirectoryItems();
  for (const item of existingItems) {
    if (item.type === "collection") continue;
    const removed = await target.deleteCollectionDirectoryItem(item.id);
    if (removed !== false) {
      deleted += 1;
    }
  }

  let currentItems = await target.listCollectionDirectoryItems();
  const collectionItemIds = new Map(
    currentItems
      .filter((item) => item.type === "collection" && item.collectionId)
      .map((item) => [item.collectionId, item.id]),
  );

  const desiredIds = [];
  const seenCollectionIds = new Set();
  let created = 0;

  for (const item of importedDirectory.items) {
    if (item.type === "collection") {
      const collectionId = collectionSlugToId.get(item.slug);
      if (!collectionId || seenCollectionIds.has(collectionId)) {
        continue;
      }
      seenCollectionIds.add(collectionId);
      const directoryItemId = collectionItemIds.get(collectionId);
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

function createUploadFile(name, type, bytes) {
  return {
    name,
    type,
    size: bytes.byteLength,
    stream() {
      return new Blob([bytes], { type }).stream();
    },
  };
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
      console.error(`\nSSL certificate error connecting to ${apiUrl}`);
      console.error("If using a local/self-signed certificate, run with:");
      console.error("  NODE_TLS_REJECT_UNAUTHORIZED=0 jant import-site ...");
      console.error("Or use: node --use-system-ca bin/jant.js import-site ...");
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
      formData.append(
        "file",
        new Blob([avatarAsset.bytes], { type: avatarAsset.contentType }),
        avatarAsset.filename,
      );

      if (data.faviconUrl || data.faviconFilePath) {
        const faviconAsset = await readImportAsset({
          sourceUrl: data.faviconUrl,
          sourceFilePath: data.faviconFilePath,
          mimeType: "image/x-icon",
          originalName: "favicon.ico",
        });
        if (faviconAsset) {
          formData.append(
            "favicon",
            new Blob([faviconAsset.bytes], {
              type: faviconAsset.contentType,
            }),
            faviconAsset.filename,
          );
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
            new Blob([appleTouchAsset.bytes], {
              type: appleTouchAsset.contentType,
            }),
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

/**
 * Walk `content/` and classify each `_index.md` / `index.md` bundle by its
 * front-matter `type`. Returns ordered root-post bundles (with child reply
 * bundles attached) and stand-alone collection landing pages.
 *
 * Algorithm:
 *   1. Recurse into `content/` collecting every directory that has either
 *      `_index.md` (branch bundle / section) or `index.md` (leaf bundle).
 *   2. For each `_index.md`, read front matter. `type: "post"` (or a
 *      missing `type` with post-shaped keys) → root bundle. `type:
 *      "collection"` → collection landing page. Other known section types
 *      (`home`, `featured`, `archive`, `collections`) are recorded and
 *      skipped for post import.
 *   3. For each root bundle, enumerate immediate child directories; any
 *      child dir containing `index.md` becomes a reply leaf bundle.
 *   4. Reply bundles are sorted by `frontMatter.date` ascending (fallback:
 *      directory name) so thread order is deterministic.
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
    if (record.kind === "post") {
      rootBundles.push(record);
      continue;
    }
    // home / featured / archive / collections / anything else — skip.
  }

  // Sort replies within each root by `date` asc (fallback: directory name).
  for (const root of rootBundles) {
    root.children.sort((a, b) => {
      const aDate =
        typeof a.frontMatter.date === "string"
          ? Date.parse(a.frontMatter.date)
          : NaN;
      const bDate =
        typeof b.frontMatter.date === "string"
          ? Date.parse(b.frontMatter.date)
          : NaN;
      if (Number.isFinite(aDate) && Number.isFinite(bDate) && aDate !== bDate) {
        return aDate - bDate;
      }
      if (Number.isFinite(aDate) && !Number.isFinite(bDate)) return -1;
      if (!Number.isFinite(aDate) && Number.isFinite(bDate)) return 1;
      return basename(a.dir).localeCompare(basename(b.dir));
    });
  }

  return { rootBundles, collectionBundles };
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
  buildSettingsUpdatesFromConfig,
  normalizeImportedNavItems,
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
  walkHugoContent,
  mediaSpecFromJantMedia,
  resolveCollectionMemberships,
  resolveThreadCollectionMemberships,
  buildPostPayloadFromBundle,
  shouldImportReplyQuietly,
};

function printImportUsage() {
  console.log("Usage: jant site import <url> [options]");
  console.log("");
  console.log("Import a Hugo export directory or ZIP into a Jant site.");
  console.log("");
  console.log("Arguments:");
  console.log("  <url>         Jant site URL (required)");
  console.log("");
  console.log("Options:");
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
  console.log("  jant site import https://your-site.example --path ./export");
  console.log("");
  console.log("Examples:");
  console.log(
    "  jant site import https://your-site.example --path ./jant-site",
  );
  console.log(
    "  jant site import https://your-site.example --path ./jant-site-export.zip",
  );
  console.log("");
  console.log("Compatibility alias: jant import-site");
}

export async function run(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
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

  const url = positionals[0];
  if (!url) {
    console.error("Error: site URL is required");
    console.error("");
    printImportUsage();
    process.exit(1);
  }
  if (positionals.length > 1) {
    console.error(
      `Error: unexpected extra arguments: ${positionals.slice(1).join(" ")}`,
    );
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
    const zipData = await readFile(inputPath);
    const { unzipSync } = await import("fflate");
    const files = unzipSync(new Uint8Array(zipData));
    tempSourceRootDir = await mkdtemp(join(tmpdir(), "jant-site-import-"));
    sourceRootDir = tempSourceRootDir;
    for (const [path, data] of Object.entries(files)) {
      const fullPath = join(sourceRootDir, path);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, data);
    }
  } else {
    console.log(`Reading directory ${inputPath}...`);
  }

  const { rootBundles, collectionBundles } =
    await walkHugoContent(sourceRootDir);
  const siteConfig = await loadSiteConfig(sourceRootDir);
  const customCss = await readImportCustomCss(sourceRootDir);

  try {
    const replyCount = rootBundles.reduce(
      (sum, root) => sum + root.children.length,
      0,
    );
    console.log(
      `Found ${rootBundles.length} posts (+${replyCount} replies) and ${collectionBundles.length} collections`,
    );
    const importedCollectionDirectory = siteConfig
      ? normalizeImportedCollectionDirectory(siteConfig)
      : { exported: false, items: [] };

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
      const importedNav = normalizeImportedNavItems(siteConfig);
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

        if (importedNav.exported) {
          try {
            const existingNavItems = await target.listNavItems();
            for (const item of existingNavItems) {
              await target.deleteNavItem(item.id);
            }
            for (const item of importedNav.items) {
              await target.createNavItem(item);
            }
          } catch (err) {
            console.error(`Error importing navigation: ${err.message}`);
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
      // Jant threads are linear: each reply must point at the current end of
      // the thread, not at the root. Track the tail as we go so the Nth
      // reply chains after the (N−1)th.
      let threadTailId = post.id;
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
          replyToId: threadTailId,
          quietReply: shouldImportReplyQuietly(rootFm, replyFm),
        });

        try {
          const createdReply = await target.createPost(replyData);
          repliesCreated++;
          if (createdReply?.id) {
            threadTailId = createdReply.id;
          }
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

    await target?.close();

    // 5. Summary
    console.log("");
    console.log("Import complete:");
    console.log(`  Posts created: ${postsCreated}`);
    console.log(`  Replies created: ${repliesCreated}`);
    console.log(`  Media uploaded: ${mediaUploaded}`);
    if (aliasesCreated > 0) {
      console.log(`  Aliases created: ${aliasesCreated}`);
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
