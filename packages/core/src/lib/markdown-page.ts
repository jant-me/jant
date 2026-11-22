/**
 * Native Markdown Rendering & Content Negotiation for AI Agents and Readers
 *
 * Converts Jant posts, Threads, timelines, Collections, and site overviews
 * into clean Markdown documents with YAML frontmatter directly from stored
 * TipTap JSON (`toBodyMarkdown`), avoiding lossy HTML-to-Markdown scraping.
 */

import type { Context } from "hono";
import type {
  CollectionDirectoryItem,
  MediaView,
  PostView,
  TimelineItemView,
} from "../types.js";
import type { AppConfig } from "../types/config.js";
import { buildDiscoveryLinkHeader } from "./agent-discovery.js";
import { toBodyMarkdown } from "./api-posts.js";
import { getJantDocsUrl } from "./jant-docs.js";
import { toAbsoluteSiteUrl, toPublicPath } from "./url.js";

/**
 * Parse an HTTP `Accept` header and decide whether the caller explicitly
 * prefers `text/markdown` over `text/html`.
 *
 * Normal browsers (`text/html,application/xhtml+xml,...`) and default wildcard
 * clients (`*\/*`) return `false`. Agents that advertise `Accept: text/markdown`
 * (or rank `text/markdown` at least as high as `text/html`) return `true`.
 *
 * @param acceptHeader - Raw HTTP `Accept` header value
 * @returns `true` when the response should be served as `text/markdown`
 * @example
 * ```ts
 * acceptsMarkdown("text/markdown, text/html;q=0.9"); // true
 * acceptsMarkdown("text/html, application/xhtml+xml, *\/*;q=0.8"); // false
 * acceptsMarkdown("*\/*"); // false
 * ```
 */
export function acceptsMarkdown(acceptHeader: string | undefined): boolean {
  if (!acceptHeader) return false;

  let markdownQ = -1;
  let htmlQ = -1;
  let wildcardQ = -1;

  for (const rawRange of acceptHeader.split(",")) {
    const parts = rawRange.trim().split(";");
    const mediaType = parts[0]?.trim().toLowerCase();
    if (!mediaType) continue;

    let q = 1;
    for (let i = 1; i < parts.length; i++) {
      const param = parts[i]?.trim();
      if (!param) continue;
      const [key, value] = param.split("=").map((s) => s.trim());
      if (key?.toLowerCase() === "q" && value !== undefined) {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
          q = parsed;
        }
      }
    }

    if (mediaType === "text/markdown" || mediaType === "text/x-markdown") {
      markdownQ = Math.max(markdownQ, q);
    } else if (
      mediaType === "text/html" ||
      mediaType === "application/xhtml+xml"
    ) {
      htmlQ = Math.max(htmlQ, q);
    } else if (mediaType === "*/*") {
      wildcardQ = Math.max(wildcardQ, q);
    }
  }

  if (markdownQ <= 0) return false;
  if (htmlQ >= 0) return markdownQ >= htmlQ;
  if (wildcardQ >= 0) return markdownQ >= wildcardQ;
  return true;
}

/**
 * Check whether the current Hono request negotiated Markdown via `Accept`.
 *
 * @param c - Hono context
 * @returns `true` when the caller prefers `text/markdown`
 * @example
 * ```ts
 * if (wantsMarkdown(c)) return markdownResponse(c, md);
 * ```
 */
export function wantsMarkdown(c: Context): boolean {
  return acceptsMarkdown(c.req.header("Accept"));
}

/**
 * Estimate token count for the `X-Markdown-Tokens` header (standard ~4 chars
 * per token heuristic).
 *
 * @param markdown - Rendered Markdown content
 * @returns Positive integer estimate (0 for empty string)
 * @example
 * ```ts
 * estimateMarkdownTokens("Hello world"); // 3
 * ```
 */
export function estimateMarkdownTokens(markdown: string): number {
  if (!markdown) return 0;
  return Math.ceil(markdown.length / 4);
}

