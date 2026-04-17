import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { resolve, join, relative, extname, dirname, basename } from "node:path";
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
import { openNodeDatabase } from "../lib/node-database.js";
import { loadNodeRuntime } from "../lib/load-node-runtime.js";
import {
  parseFrontMatter as parseFrontMatterShared,
  splitReplies as splitRepliesShared,
} from "../../src/lib/zola-markdown.js";

/**
 * Parse front matter from a Markdown file.
 * Delegates to the shared zola-markdown module.
 */
const parseFrontMatter = parseFrontMatterShared;

async function parseToml(content) {
  const { parse } = await import("smol-toml");
  return parse(content);
}

/**
 * Read custom.css from a Jant export. Prefers the root `static/custom.css`
 * (user override) and falls back to `themes/jant/static/custom.css` (the
 * default location Jant writes). Legacy flat-layout exports only had the
 * root copy, so the fallback keeps old exports importable.
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

/**
 * Parse reply markers from post body.
 * Delegates to the shared zola-markdown module.
 */
const splitReplies = splitRepliesShared;

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

function collectReplySlugPaths(replySegments) {
  const replySlugPaths = new Set();

  for (const replySegment of replySegments) {
    const replySlugPath = normalizeImportAliasPath(replySegment?.attrs?.slug);
    if (replySlugPath) {
      replySlugPaths.add(replySlugPath);
    }
  }

  return replySlugPaths;
}

function getExportedRootAliases(frontMatter) {
  const aliases = frontMatter?.extra?.jant?.root_aliases;
  return Array.isArray(aliases) ? aliases : [];
}

