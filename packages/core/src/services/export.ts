/**
 * Export Service
 *
 * Generates a ready-to-use Zola static site as a ZIP archive.
 * Threads are merged into single pages with reply marker comments.
 * Media URLs point to the original site (not exported).
 */

import type { PostService } from "./post.js";
import type { PathService } from "./path.js";
import type { CollectionService } from "./collection.js";
import type { MediaService } from "./media.js";
import {
  getDefaultJantAppleTouchIconBytes,
  getDefaultJantFaviconIcoBytes,
  HOME_BRANDING_LINK_LABEL,
  HOME_BRANDING_PREFIX,
  JANT_REPO_URL,
} from "../lib/jant-branding.js";
import {
  DECORATIVE_QUOTE_MARK_SVG_CONTENT,
  DECORATIVE_QUOTE_MARK_VIEWBOX,
} from "../lib/decorative-quote-mark.js";
import { tiptapJsonToMarkdown } from "../lib/tiptap-to-markdown.js";
import { getMediaUrl, getPublicUrlForProvider } from "../lib/image.js";
import { FEATURED_SPARKLE_PATH } from "../lib/featured-icons.js";
import { escapeHtml } from "../lib/html.js";
import { render as renderMarkdown } from "../lib/markdown.js";
import { toISOString, formatDate } from "../lib/time.js";
// Shared design tokens — single source of truth for colors, typography,
// and layout variables. Consumed verbatim by both the main site (via
// Tailwind) and the Zola export (written to static/tokens.css). Using
// ?raw inlines the file contents as a string at build time so the
// Worker bundle ships without any filesystem access.
import TOKENS_CSS from "../styles/tokens.css?raw";
import type { StorageDriver } from "../lib/storage.js";
import { base64ToUint8Array } from "../lib/favicon.js";
import type { Post, Collection, Media, NavItem } from "../types.js";

/** A file entry in the exported Zola site. */
export interface ExportFile {
  path: string;
  content: string | Uint8Array;
}

export interface ExportService {
  /** Generate a flat list of files for a complete Zola site. */
  generateZolaFiles(): Promise<ExportFile[]>;
  /** Generate a ZIP archive of the Zola site. */
  generateZolaSite(): Promise<Uint8Array>;
}

export interface SiteConfig {
  siteName: string;
  siteUrl: string;
  siteDescription: string;
  siteLanguage: string;
  showJantBrandingOnHome: boolean;
  homeDefaultView: string;
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
  /** Items per page for Zola pagination — kept in sync with the main site's PAGE_SIZE. */
  pageSize: number;
  /** Items per archive page — kept in sync with the main site's ARCHIVE_PAGE_SIZE. */
  archivePageSize: number;
}

interface AttachmentExportMeta {
  kind: Media["mediaKind"];
  src: string;
  poster: string | null;
  mimeType: string;
  originalName: string;
  size: number;
  width: number | null;
  height: number | null;
  alt: string | null;
  position: string;
  blurhash: string | null;
  waveform: string | null;
  summary: string | null;
  chars: number | null;
}

type IconExportMode = "default" | "custom";

type ExportedCollectionDirectoryItem =
  | {
      type: "collection";
      slug: string;
      title: string;
      entryCount?: number;
      recentActivityLabel?: string | null;
    }
  | {
      type: "divider";
      label: string | null;
    }
  | {
      type: "link";
      label: string;
      url: string;
    };

