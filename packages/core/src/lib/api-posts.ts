import { isTextAttachment } from "../services/media.js";
import type { Services } from "../services/index.js";
import type { PostFilters } from "../services/post.js";
import type { AppConfig } from "../types/config.js";
import type { Media, Post, Status } from "../types.js";
import { getPostDisplayTitle } from "./post-meta.js";
import { getImageUrl, getMediaUrl, getPublicUrlForProvider } from "./image.js";
import { toPublicPath } from "./url.js";

export type ApiPostResponse = Omit<Post, "title" | "url"> & {
  attachments?: ReturnType<typeof toApiAttachment>[];
  collectionIds?: string[];
  title?: string | null;
  /**
   * Short plain-text name for this Post, derived when it has no title of its
   * own. Use it wherever the Post is referenced from somewhere else; a slug is
   * a URL, not a name.
   */
  displayTitle: string;
  /**
   * Published Posts in this Post's Thread, its root included: 1 for a Post on
   * its own, 0 while nothing in the Thread is published.
   */
  threadPostCount: number;
  url?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
};

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
  const { title, url, ...rest } = post;
  // A short name for this Post wherever it is referenced from somewhere else —
  // notes are usually untitled, so the client cannot just read `title`.
  const displayTitle = getPostDisplayTitle(post);

  if (post.format === "quote") {
    return {
      ...rest,
      ...extras,
      displayTitle,
      sourceName: title ?? null,
      sourceUrl: url ?? null,
    };
  }

  return {
    ...rest,
    ...extras,
    displayTitle,
    title: title ?? null,
    url: url ?? null,
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