function getRootAliasPathsForImport(aliases, postSlug, replySlugPaths) {
  const rootSlugPath = normalizeImportAliasPath(postSlug);
  const aliasPaths = [];
  const seen = new Set();

  for (const alias of Array.isArray(aliases) ? aliases : []) {
    const aliasPath = normalizeImportAliasPath(alias);
    if (!aliasPath) {
      continue;
    }
    if (aliasPath === rootSlugPath) {
      continue;
    }
    if (replySlugPaths.has(aliasPath)) {
      throw new Error(
        `Exported root alias "${aliasPath}" conflicts with a reply slug`,
      );
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
    srcFilePath: await resolveImportLocalAssetPath(
      spec.src,
      siteConfig,
      sourceRootDir,
    ),
    poster,
    posterFilePath:
      typeof spec.poster === "string"
        ? await resolveImportLocalAssetPath(
            spec.poster,
            siteConfig,
            sourceRootDir,
          )
        : null,
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
 *    (falling back to `--localize-media` local disk via
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

  const summary =
    typeof spec.summary === "string" ? spec.summary : undefined;

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
  options = {},
) {
  if (
    sourceRootDir &&
    typeof sourceRootDir === "object" &&
    !Array.isArray(sourceRootDir) &&
    options &&
    Object.keys(options).length === 0
  ) {
    options = sourceRootDir;
    sourceRootDir = null;
  }

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

    if (options.skipUploads) {
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
    urlMap.set(normalized.src, result.url);
    mediaIds.push(result.id);
    uploaded += 1;
  }

  return { urlMap, mediaIds, uploaded };
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
    HOME_DEFAULT_VIEW:
      String(jant.home_default_view || "") === "featured" ? "featured" : "",
    SHOW_JANT_BRANDING_ON_HOME: jant.show_jant_branding_on_home ? "true" : "",
    NOINDEX: jant.noindex ? "true" : "",
    SHOW_HEADER_AVATAR: jant.show_header_avatar ? "true" : "",
    THEME: themeId && themeId !== defaultThemeId ? themeId : "",
    FONT_THEME: fontThemeId && fontThemeId !== "default" ? fontThemeId : "",
    THEME_MODE: themeMode === "light" || themeMode === "dark" ? themeMode : "",
    CUSTOM_CSS: customCss,
  };
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

async function createLocalTarget(env = process.env) {
  const nodeDatabase = await openNodeDatabase(env);
  const { createNodeCliRuntime, resolveConfig } = await loadNodeRuntime();
  const bindings = nodeDatabase.bindings;
  const runtime = await createNodeCliRuntime(bindings);
  const allSettings = await runtime.services.settings.getAll();
  const appConfig = resolveConfig(bindings, allSettings);
  const summaryConfig = {
    maxParagraphs: appConfig.summaryMaxParagraphs,
    maxChars: appConfig.summaryMaxChars,
  };

  return {
    async close() {
      await nodeDatabase.close();
    },
    async getSetupStatus() {
      return runtime.services.settings.isOnboardingComplete();
    },
    async updateSettings(updates) {
      await runtime.services.settings.setMany(updates);
      return { settings: updates };
    },
    async listNavItems() {
      return runtime.services.navItems.list();
    },
    async createNavItem(data) {
      return runtime.services.navItems.create(data);
    },
    async deleteNavItem(id) {
      return runtime.services.navItems.delete(id);
    },
    async removeSiteAvatar() {
      return runtime.services.settings.removeAvatar(runtime.storage);
    },
    async uploadSiteAvatar(data) {
      if (!runtime.storage) {
        throw new Error("Local import requires configured storage.");
      }

      const avatarAsset = await readImportAsset({
        sourceUrl: data.avatarUrl,
        sourceFilePath: data.avatarFilePath,
      });
      if (!avatarAsset) {
        throw new Error(`Failed to read site avatar: ${data.avatarUrl}`);
      }

      let faviconIco;
      if (data.faviconUrl || data.faviconFilePath) {
        const faviconAsset = await readImportAsset({
          sourceUrl: data.faviconUrl,
          sourceFilePath: data.faviconFilePath,
          mimeType: "image/x-icon",
          originalName: "favicon.ico",
        });
        if (faviconAsset) {
          faviconIco = toArrayBuffer(faviconAsset.bytes);
        }
      }

      let appleTouchIcon;
      if (data.appleTouchUrl) {
        const appleTouchAsset = await readImportAsset({
          sourceUrl: data.appleTouchUrl,
          sourceFilePath: data.appleTouchFilePath,
        });
        if (appleTouchAsset) {
          appleTouchIcon = toArrayBuffer(appleTouchAsset.bytes);
        }
      }

      await runtime.services.settings.uploadAvatar(
        {
          file: createUploadFile(
            avatarAsset.filename,
            avatarAsset.contentType,
            avatarAsset.bytes,
          ),
          faviconIco,
          appleTouchIcon,
        },
        {
          media: runtime.services.media,
          storage: runtime.storage,
          storageProvider: appConfig.storageDriver,
          maxFileSizeMB: appConfig.uploadMaxFileSize,
        },
      );

      return { success: true };
    },
    async syncSiteAvatar(data) {
      await this.removeSiteAvatar();
      if (!data) {
        return { success: true };
      }
      return this.uploadSiteAvatar(data);
    },
    async listCollections() {
      return runtime.services.collections.list();
    },
    async listCollectionDirectoryItems() {
      return runtime.services.collections.listDirectoryItems();
    },
    async createCollection(data) {
      return runtime.services.collections.create(data);
    },
    async createCollectionDirectoryItem(data) {
      return runtime.services.collections.createDirectoryItem(data);
    },
    async moveCollectionDirectoryItem(id, after, before) {
      return runtime.services.collections.moveDirectoryItem(id, after, before);
    },
    async deleteCollectionDirectoryItem(id) {
      return runtime.services.collections.deleteDirectoryItem(id);
    },
    async createPost(data) {
      const { attachments, ...postData } = data;
      return runtime.services.posts.createWithAttachments(
        postData,
        attachments,
        {
          media: runtime.services.media,
          storage: runtime.storage,
          storageDriver: appConfig.storageDriver,
          maxFileSizeMB: appConfig.uploadMaxFileSize,
        },
        summaryConfig,
      );
    },
    async createAlias(path, targetSlug) {
      const post = await runtime.services.posts.getBySlug(targetSlug);
      if (!post) {
        throw new Error(`Post with slug "${targetSlug}" not found`);
      }
      return runtime.services.customUrls.create({
        path,
        targetType: "post",
        targetId: post.id,
      });
    },
    async uploadMedia(mediaSpec) {
      if (!runtime.storage) {
        throw new Error("Local import requires configured storage.");
      }

      const asset = await readMediaSpecAsset(mediaSpec);
      if (!asset) return null;

      const originalName =
        mediaSpec.originalName ||
        asset.filename ||
        getFilenameFromUrl(mediaSpec.src) ||
        "file";
      const bytes = asset.bytes;
      const { id, filename, storageKey } =
        generateImportedStorageKey(originalName);
      const mimeType =
        mediaSpec.mimeType || asset.contentType || guessMimeType(originalName);
      let posterKey;

      if (mediaSpec.poster) {
        const posterAsset = await readMediaSpecAsset(mediaSpec, "poster");
        if (posterAsset) {
          const posterName = posterAsset.filename || "poster.webp";
          const posterExt = extname(posterName) || ".webp";
          posterKey = storageKey.replace(/(\.[^.]+)?$/, `-poster${posterExt}`);
          await runtime.storage.put(posterKey, posterAsset.bytes, {
            contentType: posterAsset.contentType || guessMimeType(posterName),
          });
        }
      }

      await runtime.storage.put(storageKey, bytes, {
        contentType: mimeType,
      });

      const createdMedia = await runtime.services.media.create({
        id,
        filename,
        originalName,
        mimeType,
        size: mediaSpec.size ?? bytes.byteLength,
        storageKey,
        provider: appConfig.storageDriver,
        width: mediaSpec.width ?? undefined,
        height: mediaSpec.height ?? undefined,
        alt: mediaSpec.alt ?? undefined,
        position: mediaSpec.position ?? undefined,
        blurhash: mediaSpec.blurhash ?? undefined,
        waveform: mediaSpec.waveform ?? undefined,
        posterKey,
        summary: mediaSpec.summary ?? undefined,
        chars: mediaSpec.chars ?? undefined,
        mediaKind: mediaSpec.kind ?? undefined,
      });

      return {
        id: createdMedia.id,
        url: getMediaPublicUrl(
          createdMedia.storageKey,
          createdMedia.provider,
          appConfig,
        ),
      };
    },
    async checkPostSlugAvailability(slug) {
      return runtime.services.posts.checkSlugAvailability(slug);
    },
  };
}

/**
 * Recursively walk a directory's content/ folder and collect post/collection files.
 */
async function walkContent(rootDir, postFiles, collectionFiles) {
  const contentDir = join(rootDir, "content");
  const contentStat = await stat(contentDir).catch(() => null);
  if (!contentStat?.isDirectory()) {
    console.error(`No content/ directory found in ${rootDir}`);
    process.exit(1);
  }

  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.name === "index.md" || entry.name === "_index.md") {
        const relPath = relative(rootDir, fullPath).replace(/\\/g, "/");
        const content = await readFile(fullPath, "utf-8");
        if (
          (relPath.startsWith("content/jant-collections/") ||
            relPath.startsWith("content/c/")) &&
          relPath.endsWith("/_index.md")
        ) {
          collectionFiles.push({ path: relPath, content });
        } else if (
          relPath.startsWith("content/") &&
          relPath.endsWith("/index.md") &&
          relPath !== "content/_index.md"
        ) {
          postFiles.push({ path: relPath, content });
        }
      }
    }
  }

  await walk(contentDir);
}