/**
 * Build a `text/markdown; charset=utf-8` HTTP response with `Vary: Accept`,
 * `X-Markdown-Tokens`, and RFC 8288 discovery `Link` headers.
 *
 * @param c - Hono context
 * @param markdown - Rendered Markdown document
 * @param options - Optional cache control and canonical URL headers
 * @returns Hono Response with Markdown headers
 * @example
 * ```ts
 * return markdownResponse(c, body, { canonicalHref: "https://example.com/hello" });
 * ```
 */
export function markdownResponse(
  c: Context,
  markdown: string,
  options: {
    cacheControl?: string;
    canonicalHref?: string;
    noindex?: boolean;
  } = {},
): Response {
  const appConfig = c.get("appConfig") as AppConfig;
  const headers = new Headers({
    "Content-Type": "text/markdown; charset=utf-8",
    Vary: "Accept",
    "X-Markdown-Tokens": String(estimateMarkdownTokens(markdown)),
    Link: buildDiscoveryLinkHeader(appConfig, {
      canonicalHref: options.canonicalHref,
    }),
  });

  if (options.cacheControl) {
    headers.set("Cache-Control", options.cacheControl);
  }
  if (options.noindex || appConfig.noindex) {
    headers.set("X-Robots-Tag", "noindex");
  }

  return new Response(markdown, { status: 200, headers });
}

function yamlValue(value: string | number | boolean): string {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function renderFrontmatter(
  entries: Array<[string, string | number | boolean | string[] | undefined]>,
): string {
  const lines: string[] = ["---"];
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${yamlValue(item)}`);
      }
    } else {
      lines.push(`${key}: ${yamlValue(value)}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

function resolveAbsoluteUrl(
  pathOrUrl: string,
  siteUrl: string,
  sitePathPrefix: string,
): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  // Already carries sitePathPrefix when coming from PostView.permalink / MediaView.url.
  if (siteUrl) {
    try {
      return new URL(pathOrUrl, siteUrl).toString();
    } catch {
      return toAbsoluteSiteUrl(pathOrUrl, siteUrl, sitePathPrefix);
    }
  }
  return pathOrUrl;
}

/**
 * Derive the explicit `.md` path for a public page path.
 *
 * @param publicPath - Public page path (with or without sitePathPrefix)
 * @param sitePathPrefix - Configured site path prefix
 * @returns Public path for the Markdown alternate (e.g. `/hello.md`, `/latest.md`)
 * @example
 * ```ts
 * toMarkdownHref("/hello", ""); // "/hello.md"
 * toMarkdownHref("/", ""); // "/latest.md"
 * ```
 */
export function toMarkdownHref(
  publicPath: string,
  sitePathPrefix = "",
): string {
  const cleanPrefix = sitePathPrefix.replace(/\/$/, "");
  const normalized = publicPath === "/" ? "" : publicPath.replace(/\/$/, "");
  if (normalized === "" || normalized === cleanPrefix) {
    return toPublicPath("/latest.md", sitePathPrefix);
  }
  if (normalized.endsWith(".md")) return normalized;
  return `${normalized}.md`;
}

function extractPostBodyMarkdown(post: PostView): string {
  if (post.rawBody) {
    const md = toBodyMarkdown(post.id, post.rawBody);
    if (md) return md.trim();
  }
  return post.summary?.trim() ?? "";
}

function renderMediaAttachmentsMarkdown(
  media: readonly MediaView[],
  postPermalink: string,
  siteUrl: string,
  sitePathPrefix: string,
): string {
  if (media.length === 0) return "";
  const lines: string[] = [];

  for (const item of media) {
    const url = resolveAbsoluteUrl(item.url, siteUrl, sitePathPrefix);
    if (item.mimeType.startsWith("image/")) {
      const alt = (item.altText || item.originalName || "Image").replace(
        /[\r\n]+/g,
        " ",
      );
      lines.push(`![${alt}](${url})`);
    } else if (item.mimeType.startsWith("text/")) {
      const label = item.summary || item.originalName || "Text attachment";
      const textUrl = resolveAbsoluteUrl(
        `${postPermalink.replace(/\/$/, "")}/text/${item.id}`,
        siteUrl,
        sitePathPrefix,
      );
      lines.push(`- Attachment: [${label}](${textUrl})`);
    } else if (item.mimeType.startsWith("audio/")) {
      const label = item.originalName || "Audio";
      lines.push(`- Audio: [${label}](${url})`);
    } else if (item.mimeType.startsWith("video/")) {
      const label = item.originalName || "Video";
      lines.push(`- Video: [${label}](${url})`);
    } else {
      const label = item.originalName || "Attachment";
      lines.push(`- [${label}](${url})`);
    }
  }

  return lines.join("\n");
}

function formatBlockquote(text: string): string {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => (line.trim() ? `> ${line}` : ">"))
    .join("\n");
}