interface ExportCollectionDirectorySourceItem {
  type: "collection" | "divider" | "link";
  label?: string | null;
  url?: string | null;
  collection?: {
    id: string;
    slug: string;
    title: string;
    postCount?: number;
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
  postCount: number;
  recentActivityAt: number;
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
  deps: { storage?: StorageDriver | null } = {},
): ExportService {
  return {
    async generateZolaFiles() {
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
        collectionsByPost,
        collectionPinsByPost,
        rawMediaByPost,
        slugMap,
        aliasMap,
        collectionSlugMap,
      ] = await Promise.all([
        services.collections.getCollectionsByPostIds(allPostIds),
        services.collections.getCollectionPinsByPostIds(allPostIds),
        services.media.getByPostIds(allPostIds),
        services.paths.getPostSlugMap(allPostIds),
        services.paths.getPostAliases(rootPostIds),
        services.paths.getCollectionSlugMap(allCollections.map((c) => c.id)),
      ]);
      const iconAssets = await buildSiteIconAssets(siteConfig, deps.storage);
      const collectionMetrics = buildExportedCollectionMetrics(
        allCollections,
        allPosts,
        collectionsByPost,
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

      // Generate post files
      for (const root of roots) {
        const slug = slugMap.get(root.id) ?? root.slug;
        const threadReplies = repliesByThread.get(root.id) ?? [];
        const postCollections = collectionsByPost.get(root.id) ?? [];
        const rootAliases = [...(aliasMap.get(root.id) ?? [])];
        const zolaAliases = [...rootAliases];
        const rootMedia = rawMediaByPost.get(root.id) ?? [];

        // Resolve which collection slugs this post is pinned in. The Zola
        // collection template reads this list to sort pinned posts to the
        // top of each collection page (mirrors the live site behavior).
        const pinnedCollectionIds = collectionPinsByPost.get(root.id);
        const pinnedCollectionSlugs: string[] = [];
        if (pinnedCollectionIds) {
          for (const collectionId of pinnedCollectionIds) {
            const colSlug = collectionSlugMap.get(collectionId);
            if (colSlug) pinnedCollectionSlugs.push(colSlug);
          }
        }

        // Reply URLs must resolve back to the merged thread page in Zola, but
        // they are not root aliases when round-tripping into Jant.
        for (const reply of threadReplies) {
          const replySlug = slugMap.get(reply.id) ?? reply.slug;
          zolaAliases.push(`/${replySlug}`);
        }

        const markdown = buildPostMarkdown(
          root,
          threadReplies,
          postCollections,
          { rootAliases, zolaAliases },
          slugMap,
          collectionSlugMap,
          rootMedia,
          rawMediaByPost,
          siteConfig,
          pinnedCollectionSlugs,
        );

        exportFiles.push({
          path: `content/${slug}/index.md`,
          content: markdown,
        });
      }

      for (const collection of allCollections) {
        const slug = collectionSlugMap.get(collection.id) ?? collection.slug;
        const entryCount = collectionMetrics.get(collection.id)?.postCount ?? 0;
        const section = buildCollectionSection(collection, slug, entryCount);
        exportFiles.push({
          path: `content/${slug}/_index.md`,
          content: section,
        });
      }

      // Generate scaffold
      exportFiles.push({
        path: "config.toml",
        content: buildConfigToml(
          siteConfig,
          iconAssets,
          exportedCollectionDirectoryItems,
        ),
      });
      exportFiles.push({
        path: "content/_index.md",
        content: buildRootSection(),
      });
      exportFiles.push({
        path: "content/collections/_index.md",
        content: buildCollectionsSection(),
      });
      exportFiles.push({
        path: "content/archive/_index.md",
        content: buildArchiveSection(),
      });
      // /featured section — root-URL listing of posts with extra.featured == true.
      // Skipped if "featured" is already taken by a post or collection slug
      // (path_registry on the main site should prevent this, but we belt-and-
      // braces: Zola would otherwise fail to build with a directory clash).
      const usedSlugs = new Set<string>();
      for (const s of slugMap.values()) usedSlugs.add(s);
      for (const s of collectionSlugMap.values()) usedSlugs.add(s);
      if (!usedSlugs.has("featured")) {
        exportFiles.push({
          path: "content/featured/_index.md",
          content: buildFeaturedSection(),
        });
        exportFiles.push({
          path: "themes/jant/templates/featured.html",
          content: TEMPLATE_FEATURED,
        });
      }
      exportFiles.push({
        path: "themes/jant/theme.toml",
        content: buildThemeToml(),
      });
      exportFiles.push({
        path: "themes/jant/templates/base.html",
        content: TEMPLATE_BASE,
      });
      exportFiles.push({
        path: "themes/jant/templates/archive.html",
        content: TEMPLATE_ARCHIVE,
      });
      exportFiles.push({
        path: "themes/jant/templates/index.html",
        content: TEMPLATE_INDEX,
      });
      exportFiles.push({
        path: "themes/jant/templates/page.html",
        content: TEMPLATE_PAGE,
      });
      exportFiles.push({
        path: "themes/jant/templates/section.html",
        content: TEMPLATE_SECTION,
      });
      exportFiles.push({
        path: "themes/jant/templates/taxonomy_list.html",
        content: TEMPLATE_TAXONOMY_LIST,
      });
      exportFiles.push({
        path: "themes/jant/templates/taxonomy_single.html",
        content: TEMPLATE_TAXONOMY_SINGLE,
      });
      exportFiles.push({
        path: "themes/jant/templates/feed/single.html",
        content: TEMPLATE_FEED_SINGLE,
      });
      exportFiles.push({
        path: "themes/jant/templates/feed/list.html",
        content: TEMPLATE_FEED_LIST,
      });
      exportFiles.push({
        path: "themes/jant/templates/collection.html",
        content: TEMPLATE_COLLECTION,
      });
      exportFiles.push({
        path: "themes/jant/templates/atom.xml",
        content: TEMPLATE_ATOM,
      });
      exportFiles.push({
        path: "themes/jant/templates/macros.html",
        content: TEMPLATE_MACROS,
      });
      exportFiles.push({
        path: "themes/jant/static/tokens.css",
        content: TOKENS_CSS,
      });
      exportFiles.push({
        path: "themes/jant/static/style.css",
        content: STYLE_CSS,
      });
      exportFiles.push({
        path: "themes/jant/static/theme.css",
        content: siteConfig.themeCss ?? "",
      });
      exportFiles.push({
        path: "themes/jant/static/custom.css",
        content: siteConfig.customCss ?? "",
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

    async generateZolaSite() {
      const exportFiles = await this.generateZolaFiles();
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
// Markdown generation
// ---------------------------------------------------------------------------

/** Escape a string for use inside a TOML double-quoted value */
function escapeToml(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

/** Escape a string for use in YAML (wrap in quotes if needed) */
function yamlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

/**
 * Map a post onto `feed` taxonomy terms. Private posts are emitted with
 * `draft: true` and never reach Zola, so they get no terms.
 *
 * Pinned posts are routed to `feed=pinned` instead of `feed=public` so
 * Zola's paginator for `/feed/public/page/N/` doesn't see them — that's
 * what lets the home page prepend pinned posts manually without causing
 * a duplicate on page 2+ (see the "no dup/skip at boundary" risk in
 * tasks/zola-theme-and-feed-taxonomy.md).
 */
function feedTermsForPost(
  post: Pick<Post, "visibility" | "pinnedAt">,
): string[] {
  if (post.visibility === "private") return [];
  if (post.visibility === "latest_hidden") return ["unlisted"];
  const public_or_pinned = post.pinnedAt !== null ? "pinned" : "public";
  return [public_or_pinned, "archive"];
}

export function buildPostMarkdown(
  root: Post,
  threadReplies: Post[],
  postCollections: Collection[],
  aliasData: {
    rootAliases: string[];
    zolaAliases: string[];
  },
  slugMap: Map<string, string>,
  collectionSlugMap: Map<string, string>,
  rootMedia: Media[],
  mediaByPost: Map<string, Media[]>,
  siteConfig: SiteConfig,
  pinnedCollectionSlugs: string[] = [],
): string {
  const parts: string[] = [];

  // Front matter (YAML)
  parts.push("---");
  if (root.title && root.format !== "quote") {
    parts.push(`title: ${yamlString(root.title)}`);
  }
  const date = root.publishedAt ?? root.createdAt;
  if (date) {
    parts.push(`date: ${toISOString(date)}`);
  }
  if (root.updatedAt && root.updatedAt !== root.publishedAt) {
    parts.push(`updated: ${toISOString(root.updatedAt)}`);
  }
  if (root.status === "draft" || root.visibility === "private") {
    parts.push("draft: true");
  }

  const slug = slugMap.get(root.id) ?? root.slug;
  parts.push(`slug: ${yamlString(slug)}`);

  if (aliasData.zolaAliases.length > 0) {
    parts.push("aliases:");
    for (const a of aliasData.zolaAliases) {
      parts.push(`  - ${yamlString(a)}`);
    }
  }

  // Taxonomies. Every non-draft post gets a `feed` term so home and
  // archive can be rendered as Zola taxonomy pages (no template-time
  // visibility filtering). Private/draft posts don't reach Zola —
  // `draft: true` above skips them on build.
  const feedTerms = feedTermsForPost(root);
  const hasCollections = postCollections.length > 0;
  const hasFeed = feedTerms.length > 0;
  if (hasCollections || hasFeed) {
    parts.push("taxonomies:");
    if (hasCollections) {
      parts.push("  collections:");
      for (const c of postCollections) {
        const colSlug = collectionSlugMap.get(c.id) ?? c.slug;
        parts.push(`    - ${yamlString(colSlug)}`);
      }
    }
    if (hasFeed) {
      parts.push("  feed:");
      for (const term of feedTerms) {
        parts.push(`    - ${yamlString(term)}`);
      }
    }
  }

  // Extra metadata
  parts.push("extra:");
  parts.push(`  format: ${root.format}`);
  parts.push(`  status: ${root.status}`);
  parts.push(`  visibility: ${root.visibility}`);
  const summaryText = getArchiveSummaryText(root);
  if (summaryText) {
    parts.push(`  summary_text: ${yamlString(summaryText)}`);
  }
  if (root.format === "link" && root.url) {
    parts.push(`  link_url: ${yamlString(root.url)}`);
  }
  if (root.format === "quote" && root.title) {
    parts.push(`  source_name: ${yamlString(root.title)}`);
  }
  if (root.format === "quote" && root.url) {
    parts.push(`  source_url: ${yamlString(root.url)}`);
  }
  if (root.quoteText) {
    parts.push(`  quote_text: ${yamlString(root.quoteText)}`);
  }
  if (root.rating !== null) {
    parts.push(`  rating: ${root.rating}`);
  }
  if (root.pinnedAt !== null) {
    parts.push("  pinned: true");
  }
  if (pinnedCollectionSlugs.length > 0) {
    parts.push("  collection_pins:");
    for (const colSlug of pinnedCollectionSlugs) {
      parts.push(`    - ${yamlString(colSlug)}`);
    }
  }
  if (root.featuredAt !== null) {
    parts.push("  featured: true");
  }
  if (aliasData.rootAliases.length > 0) {
    parts.push("  jant:");
    parts.push("    root_aliases:");
    for (const alias of aliasData.rootAliases) {
      parts.push(`      - ${yamlString(alias)}`);
    }
  }

  parts.push("---");
  parts.push("");

  // Root body
  const rootBlocks = [
    root.body ? tiptapJsonToMarkdown(root.body) : "",
    buildAttachmentBlock(rootMedia, siteConfig),
  ].filter(Boolean);
  if (rootBlocks.length > 0) {
    parts.push(rootBlocks.join("\n\n"));
  }

  // Thread replies
  for (const reply of threadReplies) {
    parts.push("");

    // Visual separator + timestamp (mirrors Atom feed rendering).
    // Importers strip this decoration via splitReplies, so round-tripping is safe.
    if (reply.publishedAt) {
      parts.push("---");
      parts.push("");
      parts.push(
        `<time datetime="${toISOString(reply.publishedAt)}">${formatDate(reply.publishedAt)}</time>`,
      );
      parts.push("");
    }

    // Reply marker comment
    const replySlug = slugMap.get(reply.id) ?? reply.slug;
    const esc = escapeCommentAttribute;
    let marker = `<!-- jant:reply date="${reply.publishedAt ? toISOString(reply.publishedAt) : ""}" slug="${esc(replySlug)}" format="${reply.format}" status="${reply.status}" visibility="${reply.visibility}"`;

    if (reply.format === "link" && reply.url) {
      marker += ` url="${esc(reply.url)}"`;
    }
    if (reply.format === "quote" && reply.quoteText) {
      marker += ` quote_text="${encodeURIComponent(reply.quoteText)}"`;
    }
    if (reply.format === "quote" && reply.title) {
      marker += ` source_name="${esc(reply.title)}"`;
    }
    if (reply.format === "quote" && reply.url) {
      marker += ` source_url="${esc(reply.url)}"`;
    }
    if (reply.rating !== null) {
      marker += ` rating="${reply.rating}"`;
    }
    if (reply.title && reply.format !== "quote") {
      marker += ` title="${esc(reply.title)}"`;
    }
    marker += " -->";

    parts.push(marker);
    parts.push("");

    const replyBlocks = [
      reply.body ? tiptapJsonToMarkdown(reply.body) : "",
      buildAttachmentBlock(mediaByPost.get(reply.id) ?? [], siteConfig),
    ].filter(Boolean);
    if (replyBlocks.length > 0) {
      parts.push(replyBlocks.join("\n\n"));
    }
  }

  return parts.join("\n");
}

export function buildCollectionSection(
  collection: Collection,
  slug: string,
  entryCount: number,
): string {
  const parts: string[] = ["+++"];
  parts.push(`title = "${escapeToml(collection.title)}"`);
  parts.push('template = "collection.html"');
  if (collection.description) {
    parts.push(`description = "${escapeToml(collection.description)}"`);
  }
  parts.push("[extra]");
  parts.push(`sort_order = "${escapeToml(collection.sortOrder)}"`);
  parts.push("jant_collection = true");
  parts.push(`collection_term = "${escapeToml(slug)}"`);
  parts.push(`entry_count = ${entryCount}`);
  parts.push("+++");
  parts.push("");
  return parts.join("\n");
}

function normalizeArchiveText(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function getArchiveSummaryText(post: Post): string | null {
  const candidates =
    post.format === "quote"
      ? [post.summary, post.quoteText, post.bodyText, post.url]
      : [post.summary, post.bodyText, post.quoteText, post.url];

  for (const candidate of candidates) {
    const normalized = normalizeArchiveText(candidate);
    if (normalized) return normalized;
  }

  return null;
}

function buildAttachmentBlock(
  mediaList: Media[],
  siteConfig: SiteConfig,
): string {
  if (mediaList.length === 0) return "";

  const figures = mediaList
    .map((media) => buildAttachmentFigure(media, siteConfig))
    .join("\n");

  return `<div data-jant-node="attachments">\n${figures}\n</div>`;
}

// Inline file-silhouette icons used in non-media attachment cards. Kept inline
// because the export emits a fully self-contained static site — no shared
// component runtime to import from.
const TEXT_CARD_ICON_SVG =
  '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="11" x2="8" y2="11"/><line x1="16" y1="14" x2="8" y2="14"/><line x1="12" y1="17" x2="8" y2="17"/></svg>';

const DOCUMENT_CARD_ICON_SVG =
  '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';

function formatAttachmentChars(count: number): string {
  if (count < 1000) return `${count} chars`;
  if (count < 1_000_000) {
    return `${parseFloat((count / 1000).toFixed(1))}k chars`;
  }
  return `${parseFloat((count / 1_000_000).toFixed(1))}M chars`;
}

function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildAttachmentCardLink(args: {
  href: string;
  iconSvg: string;
  summary: string;
  meta: string | null;
}): string {
  const metaSpan = args.meta
    ? `\n      <span class="jant-attachment-card-meta">${escapeHtml(args.meta)}</span>`
    : "";
  return `<a class="jant-attachment-card" href="${escapeHtml(args.href)}" target="_blank" rel="noopener noreferrer">
    <span class="jant-attachment-card-icon">${args.iconSvg}</span>
    <span class="jant-attachment-card-body">
      <span class="jant-attachment-card-summary">${escapeHtml(args.summary)}</span>${metaSpan}
    </span>
  </a>`;
}

function buildAttachmentFigure(media: Media, siteConfig: SiteConfig): string {
  const meta = buildAttachmentMeta(media, siteConfig);
  const metaJson = safeJsonForHtml(meta);
  const caption =
    media.summary && media.summary !== media.originalName
      ? `<figcaption>${escapeHtml(media.summary)}</figcaption>`
      : "";

  const src = meta.src;

  if (meta.kind === "text") {
    // Text attachments are exported as a card-shaped link to the public
    // `.html` artifact. The browser can render that file standalone (it is a
    // complete HTML document), so readers just click through. The card
    // mirrors the main site's gallery affordance — file icon + summary +
    // character count — but as a pure anchor so it works without JS.
    const summary =
      media.summary?.trim() || meta.originalName || "Text attachment";
    const charsMeta =
      typeof media.chars === "number" && media.chars > 0
        ? formatAttachmentChars(media.chars)
        : null;
    const card = buildAttachmentCardLink({
      href: src,
      iconSvg: TEXT_CARD_ICON_SVG,
      summary,
      meta: charsMeta,
    });
    return `<figure data-jant-node="attachment" data-jant-kind="text">
  <script type="application/json" data-jant-meta>${metaJson}</script>
  ${card}
</figure>`;
  }

  if (meta.kind === "image") {
    const alt = media.alt ? ` alt="${escapeHtml(media.alt)}"` : ' alt=""';
    return `<figure data-jant-node="attachment" data-jant-kind="image">
  <script type="application/json" data-jant-meta>${metaJson}</script>
  <img src="${escapeHtml(src)}"${alt}>${caption ? `\n  ${caption}` : ""}
</figure>`;
  }

  if (meta.kind === "video") {
    const posterAttr = meta.poster
      ? ` poster="${escapeHtml(meta.poster)}"`
      : "";
    return `<figure data-jant-node="attachment" data-jant-kind="video">
  <script type="application/json" data-jant-meta>${metaJson}</script>
  <video controls preload="metadata"${posterAttr}>
    <source src="${escapeHtml(src)}" type="${escapeHtml(meta.mimeType)}">
  </video>${caption ? `\n  ${caption}` : ""}
</figure>`;
  }

  if (meta.kind === "audio") {
    return `<figure data-jant-node="attachment" data-jant-kind="audio">
  <script type="application/json" data-jant-meta>${metaJson}</script>
  <audio controls preload="metadata" src="${escapeHtml(src)}"></audio>${caption ? `\n  ${caption}` : ""}
</figure>`;
  }

  // Documents (and any other non-media kind) get the same card affordance as
  // text attachments: file icon + filename/summary + file size.
  const summary = media.summary?.trim() || meta.originalName;
  const sizeMeta =
    typeof media.size === "number" && media.size > 0
      ? formatAttachmentSize(media.size)
      : null;
  const card = buildAttachmentCardLink({
    href: src,
    iconSvg: DOCUMENT_CARD_ICON_SVG,
    summary,
    meta: sizeMeta,
  });
  return `<figure data-jant-node="attachment" data-jant-kind="${escapeHtml(meta.kind)}">
  <script type="application/json" data-jant-meta>${metaJson}</script>
  ${card}
</figure>`;
}

function buildAttachmentMeta(
  media: Media,
  siteConfig: SiteConfig,
): AttachmentExportMeta {
  const publicUrl = getPublicUrlForProvider(
    media.provider,
    siteConfig.r2PublicUrl,
    siteConfig.s3PublicUrl,
    siteConfig.localPublicUrl,
  );

  // Text attachments are handled via the same code path as any other media:
  // their `storageKey` points to the public `.html` artifact, and readers can
  // fetch it directly from CDN without server involvement. The Tiptap JSON
  // source sits as a sibling at `{storageKey.replace(".html", ".json")}` for
  // anyone who wants to re-render programmatically, but the exported site
  // only ever references the HTML.
  return {
    kind: media.mediaKind,
    src: getMediaUrl(media.storageKey, publicUrl, siteConfig.sitePathPrefix),
    poster: media.posterKey
      ? getMediaUrl(media.posterKey, publicUrl, siteConfig.sitePathPrefix)
      : null,
    mimeType: media.mimeType,
    originalName: media.originalName,
    size: media.size,
    width: media.width,
    height: media.height,
    alt: media.alt,
    position: media.position,
    blurhash: media.blurhash,
    waveform: media.waveform,
    summary: media.summary,
    chars: media.chars,
  };
}

function escapeCommentAttribute(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
}

function safeJsonForHtml(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function formatCollectionActivityLabel(
  timestamp: number | undefined,
): string | null {
  if (typeof timestamp !== "number") {
    return null;
  }

  return toISOString(timestamp).slice(0, 10);
}

/**
 * System nav items on the main site store an empty `label` in the DB and
 * resolve their display text at render time through i18n
 * (`getNavItemDisplayLabel`). The Zola export has no i18n runtime, so fall
 * back to these English defaults when serializing to config.toml. Users can
 * still override by setting a custom label on the nav item.
 */
const SYSTEM_NAV_FALLBACK_LABELS: Record<string, string> = {
  latest: "Latest",
  featured: "Featured",
  collections: "Collections",
  archive: "Archive",
  rss: "RSS",
  settings: "Settings",
};

function resolveNavItemLabel(item: SiteConfig["navItems"][number]): string {
  if (item.label) return item.label;
  if (item.systemKey) {
    const fallback = SYSTEM_NAV_FALLBACK_LABELS[item.systemKey];
    if (fallback) return fallback;
  }
  return item.label;
}

/**
 * Resolves a nav item's final href for the Zola export.
 *
 * Mirrors the runtime logic in `lib/view.ts:toNavItemView` (which the main
 * site applies before rendering). System URLs stored in the DB ("/latest",
 * "/featured") are not real routes — they get rewritten to "/" when they
 * match `homeDefaultView`, otherwise we keep the dedicated path.
 *
 * Trailing slashes match Zola's canonical section URLs so the active-state
 * comparison in the Tera macro can match `current_url` exactly.
 */
function resolveNavItemUrl(
  item: SiteConfig["navItems"][number],
  homeDefaultView: string,
): string {
  if (item.systemKey === "latest") {
    return homeDefaultView === "latest" ? "/" : "/latest/";
  }
  if (item.systemKey === "featured") {
    return homeDefaultView === "featured" ? "/" : "/featured/";
  }
  if (item.systemKey === "collections") return "/collections/";
  if (item.systemKey === "archive") return "/archive/";
  if (item.systemKey === "rss") return "/atom.xml";
  return item.url;
}

function buildConfigToml(
  config: SiteConfig,
  iconAssets: SiteIconAssets,
  collectionDirectoryItems: ExportedCollectionDirectoryItem[],
): string {
  const footerHtml = config.siteFooter ? renderMarkdown(config.siteFooter) : "";
  const parts = [
    `base_url = "${escapeToml((config.siteUrl || "https://example.com").replace(/\/+$/, ""))}"`,
    `title = "${escapeToml(config.siteName)}"`,
    `description = "${escapeToml(config.siteDescription)}"`,
    `default_language = "${escapeToml(config.siteLanguage)}"`,
    'theme = "jant"',
    "generate_feeds = true",
    "compile_sass = false",
    "",
    'feed_filenames = ["atom.xml"]',
    "",
    "[extra.jant_export]",
    'format = "jant-site"',
    "version = 1",
    `generated_at = "${escapeToml(toISOString(Math.floor(Date.now() / 1000)))}"`,
    "",
    "[extra.jant]",
    `home_default_view = "${escapeToml(config.homeDefaultView)}"`,
    `show_jant_branding_on_home = ${config.showJantBrandingOnHome}`,
    `show_header_avatar = ${config.showHeaderAvatar}`,
    `noindex = ${config.noindex}`,
    `site_avatar_mode = "${config.siteAvatarUrl ? "custom" : "none"}"`,
    `favicon_mode = "${iconAssets.faviconMode}"`,
    `apple_touch_mode = "${iconAssets.appleTouchMode}"`,
    "nav_exported = true",
    "collections_directory_exported = true",
    `theme_id = "${escapeToml(config.themeId)}"`,
    `default_theme_id = "${escapeToml(config.defaultThemeId)}"`,
    `font_theme_id = "${escapeToml(config.fontThemeId)}"`,
    `theme_mode = "${escapeToml(config.themeMode)}"`,
    `page_size = ${config.pageSize}`,
  ];

  if (config.siteAvatarUrl) {
    parts.push(`site_avatar_url = "${escapeToml(config.siteAvatarUrl)}"`);
  }
  if (config.faviconVersion) {
    parts.push(`favicon_version = "${escapeToml(config.faviconVersion)}"`);
  }
  if (footerHtml) {
    parts.push(`site_footer_html = "${escapeToml(footerHtml)}"`);
  }
  if (config.siteFooter) {
    parts.push(`site_footer_markdown = "${escapeToml(config.siteFooter)}"`);
  }

  for (const item of config.navItems) {
    parts.push("");
    parts.push("[[extra.jant.nav]]");
    parts.push(`type = "${escapeToml(item.type)}"`);
    parts.push(`label = "${escapeToml(resolveNavItemLabel(item))}"`);
    parts.push(
      `url = "${escapeToml(resolveNavItemUrl(item, config.homeDefaultView))}"`,
    );
    parts.push(`system_key = "${escapeToml(item.systemKey ?? "")}"`);
    parts.push(`placement = "${escapeToml(item.placement ?? "header")}"`);
  }

  for (const item of collectionDirectoryItems) {
    parts.push("");
    parts.push("[[extra.jant.collections_directory]]");
    parts.push(`type = "${escapeToml(item.type)}"`);
    if (item.type === "collection") {
      parts.push(`slug = "${escapeToml(item.slug)}"`);
      parts.push(`title = "${escapeToml(item.title)}"`);
      if (typeof item.entryCount === "number") {
        parts.push(`entry_count = ${item.entryCount}`);
      }
      if (item.recentActivityLabel) {
        parts.push(
          `recent_activity_label = "${escapeToml(item.recentActivityLabel)}"`,
        );
      }
      continue;
    }
    if (item.type === "divider") {
      if (item.label !== null) {
        parts.push(`label = "${escapeToml(item.label)}"`);
      }
      continue;
    }
    parts.push(`label = "${escapeToml(item.label)}"`);
    parts.push(`url = "${escapeToml(item.url)}"`);
  }

  parts.push("");
  parts.push("[[taxonomies]]");
  parts.push('name = "collections"');
  parts.push("feed = true");
  parts.push("");
  parts.push("[[taxonomies]]");
  parts.push('name = "feed"');
  parts.push("feed = true");
  parts.push(`paginate_by = ${config.pageSize}`);
  parts.push("");
  parts.push("[markdown]");
  parts.push("highlight_code = true");
  parts.push('highlight_theme = "css"');
  parts.push("bottom_footnotes = true");

  return `${parts.join("\n")}
`;
}

function buildThemeToml(): string {
  // Minimal metadata required for Zola to recognize themes/jant/ as a theme.
  // No [extra] overrides: all theme config lives in the site's config.toml so
  // Jant-managed settings stay in one place.
  return `name = "Jant"
description = "Default theme packaged with Jant exports."
license = "MIT"
homepage = "https://jant.so"
`;
}

function buildRootSection(): string {
  // Sort is retained so section-derived iterators (e.g. the featured
  // template) get the newest-first order they expect. Home and archive
  // no longer paginate through this section — they use the `feed`
  // taxonomy terms instead — so `paginate_by` is intentionally absent.
  return `+++
sort_by = "date"
+++
`;
}

function buildCollectionsSection(): string {
  return `+++
title = "Collections"
render = false
+++
`;
}

function buildArchiveSection(): string {
  return `+++
title = "Archive"
template = "archive.html"
+++
`;
}

function buildFeaturedSection(): string {
  return `+++
title = "Featured"
template = "featured.html"
+++
`;
}

function buildGitignore(): string {
  return `# Zola build output
public/
static/processed_images/
.zola-cache/

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
  return `# ${siteName} — Zola Export

This is a static site exported from [Jant](https://github.com/jant-me/jant), ready to build with [Zola](https://www.getzola.org/).

## Install Zola

**macOS (Homebrew):**

\`\`\`sh
brew install zola
\`\`\`

**Windows (Scoop):**

\`\`\`sh
scoop install zola
\`\`\`

**Linux (Snap):**

\`\`\`sh
snap install zola --edge
\`\`\`

Or download a binary from <https://github.com/getzola/zola/releases>.

See the [Zola installation docs](https://www.getzola.org/documentation/getting-started/installation/) for more options.

## Quick start

Preview locally:

\`\`\`sh
zola serve
\`\`\`

Then open <http://127.0.0.1:1111> in your browser.

Build the site for deployment:

\`\`\`sh
zola build
\`\`\`

The output goes to the \`public/\` directory. Upload it to any static host (Netlify, Vercel, Cloudflare Pages, GitHub Pages, etc.).

## Project structure

\`\`\`
config.toml          — Site configuration (title, URL, language)
content/
  _index.md          — Root section (homepage settings)
  {slug}/index.md    — Individual posts (threads are merged into one page)
  {slug}/_index.md   — Collection display metadata for taxonomy pages and round-trip import
templates/           — Tera templates (Zola's template engine)
static/
  style.css          — Base exported stylesheet
  theme.css          — Resolved Jant theme variables
  custom.css         — Exported custom CSS overrides
  favicon.ico        — Exported site favicon (custom or default fallback)
  apple-touch-icon.png — Exported Apple touch icon (custom or default fallback)
\`\`\`

## Customizing

- **Site settings** — edit \`config.toml\` to change the title, URL, or language.
- **Jant metadata** — \`config.toml\` stores \`[extra.jant_export]\`, \`[extra.jant]\`, and \`[[extra.jant.collections_directory]]\` for round-trip import.
- **Styles** — edit \`static/style.css\`. The theme supports light and dark modes via \`prefers-color-scheme\`.
- **Templates** — edit files in \`templates/\`. Zola uses the [Tera](https://keats.github.io/tera/) template engine.
- **Debugging** — export to a directory with \`jant site export --directory ./my-site\`, then run \`cd my-site && zola serve\`.
- **Collections** — posts are tagged with collections via the \`collections\` taxonomy. Browse them at \`/collections/\`.

## Notes

- The raw export API only writes content files. The CLI localizes media by default unless you pass \`--no-localize-media\`.
- Thread replies are merged into the root post as a single page. Reply metadata is preserved in HTML comments (\`<!-- jant:reply ... -->\`).
- The collections directory structure is exported in \`config.toml\`, including collection order, dividers, and custom links for round-trip imports.
- Attachments are preserved as Jant HTML blocks (\`data-jant-node="attachments"\`). Text attachments embed canonical Markdown in the block metadata, while the rendered preview is display-only and ignored by \`jant site import\`.
- Posts with \`draft: true\` in front matter are only built when you pass the \`--drafts\` flag to \`zola build\` or \`zola serve\`.
`;
}

function buildExportedCollectionDirectoryItems(
  items: readonly ExportCollectionDirectorySourceItem[],
  collectionSlugMap: Map<string, string>,
  collectionMetrics: Map<string, ExportedCollectionMetrics>,
): ExportedCollectionDirectoryItem[] {
  const exportedItems: ExportedCollectionDirectoryItem[] = [];

  for (const item of items) {
    if (item.type === "divider") {
      exportedItems.push({
        type: "divider",
        label: item.label ?? null,
      });
      continue;
    }

    if (item.type === "link") {
      if (!item.label || !item.url) {
        continue;
      }

      exportedItems.push({
        type: "link",
        label: item.label,
        url: item.url,
      });
      continue;
    }

    const collection = item.collection;
    if (!collection?.id) {
      continue;
    }

    const slug = collectionSlugMap.get(collection.id) ?? collection.slug;
    if (!slug) {
      continue;
    }
    const metrics = collectionMetrics.get(collection.id);

    exportedItems.push({
      type: "collection",
      slug,
      title: collection.title || slug,
      entryCount:
        metrics?.postCount ??
        (typeof collection.postCount === "number"
          ? collection.postCount
          : undefined),
      recentActivityLabel: formatCollectionActivityLabel(
        metrics?.recentActivityAt ?? collection.recentActivityAt,
      ),
    });
  }

  return exportedItems;
}

function buildExportedCollectionMetrics(
  collections: readonly Collection[],
  posts: readonly Post[],
  collectionsByPost: ReadonlyMap<string, readonly Collection[]>,
): Map<string, ExportedCollectionMetrics> {
  const metrics = new Map<string, ExportedCollectionMetrics>();

  for (const collection of collections) {
    metrics.set(collection.id, {
      postCount: 0,
      recentActivityAt: collection.updatedAt,
    });
  }

  for (const post of posts) {
    if (post.deletedAt !== null) {
      continue;
    }
    // Skip posts that Zola will treat as drafts — they won't register
    // taxonomy terms, so they shouldn't count toward collection entry_count.
    if (post.status === "draft" || post.visibility === "private") {
      continue;
    }
    // Replies are merged into their thread root's page — their collections
    // are not written to the root's frontmatter, so they don't create
    // Zola taxonomy terms and must not inflate entry_count.
    if (post.replyToId !== null) {
      continue;
    }

    const activityAt =
      post.lastActivityAt ??
      post.publishedAt ??
      post.updatedAt ??
      post.createdAt;
    const postCollections = collectionsByPost.get(post.id) ?? [];

    for (const collection of postCollections) {
      const current = metrics.get(collection.id);
      if (!current) {
        continue;
      }

      if (current.postCount === 0) {
        current.recentActivityAt = activityAt;
      } else {
        current.recentActivityAt = Math.max(
          current.recentActivityAt,
          activityAt,
        );
      }
      current.postCount += 1;
    }
  }

  return metrics;
}

// ---------------------------------------------------------------------------
// Zola theme templates
// ---------------------------------------------------------------------------

const DECORATIVE_QUOTE_MARK_SVG = `<span class="decorative-quote-mark feed-quote-mark" aria-hidden="true">
  <svg viewBox="${DECORATIVE_QUOTE_MARK_VIEWBOX}" role="presentation" focusable="false">
    ${DECORATIVE_QUOTE_MARK_SVG_CONTENT}
  </svg>
</span>`;

const TEMPLATE_BASE = `{% import "macros.html" as macros %}
<!DOCTYPE html>
<html lang="{{ config.default_language }}" data-theme-mode="{{ config.extra.jant.theme_mode | default(value='auto') }}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{% block title %}{{ config.title }}{% endblock %}</title>
  {% if config.description %}
  <meta name="description" content="{{ config.description }}">
  {% endif %}
  {% if config.extra.jant.noindex %}
  <meta name="robots" content="noindex, nofollow">
  {% endif %}
  {% set favicon_href = get_url(path='favicon.ico') %}
  {% set apple_touch_href = get_url(path='apple-touch-icon.png') %}
  {% if config.extra.jant.favicon_version %}
  <link rel="icon" href="{{ favicon_href }}?v={{ config.extra.jant.favicon_version }}" sizes="16x16 32x32">
  <link rel="apple-touch-icon" href="{{ apple_touch_href }}?v={{ config.extra.jant.favicon_version }}">
  {% else %}
  <link rel="icon" href="{{ favicon_href }}" sizes="16x16 32x32">
  <link rel="apple-touch-icon" href="{{ apple_touch_href }}">
  {% endif %}
  <link rel="stylesheet" href="{{ get_url(path='style.css') }}">
  <link rel="stylesheet" href="{{ get_url(path='theme.css') }}">
  <link rel="stylesheet" href="{{ get_url(path='custom.css') }}">
  <link rel="alternate" type="application/atom+xml" title="{{ config.title }}" href="{{ get_url(path='atom.xml') }}">
  {% block head_extra %}{% endblock %}
</head>
<body>
  <div class="site-page">
    <header class="site-header">
      <div class="site-header-inner">
        <div class="{% block header_top_class %}site-header-top site-header-top-bordered{% endblock %}">
          <a href="{{ config.base_url }}" class="site-logo">
            {% if config.extra.jant.show_header_avatar and config.extra.jant.site_avatar_url %}
            <img src="{{ config.extra.jant.site_avatar_url }}" class="site-logo-avatar" alt="">
            {% endif %}
            <span>{{ config.title }}</span>
          </a>
          <div class="site-header-right">
            <nav class="site-header-nav" aria-label="Primary">
              {# Mirrors the main site's nav: first 2 header-placed items stay
                 inline as primary links, the rest collapse into a "More"
                 dropdown on narrow viewports. Skipped entirely: items with
                 system_key == "settings" (admin-only) and items with
                 placement == "more" (configured as supplemental links on the
                 main site — not surfaced in the static export). #}
              {% if config.extra.jant.nav and config.extra.jant.nav | length > 0 %}
                {% set_global header_items = [] %}
                {% for item in config.extra.jant.nav %}
                  {% if item.system_key != "settings" and item.placement | default(value="header") != "more" %}
                    {% set_global header_items = header_items | concat(with=item) %}
                  {% endif %}
                {% endfor %}
                {% for item in header_items %}
                  {% if loop.index <= 2 %}
                    {{ macros::nav_link(item=item, class="site-header-link-primary") }}
                  {% else %}
                    {{ macros::nav_link(item=item, class="site-header-link-overflow") }}
                  {% endif %}
                {% endfor %}
                {% set overflow_items = header_items | slice(start=2) %}
                {% if overflow_items | length > 0 %}
                <div class="site-header-more site-header-more-responsive-only">
                  <button type="button" class="site-header-more-btn" aria-haspopup="menu" aria-expanded="false">
                    More
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                  </button>
                  <div class="site-header-more-popover" aria-hidden="true">
                    {% for item in overflow_items %}
                      {{ macros::nav_more_link(item=item, class="site-header-more-link site-header-more-link-responsive") }}
                    {% endfor %}
                  </div>
                </div>
                {% endif %}
              {% else %}
              <a href="{{ get_url(path='collections') }}" class="site-header-link-primary">Collections</a>
              <a href="{{ get_url(path='archive') }}" class="site-header-link-primary">Archive</a>
              {% endif %}
            </nav>
          </div>
        </div>
      </div>
    </header>

    <main class="site-main">
      <div class="site-container">
        <div class="{% block site_content_class %}site-content{% endblock %}">
          {% block content %}{% endblock %}
        </div>
      </div>
    </main>

    {% if config.extra.jant.site_footer_html %}
    <footer class="site-footer" data-footer>
      <div class="site-container">
        <div class="prose">{{ config.extra.jant.site_footer_html | safe }}</div>
      </div>
    </footer>
    {% endif %}
  </div>
</body>
</html>
`;

const TEMPLATE_INDEX = `{% extends "base.html" %}
{% import "macros.html" as macros %}

{% block title %}{{ config.title }}{% endblock %}
{% block header_top_class %}site-header-top site-header-top-bordered site-header-top-home{% endblock %}
{% block site_content_class %}site-content site-content-home{% endblock %}

{% block content %}
<div data-page="home">
  {# Home page 1 is a manual render of the feed taxonomy. Pinned posts
     live in feed=pinned (NOT feed=public) so Zola's native paginator at
     /feed/public/page/N/ cannot double-count them. #}
  {% set_global pinned_pages = [] %}
  {% set_global public_pages = [] %}
  {% set feed_tax = get_taxonomy(kind="feed") %}
  {% for t in feed_tax.items %}
    {% if t.name == "pinned" %}{% set_global pinned_pages = t.pages %}{% endif %}
    {% if t.name == "public" %}{% set_global public_pages = t.pages %}{% endif %}
  {% endfor %}

  {% set page_size = config.extra.jant.page_size %}
  {% set home_public = public_pages | slice(end=page_size) %}
  {% set home_pages = pinned_pages | concat(with=home_public) %}

  <div data-feed>
    <div id="timeline-feed">
      <div id="timeline-items">
        {% for page in home_pages %}
        <div class="feed-item" data-timeline-item data-timeline-item-content>
          {% if not loop.first %}<hr class="feed-divider">{% endif %}
          {{ macros::post_card(page=page, context="home") }}
        </div>
        {% endfor %}
      </div>
    </div>
  </div>

  {% if public_pages | length > page_size %}
  <nav class="pagination" aria-label="Pagination">
    <span class="pagination-disabled">Previous</span>
    <span aria-current="page" class="pagination-current">1</span>
    <a href="/feed/public/page/2/" class="pagination-link">Next</a>
  </nav>
  {% endif %}

  {% if config.extra.jant.show_jant_branding_on_home %}
  <footer class="home-branding-credit">
    ${HOME_BRANDING_PREFIX}
    <a href="${JANT_REPO_URL}" target="_blank" rel="noopener noreferrer">
      <span>${HOME_BRANDING_LINK_LABEL}</span>
    </a>
  </footer>
  {% endif %}
</div>
{% endblock %}
`;

const TEMPLATE_PAGE = `{% extends "base.html" %}
{% import "macros.html" as macros %}

{% block title %}{% if page.title %}{{ page.title }} &mdash; {% endif %}{{ config.title }}{% endblock %}

{% block content %}
<div data-page="post">
  {{ macros::post_card(page=page, detail=true) }}
</div>
{% endblock %}
`;

const TEMPLATE_SECTION = `{% extends "base.html" %}
{% import "macros.html" as macros %}

{% block title %}{{ section.title }} &mdash; {{ config.title }}{% endblock %}

{% block content %}
<div class="section-shell">
  <header class="section-header">
    <h1 class="section-title">{{ section.title }}</h1>
    {% if section.description %}
    <p class="section-description">{{ section.description }}</p>
    {% endif %}
  </header>

  <div data-feed>
    <div id="timeline-feed">
      <div id="timeline-items">
        {% for page in section.pages %}
          <div class="feed-item" data-timeline-item data-timeline-item-content>
            {% if not loop.first %}<hr class="feed-divider">{% endif %}
            {{ macros::post_card(page=page) }}
          </div>
        {% endfor %}
      </div>
    </div>
  </div>
</div>
{% endblock %}
`;

const TEMPLATE_ARCHIVE = `{% extends "base.html" %}
{% import "macros.html" as macros %}

{% block title %}Archive &mdash; {{ config.title }}{% endblock %}

{% block content %}
<div data-page="archive">
  <header class="section-header">
    <h1 class="section-title">Archive</h1>
    <p class="section-description">Every published post in one chronological list.</p>
  </header>

  {# Archive is driven by the feed=archive taxonomy term, which contains
     every non-draft, non-unlisted post — pinned and non-pinned alike.
     Page 1 renders the first page_size slice manually; page 2+ is
     handed off to Zola's paginator at /feed/archive/page/N/. The slice
     boundary lines up with paginator page 1 exactly, so the Next link
     below jumps to page 2 without duplicates or gaps. #}
  {% set_global archive_pages = [] %}
  {% set feed_tax = get_taxonomy(kind="feed") %}
  {% for t in feed_tax.items %}
    {% if t.name == "archive" %}{% set_global archive_pages = t.pages %}{% endif %}
  {% endfor %}
  {% set page_size = config.extra.jant.page_size %}
  {% set slice_pages = archive_pages | slice(end=page_size) %}

  <div data-feed>
    <div id="timeline-feed">
      <div id="timeline-items">
        {% for page in slice_pages %}
        <div class="feed-item" data-timeline-item data-timeline-item-content>
          {% if not loop.first %}<hr class="feed-divider">{% endif %}
          {{ macros::post_card(page=page) }}
        </div>
        {% endfor %}
      </div>
    </div>
  </div>

  {% if archive_pages | length > page_size %}
  <nav class="pagination" aria-label="Pagination">
    <span class="pagination-disabled">Previous</span>
    <span aria-current="page" class="pagination-current">1</span>
    <a href="/feed/archive/page/2/" class="pagination-link">Next</a>
  </nav>
  {% endif %}
</div>
{% endblock %}
`;

const TEMPLATE_FEATURED = `{% extends "base.html" %}
{% import "macros.html" as macros %}

{% block title %}Featured &mdash; {{ config.title }}{% endblock %}

{% block content %}
{% set root = get_section(path="_index.md") %}
{% set featured = root.pages | filter(attribute="extra.featured", value=true) %}
<div class="section-shell">
  <header class="section-header">
    <h1 class="section-title">Featured</h1>
  </header>
  {% if featured | length > 0 %}
  <div data-feed>
    <div id="timeline-feed">
      <div id="timeline-items">
        {% for page in featured %}
          <div class="feed-item" data-timeline-item data-timeline-item-content>
            {% if not loop.first %}<hr class="feed-divider">{% endif %}
            {{ macros::post_card(page=page) }}
          </div>
        {% endfor %}
      </div>
    </div>
  </div>
  {% else %}
  <p class="section-empty">Nothing featured yet. Pin a post as featured from the admin to see it here.</p>
  {% endif %}
</div>
{% endblock %}
`;

const TEMPLATE_TAXONOMY_LIST = `{% extends "base.html" %}

{% block title %}Collections &mdash; {{ config.title }}{% endblock %}

{% block content %}
<div class="section-shell">
  <header class="section-header">
    <h1 class="section-title">Collections</h1>
    <p class="section-description">Browse exported posts by collection.</p>
  </header>
  {% set directory_items = config.extra.jant.collections_directory | default(value=[]) %}
  {% if directory_items | length > 0 %}
  <div class="collection-directory">
    {% for item in directory_items %}
      {% if item.type == "divider" %}
      <div class="collection-directory-divider">
        <div class="collection-directory-divider-row" {% if not item.label %}aria-hidden="true"{% endif %}>
          {% if item.label %}
          <span class="collection-directory-divider-text">{{ item.label }}</span>
          {% endif %}
          <hr class="collection-directory-divider-line">
        </div>
      </div>
      {% elif item.type == "link" and item.label and item.url %}
      <div class="collection-directory-item collection-directory-item-link">
        <div class="collection-directory-main">
          <span class="collection-directory-sequence" aria-hidden="true"></span>
          <div class="collection-directory-title-row">
            <a href="{{ item.url }}" class="collection-directory-title-link" target="_blank" rel="noopener noreferrer">
              <span class="collection-directory-title">
                {{ item.label }}
                <span class="collection-directory-title-marker" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10 13a5 5 0 0 0 7.54.54l2.92-2.92a5 5 0 0 0-7.07-7.08L11.7 5.24" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-2.92 2.92a5 5 0 0 0 7.07 7.08l1.69-1.7" />
                  </svg>
                </span>
              </span>
            </a>
          </div>
          <p class="collection-directory-summary">
            <span class="collection-directory-meta">Link</span>
          </p>
        </div>
      </div>
      {% elif item.type == "collection" and item.slug %}
      {% set entry_count = item.entry_count | default(value=-1) %}
      {% set recent_activity_label = item.recent_activity_label | default(value="") %}
      {% set has_collection_page = entry_count != 0 %}
      <div class="collection-directory-item">
        <div class="collection-directory-main">
          <span class="collection-directory-sequence" aria-hidden="true"></span>
          <div class="collection-directory-title-row">
            {% if has_collection_page %}
            <a href="/{{ item.slug }}" class="collection-directory-title-link">
              <span class="collection-directory-title">{{ item.title | default(value=item.slug) }}</span>
            </a>
            {% else %}
            <span class="collection-directory-title">{{ item.title | default(value=item.slug) }}</span>
            {% endif %}
          </div>
          <p class="collection-directory-summary">
            {% if entry_count >= 0 %}
            <span class="collection-directory-meta">
              {{ entry_count }} {% if entry_count == 1 %}entry{% else %}entries{% endif %}
            </span>
            {% endif %}
            {% if recent_activity_label != "" %}
              {% if entry_count >= 0 %}
              <span class="collection-directory-meta-separator" aria-hidden="true">/</span>
              {% endif %}
            <span class="collection-directory-updated">Updated {{ recent_activity_label }}</span>
            {% elif entry_count < 0 %}
            <span class="collection-directory-meta">Collection</span>
            {% endif %}
          </p>
        </div>
      </div>
      {% endif %}
    {% endfor %}
  </div>
  {% else %}
  <ol class="collection-list">
    {% for term in terms %}
    {% set term_meta = get_section(path= term.name ~ '/_index.md') %}
    {% set latest_page = term.pages | first %}
    <li class="collection-list-item">
      <a href="/{{ term.name }}" class="collection-list-link">
        <span class="collection-list-sequence" aria-hidden="true"></span>
        <span class="collection-list-content">
          <span class="collection-list-title">{{ term_meta.title | default(value=term.name) }}</span>
          <span class="collection-list-meta">
            <span>{{ term.pages | length }} entries</span>
            {% if latest_page %}
            <span>Updated {{ latest_page.updated | default(value=latest_page.date) | date(format="%Y-%m-%d") }}</span>
            {% endif %}
          </span>
        </span>
      </a>
    </li>
    {% endfor %}
  </ol>
  {% endif %}
</div>
{% endblock %}
`;

const TEMPLATE_TAXONOMY_SINGLE = `{% extends "base.html" %}
{% import "macros.html" as macros %}

{% block title %}{% set term_meta = get_section(path= term.name ~ '/_index.md') %}{{ term_meta.title | default(value=term.name) }} &mdash; {{ config.title }}{% endblock %}

{% block content %}
{% set term_meta = get_section(path= term.name ~ '/_index.md') %}
<div class="section-shell">
  <header class="section-header">
    <h1 class="section-title">{{ term_meta.title | default(value=term.name) }}</h1>
    {% if term_meta.description %}
    <p class="section-description">{{ term_meta.description }}</p>
    {% endif %}
  </header>
  <div data-feed>
    <div id="timeline-feed">
      <div id="timeline-items">
        {% for page in term.pages %}
          <div class="feed-item" data-timeline-item data-timeline-item-content>
            {% if not loop.first %}<hr class="feed-divider">{% endif %}
            {{ macros::post_card(page=page) }}
          </div>
        {% endfor %}
      </div>
    </div>
  </div>
</div>
{% endblock %}
`;

/**
 * Per-term paginator page for the `feed` taxonomy
 * (`/feed/{term}/`, `/feed/{term}/page/N/`). Takes precedence over
 * the generic `taxonomy_single.html` because it lives at the Zola-
 * specified path `templates/feed/single.html`.
 *
 * Unlike `taxonomy_single.html` (which resolves a sibling `_index.md`
 * section for each term label), feed terms have no backing section —
 * labels come from a static map keyed by term name. The `unlisted`
 * term emits a noindex meta via the `head_extra` block.
 */
const TEMPLATE_FEED_SINGLE = `{% extends "base.html" %}
{% import "macros.html" as macros %}

{% set term_label = term.name %}
{% if term.name == "public" %}{% set term_label = "Latest" %}{% endif %}
{% if term.name == "archive" %}{% set term_label = "Archive" %}{% endif %}
{% if term.name == "pinned" %}{% set term_label = "Pinned" %}{% endif %}
{% if term.name == "unlisted" %}{% set term_label = "Unlisted" %}{% endif %}

{% block title %}{{ term_label }} &mdash; {{ config.title }}{% endblock %}

{% block head_extra %}
  {% if term.name == "unlisted" %}
  <meta name="robots" content="noindex, follow">
  {% endif %}
{% endblock %}

{% block content %}
<div data-page="feed-{{ term.name }}">
  <header class="section-header">
    <h1 class="section-title">{{ term_label }}</h1>
    {% if paginator.current_index > 1 %}
    <p class="page-context-label">Page {{ paginator.current_index }}</p>
    {% endif %}
  </header>
  <div data-feed>
    <div id="timeline-feed">
      <div id="timeline-items">
        {% for page in paginator.pages %}
        <div class="feed-item" data-timeline-item data-timeline-item-content>
          {% if not loop.first %}<hr class="feed-divider">{% endif %}
          {{ macros::post_card(page=page) }}
        </div>
        {% endfor %}
      </div>
    </div>
  </div>

  {% if paginator.previous or paginator.next %}
  <nav class="pagination" aria-label="Pagination">
    {% if paginator.previous %}
    <a href="{{ paginator.previous }}" class="pagination-link">Previous</a>
    {% else %}
    <span class="pagination-disabled">Previous</span>
    {% endif %}

    {% set total = paginator.number_pagers %}
    {% set current = paginator.current_index %}
    {% set_global prev_shown = 0 %}
    {% for n in range(start=1, end=total + 1) %}
      {% set show = total <= 7 or n == 1 or n == total or n == current or n == current - 1 or n == current + 1 %}
      {% if show %}
        {% if n > prev_shown + 1 %}<span class="pagination-ellipsis" aria-hidden="true">…</span>{% endif %}
        {% if n == current %}
        <span aria-current="page" class="pagination-current">{{ n }}</span>
        {% else %}
          {% if n == 1 %}
            {% set page_url = paginator.first %}
          {% else %}
            {% set page_url = paginator.base_url ~ n ~ "/" %}
          {% endif %}
        <a href="{{ page_url }}" class="pagination-link">{{ n }}</a>
        {% endif %}
        {% set_global prev_shown = n %}
      {% endif %}
    {% endfor %}

    {% if paginator.next %}
    <a href="{{ paginator.next }}" class="pagination-link">Next</a>
    {% else %}
    <span class="pagination-disabled">Next</span>
    {% endif %}
  </nav>
  {% endif %}
</div>
{% endblock %}
`;

/**
 * Noindex stub for the `/feed/` taxonomy listing page. The feed
 * taxonomy exists only as a routing mechanism, not a browsable index,
 * so the listing has no editorial content and is marked noindex.
 */
const TEMPLATE_FEED_LIST = `{% extends "base.html" %}

{% block title %}Feed &mdash; {{ config.title }}{% endblock %}

{% block head_extra %}
<meta name="robots" content="noindex, nofollow">
{% endblock %}

{% block content %}
<div class="section-shell">
  <header class="section-header">
    <h1 class="section-title">Feed</h1>
    <p class="section-description">Internal routing index. Start from <a href="{{ config.base_url }}">the home page</a> instead.</p>
  </header>
</div>
{% endblock %}
`;

const TEMPLATE_COLLECTION = `{% extends "base.html" %}
{% import "macros.html" as macros %}

{% block title %}{{ section.title }} &mdash; {{ config.title }}{% endblock %}

{% block content %}
<div class="section-shell">
  <header class="section-header">
    <h1 class="section-title">{{ section.title }}</h1>
    {% if section.description %}
    <p class="section-description">{{ section.description }}</p>
    {% endif %}
  </header>
  {% set entry_count = section.extra.entry_count | default(value=0) %}
  {% if entry_count > 0 %}
  {% set term = get_taxonomy_term(kind="collections", term=section.extra.collection_term) %}
  {# Partition posts: collection-pinned ones first (matching the live site's
     per-collection pin sort), then everything else in date-desc order.
     A post is collection-pinned when its extra.collection_pins array
     contains this collection's slug. #}
  {% set this_slug = section.extra.collection_term %}
  {% set_global pinned_pages = [] %}
  {% set_global rest_pages = [] %}
  {% for page in term.pages %}
    {% set pins = page.extra.collection_pins | default(value=[]) %}
    {% set_global is_pinned_here = false %}
    {% for p in pins %}
      {% if p == this_slug %}{% set_global is_pinned_here = true %}{% endif %}
    {% endfor %}
    {% if is_pinned_here %}
      {% set_global pinned_pages = pinned_pages | concat(with=page) %}
    {% else %}
      {% set_global rest_pages = rest_pages | concat(with=page) %}
    {% endif %}
  {% endfor %}
  {% set ordered_pages = pinned_pages | concat(with=rest_pages) %}
  <div data-feed>
    <div id="timeline-feed">
      <div id="timeline-items">
        {% for page in ordered_pages %}
          <div class="feed-item" data-timeline-item data-timeline-item-content>
            {% if not loop.first %}<hr class="feed-divider">{% endif %}
            {{ macros::post_card(page=page) }}
          </div>
        {% endfor %}
      </div>
    </div>
  </div>
  {% else %}
  <p class="section-empty">No posts in this collection yet.</p>
  {% endif %}
</div>
{% endblock %}
`;

const TEMPLATE_ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="{{ lang }}">
  <title>{% if section is defined and section.title %}{{ section.title }} · {% elif term is defined and taxonomy.name == "collections" %}{% set term_meta = get_section(path= term.name ~ '/_index.md') %}{{ term_meta.title | default(value=term.name) }} · {% elif term is defined and term.name %}{{ term.name }} · {% endif %}{{ config.title }}</title>
  {% if config.description %}
  <subtitle>{{ config.description }}</subtitle>
  {% endif %}
  <link rel="self" type="application/atom+xml" href="{{ feed_url | safe }}" />
  <link rel="alternate" type="text/html" href="{% if section is defined %}{{ section.permalink }}{% elif term is defined %}{{ term.permalink }}{% else %}{{ config.base_url }}{% endif %}" />
  <id>{{ feed_url | safe }}</id>
  {% if last_updated is defined %}
  <updated>{{ last_updated | date(format="%+") }}</updated>
  {% else %}
  <updated>{{ config.extra.jant_export.generated_at | default(value="1970-01-01T00:00:00Z") }}</updated>
  {% endif %}
  {% set author_name = config.author | default(value="") %}
  {% if author_name %}
  <author><name>{{ author_name }}</name></author>
  {% endif %}
  {% for page in pages %}
    {% if page.extra.visibility | default(value="public") == "public" %}
  <entry>
    {% set entry_title = page.title | default(value="") %}
    {% set entry_summary = page.extra.summary_text | default(value="") %}
    {% if entry_summary == "" %}
      {% set entry_summary = page.summary | default(value=page.content) | striptags | trim %}
    {% endif %}
    {% if entry_summary == "" %}
      {% set entry_summary = page.permalink %}
    {% endif %}
    <title>{{ entry_title }}</title>
    <link rel="alternate" type="text/html" href="{{ page.permalink | safe }}" />
    <published>{{ page.date | date(format="%+") }}</published>
    <updated>{{ page.updated | default(value=page.date) | date(format="%+") }}</updated>
    <id>{{ page.permalink | safe }}</id>
    <summary type="text">{{ entry_summary }}</summary>
    <content type="html">&lt;p&gt;{{ entry_summary }}&lt;/p&gt;</content>
  </entry>
    {% endif %}
  {% endfor %}
</feed>
`;

// ---------------------------------------------------------------------------
// Shared macro — single post card used by all list/detail templates
// ---------------------------------------------------------------------------

const TEMPLATE_MACROS = `{# Strip the site's base_url prefix from current_url to get a leading-slash
   path, then compare against item.url (also leading-slash, pre-resolved by
   resolveNavItemUrl in export.ts). Both sides are normalized to drop any
   trailing slash before equality check. #}
{% macro nav_link(item, class) %}
{% set base = config.base_url | trim_end_matches(pat="/") %}
{% set cp = current_url | default(value="") | trim_start_matches(pat=base) %}
{% if cp == "" %}{% set cp = "/" %}{% endif %}
{% set norm_cp = cp | trim_end_matches(pat="/") %}
{% if norm_cp == "" %}{% set norm_cp = "/" %}{% endif %}
{% set norm_link = item.url | trim_end_matches(pat="/") %}
{% if norm_link == "" %}{% set norm_link = "/" %}{% endif %}
<a href="{{ item.url }}" class="site-header-link {{ class }}{% if norm_cp == norm_link %} site-header-link-active{% endif %}">{{ item.label }}</a>
{% endmacro %}

{% macro nav_more_link(item, class) %}
{% set base = config.base_url | trim_end_matches(pat="/") %}
{% set cp = current_url | default(value="") | trim_start_matches(pat=base) %}
{% if cp == "" %}{% set cp = "/" %}{% endif %}
{% set norm_cp = cp | trim_end_matches(pat="/") %}
{% if norm_cp == "" %}{% set norm_cp = "/" %}{% endif %}
{% set norm_link = item.url | trim_end_matches(pat="/") %}
{% if norm_link == "" %}{% set norm_link = "/" %}{% endif %}
<a href="{{ item.url }}" class="{{ class }}{% if norm_cp == norm_link %} site-header-more-link-active{% endif %}">{{ item.label }}</a>
{% endmacro %}

{% macro post_status_badges() %}
<div class="post-status-badges">
  <span class="post-status-badge post-status-pinned">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <line x1="12" x2="12" y1="17" y2="22" />
      <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
    </svg>
    Pinned
  </span>
  <span class="post-status-badge post-status-private">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
      <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
      <path d="m2 2 20 20" />
    </svg>
    Private
  </span>
</div>
{% endmacro %}

{% macro post_rating(page) %}
{% if page.extra.rating %}
<div class="post-rating" aria-label="{{ page.extra.rating }} out of 5">
  {% for i in range(end=5) %}
  <span class="{% if i < page.extra.rating %}post-star-filled{% else %}post-star-empty{% endif %}">★</span>
  {% endfor %}
</div>
{% endif %}
{% endmacro %}

{% macro post_header_meta(page) %}
<div class="post-header-meta-row">
  <a href="{{ page.permalink }}" class="u-url post-header-meta-link">
    <time class="dt-published" datetime="{{ page.date }}" title="{{ page.date }}">
      {{ page.date | date(format="%b %e, %Y") }}
    </time>
  </a>
</div>
{% endmacro %}

{% macro post_footer(page, detail=false, show_date=true) %}
{% set collections = page.taxonomies.collections | default(value=[]) %}
<footer class="post-menu-footer{% if detail %} post-footer-detail{% endif %}" data-post-meta>
  <div class="post-footer-meta">
    <span class="post-footer-featured" title="Featured">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="${FEATURED_SPARKLE_PATH}" />
      </svg>
      <span class="sr-only">Featured</span>
    </span>
    {% if show_date %}
    <a href="{{ page.permalink }}" class="u-url post-footer-link">
      <time class="dt-published" datetime="{{ page.date }}" title="{{ page.date }}">
        {{ page.date | date(format="%b %e, %Y") }}
      </time>
    </a>
    {% endif %}
    {% if page.extra.format == "link" and page.extra.link_url %}
    <a href="{{ page.extra.link_url }}" class="post-footer-external-link" target="_blank" rel="noopener noreferrer" aria-label="Open external link">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M7 17 17 7" />
        <path d="M9 7h8v8" />
      </svg>
    </a>
    {% endif %}
    {% if collections | length > 0 %}
    {% set first_collection = collections | first %}
    {% set first_collection_meta = get_section(path= first_collection ~ '/_index.md') %}
    {% set collection_count = collections | length %}
    {% set hidden_collection_count = collection_count - 2 %}
    {% set show_collection_separator = show_date or (page.extra.format == "link" and page.extra.link_url) or page.extra.featured %}
    <span class="post-collection-tags">
      {% if show_collection_separator %}
      <span class="post-collection-sep" aria-hidden="true">&middot;</span>
      {% endif %}
      <a href="/{{ first_collection }}" class="post-collection-tag">
        {% if detail %}
        <span class="post-collection-primary-icon" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="5.05" width="10" height="8.15" rx="2.2" />
            <path d="M5.1 5.05V4.2a1.1 1.1 0 0 1 1.1-1.1h3.6a1.1 1.1 0 0 1 1.1 1.1v.85" />
          </svg>
        </span>
        {% endif %}
        <span class="post-collection-tag-text">{{ first_collection_meta.title | default(value=first_collection) }}</span>
      </a>
      {% if collection_count >= 2 %}
      {% set second_collection = collections | nth(n=1) %}
      {% set second_collection_meta = get_section(path= second_collection ~ '/_index.md') %}
      <span class="post-collection-second-sep" aria-hidden="true">, </span>
      <a href="/{{ second_collection }}" class="post-collection-tag">
        <span class="post-collection-tag-text">{{ second_collection_meta.title | default(value=second_collection) }}</span>
      </a>
      {% endif %}
      {% if hidden_collection_count > 0 %}
      <span class="post-collection-second-sep" aria-hidden="true">, </span>
      <span class="post-collection-more-wrap">
        <button type="button" class="post-collection-more" aria-haspopup="menu" data-collection-popover-trigger>+{{ hidden_collection_count }}</button>
        <span class="post-collection-popover" role="menu" data-collection-popover>
          {% for col in collections %}
          {% if loop.index > 2 %}
          {% set col_meta = get_section(path= col ~ '/_index.md') %}
          <a href="/{{ col }}" class="post-collection-popover-item" role="menuitem">{{ col_meta.title | default(value=col) }}</a>
          {% endif %}
          {% endfor %}
        </span>
      </span>
      {% endif %}
    </span>
    {% endif %}
  </div>
</footer>
{% endmacro %}

{% macro note_card(page, detail=false, context="") %}
<article
  class="h-entry post-menu-target {% if detail %}post-detail-shell{% else %}post-card-shell{% endif %}"
  {% if detail %}data-page="post"{% endif %}
  data-post
  data-format="note"
  data-post-permalink="{{ page.permalink }}"
  {% if page.title %}data-post-has-title{% endif %}
  {# Pin icon is intentionally restricted to the home/latest feed.
     Featured, collection, and detail contexts deliberately don't emit
     this attribute, so the CSS-driven badge stays hidden there. #}
  {% if context == "home" and page.extra.pinned %}data-post-pinned{% endif %}
  {% if page.extra.featured %}data-post-featured{% endif %}
  data-post-visibility="{{ page.extra.visibility | default(value='public') }}"
>
  {{ self::post_status_badges() }}
  {% if page.title %}
    {% if detail %}
    <div class="post-header-block post-header-block-detail">
      <h1 class="p-name detail-title post-detail-title">{{ page.title }}</h1>
      {{ self::post_header_meta(page=page) }}
      {{ self::post_rating(page=page) }}
    </div>
    {% else %}
    <h2 class="p-name feed-note-title">
      <a href="{{ page.permalink }}" class="u-url post-title-link">{{ page.title }}</a>
    </h2>
    {% endif %}
  {% endif %}
  {% if detail and page.content %}
  <div class="e-content prose post-detail-body" data-post-body>{{ page.content | safe }}</div>
  {% elif not detail and page.summary %}
  <div class="e-content prose {% if page.title %}post-body-summary{% endif %}" data-post-body>{{ page.summary | safe }}</div>
  {% elif page.content %}
  <div class="e-content prose {% if page.title and not detail %}post-body-summary{% endif %}" data-post-body>{{ page.content | safe }}</div>
  {% endif %}
  {% if not detail or not page.title %}
  {{ self::post_rating(page=page) }}
  {% endif %}
  {% if detail and page.title %}
  {{ self::post_footer(page=page, detail=detail, show_date=false) }}
  {% else %}
  {{ self::post_footer(page=page, detail=detail, show_date=true) }}
  {% endif %}
</article>
{% endmacro %}

{% macro link_card(page, detail=false, context="") %}
<article
  class="h-entry post-menu-target {% if detail %}post-detail-shell post-detail-link{% else %}post-card-shell feed-link-post{% endif %}"
  {% if detail %}data-page="post"{% endif %}
  data-post
  data-format="link"
  data-post-permalink="{{ page.permalink }}"
  {% if page.title %}data-post-has-title{% endif %}
  {# Pin icon is intentionally restricted to the home/latest feed.
     Featured, collection, and detail contexts deliberately don't emit
     this attribute, so the CSS-driven badge stays hidden there. #}
  {% if context == "home" and page.extra.pinned %}data-post-pinned{% endif %}
  {% if page.extra.featured %}data-post-featured{% endif %}
  data-post-visibility="{{ page.extra.visibility | default(value='public') }}"
>
  {{ self::post_status_badges() }}
  {% if page.extra.link_url %}
  <a href="{{ page.extra.link_url }}" class="feed-link-domain" rel="noopener noreferrer" target="_blank">
    <svg class="feed-link-domain-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
      <path d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
    </svg>
    <span>{{ page.extra.link_url | split(pat='//') | nth(n=1) | split(pat='/') | first }}</span>
  </a>
  {% endif %}
  {% if page.title %}
    {% if detail %}
    <div class="post-header-block">
      <h1 class="p-name detail-title post-detail-title feed-link-title">
        <a href="{{ page.extra.link_url | default(value=page.permalink) }}" class="u-url feed-link-title-link" {% if page.extra.link_url %}target="_blank" rel="noopener noreferrer"{% endif %}>{{ page.title }}</a>
      </h1>
      {{ self::post_rating(page=page) }}
    </div>
    {% else %}
    <h2 class="p-name feed-link-title">
      <a href="{{ page.extra.link_url | default(value=page.permalink) }}" class="u-url feed-link-title-link" {% if page.extra.link_url %}target="_blank" rel="noopener noreferrer"{% endif %}>{{ page.title }}</a>
    </h2>
    {% endif %}
  {% endif %}
  {% if detail and page.content %}
  <div class="e-content prose feed-link-summary post-detail-body" data-post-body>{{ page.content | safe }}</div>
  {% elif not detail and page.summary %}
  <div class="e-content prose feed-link-summary" data-post-body>{{ page.summary | safe }}</div>
  {% elif page.content %}
  <div class="e-content prose feed-link-summary" data-post-body>{{ page.content | safe }}</div>
  {% endif %}
  {% if not detail or not page.title %}
  {{ self::post_rating(page=page) }}
  {% endif %}
  {{ self::post_footer(page=page, detail=detail) }}
</article>
{% endmacro %}

{% macro quote_card(page, detail=false, context="") %}
<article
  class="h-entry post-menu-target feed-quote-post {% if detail %}post-detail-shell{% endif %}"
  {% if detail %}data-page="post"{% endif %}
  data-post
  data-format="quote"
  data-post-permalink="{{ page.permalink }}"
  {# Pin icon is intentionally restricted to the home/latest feed.
     Featured, collection, and detail contexts deliberately don't emit
     this attribute, so the CSS-driven badge stays hidden there. #}
  {% if context == "home" and page.extra.pinned %}data-post-pinned{% endif %}
  {% if page.extra.featured %}data-post-featured{% endif %}
  data-post-visibility="{{ page.extra.visibility | default(value='public') }}"
>
  {{ self::post_status_badges() }}
  {% if page.extra.quote_text %}
  <blockquote class="feed-quote feed-quote-card">
    ${DECORATIVE_QUOTE_MARK_SVG}
    <div class="e-content feed-quote-content{% if detail %} post-detail-quote{% endif %}">{{ page.extra.quote_text }}</div>
  </blockquote>
  {% endif %}
  {% if page.extra.source_name or page.extra.source_url %}
  <div class="feed-quote-attribution">
    {% if page.extra.source_url %}
    <a href="{{ page.extra.source_url }}" class="feed-quote-source" target="_blank" rel="noopener noreferrer">
      {{ page.extra.source_name | default(value=page.extra.source_url | split(pat='//') | nth(n=1) | split(pat='/') | first) }}
    </a>
    {% else %}
    <span>{{ page.extra.source_name }}</span>
    {% endif %}
  </div>
  {% endif %}
  {% if detail and page.content %}
  <div class="feed-quote-commentary prose{% if detail %} post-detail-body{% endif %}" data-post-body>{{ page.content | safe }}</div>
  {% elif not detail and page.summary %}
  <div class="feed-quote-commentary prose" data-post-body>{{ page.summary | safe }}</div>
  {% elif page.content %}
  <div class="feed-quote-commentary prose" data-post-body>{{ page.content | safe }}</div>
  {% endif %}
  {{ self::post_rating(page=page) }}
  {{ self::post_footer(page=page, detail=detail) }}
</article>
{% endmacro %}

{% macro post_card(page, detail=false, context="") %}
{% if page.extra.format == "link" %}
{{ self::link_card(page=page, detail=detail, context=context) }}
{% elif page.extra.format == "quote" %}
{{ self::quote_card(page=page, detail=detail, context=context) }}
{% else %}
{{ self::note_card(page=page, detail=detail, context=context) }}
{% endif %}
{% endmacro %}
`;

// ---------------------------------------------------------------------------
// CSS — Jant "Organic Minimalism" approximation
// ---------------------------------------------------------------------------

const STYLE_CSS = `/* Jant Export Theme */

/* Design tokens (colors, typography, layout variables) are synced from
   the main site's src/styles/tokens.css and written to static/tokens.css
   during export. Edit tokens.css to change the theme — not this file. */
@import "./tokens.css";

*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  font-size: 16px;
  background-color: var(--site-page-bg);
  color: var(--site-text-primary);
}

body {
  margin: 0;
  font-family: var(--font-body);
  font-size: var(--type-body-size);
  line-height: var(--type-body-leading);
  letter-spacing: var(--type-body-tracking);
  color: var(--site-text-primary);
  background: var(--site-page-bg);
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}

a {
  color: inherit;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
}

img,
svg,
video {
  display: block;
  max-width: 100%;
}

img {
  height: auto;
}

.site-page {
  min-height: 100vh;
  min-height: 100dvh;
  background-color: var(--site-page-bg);
  counter-reset: sidenote-counter;
}

/*
 * Tufte horizontal frame — asymmetric padding.
 * 12.5% left + 4% right = 16.5% padding → content = 83.5% of box.
 */
.site-page > header,
.site-page > main,
.site-page > footer,
.site-page > .home-branding-credit {
  width: 100%;
  max-width: calc(var(--layout-body-max-width) / 0.835);
  padding-left: min(12.5%, 210px);
  padding-right: min(4%, 67px);
  margin-left: auto;
  margin-right: auto;
}

.site-header {
  padding-top: 24px;
}

.site-header-inner {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

/* Mirrors src/styles/ui.css .site-header-top values. */
.site-header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: nowrap;
  min-height: 2.75rem;
  width: 100%;
}

.site-header-top-bordered {
  padding-bottom: 15px;
}

.site-header-top-home {
  padding-bottom: 14px;
}

.site-header-right {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.site-logo {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 0.15rem 0;
  font-size: var(--type-subtitle);
  font-weight: var(--fw-regular);
  font-family: var(--font-site-title);
  letter-spacing: -0.02em;
  color: var(--site-text-primary);
  text-decoration: none;
  line-height: var(--type-display-leading);
}

.site-logo-avatar {
  width: calc(var(--avatar-size) + 2px);
  height: calc(var(--avatar-size) + 2px);
  border-radius: var(--avatar-radius);
  object-fit: cover;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--site-divider) 82%, transparent);
}

/* Mirrors src/styles/ui.css .site-header-nav values — fluid gap and
   a small margin off the logo so items don't crowd the title. */
.site-header-nav {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: clamp(0.6rem, 2.2vw, 1rem);
  min-width: 0;
  font-family: var(--font-ui);
}

.site-header-link {
  display: inline-flex;
  align-items: center;
  position: relative;
  min-height: 2rem;
  padding: 0.2rem 0 0.5rem;
  cursor: pointer;
  font-size: 0.84rem;
  line-height: 1;
  letter-spacing: 0.01em;
  color: var(--site-text-secondary);
  text-decoration: none;
  transition:
    color 0.15s,
    opacity 0.15s;
}

.site-header-link::after {
  content: "";
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 1.5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--site-accent) 62%, var(--site-divider));
  opacity: 0;
  transform: scaleX(0.52);
  transform-origin: center;
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.site-header-link:hover {
  color: var(--site-text-primary);
  opacity: 1;
}

.site-header-link:hover::after {
  opacity: 0.42;
  transform: scaleX(0.82);
}

.site-header-link-primary {
  display: inline-flex;
  align-items: center;
  position: relative;
  min-height: 2rem;
  padding: 0.2rem 0 0.5rem;
  cursor: pointer;
  font-size: 0.84rem;
  line-height: 1;
  letter-spacing: 0.01em;
  color: var(--site-text-secondary);
  text-decoration: none;
  transition: color 0.15s, opacity 0.15s;
}

.site-header-link-primary:hover {
  color: var(--site-text-primary);
}

/* Active page indicator — mirrors src/styles/ui.css. */
.site-header-link-active {
  color: color-mix(
    in srgb,
    var(--site-text-primary) 84%,
    var(--site-text-secondary)
  );
}

.site-header-more-link-active {
  color: color-mix(
    in srgb,
    var(--site-text-primary) 84%,
    var(--site-text-secondary)
  );
}

.site-header-link-overflow {
  display: inline-flex;
  align-items: center;
  position: relative;
  min-height: 2rem;
  padding: 0.2rem 0 0.5rem;
  cursor: pointer;
  font-size: 0.84rem;
  line-height: 1;
  letter-spacing: 0.01em;
  color: var(--site-text-secondary);
  text-decoration: none;
  transition: color 0.15s, opacity 0.15s;
}

.site-header-link-overflow:hover {
  color: var(--site-text-primary);
}

.site-header-more {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.site-header-more-responsive-only {
  display: none;
}

.site-header-more-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 2.4rem;
  padding: 0.22rem 0;
  border: none;
  background: transparent;
  cursor: pointer;
  font-family: var(--font-ui);
  font-size: var(--type-ui-meta, 0.84rem);
  font-weight: 500;
  letter-spacing: 0.01em;
  color: color-mix(in srgb, var(--site-text-secondary) 62%, transparent);
  transition: color 0.15s;
}

.site-header-more-btn svg {
  width: 0.82rem;
  height: 0.82rem;
  transition: transform 0.18s ease;
}

.site-header-more-btn:hover,
.site-header-more:focus-within .site-header-more-btn {
  color: color-mix(in srgb, var(--site-text-primary) 84%, var(--site-text-secondary));
}

.site-header-more:focus-within .site-header-more-btn svg {
  transform: rotate(180deg);
}

.site-header-more-popover {
  display: block;
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 1.1rem;
  min-width: 12.25rem;
  padding: 0.2rem 0;
  border-left: 0.5px solid var(--site-header-hairline, var(--site-divider));
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translateY(-6px);
  transform-origin: top left;
  transition: opacity 0.18s ease, transform 0.18s ease, visibility 0s linear 0.18s;
  z-index: 50;
}

.site-header-more:hover .site-header-more-popover,
.site-header-more:focus-within .site-header-more-popover {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transform: translateY(0);
  transition-delay: 0s;
}

.site-header-more-link {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.35rem;
  padding: 0.38rem 0.75rem 0.38rem 1.15rem;
  font-family: var(--font-ui);
  font-size: var(--type-ui-meta, 0.84rem);
  color: var(--site-text-secondary);
  text-decoration: none;
  transition: color 0.15s, background-color 0.15s;
}

.site-header-more-link:hover {
  color: color-mix(in srgb, var(--site-text-primary) 84%, var(--site-text-secondary));
  background: color-mix(in srgb, var(--site-nav-hover-bg, var(--site-bg)) 58%, transparent);
}

.site-header-more-link-responsive {
  display: none;
}

@media (max-width: 860px) {
  .site-header-link-overflow {
    display: none;
  }

  .site-header-more-responsive-only {
    display: inline-flex;
  }

  .site-header-more-link-responsive {
    display: flex;
  }
}

@media (max-width: 480px) {
  .site-header-nav {
    display: none;
  }
}

.site-container {}

.site-content {
  background-color: var(--site-elevated-bg);
  padding: 1rem 0 var(--space-xl);
}

.site-content-home {
  padding-top: 0.75rem;
  padding-bottom: calc(var(--space-xl) - 0.25rem);
  border-bottom: 0.5px solid
    color-mix(in srgb, var(--site-divider) 84%, transparent);
}

.site-home-header {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  margin-bottom: var(--space-xl);
}

.site-browse-nav {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.55rem;
  padding: 14px 0 4px;
}

.site-browse-link {
  font-size: var(--type-base);
  font-weight: var(--fw-regular);
  color: var(--site-text-primary);
  opacity: 0.42;
}

.site-browse-link-active {
  opacity: 1;
  font-weight: var(--fw-medium);
}

.page-context-label {
  margin: 0 0 1rem;
  color: var(--site-text-secondary);
  font-size: var(--type-sm);
}

.feed-item {
  position: relative;
}

.site-content hr.feed-divider {
  border: none;
  width: 30px;
  height: 9px;
  margin: 4rem 0;
  margin-left: calc(var(--layout-content-width) / 2 - 15px);
  color: var(--site-feed-divider-color);
  background-color: currentColor;
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 45 13'%3E%3Cpath fill='black' transform='translate(0,0) rotate(90 6 6.5)' d='M6.765.5.177 6.093l2.61 5.966 8.39-3.17L6.765.5Z'/%3E%3Cpath fill='black' transform='translate(16,0) rotate(100 6 6.5)' d='M6.765.5.177 6.093l2.61 5.966 8.39-3.17L6.765.5Z'/%3E%3Cpath fill='black' transform='translate(32,0) rotate(80 6 6.5)' d='M6.765.5.177 6.093l2.61 5.966 8.39-3.17L6.765.5Z'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 45 13'%3E%3Cpath fill='black' transform='translate(0,0) rotate(90 6 6.5)' d='M6.765.5.177 6.093l2.61 5.966 8.39-3.17L6.765.5Z'/%3E%3Cpath fill='black' transform='translate(16,0) rotate(100 6 6.5)' d='M6.765.5.177 6.093l2.61 5.966 8.39-3.17L6.765.5Z'/%3E%3Cpath fill='black' transform='translate(32,0) rotate(80 6 6.5)' d='M6.765.5.177 6.093l2.61 5.966 8.39-3.17L6.765.5Z'/%3E%3C/svg%3E");
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
}

.post-menu-target {
  position: relative;
}

.post-card-shell,
.post-detail-shell {
  position: relative;
  padding: 0.45rem 0 0.35rem;
}

.feed-link-post {
  display: flex;
  flex-direction: column;
}

.feed-link-domain {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  max-width: 100%;
  margin-bottom: 0.65rem;
  color: var(--site-text-secondary);
  font-size: 0.75rem;
  font-weight: var(--type-label-weight);
  line-height: 1;
  letter-spacing: var(--type-label-tracking);
  text-decoration: none;
}

.feed-link-domain-icon {
  width: 0.72rem;
  height: 0.72rem;
  flex-shrink: 0;
}

.feed-link-title,
.feed-note-title,
.detail-title,
.section-title,
.p-name {
  font-family: var(--font-heading);
}

.feed-link-title {
  margin: 0;
  font-size: var(--feed-note-title-size);
  font-weight: var(--type-heading-weight);
  line-height: var(--type-heading-leading);
  letter-spacing: var(--type-heading-tracking);
}

.feed-link-title-link,
.post-title-link {
  color: inherit;
  text-decoration: none;
}

.feed-link-title-link:hover,
.post-title-link:hover {
  text-decoration: underline;
}

.feed-note-title {
  margin: 0 0 0.48rem;
  font-size: var(--feed-note-title-size);
  line-height: var(--feed-note-title-leading);
  letter-spacing: var(--type-heading-tracking);
  text-wrap: pretty;
}

.post-body-summary.prose {
  color: color-mix(in srgb, var(--site-text-secondary) 88%, var(--site-text-primary));
}

.post-header-block {
  margin-bottom: 1rem;
}

.post-header-block-detail {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.post-header-block .feed-link-title,
.post-header-block .feed-note-title,
.post-header-block .detail-title {
  margin-bottom: 0;
}

.post-header-block .post-rating {
  margin-top: 0.45rem;
}

.post-header-block-detail .post-rating {
  margin-top: 0;
}

.post-header-meta-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  line-height: 1.35;
}

.post-header-meta-link {
  color: var(--site-text-secondary);
  font-size: 0.875rem;
  text-decoration: none;
  white-space: nowrap;
}

.post-header-meta-link:hover {
  color: var(--site-text-primary);
  text-decoration: underline;
}

.detail-title {
  margin: 0 0 1rem;
  font-size: var(--type-content-display);
  font-weight: var(--fw-medium);
  line-height: 1.08;
  letter-spacing: -0.03em;
  text-wrap: balance;
}

[data-page="post"] {
  color: var(--site-reading-body);
}

[data-page="post"] .detail-title,
[data-page="post"] .post-detail-title {
  color: var(--site-reading-title);
}

[data-page="post"] .post-detail-body,
[data-page="post"] .post-detail-body.prose {
  --site-prose-link-color: var(--site-reading-link);
  --site-prose-link-hover: var(--site-reading-link-hover);
  --site-prose-link-underline: var(--site-reading-link-underline);
  color: var(--site-reading-body);
}

[data-page="post"] .post-detail-body :is(h1, h2, h3, h4) {
  color: var(--site-reading-heading);
}

.feed-quote-post {
  position: relative;
  padding: 0.45rem 0 0.35rem;
}

.feed-quote {
  margin: 0;
}

.feed-quote-card {
  padding-left: 0;
  border-left: none;
}

.decorative-quote-mark {
  display: block;
  line-height: 0;
}

.decorative-quote-mark svg {
  display: block;
  width: 100%;
  height: auto;
}

.feed-quote-mark {
  width: clamp(1.46rem, 1.38rem + 0.36vw, 1.76rem);
  margin-bottom: -0.1rem;
  margin-left: -0.04rem;
  color: color-mix(in srgb, var(--site-accent) 14%, var(--site-divider));
  opacity: 0.66;
}

[data-page="post"] .feed-quote-mark {
  color: color-mix(
    in srgb,
    var(--site-accent) 18%,
    var(--site-reading-meta)
  );
  opacity: 0.72;
}

.feed-quote-content {
  font-family: var(--font-serif);
  color: var(--site-text-primary);
  font-size: var(--type-content-subtitle);
  line-height: 1.36;
  letter-spacing: -0.02em;
  text-wrap: pretty;
}

[data-page="post"] .feed-quote-content,
[data-page="post"] .post-detail-quote {
  color: var(--site-reading-quote);
}

.feed-quote-attribution {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-wrap: wrap;
  margin-top: 0.95rem;
  color: var(--site-text-secondary);
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  line-height: 1.4;
}

[data-page="post"] .feed-link-domain,
[data-page="post"] .feed-quote-attribution,
[data-page="post"] .post-header-meta-row,
[data-page="post"] .post-header-meta-link,
[data-page="post"] .post-header-meta-link time,
[data-page="post"] .post-footer-meta,
[data-page="post"] .post-footer-meta a,
[data-page="post"] .post-footer-meta time,
[data-page="post"] .post-footer-link,
[data-page="post"] .post-footer-external-link,
[data-page="post"] .post-collection-sep {
  color: var(--site-reading-meta);
}

.feed-quote-attribution::before {
  content: "";
  width: 0.9rem;
  height: 1px;
  background: color-mix(in srgb, var(--site-text-secondary) 38%, var(--site-divider));
}

[data-page="post"] .feed-quote-attribution::before {
  background: color-mix(
    in srgb,
    var(--site-reading-meta) 38%,
    var(--site-divider)
  );
}

.feed-quote-source {
  color: inherit;
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, var(--site-text-secondary) 55%, transparent);
}

[data-page="post"] .feed-link-domain:hover,
[data-page="post"] .feed-quote-source:hover,
[data-page="post"] .post-header-meta-link:hover,
[data-page="post"] .post-footer-link:hover,
[data-page="post"] .post-footer-external-link:hover {
  color: var(--site-reading-body);
}

.feed-quote-commentary {
  position: relative;
  margin-top: 1.1rem;
  padding-top: 0.95rem;
  color: color-mix(in srgb, var(--site-text-secondary) 84%, var(--site-text-primary));
}

[data-page="post"] .feed-quote-commentary {
  color: var(--site-reading-body);
}

.feed-quote-commentary::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    color-mix(in srgb, var(--site-divider) 48%, transparent) 16%,
    color-mix(in srgb, var(--site-divider) 78%, transparent) 50%,
    color-mix(in srgb, var(--site-divider) 48%, transparent) 84%,
    transparent 100%
  );
}

.post-status-badges {
  display: none;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--site-text-placeholder);
}

article[data-post-pinned] .post-status-badges,
article[data-post-visibility="private"] .post-status-badges {
  display: flex;
}

.post-status-badge {
  display: none;
  align-items: center;
  gap: 4px;
}

article[data-post-pinned] .post-status-pinned,
article[data-post-visibility="private"] .post-status-private {
  display: inline-flex;
}

.post-status-badge svg {
  width: 12px;
  height: 12px;
}

.post-footer-featured {
  display: none;
  align-items: center;
  justify-content: center;
  color: color-mix(in srgb, var(--search-mark-color) 72%, var(--site-text-secondary));
  --icon-stroke: 1.35;
  flex-shrink: 0;
}

article[data-post-featured] .post-footer-featured {
  display: inline-flex;
}

.post-footer-featured svg {
  width: 1.12rem;
  height: 1.12rem;
  opacity: 0.88;
}

[data-page="featured"] article[data-post-featured] .post-footer-featured {
  display: none;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.prose {
  --site-prose-link-color: var(--site-content-link);
  --site-prose-link-hover: var(--site-content-link-hover);
  --site-prose-link-underline: var(--site-content-link-underline);
  max-width: none;
  font-size: var(--type-body-size);
  line-height: var(--type-body-leading);
  letter-spacing: var(--type-body-tracking);
  color: var(--site-text-primary);
}

.post-body-summary {
  color: color-mix(in srgb, var(--site-text-secondary) 88%, var(--site-text-primary));
}

.content-link,
.prose a {
  color: var(--site-prose-link-color, var(--site-content-link));
  font-weight: inherit;
  text-decoration: underline;
  text-decoration-color: var(
    --site-prose-link-underline,
    var(--site-content-link-underline)
  );
  text-decoration-thickness: 0.05em;
  text-underline-offset: 0.1em;
  transition:
    color 0.18s ease,
    text-decoration-color 0.18s ease;
}

.content-link:hover,
.prose a:hover {
  color: var(--site-prose-link-hover, var(--site-content-link-hover));
  text-decoration-color: currentColor;
}

.prose > :first-child {
  margin-top: 0;
}

.prose > :last-child {
  margin-bottom: 0;
}

.prose p {
  margin: 0;
}

.prose p + p,
.prose ul,
.prose ol,
.prose blockquote,
.prose pre,
.prose table,
.prose figure {
  margin-top: 1.05rem;
}

.prose :is(h1, h2, h3, h4) {
  margin: 1.25rem 0 0.35rem;
  font-family: var(--font-heading);
  font-weight: var(--type-heading-weight);
  line-height: var(--type-heading-leading);
  letter-spacing: var(--type-heading-tracking);
}

.prose ul,
.prose ol {
  padding-left: 1.3rem;
}

.prose li {
  margin: 0.2rem 0;
}

.prose blockquote {
  padding-left: 0.95rem;
  border-left: 2px solid color-mix(in srgb, var(--site-divider) 75%, transparent);
  color: var(--site-text-secondary);
}

[data-page="post"] .post-detail-body.prose blockquote {
  border-left-color: color-mix(
    in srgb,
    var(--site-reading-meta) 28%,
    var(--site-divider)
  );
  color: var(--site-reading-quote);
}

.prose code {
  font-family: var(--font-mono);
  font-size: 0.875em;
  background: color-mix(in srgb, var(--site-nav-hover-bg) 80%, transparent);
  padding: 0.1rem 0.35rem;
  border-radius: 0.32rem;
}

.prose pre {
  overflow-x: auto;
  padding: 0.9rem 1rem;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--site-divider) 82%, transparent);
  background: color-mix(in srgb, var(--site-nav-hover-bg) 78%, transparent);
}

.prose pre code {
  background: transparent;
  padding: 0;
}

.prose table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--type-sm);
}

.prose th,
.prose td {
  border: 1px solid color-mix(in srgb, var(--site-divider) 86%, transparent);
  padding: 0.45rem 0.7rem;
  text-align: left;
}

.prose th {
  background: color-mix(in srgb, var(--site-nav-hover-bg) 74%, transparent);
}

.prose img,
.prose video {
  width: 100%;
  border-radius: var(--media-radius);
}

.prose figure[data-jant-node="image"] {
  margin-inline: 0;
}

.prose figcaption {
  margin-top: 0.55rem;
  color: var(--site-text-secondary);
  font-size: var(--type-sm);
}

[data-jant-node="attachments"] {
  display: grid;
  gap: 0.85rem;
  margin-top: 1rem;
}

[data-jant-node="attachment"] {
  margin: 0;
  padding: 0.95rem;
  border: 1px solid color-mix(in srgb, var(--site-divider) 84%, transparent);
  border-radius: 16px;
  background: color-mix(in srgb, var(--site-nav-hover-bg) 66%, transparent);
}

[data-jant-node="attachment"] > script[data-jant-meta] {
  display: none;
}

[data-jant-node="attachment"][data-jant-kind="image"] {
  padding: 0;
  overflow: hidden;
  background: transparent;
}

[data-jant-node="attachment"] audio,
[data-jant-node="attachment"] video {
  width: 100%;
}

/* Card-style attachments (text + document) — the card itself owns the visual
   chrome, so the figure wrapper just becomes a transparent container. */
[data-jant-node="attachment"][data-jant-kind="text"],
[data-jant-node="attachment"][data-jant-kind="document"] {
  padding: 0;
  border: none;
  background: transparent;
}

.jant-attachment-card {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.8rem 0.95rem;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--site-divider) 84%, transparent);
  background: color-mix(in srgb, var(--site-nav-hover-bg) 60%, transparent);
  color: var(--site-text-primary);
  text-decoration: none;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease;
}

.jant-attachment-card:hover {
  background: var(--site-nav-hover-bg);
  border-color: var(--site-divider);
}

.jant-attachment-card-icon {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: color-mix(in srgb, var(--site-text-secondary) 78%, transparent);
}

.jant-attachment-card-body {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
  flex: 1 1 auto;
}

.jant-attachment-card-summary {
  font-weight: var(--fw-medium);
  color: var(--site-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.jant-attachment-card-meta {
  font-size: var(--type-xs);
  color: var(--site-text-secondary);
}

.post-rating {
  display: flex;
  gap: 1px;
  margin-top: 8px;
  font-size: 14px;
  line-height: 1;
}

.post-star-filled {
  color: oklch(0.75 0.15 70);
}

.post-star-empty {
  color: var(--site-divider);
}

.post-menu-footer {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  margin-top: 0.9rem;
  /* Mirror main site src/styles/ui.css: footers use the dedicated UI scale
     so they don't inherit the larger reading-content body size. */
  font-size: var(--type-ui-hint);
}

.post-footer-detail {
  margin-top: 1.35rem;
  padding-top: 1rem;
  border-top: 1px solid color-mix(in srgb, var(--site-divider) 86%, transparent);
  font-size: var(--type-ui-meta);
  color: var(--site-text-secondary);
}

.post-footer-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  line-height: 1.35;
  min-width: 0;
}

.post-footer-link {
  color: var(--site-text-secondary);
  text-decoration: none;
  font-size: 13px;
  white-space: nowrap;
  flex-shrink: 0;
}

.post-footer-link:hover {
  color: var(--site-text-primary);
  text-decoration: underline;
}

.post-footer-detail .post-footer-link {
  font-size: inherit;
}

.post-footer-external-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 0.9rem;
  height: 0.9rem;
  color: var(--site-text-secondary);
  flex-shrink: 0;
}

.post-footer-external-link svg {
  width: 0.82rem;
  height: 0.82rem;
}

.post-collection-tags {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  min-width: 0;
  max-width: 100%;
  flex: 1 1 auto;
}

.post-collection-sep {
  /* Middot separator is emitted in HTML for semantic completeness but
     hidden visually to match the main site (ui.css). */
  display: none;
}

.post-collection-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--site-text-secondary);
  text-decoration: none;
  min-width: 0;
  max-width: min(100%, 22ch);
}

.post-collection-tag:hover {
  color: var(--site-text-primary);
  text-decoration: underline;
}

.post-collection-primary-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 0.82rem;
  height: 0.82rem;
  color: color-mix(in srgb, var(--site-text-secondary) 78%, var(--site-divider));
  flex-shrink: 0;
}

