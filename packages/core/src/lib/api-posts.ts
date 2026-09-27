import { isTextAttachment } from "../services/media.js";
import type { Services } from "../services/index.js";
import type { PostFilters } from "../services/post.js";
import type { AppConfig } from "../types/config.js";
import type { Media, Post, Status } from "../types.js";
import { getPostDisplayTitle } from "./post-meta.js";
import { getImageUrl, getMediaUrl, getPublicUrlForProvider } from "./image.js";
import { toPublicPath } from "./url.js";

/**
 * A Post in the author API: `GET /api/posts`, `/api/threads`, and the MCP post
 * tools. Every field is listed here and in docs/API.md's Posts table; nothing
 * reaches the response by being a column. `title` and `url` are present
 * except on quotes, which carry `sourceName` and `sourceUrl` instead.
 */
export interface ApiPostResponse {
  id: string;
  format: Post["format"];
  status: Post["status"];
  /** Resolved: a reply carries its Thread root's visibility. */
  visibility: Post["visibility"];
  pinnedAt: number | null;
  featuredAt: number | null;
  slug: string;
  title?: string | null;
  url?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  /**
   * Short plain-text name for this Post, derived when it has no title of its
   * own. Use it wherever the Post is referenced from somewhere else; a slug is
   * a URL, not a name.
   */
  displayTitle: string;
  body: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  quoteText: string | null;
  summary: string | null;
  rating: number | null;
  replyToId: string | null;
  threadId: string;
  /** BCP 47 content language, uniform across a Thread. */
  language: string | null;
  quietReply: boolean;
  publishedAt: number | null;
  lastActivityAt: number;
  threadUpdatedAt: number;
  /**
   * Published Posts in this Post's Thread, its root included: 1 for a Post on
   * its own, 0 while nothing in the Thread is published.
   */
  threadPostCount: number;
  createdAt: number;
  updatedAt: number;
  attachments?: ReturnType<typeof toApiAttachment>[];
  /** The Thread's collections; only on single-post reads. */
  collectionIds?: string[];
}

/**
 * The order `GET /api/posts` and `jant_posts_list` walk Posts in.
 *
 * Published Posts run newest-published first, pins ignored: a Post's place
 * then depends on its own publication alone, and a reply added to an old
 * Thread doesn't lift the root past a walk's cursor. Drafts keep the editing
 * order the composer's draft list reads, last edited first.
 *
 * @param status - The status the list is filtered to
 * @returns The `PostFilters` ordering fields for that list
 * @example
 * posts.listPage({ status, ...apiPostListOrder(status) }, { limit: 100 });
 */
export function apiPostListOrder(
  status: Status,
): Pick<PostFilters, "sortBy" | "ignorePinnedSort"> {
  return status === "draft"
    ? {}
    : { sortBy: "published", ignorePinnedSort: true };
}

export function toApiAttachment(
  media: Media,
  r2PublicUrl?: string,
  imageTransformUrl?: string,
  s3PublicUrl?: string,
  localPublicUrl?: string,
  sitePathPrefix?: string,
) {
  const publicUrl = getPublicUrlForProvider(
    media.provider,
    r2PublicUrl,
    s3PublicUrl,
    localPublicUrl,
  );
  const url = getMediaUrl(media.storageKey, publicUrl, sitePathPrefix);

  if (isTextAttachment(media)) {
    return {
      type: "text" as const,
      id: media.id,
      contentFormat: "markdown" as const,
      contentUrl: toPublicPath(
        `/api/attachments/${media.id}/content`,
        sitePathPrefix,
      ),
      summary: media.summary,
      chars: media.chars,
    };
  }

  const previewUrl = media.mimeType.startsWith("image/")
    ? getImageUrl(url, imageTransformUrl, {
        width: 1200,
        height: 768,
        quality: 80,
        format: "auto",
        fit: "scale-down",
      })
    : url;
  const posterUrl = media.posterKey
    ? getMediaUrl(media.posterKey, publicUrl, sitePathPrefix)
    : null;

  return {
    type: "media" as const,
    id: media.id,
    url,
    previewUrl,
    posterUrl,
    alt: media.alt,
    blurhash: media.blurhash,
    width: media.width,
    height: media.height,
    durationSeconds: media.durationSeconds,
    mimeType: media.mimeType,
    originalName: media.originalName,
    size: media.size,
    summary: media.summary,
    chars: media.chars,
  };
}

