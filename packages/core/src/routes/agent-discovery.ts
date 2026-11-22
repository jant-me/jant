/**
 * Agent Discovery & `/llms.txt` Routes
 *
 * Serves machine-readable discovery documents under Jant's reserved
 * `/.well-known/` namespace and `/llms.txt` (deferring to user content if a
 * custom URL already claims `llms.txt`, per `docs/compatibility.md`).
 */

import { Hono, type Context } from "hono";
import type { Bindings, Post } from "../types.js";
import type { AppVariables } from "../types/app-context.js";
import {
  buildAgentSkillsIndex,
  buildApiCatalog,
  buildDiscoveryLinkHeader,
  buildOAuthAuthorizationServerMetadata,
  buildOAuthProtectedResourceMetadata,
} from "../lib/agent-discovery.js";
import {
  renderLlmsTxt,
  type LlmsCollectionEntry,
  type LlmsPostEntry,
} from "../lib/markdown-page.js";
import { extractBodyText } from "../lib/summary.js";
import { getPostPath } from "../lib/url.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const agentDiscoveryRoutes = new Hono<Env>();

const DISCOVERY_CACHE_CONTROL = "public, max-age=300, s-maxage=3600";
const LLMS_CACHE_CONTROL = "public, max-age=300, s-maxage=1800";
const LLMS_POST_LIMIT = 15;

function toPostTitleAndExcerpt(post: Post): {
  title: string;
  excerpt?: string;
} {
  const cleanBody = post.body ? extractBodyText(post.body) : null;
  const rawSummary = (
    post.summary ||
    cleanBody ||
    post.bodyText ||
    post.quoteText ||
    ""
  )
    .replace(/\s+/g, " ")
    .trim();

  const clip = (value: string, max: number) =>
    value.length > max ? `${value.slice(0, max).trimEnd()}...` : value;

  const title = post.title?.trim() || clip(rawSummary, 80) || post.slug;
  const excerpt = rawSummary ? clip(rawSummary, 140) : undefined;
  return { title, excerpt };
}

function toLlmsPostEntry(
  post: Post,
  aliases: ReadonlyMap<string, string[]>,
): LlmsPostEntry {
  const { title, excerpt } = toPostTitleAndExcerpt(post);
  const canonicalPath = getPostPath(post.slug, aliases.get(post.id)?.[0]);
  const ts = post.publishedAt ?? post.updatedAt;
  const publishedDate = new Date(ts * 1000).toISOString().slice(0, 10);
  return {
    title,
    canonicalPath,
    publishedDate,
    format: post.format,
    excerpt,
  };
}

// Agent Skills Discovery Index (v0.2.0)
agentDiscoveryRoutes.get("/.well-known/agent-skills/index.json", async (c) => {
  const { siteUrl, sitePathPrefix } = c.var.appConfig;
  const doc = await buildAgentSkillsIndex(siteUrl, sitePathPrefix);
  return new Response(`${JSON.stringify(doc, null, 2)}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": DISCOVERY_CACHE_CONTROL,
      "X-Robots-Tag": "noindex",
    },
  });
});

// RFC 9727 API Catalog
agentDiscoveryRoutes.get("/.well-known/api-catalog", (c) => {
  const doc = buildApiCatalog(c.var.appConfig);
  return new Response(`${JSON.stringify(doc, null, 2)}\n`, {
    headers: {
      "Content-Type": "application/linkset+json; charset=utf-8",
      "Cache-Control": DISCOVERY_CACHE_CONTROL,
      "X-Robots-Tag": "noindex",
    },
  });
});

// RFC 9728 OAuth 2.0 Protected Resource Metadata (root and resource-scoped path)
function serveProtectedResourceMetadata(c: { var: AppVariables }): Response {
  const doc = buildOAuthProtectedResourceMetadata(c.var.appConfig);
  return new Response(`${JSON.stringify(doc, null, 2)}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": DISCOVERY_CACHE_CONTROL,
      "X-Robots-Tag": "noindex",
    },
  });
}

agentDiscoveryRoutes.get(
  "/.well-known/oauth-protected-resource",
  serveProtectedResourceMetadata,
);
agentDiscoveryRoutes.get(
  "/.well-known/oauth-protected-resource/api/mcp",
  serveProtectedResourceMetadata,
);