.post-collection-primary-icon svg {
  width: 0.82rem;
  height: 0.82rem;
  overflow: visible;
}

.post-footer-detail .post-collection-tag:hover .post-collection-primary-icon {
  color: currentColor;
}

.post-collection-tag-text {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.post-collection-more-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.post-collection-more-wrap::after {
  content: "";
  position: absolute;
  top: 100%;
  left: -6px;
  right: -6px;
  height: 10px;
}

.post-collection-more {
  display: inline-flex;
  align-items: center;
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  font-size: inherit;
  color: var(--site-text-secondary);
  text-decoration: underline dotted;
  text-underline-offset: 2px;
  cursor: pointer;
}

.post-collection-more-wrap:hover .post-collection-more,
.post-collection-more-wrap:focus-within .post-collection-more {
  color: var(--site-text-primary);
}

.post-collection-popover {
  display: none;
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 50;
  flex-direction: column;
  min-width: 160px;
  padding: 4px;
  border-radius: 6px;
  background: var(--site-elevated-bg);
  border: 1px solid var(--site-divider);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.post-collection-more-wrap:hover .post-collection-popover,
.post-collection-more-wrap:focus-within .post-collection-popover {
  display: flex;
}

.post-collection-popover-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--site-text-secondary);
  text-decoration: none;
}