function renderSinglePostBody(
  post: PostView,
  headingLevel: "#" | "##" | "###",
  siteUrl: string,
  sitePathPrefix: string,
): string {
  const parts: string[] = [];
  const body = extractPostBodyMarkdown(post);

  if (post.format === "link") {
    if (post.title && post.url) {
      parts.push(`${headingLevel} [${post.title}](${post.url})`);
    } else if (post.url) {
      parts.push(`${headingLevel} ${post.url}`);
    } else if (post.title) {
      parts.push(`${headingLevel} ${post.title}`);
    }
    if (body) parts.push(body);
  } else if (post.format === "quote") {
    if (post.quoteText) {
      parts.push(formatBlockquote(post.quoteText));
    }
    if (post.title || post.url) {
      const attribution =
        post.title && post.url
          ? `— [${post.title}](${post.url})`
          : post.title
            ? `— ${post.title}`
            : `— <${post.url}>`;
      parts.push(attribution);
    }
    if (body) parts.push(body);
  } else {
    if (post.title) {
      parts.push(`${headingLevel} ${post.title}`);
    }
    if (body) parts.push(body);
  }

  const mediaBlock = renderMediaAttachmentsMarkdown(
    post.media,
    post.permalink,
    siteUrl,
    sitePathPrefix,
  );
  if (mediaBlock) parts.push(mediaBlock);

  return parts.join("\n\n");
}

export interface RenderPostThreadMarkdownOptions {
  postView: PostView;
  threadPostViews?: PostView[];
  siteName: string;
  siteUrl: string;
  sitePathPrefix: string;
  canonicalHref: string;
  articlePublishedTime: string;
  articleModifiedTime: string;
  alternateLanguages?: Array<{ hreflang: string; href: string }>;
}

/**
 * Render a single post or full Thread as a Markdown document with YAML
 * frontmatter, preserving `note`, `link`, and `quote` semantics, media
 * attachments, and every reply in Thread order.
 *
 * @param options - Post/Thread view data and site metadata
 * @returns Complete Markdown document
 * @example
 * ```ts
 * const md = renderPostThreadMarkdown({ postView, siteName, ... });
 * ```
 */
