import { isTextAttachment } from "../services/media.js";
import type { Services } from "../services/index.js";
import type { PostFilters } from "../services/post.js";
import type { AppConfig } from "../types/config.js";
import type { Media, Post, Status } from "../types.js";
import { getPostDisplayTitle } from "./post-meta.js";
import { getImageUrl, getMediaUrl, getPublicUrlForProvider } from "./image.js";
import type { PostContent } from "./schemas.js";
import { tiptapJsonToMarkdown } from "./tiptap-to-markdown.js";
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
  /** TipTap JSON. Left out when the read asked for `content: "markdown"`. */
  body?: string | null;
  /** Left out when the read asked for `content: "markdown"`. */
  bodyHtml?: string | null;
  /** Left out when the read asked for `content: "markdown"`. */
  bodyText?: string | null;
  /** Only when the read asked for `content: "markdown"`. */
  bodyMarkdown?: string | null;
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

/**
 * Where the author API reads a text attachment's Markdown as JSON.
 *
 * @param mediaId - The text attachment's media ID
 * @param sitePathPrefix - The site's path prefix, if any
 * @returns The endpoint's public path
 * @example
 * textAttachmentContentUrl("med_01…", "/blog"); // "/blog/api/attachments/med_01…/content"
 */
export function textAttachmentContentUrl(
  mediaId: string,
  sitePathPrefix?: string,
): string {
  return toPublicPath(`/api/attachments/${mediaId}/content`, sitePathPrefix);
}

/** The app config an attachment's addresses are built from. */
export type AttachmentUrlConfig = Pick<
  AppConfig,
  | "r2PublicUrl"
  | "imageTransformUrl"
  | "s3PublicUrl"
  | "localPublicUrl"
  | "sitePathPrefix"
>;

/**
 * One of a Post's attachments, as the API returns it.
 *
 * Every attachment's `url` is the file itself. A text attachment's file is
 * its Markdown source. The author view adds `contentUrl`, the endpoint that
 * returns that source as JSON; it needs a session or token, so the reader
 * view leaves it out.
 *
 * @param media - The attachment's media row
 * @param config - Public URL settings the addresses are built from
 * @param view - `author` for the author API and MCP, `reader` for `/api/public/*`
 * @returns The attachment object
 * @example
 * post.attachments = media.map((item) => toApiAttachment(item, appConfig, "reader"));
 */
