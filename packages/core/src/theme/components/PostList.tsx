/**
 * Post List Component
 */

import type { FC } from "hono/jsx";
import type { Context } from "hono";
import { msg } from "@lingui/core/macro";
import type { Post } from "../../types.js";
import { getI18n } from "../../i18n/index.js";
import * as sqid from "../../lib/sqid.js";
import * as time from "../../lib/time.js";

export interface PostListProps {
  c: Context;
  posts: Post[];
}

const VisibilityBadge: FC<{ c: Context; visibility: string }> = ({ c, visibility }) => {
  const i18n = getI18n(c);
  const variants: Record<string, string> = {
    featured: "badge-primary",
    quiet: "badge-secondary",
    unlisted: "badge-outline",
    draft: "badge-outline",
  };

  const labels: Record<string, string> = {
    featured: i18n._(msg({ message: "Featured", comment: "@context: Post visibility badge - featured" })),
    quiet: i18n._(msg({ message: "Quiet", comment: "@context: Post visibility badge - normal" })),
    unlisted: i18n._(msg({ message: "Unlisted", comment: "@context: Post visibility badge - unlisted" })),
    draft: i18n._(msg({ message: "Draft", comment: "@context: Post visibility badge - draft" })),
  };

  return <span class={variants[visibility] ?? "badge"}>{labels[visibility] ?? visibility}</span>;
};

const TypeBadge: FC<{ c: Context; type: string }> = ({ c, type }) => {
  const i18n = getI18n(c);
  const labels: Record<string, string> = {
    note: i18n._(msg({ message: "Note", comment: "@context: Post type badge - note" })),
    article: i18n._(msg({ message: "Article", comment: "@context: Post type badge - article" })),
    link: i18n._(msg({ message: "Link", comment: "@context: Post type badge - link" })),
    quote: i18n._(msg({ message: "Quote", comment: "@context: Post type badge - quote" })),
    image: i18n._(msg({ message: "Image", comment: "@context: Post type badge - image" })),
    page: i18n._(msg({ message: "Page", comment: "@context: Post type badge - page" })),
  };
  return <span class="badge-outline">{labels[type] ?? type}</span>;
};

export const PostList: FC<PostListProps> = ({ c, posts }) => {
  const i18n = getI18n(c);
  if (posts.length === 0) {
    return (
      <div class="text-center py-12 text-muted-foreground">
        <p>{i18n._(msg({ message: "No posts yet.", comment: "@context: Empty state message when no posts exist" }))}</p>
        <a href="/dash/posts/new" class="btn mt-4">
          {i18n._(msg({ message: "Create your first post", comment: "@context: Button in empty state to create first post" }))}
        </a>
      </div>
    );
  }

  return (
    <div class="flex flex-col divide-y">
      {posts.map((post) => (
        <div key={post.id} class="py-4 flex items-start gap-4">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <TypeBadge c={c} type={post.type} />
              <VisibilityBadge c={c} visibility={post.visibility} />
              <span class="text-xs text-muted-foreground">
                {time.formatDate(post.publishedAt)}
              </span>
            </div>
            <a
              href={`/dash/posts/${sqid.encode(post.id)}`}
              class="font-medium hover:underline"
            >
              {post.title || post.content?.slice(0, 60) || i18n._(msg({ message: "Untitled", comment: "@context: Default title for untitled post" }))}
            </a>
            {post.content && !post.title && (
              <p class="text-sm text-muted-foreground mt-1 line-clamp-2">
                {post.content.slice(0, 120)}
              </p>
            )}
          </div>
          <div class="flex items-center gap-2">
            <a
              href={`/dash/posts/${sqid.encode(post.id)}/edit`}
              class="btn-sm-outline"
            >
              {i18n._(msg({ message: "Edit", comment: "@context: Button to edit post" }))}
            </a>
            <a href={`/p/${sqid.encode(post.id)}`} class="btn-sm-ghost" target="_blank">
              {i18n._(msg({ message: "View", comment: "@context: Button to view post on public site" }))}
            </a>
          </div>
        </div>
      ))}
    </div>
  );
};
