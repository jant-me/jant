/**
 * Export Service
 *
 * Generates a ready-to-use Hugo static site as a ZIP archive.
 *
 * Content layout:
 *   - Each thread root is a Hugo branch bundle
 *     (`content/{root-slug}/_index.md`).
 *   - Each reply is a nested leaf bundle
 *     (`content/{root-slug}/{reply-slug}/index.md`) with
 *     `build: { render: never, list: local }` so only the parent thread
 *     page renders it while it still appears in `.Pages`.
 *   - `/{reply-slug}/` URLs redirect to the parent thread via Hugo's
 *     `aliases:` mechanism and a custom `_default/alias.html` that injects
 *     the reply anchor at runtime.
 *   - Media is emitted next to each bundle as Hugo page resources.
 *
 * Real Hugo templates and CSS are scaffolded as placeholders here and
 * filled in by Commit 5.
 */

import type { PostService } from "./post.js";
import type { PathService } from "./path.js";
import type { CollectionService } from "./collection.js";
import type { MediaService } from "./media.js";
import {
  getDefaultJantAppleTouchIconBytes,
  getDefaultJantFaviconIcoBytes,
} from "../lib/jant-branding.js";
import { getRootActivityAt } from "../db/thread-activity.js";
import { tiptapJsonToMarkdown } from "../lib/tiptap-to-markdown.js";
import { extractBodyText } from "../lib/summary.js";
import { getMediaUrl, getPublicUrlForProvider } from "../lib/image.js";
import { render as renderMarkdown } from "../lib/markdown.js";
import { formatRelativeAge, toISOString } from "../lib/time.js";
import {
  formatFrontMatter,
  type HugoCollectionRef,
  type HugoFrontMatter,
  type JantMedia,
} from "../lib/hugo-markdown.js";
// Shared design tokens — single source of truth for colors, typography,
// and layout variables. Consumed verbatim by both the main site (via
// Tailwind) and the Hugo export (written to static/tokens.css). Using
// ?raw inlines the file contents as a string at build time so the
// Worker bundle ships without any filesystem access.
import TOKENS_CSS from "../styles/tokens.css?raw";

// Placeholder Hugo theme files — real templates and styles land in Commit 5.
// We import them as Vite `?raw` strings so the Worker bundle has no runtime
// filesystem dependency.
import THEME_TOML from "./export-theme/theme.toml?raw";
import THEME_STYLE_MAIN_CSS from "./export-theme/styles/main.css?raw";
// Static-site client bundle — Lit-based lightbox, feed video autoplay, audio
// waveform, and gallery scroll hints. Built by `vite.config.site.ts` into
// `export-theme/assets/client-site.{js,css}` and shipped under the theme's
// reserved `_jant/` static directory so the theme stays version-aligned with
// `@jant/core`. The assets folder is regenerated on every build, so the
// checked-in files are source-of-truth for the most recent release.
import CLIENT_SITE_JS from "./export-theme/assets/client-site.js?raw";
import CLIENT_SITE_CSS from "./export-theme/assets/client-site.css?raw";
import LAYOUT_BASEOF from "./export-theme/layouts/_default/baseof.html?raw";
import LAYOUT_SINGLE from "./export-theme/layouts/_default/single.html?raw";
import LAYOUT_LIST from "./export-theme/layouts/_default/list.html?raw";
import LAYOUT_ALIAS from "./export-theme/layouts/_default/alias.html?raw";
import LAYOUT_INDEX from "./export-theme/layouts/index.html?raw";
import LAYOUT_POST_LIST from "./export-theme/layouts/post/list.html?raw";
import LAYOUT_FEATURED_LIST from "./export-theme/layouts/featured/list.html?raw";
import LAYOUT_ARCHIVE_LIST from "./export-theme/layouts/archive/list.html?raw";
import LAYOUT_COLLECTIONS_LIST from "./export-theme/layouts/collections/list.html?raw";
import LAYOUT_COLLECTION_SINGLE from "./export-theme/layouts/collection/single.html?raw";
import PARTIAL_HEAD from "./export-theme/layouts/partials/head.html?raw";
import PARTIAL_HEADER from "./export-theme/layouts/partials/header.html?raw";
import PARTIAL_FOOTER from "./export-theme/layouts/partials/footer.html?raw";
import PARTIAL_PAGINATION from "./export-theme/layouts/partials/pagination.html?raw";
import PARTIAL_POST_CARD from "./export-theme/layouts/partials/post-card.html?raw";
import PARTIAL_MEDIA_GALLERY from "./export-theme/layouts/partials/media-gallery.html?raw";
import PARTIAL_REPLY from "./export-theme/layouts/partials/reply.html?raw";
import PARTIAL_THREAD_PREVIEW from "./export-theme/layouts/partials/thread-preview.html?raw";
import PARTIAL_FEATURED_THREAD from "./export-theme/layouts/partials/featured-thread.html?raw";
import LAYOUT_RSS from "./export-theme/layouts/_default/rss.xml?raw";
import PARTIAL_FEED_POST_CONTENT from "./export-theme/layouts/partials/feed-post-content.xml?raw";

import type { StorageDriver } from "../lib/storage.js";
import { base64ToUint8Array } from "../lib/favicon.js";
import {
  SYSTEM_NAV_KEYS,
  type Collection,
  type Media,
  type NavItem,
  type Post,
  type SystemNavKey,
} from "../types.js";

/** A file entry in the exported Hugo site. */
export interface ExportFile {
  path: string;
  content: string | Uint8Array;
}

export interface ExportService {
  /** Generate a flat list of files for a complete Hugo site. */
  generateHugoFiles(): Promise<ExportFile[]>;
  /** Generate a ZIP archive of the Hugo site. */
  generateHugoSite(): Promise<Uint8Array>;
}

export interface SiteConfig {
  siteName: string;
  siteUrl: string;
  siteDescription: string;
  siteLanguage: string;
  /** Whether the source site serves per-language browsing views. */
  multilingualEnabled: boolean;
  /** Non-primary content languages, in switcher order. */
  additionalLanguages: readonly string[];
  showJantBrandingOnHome: boolean;
  /** Whether anonymous JSON reads are enabled on the source Jant site. */
  publicApiEnabled: boolean;
  /** Whether the exported Hugo site should emit Atom feeds. */
  rssFeedsEnabled: boolean;
  /** "latest" or "featured" — drives the default RSS nav link in the exported site. */
  mainRssFeed: string;
  siteFooter: string;
  showHeaderAvatar: boolean;
  siteAvatarUrl: string;
  faviconIcoBase64?: string;
  appleTouchIconStorageKey?: string;
  faviconVersion?: string;
  themeId: string;
  defaultThemeId: string;
  fontThemeId: string;
  themeMode: string;
  noindex: boolean;
  themeCss?: string;
  customCss?: string;
  r2PublicUrl?: string;
  s3PublicUrl?: string;
  localPublicUrl?: string;
  imageTransformUrl?: string;
  sitePathPrefix?: string;
  navItems: Pick<
    NavItem,
    "type" | "systemKey" | "label" | "url" | "position" | "placement"
  >[];
  /** Items per page for Hugo pagination — kept in sync with the main site's PAGE_SIZE. */
  pageSize: number;
  /** Items per archive page — kept in sync with the main site's ARCHIVE_PAGE_SIZE. */
  archivePageSize: number;
  /** Max items per Atom feed — kept in sync with the main site's rssFeedLimit. */
  rssFeedLimit: number;
}

type IconExportMode = "default" | "custom";