export function renderPostThreadMarkdown(
  options: RenderPostThreadMarkdownOptions,
): string {
  const {
    postView,
    threadPostViews,
    siteName,
    siteUrl,
    sitePathPrefix,
    canonicalHref,
    articlePublishedTime,
    articleModifiedTime,
    alternateLanguages,
  } = options;

  const posts =
    threadPostViews && threadPostViews.length > 0
      ? threadPostViews
      : [postView];
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- posts always has at least 1 entry
  const root = posts[0]!;
  const canonicalMarkdownUrl = toMarkdownHref(canonicalHref, sitePathPrefix);
  const collectionLabels = root.collections.map((col) => col.title);

  const frontmatter = renderFrontmatter([
    ["title", root.title || root.summary?.slice(0, 80) || siteName],
    ["url", canonicalHref],
    ["markdown_url", canonicalMarkdownUrl],
    ["format", root.format],
    ["published", articlePublishedTime],
    [
      "updated",
      articleModifiedTime !== articlePublishedTime
        ? articleModifiedTime
        : undefined,
    ],
    ["language", root.language],
    ["collections", collectionLabels.length > 0 ? collectionLabels : undefined],
    ["thread_posts", posts.length > 1 ? posts.length : undefined],
    ["link_url", root.format === "link" ? root.url : undefined],
    ["quote_source", root.format === "quote" ? root.title : undefined],
    ["quote_source_url", root.format === "quote" ? root.url : undefined],
    ["site", siteName],
  ]);

  const sections: string[] = [frontmatter];
  sections.push(renderSinglePostBody(root, "#", siteUrl, sitePathPrefix));

  for (let i = 1; i < posts.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- bounded loop
    const reply = posts[i]!;
    const replyDate = reply.publishedAt.slice(0, 10);
    const replyUrl = resolveAbsoluteUrl(
      reply.permalink,
      siteUrl,
      sitePathPrefix,
    );
    const replyHeading = `## Reply ${i} (${replyDate})\n\nPermalink: ${replyUrl}`;
    const replyBody = renderSinglePostBody(
      reply,
      "###",
      siteUrl,
      sitePathPrefix,
    );
    sections.push(
      `---\n\n${replyHeading}${replyBody ? `\n\n${replyBody}` : ""}`,
    );
  }

  if (alternateLanguages && alternateLanguages.length > 0) {
    const langLines = alternateLanguages.map(
      (alt) => `- ${alt.hreflang}: ${alt.href}`,
    );
    sections.push(`---\n\nTranslations:\n${langLines.join("\n")}`);
  }

  return `${sections.join("\n\n")}\n`;
}

export interface RenderThreadListMarkdownOptions {
  title: string;
  description?: string;
  pageUrl: string;
  markdownUrl?: string;
  siteName: string;
  siteDescription?: string;
  siteUrl: string;
  sitePathPrefix: string;
  publicApiEnabled: boolean;
  language?: string | null;
  items: TimelineItemView[];
  currentPage?: number;
  totalPages?: number;
  nextPageUrl?: string;
}

/**
 * Render a timeline, home, featured, archive, or collection page as Markdown
 * with AI discovery frontmatter pointers and links to each Thread's `.md` view.
 *
 * @param options - Page metadata and timeline items
 * @returns Complete Markdown document
 * @example
 * ```ts
 * const md = renderThreadListMarkdown({ title: "Latest", items, ... });
 * ```
 */