export function toApiAttachment(
  media: Media,
  config: AttachmentUrlConfig,
  view: "author" | "reader" = "author",
) {
  const { imageTransformUrl, sitePathPrefix } = config;
  const publicUrl = getPublicUrlForProvider(
    media.provider,
    config.r2PublicUrl,
    config.s3PublicUrl,
    config.localPublicUrl,
  );
  const url = getMediaUrl(media.storageKey, publicUrl, sitePathPrefix);

  if (isTextAttachment(media)) {
    return {
      type: "text" as const,
      id: media.id,
      url,
      contentFormat: "markdown" as const,
      ...(view === "author"
        ? { contentUrl: textAttachmentContentUrl(media.id, sitePathPrefix) }
        : {}),
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

/**
 * A post body as Markdown, or null for a historical body that isn't TipTap
 * JSON. One unreadable row answers null and is logged, rather than failing a
 * whole page of posts.
 *
 * @param postId - The post, named in the log line
 * @param body - The stored TipTap JSON
 * @returns The Markdown, or null
 * @example
 * toBodyMarkdown(post.id, post.body); // "Hello **world**"
 */
export function toBodyMarkdown(postId: string, body: string): string | null {
  try {
    return tiptapJsonToMarkdown(body);
  } catch (error) {
    // eslint-disable-next-line no-console -- A skipped body must leave a trace
    console.error(
      `Couldn't convert the body of post ${postId} to Markdown`,
      error,
    );
    return null;
  }
}

/**
 * The body fields a read returns: the stored and rendered forms, or with
 * `content: "markdown"` the Markdown alone.
 *
 * @param post - The Post
 * @param content - The body format the read asked for
 * @returns The body fields
 * @example
 * toApiPostBody(post, "markdown"); // { bodyMarkdown: "…" }
 */
function toApiPostBody(
  post: Post,
  content: PostContent | undefined,
): Pick<ApiPostResponse, "body" | "bodyHtml" | "bodyText" | "bodyMarkdown"> {
  if (content === "markdown") {
    return {
      bodyMarkdown: post.body ? toBodyMarkdown(post.id, post.body) : null,
    };
  }
  return { body: post.body, bodyHtml: post.bodyHtml, bodyText: post.bodyText };
}

/**
 * One Post's author response, from what was read about it in its page's batch.
 *
 * @param post - The Post
 * @param extras - Its Thread's post count, attachments, and collections
 * @param options - `content: "markdown"` returns `bodyMarkdown` in place of
 *   `body`, `bodyHtml`, and `bodyText`
 * @returns The response
 * @example
 * toApiPost(post, { threadPostCount: 1 });
 */
export function toApiPost(
  post: Post,
  extras: {
    threadPostCount: number;
    attachments?: ReturnType<typeof toApiAttachment>[];
    collectionIds?: string[];
  },
  options: { content?: PostContent } = {},
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
    ...toApiPostBody(post, options.content),
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

/** What else {@link loadApiPostResponses} puts on each response. */
export interface ApiPostResponseOptions {
  /** Add each Post's shared Thread collections. */
  collectionIds?: boolean;
  /** `markdown` returns each body as Markdown. */
  content?: PostContent;
}

/**
 * API responses for Posts already loaded. Attachments, Thread Post counts,
 * and (when asked) Thread collections are each read in one batch for the
 * whole set, so a page costs the same few round trips however long it is.
 *
 * @param deps - Services and app config; a request's `c.var` or an MCP context
 * @param posts - Posts to respond with, in order
 * @param options - `collectionIds` adds each Post's shared Thread collections;
 *   `content: "markdown"` returns each body as Markdown
 * @returns One response per Post, in the same order
 * @example
 * const responses = await loadApiPostResponses(c.var, page.posts);
 */
export async function loadApiPostResponses(
  deps: ApiPostResponseDeps,
  posts: Post[],
  options: ApiPostResponseOptions = {},
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
    toApiPost(
      post,
      {
        threadPostCount: threadPostCounts.get(post.threadId) ?? 0,
        attachments: (mediaMap.get(post.id) ?? []).map((media) =>
          toApiAttachment(media, appConfig),
        ),
        ...(collectionsMap
          ? {
              collectionIds: (collectionsMap.get(post.id) ?? []).map(
                (collection) => collection.id,
              ),
            }
          : {}),
      },
      { content: options.content },
    ),
  );
}

/**
 * One Post's API response. See {@link loadApiPostResponses}.
 *
 * @param deps - Services and app config
 * @param post - The Post
 * @param options - As for {@link loadApiPostResponses}
 * @returns The Post's response
 * @example
 * return c.json(await loadApiPostResponse(c.var, post));
 */
export async function loadApiPostResponse(
  deps: ApiPostResponseDeps,
  post: Post,
  options: ApiPostResponseOptions = {},
): Promise<ApiPostResponse> {
  const [response] = await loadApiPostResponses(deps, [post], options);
  if (!response) throw new Error(`No response built for post ${post.id}`);
  return response;
}

/**
 * One Post as `GET /api/posts/:id` and `jant_posts_get` answer it: the
 * response, its Thread's collections, and its place in the Thread.
 *
 * @param deps - Services and app config
 * @param post - The Post
 * @param options - `content: "markdown"` returns the body as Markdown
 * @returns The Post's response with `collectionIds` and `threadPosition`
 * @example
 * return c.json(await loadApiPostDetail(c.var, post));
 */
export async function loadApiPostDetail(
  deps: ApiPostResponseDeps,
  post: Post,
  options: { content?: PostContent } = {},
): Promise<ApiPostResponse & { threadPosition: number }> {
  const [response, threadPosition] = await Promise.all([
    loadApiPostResponse(deps, post, {
      collectionIds: true,
      content: options.content,
    }),
    deps.services.posts.getThreadPosition(post.id),
  ]);
  return { ...response, threadPosition };
}
