import type { PostView } from "../../types.js";

type PostArticleAttributeSource = Pick<
  PostView,
  | "id"
  | "slug"
  | "format"
  | "status"
  | "visibility"
  | "replyToId"
  | "threadRootId"
  | "pinned"
  | "pinnedInCollection"
  | "featured"
  | "draftTailId"
>;

/**
 * Builds the shared data-attribute contract for interactive Post articles.
 * Child identity is content-derived and therefore stays stable across feed,
 * detail, search, and partial-render modes.
 *
 * @param post - Render-ready Post identity and action state
 * @returns Data attributes consumed by menus, shortcuts, themes, and scripts
 *
 * @example
 * ```tsx
 * <article {...getPostArticleAttributes(post)}>...</article>
 * ```
 */
export function getPostArticleAttributes(post: PostArticleAttributeSource) {
  const isChildPost = Boolean(post.replyToId || post.threadRootId);

  return {
    "data-post": "",
    "data-format": post.format,
    "data-post-id": post.id,
    "data-post-slug": post.slug,
    "data-thread-root-id": post.threadRootId ?? post.id,
    ...(post.pinned ? { "data-post-pinned": "" } : {}),
    ...(post.pinnedInCollection
      ? { "data-post-pinned-in-collection": "" }
      : {}),
    ...(post.featured ? { "data-post-featured": "" } : {}),
    ...(post.status === "draft" ? { "data-post-draft": "" } : {}),
    ...(post.draftTailId
      ? { "data-thread-draft-tail-id": post.draftTailId }
      : {}),
    "data-post-visibility": post.visibility,
    ...(isChildPost ? { "data-post-reply": "" } : {}),
  };
}