export function renderThreadListMarkdown(
  options: RenderThreadListMarkdownOptions,
): string {
  const {
    title,
    description,
    pageUrl,
    markdownUrl,
    siteName,
    siteDescription,
    siteUrl,
    sitePathPrefix,
    publicApiEnabled,
    language,
    items,
    currentPage,
    totalPages,
    nextPageUrl,
  } = options;

  const llmsUrl = toAbsoluteSiteUrl("/llms.txt", siteUrl, sitePathPrefix);
  const skillUrl = toAbsoluteSiteUrl("/skill.md", siteUrl, sitePathPrefix);
  const mcpUrl = toAbsoluteSiteUrl("/api/mcp", siteUrl, sitePathPrefix);
  const publicMcpUrl = publicApiEnabled
    ? toAbsoluteSiteUrl("/api/public/mcp", siteUrl, sitePathPrefix)
    : undefined;
  const publicApiUrl = publicApiEnabled
    ? toAbsoluteSiteUrl("/api/public/threads", siteUrl, sitePathPrefix)
    : undefined;

  const frontmatter = renderFrontmatter([
    ["title", title],
    ["description", description || siteDescription || undefined],
    ["url", pageUrl],
    ["markdown_url", markdownUrl],
    ["site", siteName],
    ["language", language || undefined],
    [
      "page",
      currentPage && totalPages && totalPages > 1 ? currentPage : undefined,
    ],
    [
      "total_pages",
      currentPage && totalPages && totalPages > 1 ? totalPages : undefined,
    ],
    ["llms", llmsUrl],
    ["skill", skillUrl],
    ["mcp", mcpUrl],
    ["public_mcp", publicMcpUrl],
    ["public_api", publicApiUrl],
  ]);

  const sections: string[] = [frontmatter, `# ${title}`];
  if (description || siteDescription) {
    sections.push(`> ${description || siteDescription}`);
  }

  const aiNoteParts = [
    `Site overview: [llms.txt](${llmsUrl})`,
    `Author/agent guide: [skill.md](${skillUrl})`,
  ];
  if (publicMcpUrl) {
    aiNoteParts.push(`Public read-only MCP: ${publicMcpUrl}`);
  }
  sections.push(`*For AI assistants — ${aiNoteParts.join(" · ")}*`);

  if (items.length === 0) {
    sections.push("_No posts yet._");
  } else {
    for (const item of items) {
      const post = item.post;
      const postUrl = resolveAbsoluteUrl(
        post.permalink,
        siteUrl,
        sitePathPrefix,
      );
      const postMdUrl = toMarkdownHref(postUrl, sitePathPrefix);
      const date = post.publishedAt.slice(0, 10);
      const replyCount = item.threadPreview?.totalReplyCount ?? 0;

      const metaBits: string[] = [date, post.format];
      if (replyCount > 0) {
        metaBits.push(
          `${replyCount} ${replyCount === 1 ? "reply" : "replies"}`,
        );
      }
      if (post.collections.length > 0) {
        metaBits.push(post.collections.map((col) => col.title).join(", "));
      }

      const body = renderSinglePostBody(post, "##", siteUrl, sitePathPrefix);
      const headingPrefix =
        post.title || post.format === "link"
          ? ""
          : `## ${date} · ${post.slug}\n\n`;

      const linksLine = `[HTML](${postUrl}) · [Markdown](${postMdUrl})`;
      sections.push(
        `---\n\n${headingPrefix}${body}\n\n_${metaBits.join(" · ")}_ — ${linksLine}`,
      );
    }
  }

  if (nextPageUrl) {
    sections.push(`---\n\nNext page: ${nextPageUrl}`);
  }

  return `${sections.join("\n\n")}\n`;
}

export interface RenderCollectionsDirectoryMarkdownOptions {
  siteName: string;
  siteDescription?: string;
  siteUrl: string;
  sitePathPrefix: string;
  pageUrl: string;
  publicApiEnabled: boolean;
  language?: string | null;
  items: CollectionDirectoryItem[];
}

/**
 * Render the `/collections` directory as Markdown.
 *
 * @param options - Directory entries and site metadata
 * @returns Complete Markdown document
 * @example
 * ```ts
 * const md = renderCollectionsDirectoryMarkdown({ siteName, items, ... });
 * ```
 */