.post-collection-popover-item:hover {
  background: var(--site-nav-hover-bg);
  color: var(--site-text-primary);
}

.section-shell {
  display: flex;
  flex-direction: column;
  gap: 1.15rem;
}

.section-header {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.section-title {
  margin: 0;
  font-size: var(--type-content-display);
  font-weight: var(--fw-medium);
  line-height: 1.12;
  letter-spacing: -0.03em;
}

.section-description {
  margin: 0;
  max-width: 38rem;
  color: var(--site-text-secondary);
}

.collection-directory {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  counter-reset: collection-directory;
}

.collection-directory-item {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.95rem 0;
}

.collection-directory-item-link {
  text-decoration: none;
}

.collection-directory-main {
  --collection-directory-sequence-width: 3.5ch;
  --collection-directory-title-line-height: 1.18;
  min-width: 0;
  flex: 1;
  display: grid;
  grid-template-columns: var(--collection-directory-sequence-width) minmax(0, 1fr);
  align-items: start;
  column-gap: 0.8rem;
  row-gap: 0.25rem;
}

.collection-directory-item .collection-directory-main {
  counter-increment: collection-directory;
}

.collection-directory-sequence {
  grid-column: 1;
  grid-row: 1;
  display: block;
  width: var(--collection-directory-sequence-width);
  padding-top: 0.2rem;
  font-family: var(--font-mono);
  font-size: 0.68rem;
  font-variant-numeric: tabular-nums;
  line-height: var(--collection-directory-title-line-height);
  letter-spacing: 0.14em;
  color: var(--site-text-secondary);
  transition: color 0.15s ease;
}

.collection-directory-sequence::before {
  content: counter(collection-directory, decimal-leading-zero);
}

.collection-directory-title-row {
  grid-column: 2;
  grid-row: 1;
  min-width: 0;
  display: flex;
  align-items: flex-start;
}

.collection-directory-title-link {
  text-decoration: none;
  color: inherit;
}

.collection-directory-title-link:hover {
  color: var(--site-text-primary);
}

.collection-directory-title-link:hover .collection-directory-title {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.collection-directory-title-link:hover .collection-directory-title-marker {
  color: var(--site-text-primary);
}

.collection-directory-title {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-family: var(--font-heading);
  font-size: var(--type-content-body);
  font-weight: var(--type-heading-weight);
  line-height: var(--collection-directory-title-line-height);
  letter-spacing: -0.02em;
}

.collection-directory-title-marker {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 0.95rem;
  min-width: 0.95rem;
  height: 0.95rem;
  color: var(--site-text-secondary);
  transition: color 0.15s ease;
}

.collection-directory-summary {
  grid-column: 2;
  grid-row: 2;
  display: flex;
  min-width: 0;
  overflow: hidden;
  align-items: center;
  gap: 0.2rem 0.5rem;
  margin: 0;
  color: var(--site-text-secondary);
  font-size: var(--type-sm);
  line-height: 1.5;
  white-space: nowrap;
}

.collection-directory-meta {
  flex: 0 0 auto;
  color: inherit;
}

.collection-directory-meta-separator {
  flex: 0 0 auto;
  color: color-mix(in srgb, var(--site-divider) 88%, transparent);
}

.collection-directory-updated {
  flex: 0 0 auto;
  color: inherit;
  white-space: nowrap;
}

.collection-directory-divider {
  padding: 1.5rem 0 0.85rem;
}

.collection-directory-divider-row {
  display: flex;
  align-items: center;
  gap: 0.95rem;
}

.collection-directory-divider-text {
  font-family: var(--font-heading);
  font-size: 0.9rem;
  white-space: nowrap;
  color: var(--site-text-secondary);
}

.collection-directory-divider-line {
  flex: 1;
  height: 1px;
  border: none;
  margin: 0;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--site-divider) 100%, transparent),
    color-mix(in srgb, var(--site-divider) 54%, transparent) 34%,
    transparent 86%
  );
}