type ExportedCollectionDirectoryItem =
  | {
      type: "collection";
      sequence: string;
      slug: string;
      title: string;
      /** Rendered HTML of the collection description, or null if empty. */
      descriptionHtml?: string | null;
      entryCount?: number;
      recentActivityLabel?: string | null;
      recentActivityIso?: string | null;
    }
  | {
      type: "divider";
      label: string | null;
    }
  | {
      type: "link";
      sequence: string;
      label: string;
      url: string;
      /** Rendered HTML of the link description, or null if empty. */
      descriptionHtml?: string | null;
    };

interface ExportCollectionDirectorySourceItem {
  type: "collection" | "divider" | "link";
  label?: string | null;
  url?: string | null;
  description?: string | null;
  collection?: {
    id: string;
    slug: string;
    title: string;
    description?: string | null;
    threadCount?: number;
    recentActivityAt?: number;
  };
}

interface SiteIconAssets {
  faviconBytes: Uint8Array;
  faviconMode: IconExportMode;
  appleTouchBytes: Uint8Array;
  appleTouchMode: IconExportMode;
}

interface ExportedCollectionMetrics {
  threadCount: number;
  recentActivityAt: number;
}

/**
 * A single `collections:` front-matter entry, already resolved to its
 * Hugo-visible slug. Assembled from
 * `collectionService.getCollectionEntriesByThreadIds` + `collectionSlugMap`.
 */
interface ExportedCollectionEntry {
  slug: string;
  /**
   * Denormalized collection title. Kept alongside the slug so the exported
   * front matter can render a tag label without templates having to resolve
   * another page. Optional because legacy call sites may not supply it.
   */
  title?: string;
  /** Unix seconds. */
  collectedAt: number;
  position: number;
  /** Unix seconds, or null when not pinned in this collection. */
  pinnedAt: number | null;
}

function buildDefaultAppleTouchAsset(): Pick<
  SiteIconAssets,
  "appleTouchBytes" | "appleTouchMode"
> {
  return {
    appleTouchBytes: getDefaultJantAppleTouchIconBytes(),
    appleTouchMode: "default",
  };
}

export function createExportService(
  services: {
    posts: PostService;
    paths: PathService;
    collections: CollectionService;
    media: MediaService;
  },
  siteConfig: SiteConfig,
  deps: {
    storage?: StorageDriver | null;
    /**
     * Whether to bundle media bytes into the exported site under
     * `static/media/`. Defaults to `true` (the `jant site export`
     * archive, which must be self-contained). GitHub Sync passes
     * `false` so media is linked by URL instead — it never reads or
     * base64-encodes attachment bytes.
     */
    bundleMedia?: boolean;
  } = {},
): ExportService {
  return {
    async generateHugoFiles() {
      const collectionDirectoryDataPromise =
        typeof services.collections.listDirectoryData === "function"
          ? services.collections.listDirectoryData()
          : Promise.resolve(null);

      // 1. Query all data
      const [allPosts, allCollections, collectionDirectoryData] =
        await Promise.all([
          services.posts.list({
            excludeReplies: false,
            limit: 10000,
          }),
          services.collections.list(),
          collectionDirectoryDataPromise,
        ]);

      const allPostIds = allPosts.map((p) => p.id);
      const roots = allPosts.filter((p) => p.replyToId === null);
      const replies = allPosts.filter((p) => p.replyToId !== null);
      const rootPostIds = roots.map((p) => p.id);

      const [
        collectionsByRoot,
        collectionEntriesByThread,
        rawMediaByPost,
        slugMap,
        aliasMap,
        collectionSlugMap,
      ] = await Promise.all([
        services.collections.getCollectionsByPostIds(rootPostIds),
        services.collections.getCollectionEntriesByThreadIds(rootPostIds),
        services.media.getByPostIds(allPostIds),
        services.paths.getPostSlugMap(allPostIds),
        services.paths.getPostAliases(rootPostIds),
        services.paths.getCollectionSlugMap(allCollections.map((c) => c.id)),
      ]);
      // Denormalized title lookup so front-matter collection refs can
      // include a title label without templates having to resolve another
      // page. Source of truth is still `slug` on round-trip; `title` is
      // refreshed from DB on every export.
      const collectionTitleMap = new Map<string, string>();
      for (const collection of allCollections) {
        collectionTitleMap.set(collection.id, collection.title);
      }

      const iconAssets = await buildSiteIconAssets(siteConfig, deps.storage);
      const collectionMetrics = buildExportedCollectionMetrics(
        allCollections,
        allPosts,
        collectionsByRoot,
      );
      const exportedCollectionDirectoryItems =
        buildExportedCollectionDirectoryItems(
          collectionDirectoryData?.items ??
            allCollections.map((collection) => ({
              id: collection.id,
              type: "collection" as const,
              collection,
            })),
          collectionSlugMap,
          collectionMetrics,
        );

      // 2. Group replies by threadId
      const repliesByThread = new Map<string, Post[]>();
      for (const reply of replies) {
        const list = repliesByThread.get(reply.threadId) ?? [];
        list.push(reply);
        repliesByThread.set(reply.threadId, list);
      }
      // Sort replies by createdAt within each thread
      for (const list of repliesByThread.values()) {
        list.sort((a, b) => a.createdAt - b.createdAt);
      }

      // 3. Build file list
      const exportFiles: ExportFile[] = [];
      const bundleMedia = deps.bundleMedia ?? true;

      // Generate thread bundles (root _index.md + per-reply index.md).
      for (const root of roots) {
        const slug = slugMap.get(root.id) ?? root.slug;
        const threadReplies = repliesByThread.get(root.id) ?? [];
        const rootAliases = [...(aliasMap.get(root.id) ?? [])];

        const rootCollectionEntries = buildExportedCollectionEntriesForThread(
          root.id,
          collectionEntriesByThread,
          collectionSlugMap,
          collectionTitleMap,
        );

        const bundleFiles = await buildThreadBundle(
          root,
          threadReplies,
          slug,
          rootAliases,
          rootCollectionEntries,
          slugMap,
          rawMediaByPost,
          siteConfig,
          deps.storage ?? null,
          bundleMedia,
        );
        exportFiles.push(...bundleFiles);
      }

      // Collection landing pages (`content/{slug}/_index.md`).
      for (const collection of allCollections) {
        const slug = collectionSlugMap.get(collection.id) ?? collection.slug;
        const entryCount =
          collectionMetrics.get(collection.id)?.threadCount ?? 0;
        exportFiles.push({
          path: `content/${slug}/_index.md`,
          content: await buildCollectionSection(
            collection,
            slug,
            entryCount,
            siteConfig.rssFeedsEnabled,
          ),
        });
      }

      // Section + home scaffolding.
      exportFiles.push({
        path: "hugo.toml",
        content: buildHugoToml(siteConfig),
      });
      exportFiles.push({
        path: "content/_index.md",
        content: await buildHomeSection(siteConfig),
      });
      exportFiles.push({
        path: "content/collections/_index.md",
        content: await buildCollectionsSection(),
      });
      exportFiles.push({
        path: "content/archive/_index.md",
        content: await buildArchiveSection(siteConfig.rssFeedsEnabled),
      });

      const usedSlugs = new Set<string>();
      for (const s of slugMap.values()) usedSlugs.add(s);
      for (const s of collectionSlugMap.values()) usedSlugs.add(s);
      if (!usedSlugs.has("featured")) {
        exportFiles.push({
          path: "content/featured/_index.md",
          content: await buildFeaturedSection(siteConfig.rssFeedsEnabled),
        });
      }

      // Single data file consumed by templates via `hugo.Data.jant`. The
      // collection directory lives on the same object as `directory` so
      // everything Jant owns round-trips in one place.
      exportFiles.push({
        path: "data/jant.toml",
        content: buildJantDataToml(
          siteConfig,
          iconAssets,
          exportedCollectionDirectoryItems,
        ),
      });

      // Theme scaffolding (real templates + styles land in Commit 5).
      exportFiles.push({
        path: "themes/jant/theme.toml",
        content: THEME_TOML,
      });
      exportFiles.push({
        path: "themes/jant/layouts/_default/baseof.html",
        content: LAYOUT_BASEOF,
      });
      exportFiles.push({
        path: "themes/jant/layouts/_default/single.html",
        content: LAYOUT_SINGLE,
      });
      exportFiles.push({
        path: "themes/jant/layouts/_default/list.html",
        content: LAYOUT_LIST,
      });
      exportFiles.push({
        path: "themes/jant/layouts/_default/alias.html",
        content: LAYOUT_ALIAS,
      });
      exportFiles.push({
        path: "themes/jant/layouts/index.html",
        content: LAYOUT_INDEX,
      });
      exportFiles.push({
        path: "themes/jant/layouts/post/list.html",
        content: LAYOUT_POST_LIST,
      });
      exportFiles.push({
        path: "themes/jant/layouts/featured/list.html",
        content: LAYOUT_FEATURED_LIST,
      });
      exportFiles.push({
        path: "themes/jant/layouts/archive/list.html",
        content: LAYOUT_ARCHIVE_LIST,
      });
      exportFiles.push({
        path: "themes/jant/layouts/collections/list.html",
        content: LAYOUT_COLLECTIONS_LIST,
      });
      exportFiles.push({
        path: "themes/jant/layouts/collection/single.html",
        content: LAYOUT_COLLECTION_SINGLE,
      });
      exportFiles.push({
        path: "themes/jant/layouts/partials/head.html",
        content: PARTIAL_HEAD,
      });
      exportFiles.push({
        path: "themes/jant/layouts/partials/header.html",
        content: PARTIAL_HEADER,
      });
      exportFiles.push({
        path: "themes/jant/layouts/partials/footer.html",
        content: PARTIAL_FOOTER,
      });
      exportFiles.push({
        path: "themes/jant/layouts/partials/pagination.html",
        content: PARTIAL_PAGINATION,
      });
      exportFiles.push({
        path: "themes/jant/layouts/partials/post-card.html",
        content: PARTIAL_POST_CARD,
      });
      exportFiles.push({
        path: "themes/jant/layouts/partials/media-gallery.html",
        content: PARTIAL_MEDIA_GALLERY,
      });
      exportFiles.push({
        path: "themes/jant/layouts/partials/reply.html",
        content: PARTIAL_REPLY,
      });
      exportFiles.push({
        path: "themes/jant/layouts/partials/thread-preview.html",
        content: PARTIAL_THREAD_PREVIEW,
      });
      exportFiles.push({
        path: "themes/jant/layouts/partials/featured-thread.html",
        content: PARTIAL_FEATURED_THREAD,
      });
      exportFiles.push({
        path: "themes/jant/layouts/_default/rss.xml",
        content: LAYOUT_RSS,
      });
      exportFiles.push({
        path: "themes/jant/layouts/partials/feed-post-content.xml",
        content: PARTIAL_FEED_POST_CONTENT,
      });

      // Static assets. Load order in the template's <head> is
      // tokens → main → theme → custom (wired up by the Commit 5 partial).
      exportFiles.push({
        path: "themes/jant/static/tokens.css",
        content: TOKENS_CSS,
      });
      exportFiles.push({
        path: "themes/jant/static/main.css",
        content: THEME_STYLE_MAIN_CSS,
      });
      exportFiles.push({
        path: "themes/jant/static/theme.css",
        content: siteConfig.themeCss ?? "",
      });
      exportFiles.push({
        path: "themes/jant/static/custom.css",
        content: siteConfig.customCss ?? "",
      });
      // Client-side interactions: media lightbox, feed video autoplay,
      // audio waveform, gallery scroll hints. Reserved namespace keeps these
      // from colliding with user-authored static files.
      exportFiles.push({
        path: "themes/jant/static/_jant/client-site.js",
        content: CLIENT_SITE_JS,
      });
      exportFiles.push({
        path: "themes/jant/static/_jant/client-site.css",
        content: CLIENT_SITE_CSS,
      });
      exportFiles.push({
        path: "themes/jant/static/favicon.ico",
        content: iconAssets.faviconBytes,
      });
      exportFiles.push({
        path: "themes/jant/static/apple-touch-icon.png",
        content: iconAssets.appleTouchBytes,
      });

      exportFiles.push({
        path: "README.md",
        content: buildReadme(siteConfig.siteName),
      });
      exportFiles.push({
        path: ".gitignore",
        content: buildGitignore(),
      });

      return exportFiles;
    },

    async generateHugoSite() {
      const exportFiles = await this.generateHugoFiles();
      const { zipSync } = await import("fflate");
      const encoder = new TextEncoder();
      const files: Record<string, Uint8Array> = {};
      for (const file of exportFiles) {
        files[file.path] =
          typeof file.content === "string"
            ? encoder.encode(file.content)
            : file.content;
      }
      return zipSync(files);
    },
  };
}

