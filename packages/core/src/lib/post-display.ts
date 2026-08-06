/**
 * Post display assembly helpers.
 *
 * Reusable server-side assembly for single-post cards and permalink thread
 * views so full-page renders and partial refreshes stay in sync.
 */

import type { Context } from "hono";
import type { Bindings, Post, PostView } from "../types.js";
import type { AppVariables } from "../types/app-context.js";
import { buildMediaMap } from "./media-helpers.js";
import { createMediaContext, resolveDraftTailId, toPostView } from "./view.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

/** Social/preview image picked for a post page, with metadata when known. */
export interface PostSocialImage {
  /** Image URL — may be app-local or an already-absolute CDN URL. */
  url: string;
  /** Pixel width, when known (image attachments only, not link previews). */
  width?: number;
  /** Pixel height, when known. */
  height?: number;
  /** Alt text, when the source image attachment has one. */
  alt?: string;
}

export interface PostPageDisplayData {
  postView: PostView;
  threadPostViews?: PostView[];
  /**
   * Image to use as og:image / twitter:image for this post page. Prefers an
   * image attached to the current post, then its link-preview thumbnail, then
   * any image found elsewhere in the thread. Undefined when the thread has no
   * images — BaseLayout then falls back to the site avatar or the default
   * Jant social image.
   */
  socialImage?: PostSocialImage;
  /**
   * ISO 8601 publish time for `article:published_time`. A post page renders
   * the whole thread as one "article", so this is the thread root's publish
   * time (the post itself when it is not part of a thread).
   */
  articlePublishedTime: string;
  /**
   * ISO 8601 last-modified time for `article:modified_time`: the most recent
   * update across every post in the thread.
   */
  articleModifiedTime: string;
}

function findFirstImage(post: PostView): PostSocialImage | undefined {
  const image = post.media.find((m) => m.mimeType.startsWith("image/"));
  if (image) {
    return {
      url: image.url,
      width: image.width,
      height: image.height,
      alt: image.altText,
    };
  }
  // Link-preview thumbnails are transformed images with no known dimensions.
  return post.previewImageUrl ? { url: post.previewImageUrl } : undefined;
}

function resolvePostSocialImage(
  postView: PostView,
  threadPostViews: PostView[] | undefined,
): PostSocialImage | undefined {
  const direct = findFirstImage(postView);
  if (direct) return direct;

  if (!threadPostViews) return undefined;
  for (const p of threadPostViews) {
    if (p.id === postView.id) continue;
    const found = findFirstImage(p);
    if (found) return found;
  }
  return undefined;
}

interface PostDisplayOptions {
  isAuthenticated?: boolean;
  allowDraft?: boolean;
  /**
   * Force draft members into the assembled thread. The author already sees
   * them whenever they are signed in; this only covers the draft-preview
   * route, where the request is authenticated but `isAuthenticated` has
   * already been forced to `true` for private-post access.
   */
  includeDraftThread?: boolean;
}

function canViewPost(post: Post, options: PostDisplayOptions = {}): boolean {
  const isAuthenticated = options.isAuthenticated ?? false;
  if (post.status !== "published") {
    return Boolean(
      post.status === "draft" && isAuthenticated && options.allowDraft,
    );
  }

  if (post.visibility === "private" && !isAuthenticated) {
    return false;
  }

  return true;
}

/**
 * Assembles a single post card view with thread metadata.
 *
 * @param c - Hono context (provides services + appConfig)
 * @param postId - TypeID of the post to render
 * @param options - Auth state used to enforce private post visibility
 * @returns Render-ready post card view, or null when it should not be shown
 */
export async function assemblePostCardView(
  c: Context<Env>,
  postId: string,
  options?: PostDisplayOptions,
): Promise<PostView | null> {
  const post = await c.var.services.posts.getById(postId);
  if (!post || !canViewPost(post, options)) {
    return null;
  }

  const mediaCtx = createMediaContext(c.var.appConfig);
  const [rawMediaMap, collectionsMap, lastPostMap, draftTailMap, aliasesMap] =
    await Promise.all([
      c.var.services.media.getByPostIds([post.id]),
      c.var.services.collections.getCollectionsByPostIds([post.id]),
      c.var.services.posts.getThreadTailIds([post.threadId]),
      c.var.isAuthenticated
        ? c.var.services.posts.getThreadTailIds([post.threadId], {
            includeDrafts: true,
          })
        : Promise.resolve(new Map<string, string>()),
      c.var.services.paths.getPostAliases([post.id]),
    ]);

  const mediaMap = buildMediaMap(
    rawMediaMap,
    mediaCtx.r2PublicUrl,
    mediaCtx.imageTransformUrl,
    mediaCtx.s3PublicUrl,
    mediaCtx.localPublicUrl,
    mediaCtx.sitePathPrefix,
  );
  const view = toPostView(
    { ...post, mediaAttachments: mediaMap.get(post.id) ?? [] },
    mediaCtx,
    collectionsMap.get(post.id),
    lastPostMap.get(post.threadId) === post.id,
    aliasesMap.get(post.id)?.[0],
  );

  const draftTailId = resolveDraftTailId(
    post.threadId,
    lastPostMap,
    draftTailMap,
  );
  if (draftTailId) view.draftTailId = draftTailId;

  return view;
}

