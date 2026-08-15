/**
 * Sitemap Routes
 *
 * Sitemap is sharded to keep each shard small, cache-friendly, and stable:
 *
 *   /sitemap.xml            → sitemap index listing all shards
 *   /sitemap-posts-N.xml    → one shard of published non-reply posts
 *   /sitemap-collections.xml → public collection pages
 *   /sitemap-pages.xml       → homepage + static aggregate pages
 *
 * Post shards are keyset-paginated by post `id` (TypeIDs embed a
 * creation-ordered UUIDv7 timestamp), so once a shard fills up its membership
 * never changes: new posts always land in the last shard, never rewriting an
 * older one. This lets old shards be cached at the edge for a long time.
 */

import { Hono } from "hono";
import type { Bindings, Post } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import {
  renderSitemapIndex,
  renderSitemapUrlSet,
  SITEMAP_SHARD_SIZE,
  type SitemapIndexEntry,
  type SitemapUrlEntry,
} from "../../lib/feed.js";
import { toAbsoluteSiteUrl } from "../../lib/url.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const sitemapRoutes = new Hono<Env>();

const CACHE_SHORT = "public, max-age=180";
const CACHE_FULL_SHARD = "public, max-age=86400, s-maxage=86400";

function xmlResponse(xml: string, cacheControl: string): Response {
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": cacheControl,
    },
  });
}

/**
 * Build a public URL entry (absolute URL) from an internal path.
 */
function absoluteUrl(
  internalPath: string,
  siteUrl: string,
  sitePathPrefix: string,
): string {
  return toAbsoluteSiteUrl(internalPath, siteUrl, sitePathPrefix);
}

/** Convert a unix-seconds timestamp into a `YYYY-MM-DD` string. */
function toIsoDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

// =============================================================================
// Sitemap Index
// =============================================================================

sitemapRoutes.get("/sitemap.xml", async (c) => {
  const { appConfig } = c.var;
  const { siteUrl, sitePathPrefix } = appConfig;

  const postCount = await c.var.services.posts.countForSitemap();
  const postShardCount = Math.max(1, Math.ceil(postCount / SITEMAP_SHARD_SIZE));

  const entries: SitemapIndexEntry[] = [
    { loc: absoluteUrl("/sitemap-pages.xml", siteUrl, sitePathPrefix) },
  ];

  // Only include post shards if there's at least one post. When postCount is
  // 0 we still list `sitemap-posts-1.xml` so the site always has a posts
  // shard — the renderer emits an empty <urlset>, which is valid.
  for (let page = 1; page <= postShardCount; page++) {
    entries.push({
      loc: absoluteUrl(`/sitemap-posts-${page}.xml`, siteUrl, sitePathPrefix),
    });
  }

  const collections = await c.var.services.collections.list();
  if (collections.length > 0) {
    entries.push({
      loc: absoluteUrl("/sitemap-collections.xml", siteUrl, sitePathPrefix),
    });
  }

  return xmlResponse(renderSitemapIndex(entries), CACHE_SHORT);
});

// =============================================================================
// Post Shards
// =============================================================================