async function readStorageObjectBytes(
  storage: StorageDriver,
  storageKey: string,
): Promise<Uint8Array | null> {
  const object = await storage.get(storageKey);
  if (!object?.body) {
    return null;
  }

  return new Uint8Array(await new Response(object.body).arrayBuffer());
}

async function buildSiteIconAssets(
  config: SiteConfig,
  storage?: StorageDriver | null,
): Promise<SiteIconAssets> {
  const faviconMode: IconExportMode = config.faviconIcoBase64
    ? "custom"
    : "default";
  const faviconBytes = config.faviconIcoBase64
    ? base64ToUint8Array(config.faviconIcoBase64)
    : getDefaultJantFaviconIcoBytes();

  if (!config.appleTouchIconStorageKey) {
    return {
      faviconBytes,
      faviconMode,
      ...buildDefaultAppleTouchAsset(),
    };
  }

  if (!storage) {
    return {
      faviconBytes,
      faviconMode,
      ...buildDefaultAppleTouchAsset(),
    };
  }

  let appleTouchBytes: Uint8Array | null;
  try {
    appleTouchBytes = await readStorageObjectBytes(
      storage,
      config.appleTouchIconStorageKey,
    );
  } catch {
    return {
      faviconBytes,
      faviconMode,
      ...buildDefaultAppleTouchAsset(),
    };
  }

  if (!appleTouchBytes) {
    return {
      faviconBytes,
      faviconMode,
      ...buildDefaultAppleTouchAsset(),
    };
  }

  return {
    faviconBytes,
    faviconMode,
    appleTouchBytes,
    appleTouchMode: "custom",
  };
}

// ---------------------------------------------------------------------------
// Thread bundle generation
// ---------------------------------------------------------------------------

function buildExportedCollectionEntriesForThread(
  threadId: string,
  collectionEntriesByThread: Map<
    string,
    {
      collectionId: string;
      createdAt: number;
      position: number;
      pinnedAt: number | null;
    }[]
  >,
  collectionSlugMap: Map<string, string>,
  collectionTitleMap: Map<string, string>,
): ExportedCollectionEntry[] {
  const entries = collectionEntriesByThread.get(threadId) ?? [];
  const resolved: ExportedCollectionEntry[] = [];
  for (const entry of entries) {
    const slug = collectionSlugMap.get(entry.collectionId);
    if (!slug) continue;
    const title = collectionTitleMap.get(entry.collectionId);
    resolved.push({
      slug,
      title,
      collectedAt: entry.createdAt,
      position: entry.position,
      pinnedAt: entry.pinnedAt,
    });
  }
  return resolved;
}