export function toApiPost(
  post: Post,
  extras: {
    threadPostCount: number;
    attachments?: ReturnType<typeof toApiAttachment>[];
    collectionIds?: string[];
  },
): ApiPostResponse {
  // Quotes name their source where other formats carry a title and link.
  const source =
    post.format === "quote"
      ? { sourceName: post.title ?? null, sourceUrl: post.url ?? null }
      : { title: post.title ?? null, url: post.url ?? null };

  return {
    id: post.id,
    format: post.format,
    status: post.status,
    visibility: post.visibility,
    pinnedAt: post.pinnedAt,
    featuredAt: post.featuredAt,
    slug: post.slug,
    ...source,
    // A short name for this Post wherever it is referenced from somewhere
    // else — notes are usually untitled, so the client cannot just read `title`.
    displayTitle: getPostDisplayTitle(post),
    body: post.body,
    bodyHtml: post.bodyHtml,
    bodyText: post.bodyText,
    quoteText: post.quoteText,
    summary: post.summary,
    rating: post.rating,
    replyToId: post.replyToId,
    threadId: post.threadId,
    language: post.language,
    quietReply: post.quietReply,
    publishedAt: post.publishedAt,
    lastActivityAt: post.lastActivityAt,
    threadUpdatedAt: post.threadUpdatedAt,
    threadPostCount: extras.threadPostCount,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    ...(extras.attachments ? { attachments: extras.attachments } : {}),
    ...(extras.collectionIds ? { collectionIds: extras.collectionIds } : {}),
  };
}

/** What {@link loadApiPostResponses} reads through. */
export interface ApiPostResponseDeps {
  services: Pick<Services, "media" | "posts" | "collections">;
  appConfig: AppConfig;
}

/**
 * API responses for Posts already loaded. Attachments, Thread Post counts,
 * and (when asked) Thread collections are each read in one batch for the
 * whole set, so a page costs the same few round trips however long it is.
 *
 * @param deps - Services and app config; a request's `c.var` or an MCP context
 * @param posts - Posts to respond with, in order
 * @param options - `collectionIds` adds each Post's shared Thread collections
 * @returns One response per Post, in the same order
 * @example
 * const responses = await loadApiPostResponses(c.var, page.posts);
 */
export async function loadApiPostResponses(
  deps: ApiPostResponseDeps,
  posts: Post[],
  options: { collectionIds?: boolean } = {},
): Promise<ApiPostResponse[]> {
  if (posts.length === 0) return [];
  const { services, appConfig } = deps;
  const postIds = posts.map((post) => post.id);
  const [mediaMap, threadPostCounts, collectionsMap] = await Promise.all([
    services.media.getByPostIds(postIds),
    services.posts.countThreadPosts(posts.map((post) => post.threadId)),
    options.collectionIds
      ? services.collections.getCollectionsByPostIds(postIds)
      : Promise.resolve(null),
  ]);

  return posts.map((post) =>
    toApiPost(post, {
      threadPostCount: threadPostCounts.get(post.threadId) ?? 0,
      attachments: (mediaMap.get(post.id) ?? []).map((media) =>
        toApiAttachment(
          media,
          appConfig.r2PublicUrl,
          appConfig.imageTransformUrl,
          appConfig.s3PublicUrl,
          appConfig.localPublicUrl,
          appConfig.sitePathPrefix,
        ),
      ),
      ...(collectionsMap
        ? {
            collectionIds: (collectionsMap.get(post.id) ?? []).map(
              (collection) => collection.id,
            ),
          }
        : {}),
    }),
  );
}

/**
 * One Post's API response. See {@link loadApiPostResponses}.
 *
 * @param deps - Services and app config
 * @param post - The Post
 * @param options - `collectionIds` adds the Post's shared Thread collections
 * @returns The Post's response
 * @example
 * return c.json(await loadApiPostResponse(c.var, post));
 */
export async function loadApiPostResponse(
  deps: ApiPostResponseDeps,
  post: Post,
  options: { collectionIds?: boolean } = {},
): Promise<ApiPostResponse> {
  const [response] = await loadApiPostResponses(deps, [post], options);
  if (!response) throw new Error(`No response built for post ${post.id}`);
  return response;
}