// Hono's path parser does not allow a param alongside a literal prefix in
// the same segment (e.g. `/sitemap-posts-:page.xml` does not match). The
// param must own the whole segment, so we match the full filename with a
// regex and parse the page number out inside the handler.
sitemapRoutes.get("/:file{sitemap-posts-[0-9]+\\.xml}", async (c) => {
  const { appConfig } = c.var;
  const { siteUrl, sitePathPrefix } = appConfig;
  const file = c.req.param("file");
  const match = /^sitemap-posts-([0-9]+)\.xml$/.exec(file);
  if (!match) return c.notFound();
  const page = Number(match[1]);
  if (!Number.isFinite(page) || page < 1) return c.notFound();

  // Keyset cursor: for page N (>1) we want the id just before the shard's
  // first row, so `listForSitemap({ afterId })` returns the shard. For page
  // 1 there is no cursor.
  let afterId: string | undefined;
  if (page > 1) {
    const cursorOffset = (page - 1) * SITEMAP_SHARD_SIZE - 1;
    const cursor = await c.var.services.posts.getSitemapIdAt(cursorOffset);
    if (cursor === null) return c.notFound();
    afterId = cursor;
  }

  const shardEntries = await c.var.services.posts.listForSitemap({
    afterId,
    limit: SITEMAP_SHARD_SIZE,
  });

  // `entry.alias` already includes a leading "/" (see `paths.getPostAliases`);
  // slugs are stored raw. Prepending "/" to an alias would create "//path",
  // which `new URL()` reads as protocol-relative and hijacks the hostname.
  const pathOf = (entry: (typeof shardEntries)[number]) =>
    entry.alias ?? `/${entry.slug}`;

  // A post's URL is language-neutral and listed once. Translations are
  // announced with `xhtml:link` alternates instead, which is what the sitemap
  // protocol asks for — and the only place a crawler can learn about a
  // translation whose own URL lives in a different shard.
  const translated = shardEntries.filter(
    (entry) => entry.translationGroupId && entry.language,
  );
  const translationsMap =
    translated.length > 0
      ? await c.var.services.posts.getTranslationsMap(
          translated.map((entry) => entry.id),
        )
      : new Map<string, Post[]>();
  const siblingIds = [...translationsMap.values()]
    .flat()
    .map((post) => post.id);
  const siblingAliases =
    siblingIds.length > 0
      ? await c.var.services.paths.getPostAliases(siblingIds)
      : new Map<string, string[]>();

  const urls: SitemapUrlEntry[] = shardEntries.map((entry) => {
    const path = pathOf(entry);
    const siblings: Post[] = translationsMap.get(entry.id) ?? [];
    const alternates =
      entry.language && siblings.length > 0
        ? [
            {
              hreflang: entry.language,
              href: absoluteUrl(path, siteUrl, sitePathPrefix),
            },
            ...siblings.flatMap((sibling) =>
              sibling.language
                ? [
                    {
                      hreflang: sibling.language,
                      href: absoluteUrl(
                        siblingAliases.get(sibling.id)?.[0] ??
                          `/${sibling.slug}`,
                        siteUrl,
                        sitePathPrefix,
                      ),
                    },
                  ]
                : [],
            ),
          ]
        : undefined;

    return {
      loc: absoluteUrl(path, siteUrl, sitePathPrefix),
      lastmod: toIsoDate(entry.updatedAt),
      priority: entry.featuredAt ? "0.8" : "0.6",
      ...(alternates ? { alternates } : {}),
    };
  });

  // The last (not-yet-filled) shard needs short caching because new posts
  // will append to it. Full shards are immutable in membership and can be
  // cached aggressively — only a post edit inside them moves `<lastmod>`,
  // which is acceptable sitemap staleness.
  const isFullShard = shardEntries.length === SITEMAP_SHARD_SIZE;
  const cacheControl = isFullShard ? CACHE_FULL_SHARD : CACHE_SHORT;

  return xmlResponse(renderSitemapUrlSet(urls), cacheControl);
});

// =============================================================================
// Collections Shard
// =============================================================================

sitemapRoutes.get("/sitemap-collections.xml", async (c) => {
  const { appConfig } = c.var;
  const { siteUrl, sitePathPrefix } = appConfig;

  const collections = await c.var.services.collections.list();

  // Resolve each collection's canonical URL (alias if one exists, else slug).
  // The `/collections` directory itself lives in `/sitemap-pages.xml`, since
  // it's a static aggregate page rather than per-collection content.
  const urls: SitemapUrlEntry[] = await Promise.all(
    collections.map(async (collection) => {
      const alias = await c.var.services.customUrls.getByTarget(
        "collection",
        collection.id,
      );
      const path = alias ? `/${alias.path}` : `/${collection.slug}`;
      return {
        loc: absoluteUrl(path, siteUrl, sitePathPrefix),
        lastmod: toIsoDate(collection.updatedAt),
        priority: "0.7",
      };
    }),
  );

  return xmlResponse(renderSitemapUrlSet(urls), CACHE_SHORT);
});

// =============================================================================
// Static Pages Shard (homepage)
// =============================================================================

sitemapRoutes.get("/sitemap-pages.xml", async (c) => {
  const { appConfig } = c.var;
  const { siteUrl, sitePathPrefix } = appConfig;

  const urls: SitemapUrlEntry[] = [
    {
      loc: absoluteUrl("/", siteUrl, sitePathPrefix),
      priority: "1.0",
      changefreq: "daily",
    },
    {
      loc: absoluteUrl("/archive", siteUrl, sitePathPrefix),
      priority: "0.5",
      changefreq: "weekly",
    },
  ];

  urls.push({
    loc: absoluteUrl("/featured", siteUrl, sitePathPrefix),
    priority: "0.6",
    changefreq: "daily",
  });

  // Include the collections directory landing page when at least one
  // collection exists. When there are no collections, `/collections` still
  // renders (as an empty directory), but indexing an empty aggregate page
  // adds no value.
  const collections = await c.var.services.collections.list();
  if (collections.length > 0) {
    urls.push({
      loc: absoluteUrl("/collections", siteUrl, sitePathPrefix),
      priority: "0.5",
      changefreq: "weekly",
    });
  }

  return xmlResponse(renderSitemapUrlSet(urls), CACHE_SHORT);
});

// =============================================================================
// robots.txt
// =============================================================================

sitemapRoutes.get("/robots.txt", async (c) => {
  const { appConfig } = c.var;
  const siteUrl = appConfig.siteUrl;
  const noindex = appConfig.noindex;

  const rules = noindex
    ? ["Disallow: /"]
    : ["Allow: /", "Disallow: /_/", "Disallow: /*/text/"];
  const robots = [
    `User-agent: *`,
    ...rules,
    "",
    `Sitemap: ${toAbsoluteSiteUrl("/sitemap.xml", siteUrl, appConfig.sitePathPrefix)}`,
    "",
  ].join("\n");

  return new Response(robots, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": CACHE_SHORT,
    },
  });
});