function collectionEntriesToRefs(
  entries: readonly ExportedCollectionEntry[],
): HugoCollectionRef[] {
  return entries.map((entry) => ({
    slug: entry.slug,
    title: entry.title,
    collected_at: toISOString(entry.collectedAt),
    position: entry.position,
    pinned_at: entry.pinnedAt !== null ? toISOString(entry.pinnedAt) : null,
  }));
}

interface MediaEmission {
  /** Flat `media:` front-matter entry. */
  entry: JantMedia;
  /**
   * Site-relative path under `static/` where the primary bytes should
   * land, or null when the media is linked by URL and no bytes need to
   * be emitted.
   */
  inlinePath: string | null;
  /**
   * Site-relative path under `static/` where the poster bytes should
   * land, or null when there's no poster or the poster is linked by URL.
   */
  inlinePosterPath: string | null;
}

/**
 * Build a flat `media:` entry for a Media record plus a decision about
 * whether the primary bytes (and poster) should be bundled into the
 * export's `static/media/` directory.
 *
 * When the media's provider has a reachable public URL (R2/S3/local
 * proxy configured with a `*_public_url`), `src` points at that absolute
 * URL and no bytes are emitted — the exported site stays small and the
 * media keeps being served from wherever it already lives.
 *
 * Otherwise behavior depends on `bundleMedia`:
 * - `true` (the `jant site export` archive): bytes are written to
 *   `static/media/{id}.ext` and `src` is the site-relative path, so the
 *   archive is self-contained.
 * - `false` (GitHub Sync): no bytes are emitted. `src` falls back to the
 *   site's own URL so it stays an absolute, resolvable link — the worker
 *   already serves these objects at `/{storageKey}`. This keeps Sync
 *   from reading and base64-encoding every attachment on every push.
 *
 * When `bundleMedia` is false but the site URL is unknown, bundling is
 * used as a last resort to avoid emitting a broken relative link.
 */
function buildMediaEmission(
  media: Media,
  siteConfig: SiteConfig,
  bundleMedia: boolean,
): MediaEmission {
  const dedicatedPublicUrl = getPublicUrlForProvider(
    media.provider,
    siteConfig.r2PublicUrl,
    siteConfig.s3PublicUrl,
    siteConfig.localPublicUrl,
  );
  const siteFallbackUrl =
    !bundleMedia && siteConfig.siteUrl.trim() ? siteConfig.siteUrl : undefined;
  const mediaBaseUrl = dedicatedPublicUrl || siteFallbackUrl;
  const hasRemoteUrl = Boolean(mediaBaseUrl);

  const ext = extOfFilename(media.filename);
  const localName = `${media.id}${ext}`;
  const localPath = `/media/${localName}`;
  const src = hasRemoteUrl
    ? getMediaUrl(media.storageKey, mediaBaseUrl)
    : localPath;

  const entry: JantMedia = {
    id: media.id,
    kind: media.mediaKind,
    src,
    position: parsePositionForSort(media.position),
  };
  if (media.alt !== null && media.alt !== "") entry.alt = media.alt;
  if (media.width !== null) entry.width = media.width;
  if (media.height !== null) entry.height = media.height;
  if (media.blurhash !== null && media.blurhash !== "")
    entry.blurhash = media.blurhash;
  if (media.originalName) entry.original_name = media.originalName;
  if (media.mimeType) entry.mime_type = media.mimeType;
  if (typeof media.size === "number") entry.size = media.size;
  if (media.waveform) entry.waveform = media.waveform;
  if (media.summary) entry.summary = media.summary;
  if (typeof media.chars === "number") entry.chars = media.chars;
  if (media.durationSeconds !== null && media.durationSeconds !== undefined) {
    entry.duration_seconds = media.durationSeconds;
  }
  entry.provider = media.provider;
  entry.storage_key = media.storageKey;

  let inlinePosterPath: string | null = null;
  if (media.posterKey) {
    const posterExt = extOfStorageKey(media.posterKey);
    const posterLocalName = `${media.id}-poster.${posterExt}`;
    entry.poster = hasRemoteUrl
      ? getMediaUrl(media.posterKey, mediaBaseUrl)
      : `/media/${posterLocalName}`;
    entry.poster_key = media.posterKey;
    if (!hasRemoteUrl) {
      inlinePosterPath = `static/media/${posterLocalName}`;
    }
  }

  return {
    entry,
    inlinePath: hasRemoteUrl ? null : `static/media/${localName}`,
    inlinePosterPath,
  };
}

function parsePositionForSort(position: string): number {
  // Fractional indexing keys sort lexicographically, but downstream
  // consumers (and the UI) expect a numeric fallback. Keep a stable
  // ordering by hashing the string into an integer.
  let hash = 0;
  for (let i = 0; i < position.length; i++) {
    hash = (hash * 31 + position.charCodeAt(i)) | 0;
  }
  return hash;
}

function extOfFilename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot) : "";
}

function extOfStorageKey(key: string): string {
  const dot = key.lastIndexOf(".");
  return dot >= 0 ? key.slice(dot + 1) : "webp";
}

/**
 * Build a complete set of ExportFile entries for a single thread bundle:
 * the root `_index.md`, one `index.md` per reply, and resource blobs for
 * attached media when the storage driver can fetch them.
 */