/**
 * Assembles the post permalink view, including the full thread when needed.
 *
 * @param c - Hono context (provides services + appConfig)
 * @param postOrId - TypeID of the post or a preloaded post record
 * @param options - Auth state used to enforce private post visibility
 * @returns Render-ready permalink view data, or null when it should not be shown
 */
export async function assemblePostPageDisplay(
  c: Context<Env>,
  postOrId: string | Post,
  options?: PostDisplayOptions,
): Promise<PostPageDisplayData | null> {
  const post =
    typeof postOrId === "string"
      ? await c.var.services.posts.getById(postOrId)
      : postOrId;

  if (!post || !canViewPost(post, options)) {
    return null;
  }

  const mediaCtx = createMediaContext(c.var.appConfig);
  // Drafts render for the author so the thread they see ends where the server
  // thinks it ends — otherwise a trailing draft silently blocks replies while
  // staying invisible. Read the real auth state rather than the option, which
  // callers force to `true` to bypass the private-post check.
  const includeDrafts = Boolean(
    options?.includeDraftThread || c.var.isAuthenticated,
  );
  const threadPosts = (
    await c.var.services.posts.getThread(post.threadId)
  ).filter(
    (threadPost) =>
      threadPost.status === "published" ||
      (includeDrafts && threadPost.status === "draft"),
  );

  const allPostIds =
    threadPosts.length > 1 ? threadPosts.map((p) => p.id) : [post.id];
  const [rawMediaMap, collectionsMap, aliasesMap] = await Promise.all([
    c.var.services.media.getByPostIds(allPostIds),
    c.var.services.collections.getCollectionsByPostIds(allPostIds),
    c.var.services.paths.getPostAliases(allPostIds),
  ]);
  const mediaMap = buildMediaMap(
    rawMediaMap,
    mediaCtx.r2PublicUrl,
    mediaCtx.imageTransformUrl,
    mediaCtx.s3PublicUrl,
    mediaCtx.localPublicUrl,
    mediaCtx.sitePathPrefix,
  );
  const firstAlias = (id: string) => aliasesMap.get(id)?.[0];

  const postView = toPostView(
    { ...post, mediaAttachments: mediaMap.get(post.id) ?? [] },
    mediaCtx,
    collectionsMap.get(post.id),
    undefined,
    firstAlias(post.id),
  );

  const threadPostViews =
    threadPosts.length > 1
      ? threadPosts.map((threadPost, index) =>
          toPostView(
            {
              ...threadPost,
              mediaAttachments: mediaMap.get(threadPost.id) ?? [],
            },
            mediaCtx,
            collectionsMap.get(threadPost.id),
            index === threadPosts.length - 1,
            firstAlias(threadPost.id),
          ),
        )
      : undefined;

  // Page metadata describes what a reader gets, so it never draws on drafts:
  // an unpublished reply must not supply the og:image or bump the modified
  // time. Falls back to the post itself when nothing in the thread is
  // published (the draft-preview route, which is noindex anyway).
  const publishedViews = threadPostViews?.filter(
    (view) => view.status === "published",
  );
  const metaViews = publishedViews?.length ? publishedViews : [postView];

  const socialImage = resolvePostSocialImage(postView, metaViews);

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- metaViews is never empty
  const rootView = metaViews[0]!;
  // ISO 8601 strings from toISOString() are all UTC and zero-padded, so
  // lexical comparison matches chronological order.
  const articleModifiedTime = metaViews
    .map((p) => p.updatedAt)
    .reduce((latest, t) => (t > latest ? t : latest));

  return {
    postView,
    threadPostViews,
    socialImage,
    articlePublishedTime: rootView.publishedAt,
    articleModifiedTime,
  };
}
