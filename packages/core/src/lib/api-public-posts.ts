/**
 * Public API Post responses
 *
 * The reading view of a Post that `/api/public/*` returns: rendered body or
 * Markdown, public permalink, and public collection references.
 */

import type { Services } from "../services/index.js";
import type { AppConfig } from "../types/config.js";
import type { Collection, Media, Post } from "../types.js";
import type { PostContent } from "./schemas.js";
import { getCollectionPagePath } from "./collection-paths.js";
import { toApiAttachment, toBodyMarkdown } from "./api-posts.js";
import { getPostPath, toPublicPath } from "./url.js";
import { getImageUrl, getMediaUrl, getPublicUrlForProvider } from "./image.js";

export type PublicPostBaseResponse = {
  id: string;
  format: Post["format"];
  status: "published";
  visibility: Post["visibility"];
  slug: string;
  permalink: string;
  title?: string | null;
  url?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  quoteText: string | null;
  summary: string | null;
  rating: number | null;
  previewKind: string | null;
  previewProvider: string | null;
  previewImageUrl: string | null;
  replyToId: string | null;
  threadId: string;
  /**
   * BCP 47 content language, or null on a post written before the site
   * enabled multilingual content.
   */
  language: string | null;
  /** Reply published without announcing its Thread. Always false on roots. */
  quietReply: boolean;
  pinnedAt: number | null;
  featuredAt: number | null;
  publishedAt: number | null;
  /** Root only: newest post in the Thread, quiet replies excluded. */
  lastActivityAt: number;
  /** Root only: newest post in the Thread, quiet replies included. */
  threadUpdatedAt: number;
  /**
   * Published Posts in this Post's Thread, its root included: 1 for a Post on
   * its own.
   */
  threadPostCount: number;
  createdAt: number;
  updatedAt: number;
  attachments: ReturnType<typeof toApiAttachment>[];
  collections: {
    id: string;
    slug: string;
    title: string;
    url: string;
  }[];
};

export type PublicPostRenderedResponse = PublicPostBaseResponse & {
  bodyHtml: string | null;
  bodyText: string | null;
};

export type PublicPostMarkdownResponse = PublicPostBaseResponse & {
  bodyMarkdown: string | null;
};

/** What the public API's responses read besides the Posts themselves. */
export interface PublicResponseDeps {
  services: Pick<Services, "media" | "posts" | "collections" | "paths">;
  appConfig: AppConfig;
}

export type PublicPostResponse =
  PublicPostRenderedResponse | PublicPostMarkdownResponse;

/**
 * One Post's reading view, from its attachments, its Thread's collections, and
 * its Thread's Post count.
 *
 * @param post - The Post
 * @param related - What was read about it in the same batch as its page;
 *   `aliasPath` is its oldest custom path, its permalink when it has one
 * @param appConfig - Media URLs and the site path prefix
 * @param options - `content: "markdown"` returns `bodyMarkdown` instead of the
 *   rendered body
 * @returns The public response
 * @example
 * toPublicPost(post, { media: [], collections: [], threadPostCount: 1 }, config);
 */
export function toPublicPost(
  post: Post,
  related: {
    media: Media[];
    collections: Collection[];
    threadPostCount: number;
    aliasPath?: string | null;
  },
  appConfig: AppConfig,
  options?: { content?: PostContent },
): PublicPostResponse {
  const {
    r2PublicUrl,
    imageTransformUrl,
    s3PublicUrl,
    localPublicUrl,
    sitePathPrefix,
    storageDriver,
  } = appConfig;

  const previewImagePublicUrl = getPublicUrlForProvider(
    storageDriver,
    r2PublicUrl,
    s3PublicUrl,
    localPublicUrl,
  );
  const previewImageUrl = post.previewImageKey
    ? getImageUrl(
        getMediaUrl(
          post.previewImageKey,
          previewImagePublicUrl,
          sitePathPrefix,
        ),
        imageTransformUrl,
        { width: 1280, quality: 80, format: "auto", fit: "scale-down" },
      )
    : null;

  const base = {
    id: post.id,
    format: post.format,
    status: "published" as const,
    visibility: post.visibility,
    slug: post.slug,
    permalink: toPublicPath(
      getPostPath(post.slug, related.aliasPath),
      sitePathPrefix,
    ),
    quoteText: post.quoteText,
    summary: post.summary,
    rating: post.rating,
    previewKind: post.previewKind,
    previewProvider: post.previewProvider,
    previewImageUrl,
    replyToId: post.replyToId,
    threadId: post.threadId,
    language: post.language,
    quietReply: post.quietReply,
    pinnedAt: post.pinnedAt,
    featuredAt: post.featuredAt,
    publishedAt: post.publishedAt,
    lastActivityAt: post.lastActivityAt,
    threadUpdatedAt: post.threadUpdatedAt,
    threadPostCount: related.threadPostCount,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    attachments: related.media.map((media) =>
      toApiAttachment(media, appConfig, "reader"),
    ),
    collections: related.collections.map((collection) => ({
      id: collection.id,
      slug: collection.slug,
      title: collection.title,
      url: toPublicPath(getCollectionPagePath(collection.slug), sitePathPrefix),
    })),
  };
  const contentFields =
    options?.content === "markdown"
      ? {
          bodyMarkdown: post.body ? toBodyMarkdown(post.id, post.body) : null,
        }
      : {
          bodyHtml: post.bodyHtml,
          bodyText: post.bodyText,
        };

  if (post.format === "quote") {
    return {
      ...base,
      ...contentFields,
      sourceName: post.title,
      sourceUrl: post.url,
    };
  }

  return {
    ...base,
    ...contentFields,
    title: post.title,
    url: post.url,
  };
}

/**
 * Reading-view responses for Posts already loaded. Attachments, Thread
 * collections, and Thread Post counts are each read in one batch.
 *
 * @param deps - Services and app config; a request's `c.var`
 * @param posts - Posts to respond with, in order
 * @param options - `content: "markdown"` returns `bodyMarkdown`
 * @returns One response per Post, in the same order
 * @example
 * const responses = await loadPublicPostResponses(c.var, page.posts, {});
 */
export async function loadPublicPostResponses(
  deps: PublicResponseDeps,
  posts: Post[],
  options: { content?: PostContent } = {},
): Promise<PublicPostResponse[]> {
  if (posts.length === 0) return [];
  const { services, appConfig } = deps;
  const postIds = posts.map((post) => post.id);
  const [mediaMap, collectionsMap, threadPostCounts, aliases] =
    await Promise.all([
      services.media.getByPostIds(postIds),
      services.collections.getCollectionsByPostIds(postIds),
      services.posts.countThreadPosts(posts.map((post) => post.threadId)),
      services.paths.getPostAliases(postIds),
    ]);

  return posts.map((post) =>
    toPublicPost(
      post,
      {
        media: mediaMap.get(post.id) ?? [],
        collections: collectionsMap.get(post.id) ?? [],
        threadPostCount: threadPostCounts.get(post.threadId) ?? 0,
        aliasPath: aliases.get(post.id)?.[0],
      },
      appConfig,
      options,
    ),
  );
}