async function buildThreadBundle(
  root: Post,
  threadReplies: Post[],
  rootSlug: string,
  rootAliases: string[],
  rootCollectionEntries: ExportedCollectionEntry[],
  slugMap: Map<string, string>,
  mediaByPost: Map<string, Media[]>,
  siteConfig: SiteConfig,
  storage: StorageDriver | null,
  bundleMedia: boolean,
): Promise<ExportFile[]> {
  const files: ExportFile[] = [];
  const featuredPosts = [root, ...threadReplies].filter(
    (post) => post.status === "published" && post.featuredAt !== null,
  );
  const featuredPostIds = featuredPosts.map((post) => post.id);
  const featuredSortAt = featuredPosts.reduce<number | null>(
    (latest, post) =>
      Math.max(latest ?? -1, post.publishedAt ?? post.createdAt),
    null,
  );

  // Root aliases = historical root slugs + every reply slug (so
  // /{reply-slug}/ gets a Hugo alias page that redirects/anchors to
  // the thread root).
  const aliases = [...rootAliases];
  for (const reply of threadReplies) {
    const replySlug = slugMap.get(reply.id) ?? reply.slug;
    aliases.push(`/${replySlug}/`);
  }

  // Root front matter.
  const rootMedia = mediaByPost.get(root.id) ?? [];
  const rootEmissions = rootMedia.map((m) =>
    buildMediaEmission(m, siteConfig, bundleMedia),
  );
  const rootMediaList = rootEmissions.map((e) => e.entry);
  const rootFrontMatter: HugoFrontMatter = {
    id: root.id,
    title: root.format !== "quote" ? (root.title ?? undefined) : undefined,
    date:
      root.publishedAt !== null
        ? toISOString(root.publishedAt)
        : toISOString(root.createdAt),
    updated:
      root.updatedAt && root.updatedAt !== root.publishedAt
        ? toISOString(root.updatedAt)
        : undefined,
    // `updated` only reflects edits to the root post itself; when a reply
    // lands, it does NOT bump. For RSS we want the thread's last activity
    // (max of all published reply timestamps) so readers re-surface a
    // thread when a new reply appears. Kept alongside `updated` so the
    // importer round-trips cleanly.
    last_activity_at:
      root.lastActivityAt !== null && root.lastActivityAt !== root.publishedAt
        ? toISOString(root.lastActivityAt)
        : undefined,
    slug: rootSlug,
    type: "post",
    draft:
      root.status === "draft" || root.visibility === "private"
        ? true
        : undefined,
    aliases: aliases.length > 0 ? aliases : undefined,
    format: root.format,
    status: root.status,
    visibility: root.visibility,
    // Language is Thread-uniform, so only the root emits it; the importer
    // re-derives replies from their root. `translation_group` is an opaque
    // shared key — importing the whole site keeps translated posts linked.
    language: root.language ?? undefined,
    translation_group: root.translationGroupId ?? undefined,
    summary_text: getArchiveSummaryText(root) ?? undefined,
    link_url: root.format === "link" && root.url ? root.url : undefined,
    source_name: root.format === "quote" && root.title ? root.title : undefined,
    source_url: root.format === "quote" && root.url ? root.url : undefined,
    quote_text: root.quoteText ?? undefined,
    rating: root.rating ?? undefined,
    featured_at:
      root.featuredAt !== null ? toISOString(root.featuredAt) : undefined,
    featured_post_ids: featuredPostIds.length > 0 ? featuredPostIds : undefined,
    featured_sort_at:
      featuredSortAt !== null ? toISOString(featuredSortAt) : undefined,
    pinned_at: root.pinnedAt !== null ? toISOString(root.pinnedAt) : undefined,
    root_aliases: rootAliases.length > 0 ? rootAliases : undefined,
    collections:
      rootCollectionEntries.length > 0
        ? collectionEntriesToRefs(rootCollectionEntries)
        : undefined,
    media: rootMediaList.length > 0 ? rootMediaList : undefined,
  };

  const rootBody = root.body ? tiptapJsonToMarkdown(root.body) : "";
  files.push({
    path: `content/${rootSlug}/_index.md`,
    content: `${await formatFrontMatter(rootFrontMatter)}\n${rootBody}${rootBody.endsWith("\n") ? "" : "\n"}`,
  });

  // Emit media bytes under static/media/ for any media without a
  // reachable public URL. Media whose provider has a configured public
  // URL keeps `src` pointing at that absolute URL and skips inlining —
  // this avoids re-downloading every attachment when the site is going
  // to keep serving media from the existing CDN/proxy anyway.
  for (const { emission, media } of rootEmissions.map((e, i) => ({
    emission: e,
    media: rootMedia[i] as Media,
  }))) {
    if (emission.inlinePath) {
      const file = await readMediaResourceFile(
        storage,
        media.storageKey,
        emission.inlinePath,
      );
      if (file) files.push(file);
    }
    if (emission.inlinePosterPath && media.posterKey) {
      const posterFile = await readMediaResourceFile(
        storage,
        media.posterKey,
        emission.inlinePosterPath,
      );
      if (posterFile) files.push(posterFile);
    }
  }

  // Replies as nested leaf bundles.
  for (const reply of threadReplies) {
    const replySlug = slugMap.get(reply.id) ?? reply.slug;
    const replyMedia = mediaByPost.get(reply.id) ?? [];
    const replyEmissions = replyMedia.map((m) =>
      buildMediaEmission(m, siteConfig, bundleMedia),
    );
    const replyMediaList = replyEmissions.map((e) => e.entry);
    const replyFrontMatter: HugoFrontMatter = {
      id: reply.id,
      title: reply.format !== "quote" ? (reply.title ?? undefined) : undefined,
      date:
        reply.publishedAt !== null
          ? toISOString(reply.publishedAt)
          : toISOString(reply.createdAt),
      updated:
        reply.updatedAt && reply.updatedAt !== reply.publishedAt
          ? toISOString(reply.updatedAt)
          : undefined,
      slug: replySlug,
      type: "post",
      draft:
        reply.status === "draft" || reply.visibility === "private"
          ? true
          : undefined,
      build: { render: "never", list: "local" },
      format: reply.format,
      status: reply.status,
      visibility: reply.visibility,
      summary_text: getArchiveSummaryText(reply) ?? undefined,
      link_url: reply.format === "link" && reply.url ? reply.url : undefined,
      source_name:
        reply.format === "quote" && reply.title ? reply.title : undefined,
      source_url: reply.format === "quote" && reply.url ? reply.url : undefined,
      quote_text: reply.quoteText ?? undefined,
      rating: reply.rating ?? undefined,
      quiet_reply: reply.quietReply ? true : undefined,
      featured_at:
        reply.featuredAt !== null ? toISOString(reply.featuredAt) : undefined,
      pinned_at:
        reply.pinnedAt !== null ? toISOString(reply.pinnedAt) : undefined,
      media: replyMediaList.length > 0 ? replyMediaList : undefined,
    };

    const replyBody = reply.body ? tiptapJsonToMarkdown(reply.body) : "";
    files.push({
      path: `content/${rootSlug}/${replySlug}/index.md`,
      content: `${await formatFrontMatter(replyFrontMatter)}\n${replyBody}${replyBody.endsWith("\n") ? "" : "\n"}`,
    });

    for (const { emission, media } of replyEmissions.map((e, i) => ({
      emission: e,
      media: replyMedia[i] as Media,
    }))) {
      if (emission.inlinePath) {
        const file = await readMediaResourceFile(
          storage,
          media.storageKey,
          emission.inlinePath,
        );
        if (file) files.push(file);
      }
      if (emission.inlinePosterPath && media.posterKey) {
        const posterFile = await readMediaResourceFile(
          storage,
          media.posterKey,
          emission.inlinePosterPath,
        );
        if (posterFile) files.push(posterFile);
      }
    }
  }

  return files;
}

/**
 * Read a media record's bytes from storage and return an ExportFile so
 * they can be bundled next to the post as a Hugo page resource. Returns
 * null when storage is unavailable or the object cannot be read, in
 * which case the front matter entry still points at the resource name
 * and the CLI's pull-media step (or a later sync) can fill it in.
 */