.collection-list {
  margin: 0;
  padding: 0;
  list-style: none;
  counter-reset: collection-list;
}

.collection-list-item {
  counter-increment: collection-list;
  border-top: 1px solid color-mix(in srgb, var(--site-divider) 84%, transparent);
}

.collection-list-link {
  display: grid;
  grid-template-columns: 3.5ch minmax(0, 1fr);
  gap: 0.8rem;
  align-items: start;
  padding: 0.95rem 0;
  text-decoration: none;
}

.collection-list-link:hover .collection-list-title {
  text-decoration: underline;
}

.collection-list-link:hover .collection-list-sequence {
  color: var(--site-text-primary);
}

.collection-list-sequence {
  display: block;
  width: 3.5ch;
  padding-top: 0.2rem;
  font-family: var(--font-mono);
  font-size: 0.68rem;
  font-variant-numeric: tabular-nums;
  line-height: 1.18;
  letter-spacing: 0.14em;
  color: var(--site-text-secondary);
  transition: color 0.15s ease;
}

.collection-list-sequence::before {
  content: counter(collection-list, decimal-leading-zero);
}

.collection-list-content {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
}

.collection-list-title {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-family: var(--font-heading);
  font-size: var(--type-content-body);
  font-weight: var(--type-heading-weight);
  line-height: 1.18;
  letter-spacing: -0.01em;
}