// RFC 8414 OAuth 2.0 Authorization Server Metadata
agentDiscoveryRoutes.get("/.well-known/oauth-authorization-server", (c) => {
  const doc = buildOAuthAuthorizationServerMetadata(c.var.appConfig);
  return new Response(`${JSON.stringify(doc, null, 2)}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": DISCOVERY_CACHE_CONTROL,
      "X-Robots-Tag": "noindex",
    },
  });
});

/**
 * Render `/llms.txt` when no custom URL in `path_registry` already claims it.
 *
 * Called from the catch-all page route after checking `path_registry` so an
 * existing custom URL at `/llms.txt` keeps working (see `docs/compatibility.md`).
 *
 * @param c - Hono context
 * @returns `/llms.txt` Markdown response
 */
export async function renderLlmsTxtResponse(
  c: Context<Env>,
): Promise<Response> {
  const { appConfig, services } = c.var;
  const [aboutStatus, directoryData, featuredPage, recentPage] =
    await Promise.all([
      services.aboutPage.getStatus(),
      services.collections.listDirectoryData({
        isAuthenticated: false,
        timeZone: appConfig.timeZone,
      }),
      services.threads.listThreads(
        {
          audience: "reader",
          selection: { visibility: ["featured"] },
          timeZone: appConfig.timeZone,
        },
        { limit: LLMS_POST_LIMIT },
      ),
      services.threads.listThreads(
        {
          audience: "reader",
          selection: {},
          timeZone: appConfig.timeZone,
        },
        { limit: LLMS_POST_LIMIT },
      ),
    ]);

  const highlightRoots =
    featuredPage.threads.length > 0
      ? featuredPage.threads.map((t) => t.root)
      : recentPage.threads.map((t) => t.root);

  const collectionIds: string[] = [];
  for (const item of directoryData.items) {
    if (item.type === "collection" && item.collection) {
      collectionIds.push(item.collection.id);
    }
  }

  const [postAliases, collectionAliases] = await Promise.all([
    highlightRoots.length > 0
      ? services.paths.getPostAliases(highlightRoots.map((p) => p.id))
      : Promise.resolve(new Map<string, string[]>()),
    collectionIds.length > 0
      ? services.paths.getCollectionAliases(collectionIds)
      : Promise.resolve(new Map<string, string[]>()),
  ]);

  const collections: LlmsCollectionEntry[] = [];
  for (const item of directoryData.items) {
    if (item.type === "collection" && item.collection) {
      const col = item.collection;
      const alias = collectionAliases.get(col.id)?.[0];
      collections.push({
        title: col.title,
        slug: col.slug,
        canonicalPath: `/${alias ?? col.slug}`,
        description: col.description,
        threadCount: col.threadCount,
      });
    } else if (item.type === "smart_collection" && item.smartCollection) {
      const sc = item.smartCollection;
      collections.push({
        title: sc.title,
        slug: sc.slug,
        canonicalPath: `/${sc.slug}`,
        description: sc.description,
        threadCount: sc.threadCount,
      });
    }
  }

  const aboutPath =
    aboutStatus.state === "ready" &&
    aboutStatus.post.status === "published" &&
    aboutStatus.post.visibility !== "private"
      ? aboutStatus.path
      : null;

  const featuredPosts =
    featuredPage.threads.length > 0
      ? featuredPage.threads.map((t) => toLlmsPostEntry(t.root, postAliases))
      : [];
  const recentPosts =
    featuredPage.threads.length === 0
      ? recentPage.threads.map((t) => toLlmsPostEntry(t.root, postAliases))
      : [];

  const body = renderLlmsTxt({
    siteName: appConfig.siteName,
    siteDescription: appConfig.siteDescription || undefined,
    siteUrl: appConfig.siteUrl,
    sitePathPrefix: appConfig.sitePathPrefix,
    siteLanguage: appConfig.siteLanguage,
    additionalLanguages: appConfig.multilingualEnabled
      ? appConfig.additionalLanguages
      : [],
    publicApiEnabled: appConfig.publicApiEnabled,
    rssFeedsEnabled: appConfig.rssFeedsEnabled,
    aboutPath,
    collections,
    featuredPosts,
    recentPosts,
  });

  const headers = new Headers({
    "Content-Type": "text/markdown; charset=utf-8",
    "Cache-Control": LLMS_CACHE_CONTROL,
    Link: buildDiscoveryLinkHeader(appConfig),
  });
  if (appConfig.noindex) {
    headers.set("X-Robots-Tag", "noindex");
  }

  return new Response(body, { status: 200, headers });
}