async function readMediaResourceFile(
  storage: StorageDriver | null,
  storageKey: string,
  bundlePath: string,
): Promise<ExportFile | null> {
  if (!storage) return null;
  try {
    const bytes = await readStorageObjectBytes(storage, storageKey);
    if (!bytes) return null;
    return { path: bundlePath, content: bytes };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Section + landing pages
// ---------------------------------------------------------------------------

async function buildHomeSection(siteConfig: SiteConfig): Promise<string> {
  const frontMatter: HugoFrontMatter = {
    title: siteConfig.siteName,
    type: "home",
  };
  return `${await formatFrontMatter(frontMatter)}\n`;
}

async function buildCollectionsSection(): Promise<string> {
  const frontMatter: HugoFrontMatter = {
    title: "Collections",
    type: "collections",
  };
  return `${await formatFrontMatter(frontMatter)}\n`;
}

async function buildArchiveSection(rssFeedsEnabled: boolean): Promise<string> {
  const frontMatter: HugoFrontMatter = {
    title: "Archive",
    type: "archive",
    // Opt into Atom output at /archive/index.xml.
    outputs: rssFeedsEnabled ? ["html", "rss"] : ["html"],
  };
  return `${await formatFrontMatter(frontMatter)}\n`;
}

async function buildFeaturedSection(rssFeedsEnabled: boolean): Promise<string> {
  const frontMatter: HugoFrontMatter = {
    title: "Featured",
    type: "featured",
    // Opt into Atom output at /featured/index.xml.
    outputs: rssFeedsEnabled ? ["html", "rss"] : ["html"],
  };
  return `${await formatFrontMatter(frontMatter)}\n`;
}

async function buildCollectionSection(
  collection: Collection,
  slug: string,
  entryCount: number,
  rssFeedsEnabled: boolean,
): Promise<string> {
  const frontMatter: HugoFrontMatter = {
    title: collection.title,
    slug,
    type: "collection",
    summary_text: collection.description ?? undefined,
    sort_order: collection.sortOrder,
    entry_count: entryCount,
    // Opt into Atom output at /{slug}/index.xml.
    outputs: rssFeedsEnabled ? ["html", "rss"] : ["html"],
  };
  return `${await formatFrontMatter(frontMatter)}\n`;
}

// ---------------------------------------------------------------------------
// Summary extraction (kept from the previous exporter)
// ---------------------------------------------------------------------------

function normalizeArchiveText(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function getArchiveSummaryText(post: Post): string | null {
  // `summary_text` is a plain-text projection of the post's primary content,
  // used for `<meta name="description">`, `og:description`, and archive/card
  // fallbacks when the rendered body is empty. The candidate list differs
  // per format so the description reflects the right "primary content":
  //
  // - Quote: body (commentary) → quoteText. Quotes have no title, so we
  //   fall back to the quote itself to guarantee a meaningful description.
  // - Link: body only. Links have a title + domain; the URL is already
  //   serialized as `link_url` and rendered as a domain badge, so using
  //   it as `summary_text` would duplicate that information.
  // - Note: body only. If the body is empty, there's nothing to describe.
  //
  // Note: we re-derive the body text from `post.body` (TipTap JSON) rather
  // than reusing `post.bodyText`, because `bodyText` is written with
  // `includeLinkHrefs: true` for FTS search indexing — that pollutes the
  // stored text with trailing link URLs. Here we need clean prose.
  const cleanBodyText = post.body ? extractBodyText(post.body) : null;
  const candidates =
    post.format === "quote"
      ? [post.summary, cleanBodyText, post.quoteText]
      : [post.summary, cleanBodyText];

  for (const candidate of candidates) {
    const normalized = normalizeArchiveText(candidate);
    if (normalized) return normalized;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Collection metrics + directory items (kept from the previous exporter)
// ---------------------------------------------------------------------------

function formatCollectionActivityLabel(
  timestamp: number | undefined,
): string | null {
  if (typeof timestamp !== "number") {
    return null;
  }

  return formatRelativeAge(timestamp);
}

function formatCollectionActivityIso(
  timestamp: number | undefined,
): string | null {
  if (typeof timestamp !== "number") {
    return null;
  }

  return toISOString(timestamp);
}

/**
 * Group-aware sequence labels for the exported collection directory.
 *
 * Mirrors the main site's `computeSequenceLabels` in
 * `ui/shared/CollectionDirectory.tsx` so Hugo exports render the same numeric
 * indices (e.g. "00" "01" under the first divider, "10" "11" under the
 * second). Dividers themselves receive an empty string — their slot is
 * reserved so the returned array is index-aligned with the source list.
 */
function computeCollectionDirectorySequenceLabels(
  items: readonly ExportCollectionDirectorySourceItem[],
): string[] {
  const isContentItem = (item: ExportCollectionDirectorySourceItem) =>
    (item.type === "collection" && item.collection) ||
    (item.type === "link" && item.label && item.url);

  const groupSizes: number[] = [];
  let seenDivider = false;
  let ungroupedCount = 0;
  for (const item of items) {
    if (item.type === "divider") {
      seenDivider = true;
      groupSizes.push(0);
    } else if (isContentItem(item)) {
      if (seenDivider) {
        const lastGroupIndex = groupSizes.length - 1;
        const lastGroupSize = groupSizes[lastGroupIndex];
        if (lastGroupSize !== undefined) {
          groupSizes[lastGroupIndex] = lastGroupSize + 1;
        }
      } else {
        ungroupedCount += 1;
      }
    }
  }

  const hasGroups = groupSizes.length > 0;
  const maxGroupIndex = Math.max(0, groupSizes.length - 1);
  const groupWidth = hasGroups
    ? Math.max(1, maxGroupIndex.toString(36).length)
    : 0;
  const ungroupedItemWidth = Math.max(
    2,
    String(Math.max(0, ungroupedCount - 1)).length,
  );

  const labels: string[] = [];
  let groupIndex = -1;
  let itemIndex = 0;

  for (const item of items) {
    if (item.type === "divider") {
      groupIndex += 1;
      itemIndex = 0;
      labels.push("");
    } else if (isContentItem(item)) {
      if (hasGroups) {
        const g = Math.max(0, groupIndex)
          .toString(36)
          .padStart(groupWidth, "0");
        const i = itemIndex.toString(36);
        labels.push(g + i);
      } else {
        labels.push(String(itemIndex).padStart(ungroupedItemWidth, "0"));
      }
      itemIndex += 1;
    } else {
      labels.push("");
    }
  }

  return labels;
}

function buildExportedCollectionDirectoryItems(
  items: readonly ExportCollectionDirectorySourceItem[],
  collectionSlugMap: Map<string, string>,
  collectionMetrics: Map<string, ExportedCollectionMetrics>,
): ExportedCollectionDirectoryItem[] {
  const sequenceLabels = computeCollectionDirectorySequenceLabels(items);
  const exportedItems: ExportedCollectionDirectoryItem[] = [];

  items.forEach((item, index) => {
    if (item.type === "divider") {
      exportedItems.push({
        type: "divider",
        label: item.label ?? null,
      });
      return;
    }

    if (item.type === "link") {
      if (!item.label || !item.url) {
        return;
      }

      const description = item.description?.trim();
      exportedItems.push({
        type: "link",
        sequence: sequenceLabels[index] ?? "",
        label: item.label,
        url: item.url,
        descriptionHtml: description
          ? renderMarkdown(description, {
              namespace: `collection-directory-link-${sequenceLabels[index] ?? index}`,
            })
          : null,
      });
      return;
    }

    const collection = item.collection;
    if (!collection?.id) {
      return;
    }

    const slug = collectionSlugMap.get(collection.id) ?? collection.slug;
    if (!slug) {
      return;
    }
    const metrics = collectionMetrics.get(collection.id);
    const activityTimestamp =
      metrics?.recentActivityAt ?? collection.recentActivityAt;

    const collectionDescription = collection.description?.trim();
    exportedItems.push({
      type: "collection",
      sequence: sequenceLabels[index] ?? "",
      slug,
      title: collection.title || slug,
      descriptionHtml: collectionDescription
        ? renderMarkdown(collectionDescription, { namespace: collection.id })
        : null,
      entryCount:
        metrics?.threadCount ??
        (typeof collection.threadCount === "number"
          ? collection.threadCount
          : undefined),
      recentActivityLabel: formatCollectionActivityLabel(activityTimestamp),
      recentActivityIso: formatCollectionActivityIso(activityTimestamp),
    });
  });

  return exportedItems;
}

function buildExportedCollectionMetrics(
  collections: readonly Collection[],
  posts: readonly Post[],
  collectionsByThread: ReadonlyMap<string, readonly Collection[]>,
): Map<string, ExportedCollectionMetrics> {
  const metrics = new Map<string, ExportedCollectionMetrics>();

  for (const collection of collections) {
    metrics.set(collection.id, {
      threadCount: 0,
      recentActivityAt: collection.updatedAt,
    });
  }

  for (const post of posts) {
    // Drafts and private posts are excluded — they won't reach Hugo.
    if (post.status === "draft" || post.visibility === "private") {
      continue;
    }
    // Replies roll up into their thread root for directory metrics.
    if (post.replyToId !== null) {
      continue;
    }

    const activityAt = getRootActivityAt(post);
    const threadCollections = collectionsByThread.get(post.id) ?? [];

    for (const collection of threadCollections) {
      const current = metrics.get(collection.id);
      if (!current) {
        continue;
      }

      if (current.threadCount === 0) {
        current.recentActivityAt = activityAt;
      } else {
        current.recentActivityAt = Math.max(
          current.recentActivityAt,
          activityAt,
        );
      }
      current.threadCount += 1;
    }
  }

  return metrics;
}

// ---------------------------------------------------------------------------
// Nav item resolution
// ---------------------------------------------------------------------------

function resolveNavItemLabel(item: SiteConfig["navItems"][number]): string {
  if (item.label) return item.label;
  if (item.systemKey) {
    const definition = SYSTEM_NAV_KEYS[item.systemKey as SystemNavKey];
    if (definition) return definition.defaultLabel;
  }
  return item.label;
}

/**
 * Resolve a nav item's final href for the Hugo export.
 *
 * Mirrors the runtime logic in `lib/view.ts:toNavItemView`. System URLs
 * stored in the DB are canonicalized during export so stale DB values do not
 * leak into the static site's navigation.
 *
 * The "rss" system nav item points at whichever Atom feed the site has
 * configured as its main feed: `mainRssFeed === "featured"` → the featured
 * section feed at `/featured/index.xml`, otherwise the home feed at
 * `/index.xml` (which mirrors the homepage's "latest" timeline).
 */
function resolveNavItemUrl(
  item: SiteConfig["navItems"][number],
  mainRssFeed: string,
): string {
  if (item.systemKey === "latest") {
    return "/";
  }
  if (item.systemKey === "featured") {
    return "/featured/";
  }
  if (item.systemKey === "collections") return "/collections/";
  if (item.systemKey === "archive") return "/archive/";
  if (item.systemKey === "rss") {
    return mainRssFeed === "featured" ? "/featured/index.xml" : "/index.xml";
  }
  return item.url;
}

// ---------------------------------------------------------------------------
// hugo.toml + data TOMLs
// ---------------------------------------------------------------------------

/** Escape a string for use inside a TOML double-quoted value. */
function escapeTomlString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

function buildHugoToml(config: SiteConfig): string {
  const baseUrl = (config.siteUrl || "https://example.com").replace(/\/+$/, "");
  // Hugo requires language codes to be all lowercase (it rejects the BCP-47
  // casing `zh-Hant` / `zh-Hans` with "must be all lower case and no spaces").
  const language = config.siteLanguage.toLowerCase();
  const parts: string[] = [
    `baseURL = "${escapeTomlString(baseUrl)}/"`,
    `title = "${escapeTomlString(config.siteName)}"`,
    `languageCode = "${escapeTomlString(language)}"`,
    `defaultContentLanguage = "${escapeTomlString(language)}"`,
    'theme = "jant"',
    `paginate = ${config.pageSize}`,
    "enableRobotsTXT = true",
    // Disable Hugo's built-in taxonomies — jant has no tags or categories
    // and the default empty /tags/ and /categories/ pages are noise. This
    // must stay at the root (before any `[table]` header) so TOML doesn't
    // nest it under the previous table.
    "disableKinds = ['taxonomy', 'term']",
    "",
    "[permalinks]",
    '  post = "/:slug/"',
    "",
    "[markup]",
    "  [markup.goldmark]",
    "    [markup.goldmark.renderer]",
    "      unsafe = true",
    "",
    // Emit an Atom 2005 feed at the site root (/index.xml). Per-section
    // feeds (featured, archive, each collection) are opted in via each
    // section's front matter `outputs: ["html", "rss"]` — enabling RSS on
    // `section` globally here would also create a feed at every root post's
    // URL, since root posts are themselves branch bundles / sections.
    // Override the built-in RSS output format to emit Atom instead of
    // RSS 2.0 so the wire format mirrors the main site's `lib/feed.ts`.
    "[outputs]",
    `  home = ["html"${config.rssFeedsEnabled ? ', "rss"' : ""}]`,
    // Hugo's default for sections is ["html", "rss"] — without overriding
    // it here every root post (which is a section) would get its own
    // /{slug}/index.xml. Turn sections off by default and re-enable RSS
    // on just featured, archive, and each collection via per-section
    // front matter `outputs: ["html", "rss"]`.
    '  section = ["html"]',
    "",
    "[outputFormats]",
    "  [outputFormats.RSS]",
    '    mediaType = "application/atom+xml"',
    '    baseName = "index"',
    // Use text/template (not html/template) so Hugo doesn't HTML-escape
    // the XML prologue, CDATA markers, or tag literals. Every dynamic
    // value inside the template passes through `transform.XMLEscape`.
    "    isPlainText = true",
    '    rel = "alternate"',
    "",
    "[mediaTypes]",
    '  [mediaTypes."application/atom+xml"]',
    '    suffixes = ["xml"]',
    "",
    "[params]",
    `  description = "${escapeTomlString(config.siteDescription)}"`,
    `  main_rss_feed = "${escapeTomlString(config.mainRssFeed)}"`,
    `  public_api_enabled = ${config.publicApiEnabled}`,
    `  rss_feeds_enabled = ${config.rssFeedsEnabled}`,
    `  show_jant_branding_on_home = ${config.showJantBrandingOnHome}`,
    `  show_header_avatar = ${config.showHeaderAvatar}`,
    `  noindex = ${config.noindex}`,
    `  theme_id = "${escapeTomlString(config.themeId)}"`,
    `  default_theme_id = "${escapeTomlString(config.defaultThemeId)}"`,
    `  font_theme_id = "${escapeTomlString(config.fontThemeId)}"`,
    `  theme_mode = "${escapeTomlString(config.themeMode)}"`,
    `  page_size = ${config.pageSize}`,
    `  archive_page_size = ${config.archivePageSize}`,
    `  rss_feed_limit = ${config.rssFeedLimit}`,
  ];
  if (config.siteAvatarUrl) {
    parts.push(
      `  site_avatar_url = "${escapeTomlString(config.siteAvatarUrl)}"`,
    );
  }
  if (config.faviconVersion) {
    parts.push(
      `  favicon_version = "${escapeTomlString(config.faviconVersion)}"`,
    );
  }

  return `${parts.join("\n")}\n`;
}

function buildJantDataToml(
  config: SiteConfig,
  iconAssets: SiteIconAssets,
  directoryItems: readonly ExportedCollectionDirectoryItem[],
): string {
  const footerHtml = config.siteFooter
    ? renderMarkdown(config.siteFooter, { namespace: "site-footer" })
    : "";
  const parts: string[] = [
    'format = "jant-site"',
    "version = 1",
    `generated_at = "${escapeTomlString(toISOString(Math.floor(Date.now() / 1000)))}"`,
    `site_name = "${escapeTomlString(config.siteName)}"`,
    `site_description = "${escapeTomlString(config.siteDescription)}"`,
    `site_language = "${escapeTomlString(config.siteLanguage)}"`,
    `multilingual_enabled = ${config.multilingualEnabled}`,
    `additional_languages = "${escapeTomlString(config.additionalLanguages.join(","))}"`,
    `main_rss_feed = "${escapeTomlString(config.mainRssFeed)}"`,
    `public_api_enabled = ${config.publicApiEnabled}`,
    `rss_feeds_enabled = ${config.rssFeedsEnabled}`,
    `show_jant_branding_on_home = ${config.showJantBrandingOnHome}`,
    `show_header_avatar = ${config.showHeaderAvatar}`,
    `noindex = ${config.noindex}`,
    `site_avatar_mode = "${config.siteAvatarUrl ? "custom" : "none"}"`,
    `favicon_mode = "${iconAssets.faviconMode}"`,
    `apple_touch_mode = "${iconAssets.appleTouchMode}"`,
    `theme_id = "${escapeTomlString(config.themeId)}"`,
    `default_theme_id = "${escapeTomlString(config.defaultThemeId)}"`,
    `font_theme_id = "${escapeTomlString(config.fontThemeId)}"`,
    `theme_mode = "${escapeTomlString(config.themeMode)}"`,
    `page_size = ${config.pageSize}`,
    `archive_page_size = ${config.archivePageSize}`,
    `rss_feed_limit = ${config.rssFeedLimit}`,
    'favicon_path = "/favicon.ico"',
    'apple_touch_icon_path = "/apple-touch-icon.png"',
  ];
  if (config.siteAvatarUrl) {
    parts.push(`site_avatar_url = "${escapeTomlString(config.siteAvatarUrl)}"`);
  }
  if (config.faviconVersion) {
    parts.push(
      `favicon_version = "${escapeTomlString(config.faviconVersion)}"`,
    );
  }
  if (footerHtml) {
    parts.push(`site_footer_html = "${escapeTomlString(footerHtml)}"`);
  }
  if (config.siteFooter) {
    parts.push(
      `site_footer_markdown = "${escapeTomlString(config.siteFooter)}"`,
    );
  }

  for (const item of config.navItems) {
    // `settings` is authenticated-only and has no corresponding page in the
    // static Hugo site — drop it at export time so it never shows up in nav.
    if (item.systemKey === "settings") continue;
    if (
      !config.rssFeedsEnabled &&
      item.type === "system" &&
      item.systemKey === "rss"
    ) {
      continue;
    }
    parts.push("");
    parts.push("[[nav]]");
    parts.push(`type = "${escapeTomlString(item.type)}"`);
    parts.push(`label = "${escapeTomlString(resolveNavItemLabel(item))}"`);
    parts.push(
      `url = "${escapeTomlString(resolveNavItemUrl(item, config.mainRssFeed))}"`,
    );
    parts.push(`system_key = "${escapeTomlString(item.systemKey ?? "")}"`);
    parts.push(`placement = "${escapeTomlString(item.placement ?? "header")}"`);
  }

  for (const item of directoryItems) {
    parts.push("");
    parts.push("[[directory]]");
    parts.push(`type = "${escapeTomlString(item.type)}"`);
    if (item.type === "collection") {
      parts.push(`sequence = "${escapeTomlString(item.sequence)}"`);
      parts.push(`slug = "${escapeTomlString(item.slug)}"`);
      parts.push(`title = "${escapeTomlString(item.title)}"`);
      if (item.descriptionHtml) {
        parts.push(
          `description_html = "${escapeTomlString(item.descriptionHtml)}"`,
        );
      }
      if (typeof item.entryCount === "number") {
        parts.push(`entry_count = ${item.entryCount}`);
      }
      if (item.recentActivityLabel) {
        parts.push(
          `recent_activity_label = "${escapeTomlString(item.recentActivityLabel)}"`,
        );
      }
      if (item.recentActivityIso) {
        parts.push(
          `recent_activity_iso = "${escapeTomlString(item.recentActivityIso)}"`,
        );
      }
    } else if (item.type === "divider") {
      if (item.label !== null) {
        parts.push(`label = "${escapeTomlString(item.label)}"`);
      }
    } else {
      parts.push(`sequence = "${escapeTomlString(item.sequence)}"`);
      parts.push(`label = "${escapeTomlString(item.label)}"`);
      parts.push(`url = "${escapeTomlString(item.url)}"`);
      if (item.descriptionHtml) {
        parts.push(
          `description_html = "${escapeTomlString(item.descriptionHtml)}"`,
        );
      }
    }
  }

  return `${parts.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// README + .gitignore
// ---------------------------------------------------------------------------

function buildGitignore(): string {
  return `# Hugo build output
public/
resources/
.hugo_build.lock

# OS
.DS_Store
Thumbs.db

# Editors
.vscode/
.idea/
*.swp
`;
}

function buildReadme(siteName: string): string {
  return `# ${siteName} — Hugo Export

This is a static site exported from [Jant](https://github.com/jant-me/jant), ready to build with [Hugo](https://gohugo.io/).

## Install Hugo

This export targets Hugo **extended 0.160.1+**.

**macOS (Homebrew):**

\`\`\`sh
brew install hugo
\`\`\`

**Windows (Scoop):**

\`\`\`sh
scoop install hugo-extended
\`\`\`

**Linux:**

Download the extended build from <https://github.com/gohugoio/hugo/releases>.

See the [Hugo installation docs](https://gohugo.io/installation/) for more options.

## Quick start

Preview locally:

\`\`\`sh
hugo serve
\`\`\`

Then open <http://localhost:1313> in your browser.

Build the site for deployment:

\`\`\`sh
hugo --minify
\`\`\`

The output goes to the \`public/\` directory. Upload it to any static host (Netlify, Vercel, Cloudflare Pages, GitHub Pages, etc.).

## Project structure

\`\`\`
hugo.toml                 — Site configuration (baseURL, title, theme, params)
content/
  _index.md               — Home section
  archive/_index.md       — Archive section
  collections/_index.md   — Collections directory section
  featured/_index.md      — Featured section
  {slug}/
    _index.md             — Thread root (branch bundle)
    {reply-slug}/
      index.md            — Reply (leaf bundle, not rendered as its own URL)
data/
  jant.toml               — Nav items, branding, display preferences, ordered collections directory
themes/jant/              — Bundled Hugo theme (overrideable via layouts/ at the site root)
static/                   — Copy files here to add them to the published site
\`\`\`

## Customizing

- **Site settings** — edit \`hugo.toml\` to change the baseURL, title, or pagination.
- **Jant metadata** — \`data/jant.toml\` drives nav and the collections directory, and is preserved across round-trip import.
- **Styles** — edit \`themes/jant/static/main.css\`, or drop a \`static/main.css\` at the site root to override.
- **Templates** — add files under \`layouts/\` at the site root to override the bundled theme.
- **Debugging** — from a Jant site project, run \`npx jant site export --directory ./my-site\`, then \`cd my-site && hugo serve\`.

## Fetching media locally

When the source site has a storage provider configured (R2/S3/local proxy), images and attachments in this export link to the provider URL instead of being bundled. That keeps the repo small but means the files aren't on disk — fine if Hugo can reach the internet, not fine if you want a fully self-contained archive.

To download every referenced media file into \`static/media/\` and rewrite the references to local paths, run this from the root of the export:

\`\`\`sh
npx @jant/core site pull-media --path .
\`\`\`

Safe to re-run; files already on disk are reused. Anything that fails to download keeps its original URL so the site still builds.

## Notes

- Each thread is a Hugo branch bundle. Replies live as nested leaf bundles with \`build.render = "never"\` so they do not produce standalone URLs; they render inside the thread page.
- \`/{reply-slug}/\` URLs are preserved via \`aliases:\` on the root post, so old links still land on the right thread anchor.
- Media is emitted under \`static/media/{id}.ext\` and referenced from a flat \`media:\` array on each post. When a storage provider has a configured public URL (R2/S3/local proxy), the exporter links to the provider URL instead of re-bundling the bytes.
- Posts with \`draft: true\` in front matter are only built when you pass \`--buildDrafts\` to \`hugo\` / \`hugo serve\`.
`;
}

// ---------------------------------------------------------------------------
// Re-exports for consumers (kept so existing entry points compile)
// ---------------------------------------------------------------------------

export {
  buildSiteIconAssets,
  buildExportedCollectionMetrics,
  buildExportedCollectionDirectoryItems,
  readStorageObjectBytes,
  getArchiveSummaryText,
  getMediaUrl,
  getPublicUrlForProvider,
};