.collection-list-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  color: var(--site-text-secondary);
  font-size: var(--type-sm);
}

.archive-shell {
  gap: 1.35rem;
}

.archive-list {
  display: grid;
  gap: 0;
}

.archive-month-group + .archive-month-group {
  margin-top: 1.35rem;
}

.archive-month-heading {
  margin: 0 0 0.45rem;
  color: var(--site-text-secondary);
  font-size: 0.82rem;
  font-weight: var(--fw-medium);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.archive-entry {
  display: grid;
  grid-template-columns: minmax(6.75rem, auto) minmax(0, 1fr);
  gap: 0.9rem 1.25rem;
  align-items: start;
  padding: 0.9rem 0;
  border-top: 1px solid color-mix(in srgb, var(--site-divider) 84%, transparent);
}

.archive-entry:first-child {
  border-top: none;
  padding-top: 0;
}

.archive-entry-date {
  color: var(--site-text-secondary);
  font-size: var(--type-sm);
  line-height: 1.5;
  text-decoration: none;
}

.archive-entry-main {
  min-width: 0;
}

.archive-entry-title {
  display: inline-block;
  color: var(--site-text-primary);
  font-family: var(--font-heading);
  font-size: 1.03rem;
  font-weight: var(--type-heading-weight);
  line-height: 1.34;
  letter-spacing: var(--type-heading-tracking);
  text-decoration: none;
  text-wrap: pretty;
}

.archive-entry-title:hover {
  text-decoration: underline;
}

.archive-entry-meta {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-wrap: wrap;
  margin-top: 0.38rem;
  color: var(--site-text-secondary);
  font-size: 0.72rem;
  line-height: 1.45;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.archive-entry-format {
  opacity: 0.7;
}

.archive-entry-tag {
  color: inherit;
  text-decoration: none;
  border-bottom: 0.5px solid color-mix(in srgb, var(--site-divider) 82%, transparent);
}

.archive-entry-tag:hover {
  color: var(--site-text-primary);
  border-bottom-color: currentColor;
}

.pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 1.5rem 0;
}

.pagination-link {
  color: var(--site-text-secondary);
  text-decoration: underline;
}

.pagination-link:hover {
  color: var(--site-text-primary);
}

.pagination-current {
  color: var(--site-text-primary);
}

.pagination-disabled {
  color: color-mix(in srgb, var(--site-text-secondary) 50%, transparent);
}

.pagination-ellipsis {
  color: var(--site-text-secondary);
}

.site-footer {
  margin-top: var(--space-xl);
  padding-bottom: var(--space-xl);
  color: var(--site-text-secondary);
  font-size: var(--type-sm);
}

.site-footer > .site-container {
  border-top: 0.5px solid var(--site-divider);
  padding-top: var(--content-gap);
}

.home-branding-credit {
  margin-top: var(--space-xl);
  text-align: center;
  color: var(--site-text-secondary);
  font-size: var(--type-base);
}

.home-branding-credit a {
  display: inline-flex;
  align-items: center;
  gap: 0.38rem;
  color: inherit;
  text-decoration: none;
  border-bottom: 0.5px solid
    color-mix(in srgb, var(--site-text-secondary) 45%, transparent);
}

/*
 * Tufte content-width constraint.
 * Text blocks occupy 55% of the page section width,
 * leaving 45% right margin for breathing room.
 */
.site-home-header,
.post-detail-body,
.post-body-summary,
.feed-note-title,
.feed-link-title,
.feed-quote,
.feed-quote-attribution,
.feed-quote-commentary,
.feed-link-domain,
.feed-continue-link,
[data-post-body].prose,
[data-post-meta] {
  width: var(--layout-content-width);
}

.post-detail-title {
  width: min(80%, 45rem);
}

@media (max-width: 1024px) {
  .site-home-header,
  .post-detail-title,
  .post-detail-body,
  .post-body-summary,
  .feed-note-title,
  .feed-link-title,
  .feed-quote,
  .feed-quote-attribution,
  .feed-quote-commentary,
  .feed-link-domain,
  .feed-continue-link,
  [data-post-body].prose,
  [data-post-meta] {
    width: min(100%, 35rem);
  }
}

@media (min-width: 700px) {
  .site-header {
    padding-top: 30px;
  }

  .site-header-top-bordered {
    padding-bottom: 18px;
  }
}

@media (max-width: 760px) {
  :root {
    --layout-content-width: 100%;
  }

  .site-page > header,
  .site-page > main,
  .site-page > footer,
  .site-page > .home-branding-credit {
    padding-left: max(5%, 28px);
    padding-right: 5%;
  }
}

@media (max-width: 699px) {
  :root {
    --site-padding: 1.875rem;
  }

  .site-header-nav {
    justify-content: flex-start;
  }
}

@media (max-width: 640px) {
  .collection-directory-item {
    padding: 0.9rem 0;
  }

  .collection-directory-updated {
    white-space: normal;
  }

  .archive-entry {
    grid-template-columns: 1fr;
    gap: 0.3rem;
  }

  .pagination {
    gap: 0.55rem;
  }
}
`;