export const __test__ = {
  resolveImportUrl,
  readMediaSpecAsset,
  normalizeMediaSpec,
  normalizeTextAttachmentSpec,
  extractAttachmentBlocks,
  buildImportedAttachments,
  buildSettingsUpdatesFromConfig,
  normalizeImportedNavItems,
  normalizeImportedCollectionDirectory,
  buildSiteAvatarImport,
  reorderCollectionDirectoryItems,
  syncImportedCollectionDirectory,
  collectReplySlugPaths,
  getExportedRootAliases,
  getRootAliasPathsForImport,
  toRemotePostPayload,
  buildIncompleteSetupError,
  detectRemoteSetupStatus,
  getIncompleteSetupError,
};

export async function run(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      url: { type: "string" },
      token: { type: "string" },
      path: { type: "string", default: "." },
      "dry-run": { type: "boolean", default: false },
      "skip-media": { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log("Usage: jant site import [--url <url>] [options]");
    console.log("");
    console.log("Import a Zola export directory or ZIP into a Jant instance.");
    console.log("");
    console.log("Modes:");
    console.log(
      "  Local           No --url; imports into the local Node database runtime",
    );
    console.log(
      `  Remote          --url requires ${CLI_API_TOKEN_ENV_VAR} or --token`,
    );
    console.log("");
    console.log("Options:");
    console.log("  --url         Target remote Jant instance URL");
    console.log(
      "  --path        Path to export directory or ZIP file (default: .)",
    );
    console.log("  --dry-run     Parse and validate without making API calls");
    console.log(
      "  --skip-media  Skip remote media download/upload (embedded text attachments still import)",
    );
    console.log("");
    console.log(
      "Import expects an empty target site and fails on slug or alias conflicts.",
    );
    console.log("");
    console.log("Authentication:");
    console.log(`  Set ${CLI_API_TOKEN_ENV_VAR} env var (recommended):`);
    console.log(`    export ${CLI_API_TOKEN_ENV_VAR}=jnt_your_token`);
    console.log("    jant site import --url https://your-site.com");
    console.log("");
    console.log("Examples:");
    console.log("  jant site import --path ./jant-site");
    console.log("  jant site import --path ./jant-site-export.zip");
    console.log("");
    console.log("Compatibility alias: jant import-site");
    process.exit(0);
  }

  const token = getCliApiToken(process.env, values.token);
  if (values.url && !token && !values["dry-run"]) {
    console.error(
      `Error: remote import requires ${CLI_API_TOKEN_ENV_VAR} or --token (unless using --dry-run)`,
    );
    console.error("");
    console.error(`  export ${CLI_API_TOKEN_ENV_VAR}=jnt_your_token`);
    process.exit(1);
  }

  const apiUrl = values.url?.replace(/\/$/, "");
  const dryRun = values["dry-run"];
  const skipMedia = values["skip-media"];
  const target = dryRun
    ? null
    : values.url
      ? createRemoteTarget(apiUrl, token)
      : await createLocalTarget(process.env);

  // 1. Read source — directory or ZIP
  const inputPath = resolve(process.cwd(), values.path);
  const inputStat = await stat(inputPath).catch(() => null);

  if (!inputStat) {
    console.error(`Path not found: ${inputPath}`);
    process.exit(1);
  }

  const postFiles = [];
  const collectionFiles = [];
  let siteConfig = null;
  let customCss = "";
  let sourceRootDir = inputPath;
  let tempSourceRootDir = null;

  if (inputStat.isDirectory()) {
    console.log(`Reading directory ${inputPath}...`);
    await walkContent(sourceRootDir, postFiles, collectionFiles);
    const configPath = join(sourceRootDir, "config.toml");
    const configContent = await readFile(configPath, "utf-8").catch(() => null);
    if (configContent) {
      siteConfig = await parseToml(configContent);
    }
    customCss = await readImportCustomCss(sourceRootDir);
  } else {
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

    await walkContent(sourceRootDir, postFiles, collectionFiles);
    const configPath = join(sourceRootDir, "config.toml");
    const configContent = await readFile(configPath, "utf-8").catch(() => null);
    if (configContent) {
      siteConfig = await parseToml(configContent);
    }
    customCss = await readImportCustomCss(sourceRootDir);
  }

  try {
    console.log(
      `Found ${postFiles.length} posts and ${collectionFiles.length} collections`,
    );
    const importedCollectionDirectory = siteConfig
      ? normalizeImportedCollectionDirectory(siteConfig)
      : { exported: false, items: [] };

    if (target) {
      const setupError = await getIncompleteSetupError(
        target,
        values.url ? `Target site at ${apiUrl}` : "Local target site",
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
        if (avatarImport && !skipMedia) {
          if (avatarImport.mode === "remove") {
            console.log("[dry-run] Would remove existing site avatar");
          } else {
            console.log("[dry-run] Would import exported site avatar");
          }
        }
      } else {
        try {
          const result = await target.updateSettings(settingsUpdates);
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

        if (avatarImport && !skipMedia) {
          try {
            await target.syncSiteAvatar(
              avatarImport.mode === "set" ? avatarImport : null,
            );
          } catch (err) {
            console.error(`Error importing site avatar: ${err.message}`);
            process.exit(1);
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

    for (const { path, content } of collectionFiles) {
      const { frontMatter } = await parseFrontMatter(content);
      const slug = path
        .replace("content/jant-collections/", "")
        .replace("content/c/", "")
        .replace("/_index.md", "");

      if (collectionSlugToId.has(slug)) {
        console.error(
          `Import conflict: collection slug "${slug}" is already in use. Import into an empty site or remove the existing collection first.`,
        );
        process.exit(1);
      }

      if (dryRun) {
        console.log(
          `[dry-run] Would create collection: ${frontMatter.title || slug}`,
        );
        collectionSlugToId.set(slug, `dry-run-${slug}`);
        continue;
      }

      try {
        const collectionExtra = frontMatter.extra || {};
        const result = await target.createCollection({
          title: frontMatter.title || slug,
          slug,
          description: frontMatter.description || undefined,
          sortOrder:
            collectionExtra.sort_order ||
            collectionExtra.sortOrder ||
            undefined,
        });
        collectionSlugToId.set(slug, result.id);
        console.log(`Created collection: ${frontMatter.title || slug}`);
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

    // 4. Process posts
    let postsCreated = 0;
    let repliesCreated = 0;
    let mediaUploaded = 0;
    let aliasesCreated = 0;

    for (const { path, content } of postFiles) {
      const { frontMatter, body } = await parseFrontMatter(content);

      const segments = splitReplies(body);
      const rootSegment = segments[0];
      const replySegments = segments.slice(1);
      const replySlugPaths = collectReplySlugPaths(replySegments);

      // Resolve collection IDs from taxonomy slugs
      const collectionIds = [];
      const taxonomyCollections =
        frontMatter.taxonomies?.c || frontMatter.taxonomies?.collections || [];
      for (const colSlug of taxonomyCollections) {
        const id = collectionSlugToId.get(colSlug);
        if (id) collectionIds.push(id);
      }

      const extra = frontMatter.extra || {};
      const format = extra.format || "note";
      const postSlug =
        frontMatter.slug != null ? String(frontMatter.slug) : undefined;
      const postStatus =
        extra.status === "draft" || extra.status === "published"
          ? extra.status
          : frontMatter.draft
            ? "draft"
            : "published";
      const postVisibility =
        extra.visibility === "unlisted" || extra.visibility === "private"
          ? extra.visibility
          : undefined;
      const postLabel =
        (format === "quote" ? extra.source_name : frontMatter.title) ||
        postSlug ||
        "(untitled)";

      if (!dryRun && postSlug) {
        await assertImportSlugAvailable(target, postSlug, postLabel, "post");
      }

      // Process images in root body
      let rootBody = rootSegment?.body || "";
      const normalizedRootBody = normalizeImportedBodySegment(rootBody);
      rootBody = normalizedRootBody.markdown;
      let importedAttachments = [];

      if (!skipMedia && !dryRun) {
        const imageMedia = findImageUrls(rootBody).map((src) => ({ src }));
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
          normalizedRootBody.attachments,
          target,
          siteConfig,
          sourceRootDir,
          { skipUploads: skipMedia },
        );
        importedAttachments = attachmentResult.attachments;
        mediaUploaded += attachmentResult.uploaded;
      }

      const postData = {
        format,
        title:
          format === "quote"
            ? typeof extra.source_name === "string"
              ? extra.source_name
              : undefined
            : frontMatter.title != null
              ? String(frontMatter.title)
              : undefined,
        bodyMarkdown: rootBody || undefined,
        slug: postSlug,
        path: frontMatter.path != null ? String(frontMatter.path) : undefined,
        status: postStatus,
        visibility: postVisibility,
        collectionIds: collectionIds.length > 0 ? collectionIds : undefined,
        attachments:
          importedAttachments.length > 0 ? importedAttachments : undefined,
        publishedAt:
          postStatus === "published" && frontMatter.date
            ? Math.floor(new Date(frontMatter.date).getTime() / 1000)
            : undefined,
        pinned: extra.pinned || undefined,
        featured: extra.featured || undefined,
        rating: extra.rating || undefined,
      };

      if (format === "link" && extra.link_url) {
        postData.url = extra.link_url;
      }
      if (format === "quote" && extra.quote_text) {
        postData.quoteText = extra.quote_text;
        if (typeof extra.source_url === "string" && extra.source_url.trim()) {
          postData.url = extra.source_url;
        }
      }

      if (dryRun) {
        console.log(`[dry-run] Would create post: ${postLabel} (${format})`);
        if (replySegments.length > 0) {
          console.log(`  [dry-run] With ${replySegments.length} replies`);
        }
        postsCreated++;
        repliesCreated += replySegments.length;
        continue;
      }

      const progress = `[${postsCreated + 1}/${postFiles.length}]`;

      let post;
      try {
        post = await target.createPost(postData);
        postsCreated++;
        const replyInfo =
          replySegments.length > 0 ? ` (+${replySegments.length} replies)` : "";
        console.log(`${progress} Created: ${postLabel}${replyInfo}`);
      } catch (err) {
        console.error(`Error creating post "${postLabel}": ${err.message}`);
        process.exit(1);
      }

      // Create replies before aliases so reply slugs can claim their own paths.
      if (!post) continue;
      for (const replySegment of replySegments) {
        const replyAttrs = replySegment.attrs || {};
        const replySlug = replyAttrs.slug || undefined;
        const replyLabel =
          replyAttrs.source_name ||
          replyAttrs.title ||
          replySlug ||
          "(untitled reply)";
        if (!dryRun && replySlug) {
          await assertImportSlugAvailable(
            target,
            replySlug,
            `${replyLabel} in ${postLabel}`,
            "reply",
          );
        }
        let replyBody = replySegment.body || "";
        const normalizedReplyBody = normalizeImportedBodySegment(replyBody);
        replyBody = normalizedReplyBody.markdown;
        let replyAttachments = [];

        if (!skipMedia && !dryRun) {
          const imageMedia = findImageUrls(replyBody).map((src) => ({ src }));
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
        if (!dryRun) {
          const attachmentResult = await buildImportedAttachments(
            normalizedReplyBody.attachments,
            target,
            siteConfig,
            sourceRootDir,
            { skipUploads: skipMedia },
          );
          replyAttachments = attachmentResult.attachments;
          mediaUploaded += attachmentResult.uploaded;
        }

        const replyFormat = replyAttrs.format || "note";
        const replyStatus =
          replyAttrs.status === "draft" || replyAttrs.status === "published"
            ? replyAttrs.status
            : "published";
        const replyVisibility =
          replyAttrs.visibility === "unlisted" ||
          replyAttrs.visibility === "private"
            ? replyAttrs.visibility
            : undefined;
        const replyData = {
          format: replyFormat,
          status: replyStatus,
          title:
            replyFormat === "quote"
              ? replyAttrs.source_name || undefined
              : replyAttrs.title || undefined,
          bodyMarkdown: replyBody || undefined,
          replyToId: post.id,
          slug: replySlug,
          visibility: replyVisibility,
          attachments:
            replyAttachments.length > 0 ? replyAttachments : undefined,
          publishedAt: replyAttrs.date
            ? Math.floor(new Date(replyAttrs.date).getTime() / 1000)
            : undefined,
          rating: replyAttrs.rating ? Number(replyAttrs.rating) : undefined,
        };

        if (replyFormat === "link" && replyAttrs.url) {
          replyData.url = replyAttrs.url;
        }
        if (replyFormat === "quote" && replyAttrs.quote_text) {
          replyData.quoteText = decodeURIComponent(replyAttrs.quote_text);
          if (replyAttrs.source_url) {
            replyData.url = replyAttrs.source_url;
          }
        }

        try {
          await target.createPost(replyData);
          repliesCreated++;
        } catch (err) {
          console.error(`  Error creating reply: ${err.message}`);
          process.exit(1);
        }
      }

      // Create exported root aliases after replies. Reply slugs are handled by
      // the thread markers; only true root aliases round-trip back into Jant.
      const rootTargetSlug = postSlug || post.slug;
      let aliasPaths;
      try {
        aliasPaths = getRootAliasPathsForImport(
          getExportedRootAliases(frontMatter),
          rootTargetSlug,
          replySlugPaths,
        );
      } catch (err) {
        console.error(
          `Error importing aliases for "${postLabel}": ${err.message}`,
        );
        process.exit(1);
      }
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