export function renderCollectionsDirectoryMarkdown(
  options: RenderCollectionsDirectoryMarkdownOptions,
): string {
  const {
    siteName,
    siteDescription,
    siteUrl,
    sitePathPrefix,
    pageUrl,
    publicApiEnabled,
    language,
    items,
  } = options;

  const frontmatter = renderFrontmatter([
    ["title", `Collections — ${siteName}`],
    ["description", siteDescription || undefined],
    ["url", pageUrl],
    ["markdown_url", toMarkdownHref(pageUrl, sitePathPrefix)],
    ["site", siteName],
    ["language", language || undefined],
    ["llms", toAbsoluteSiteUrl("/llms.txt", siteUrl, sitePathPrefix)],
    ["skill", toAbsoluteSiteUrl("/skill.md", siteUrl, sitePathPrefix)],
    [
      "public_api",
      publicApiEnabled
        ? toAbsoluteSiteUrl("/api/public/collections", siteUrl, sitePathPrefix)
        : undefined,
    ],
  ]);

  const lines: string[] = [frontmatter, "", `# Collections — ${siteName}`];

  for (const item of items) {
    if (item.type === "divider") {
      lines.push("", `## ${item.label || "Section"}`);
      continue;
    }
    if (item.type === "link" && item.url) {
      const desc = item.description ? `: ${item.description}` : "";
      lines.push(`- [${item.label || item.url}](${item.url})${desc}`);
      continue;
    }
    if (item.type === "collection" && item.collection) {
      const col = item.collection;
      const colUrl = toAbsoluteSiteUrl(`/${col.slug}`, siteUrl, sitePathPrefix);
      const colMdUrl = toMarkdownHref(colUrl, sitePathPrefix);
      const count = `${col.threadCount} ${col.threadCount === 1 ? "thread" : "threads"}`;
      const desc = col.description ? ` — ${col.description}` : "";
      lines.push(
        `- [${col.title}](${colMdUrl}) (${count})${desc} · [HTML](${colUrl})`,
      );
      continue;
    }
    if (item.type === "smart_collection" && item.smartCollection) {
      const sc = item.smartCollection;
      const scUrl = toAbsoluteSiteUrl(`/${sc.slug}`, siteUrl, sitePathPrefix);
      const scMdUrl = toMarkdownHref(scUrl, sitePathPrefix);
      const count = `${sc.threadCount} ${sc.threadCount === 1 ? "thread" : "threads"}`;
      const desc = sc.description ? ` — ${sc.description}` : "";
      lines.push(
        `- [${sc.title}](${scMdUrl}) (${count})${desc} · [HTML](${scUrl})`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

export interface LlmsCollectionEntry {
  title: string;
  slug: string;
  canonicalPath: string;
  description: string | null;
  threadCount?: number;
}

export interface LlmsPostEntry {
  title: string;
  canonicalPath: string;
  publishedDate: string;
  format: string;
  excerpt?: string;
}

export interface RenderLlmsTxtOptions {
  siteName: string;
  siteDescription?: string;
  siteUrl: string;
  sitePathPrefix: string;
  siteLanguage: string;
  additionalLanguages: string[];
  publicApiEnabled: boolean;
  rssFeedsEnabled: boolean;
  aboutPath?: string | null;
  collections: LlmsCollectionEntry[];
  featuredPosts: LlmsPostEntry[];
  recentPosts: LlmsPostEntry[];
}

/**
 * Render `/llms.txt` following the llmstxt.org convention, connecting reader
 * content (About, curated Collections, Featured/Recent posts in Markdown) and
 * machine access (Public API, Public Read-Only MCP, and Author `/skill.md` +
 * `/api/mcp`).
 *
 * @param options - Site metadata, curated collections, and highlight posts
 * @returns Complete `/llms.txt` Markdown document
 * @example
 * ```ts
 * const txt = renderLlmsTxt({ siteName: "My Blog", ... });
 * ```
 */
export function renderLlmsTxt(options: RenderLlmsTxtOptions): string {
  const {
    siteName,
    siteDescription,
    siteUrl,
    sitePathPrefix,
    siteLanguage,
    additionalLanguages,
    publicApiEnabled,
    rssFeedsEnabled,
    aboutPath,
    collections,
    featuredPosts,
    recentPosts,
  } = options;

  const abs = (path: string) =>
    toAbsoluteSiteUrl(path, siteUrl, sitePathPrefix);

  const lines: string[] = [`# ${siteName}`];

  if (siteDescription) {
    lines.push("", `> ${siteDescription}`);
  }

  const allLanguages = [siteLanguage, ...additionalLanguages].filter(Boolean);
  lines.push(
    "",
    `A personal microblog powered by Jant (${abs("/")}).`,
    ...(allLanguages.length > 1
      ? [`Languages: ${allLanguages.join(", ")}.`]
      : []),
    "Any public page on this site supports `Accept: text/markdown` content negotiation as well as an explicit `.md` URL.",
  );

  lines.push("", "## Start Here");
  if (aboutPath) {
    lines.push(
      `- [About](${abs(`${aboutPath}.md`)}): About this site and its author ([HTML](${abs(aboutPath)}))`,
    );
  }
  lines.push(
    `- [Latest Timeline](${abs("/latest.md")}): Most recent public threads ([HTML](${abs("/")}))`,
  );
  if (featuredPosts.length > 0) {
    lines.push(
      `- [Featured](${abs("/featured.md")}): Author-highlighted threads ([HTML](${abs("/featured")}))`,
    );
  }
  lines.push(
    `- [Archive](${abs("/archive.md")}): Full chronological archive ([HTML](${abs("/archive")}))`,
  );
  if (collections.length > 0) {
    lines.push(
      `- [Collections](${abs("/collections.md")}): Curated topics ([HTML](${abs("/collections")}))`,
    );
  }

  if (collections.length > 0) {
    lines.push("", "## Collections");
    for (const col of collections) {
      const mdUrl = abs(`${col.canonicalPath}.md`);
      const desc = col.description ? `: ${col.description}` : "";
      const count =
        typeof col.threadCount === "number"
          ? ` (${col.threadCount} ${col.threadCount === 1 ? "thread" : "threads"})`
          : "";
      lines.push(`- [${col.title}](${mdUrl})${count}${desc}`);
    }
  }

  const highlightPosts = featuredPosts.length > 0 ? featuredPosts : recentPosts;
  const highlightHeading =
    featuredPosts.length > 0 ? "## Featured Posts" : "## Recent Posts";

  if (highlightPosts.length > 0) {
    lines.push("", highlightHeading);
    for (const post of highlightPosts) {
      const mdUrl = abs(`${post.canonicalPath}.md`);
      const excerpt =
        post.excerpt && post.excerpt !== post.title ? `: ${post.excerpt}` : "";
      lines.push(
        `- [${post.title}](${mdUrl}) (${post.publishedDate}, ${post.format})${excerpt}`,
      );
    }
  }

  lines.push("", "## Reading This Site (For Reader AI Assistants)");
  lines.push(
    "- **Markdown**: Send `Accept: text/markdown` to any public URL, or append `.md` (for example `/about.md` or `/<post-slug>.md`).",
  );
  if (publicApiEnabled) {
    lines.push(
      `- **Public Read-Only MCP**: \`POST ${abs("/api/public/mcp")}\` — no authentication required; lists threads, reads full threads, lists Collections, and searches public posts.`,
    );
    lines.push(
      `- **Public JSON API**: [Threads](${abs("/api/public/threads")}), [Collections](${abs("/api/public/collections")}), [Search](${abs("/api/public/search")}?q=...)`,
    );
  }
  if (rssFeedsEnabled) {
    lines.push(`- **Atom Feed**: ${abs("/feed")}`);
  }
  lines.push(`- **Sitemap**: ${abs("/sitemap.xml")}`);

  lines.push("", "## Managing This Site (For the Site Owner's AI Assistant)");
  lines.push(
    `- [Site Skill](${abs("/skill.md")}): Full instructions for publishing, editing, organizing Collections, uploading media, and migrating content.`,
  );
  lines.push(
    `- **Authenticated MCP**: \`POST ${abs("/api/mcp")}\` — supports OAuth 2.1 discovery (\`${abs("/.well-known/oauth-protected-resource")}\`) and API Bearer tokens.`,
  );
  lines.push(
    `- **Agent Skills Discovery**: ${abs("/.well-known/agent-skills/index.json")}`,
  );
  lines.push(
    `- **API Catalog**: ${abs("/.well-known/api-catalog")} ([API Reference](${getJantDocsUrl("api")}))`,
  );

  return `${lines.join("\n")}\n`;
}
