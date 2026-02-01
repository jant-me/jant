/**
 * Post List Component
 */

import type { FC } from "hono/jsx";
import { useLingui } from "../../i18n/index.js";
import type { Post } from "../../types.js";
import * as sqid from "../../lib/sqid.js";
import * as time from "../../lib/time.js";

export interface PostListProps {
  posts: Post[];
}

const VisibilityBadge: FC<{ visibility: string }> = ({ visibility }) => {
  const { t } = useLingui();
  const variants: Record<string, string> = {
    featured: "badge-primary",
    quiet: "badge-secondary",
    unlisted: "badge-outline",
    draft: "badge-outline",
  };

  const labels: Record<string, string> = {
    featured: t({ message: "Featured", comment: "@context: Post visibility badge - featured" }),
    quiet: t({ message: "Quiet", comment: "@context: Post visibility badge - normal" }),
    unlisted: t({ message: "Unlisted", comment: "@context: Post visibility badge - unlisted" }),
    draft: t({ message: "Draft", comment: "@context: Post visibility badge - draft" }),
  };

  return <span class={variants[visibility] ?? "badge"}>{labels[visibility] ?? visibility}</span>;
};

const TypeBadge: FC<{ type: string }> = ({ type }) => {
  const { t } = useLingui();
  const labels: Record<string, string> = {
    note: t({ message: "Note", comment: "@context: Post type badge - note" }),
    article: t({ message: "Article", comment: "@context: Post type badge - article" }),
    link: t({ message: "Link", comment: "@context: Post type badge - link" }),
    quote: t({ message: "Quote", comment: "@context: Post type badge - quote" }),
    image: t({ message: "Image", comment: "@context: Post type badge - image" }),
    page: t({ message: "Page", comment: "@context: Post type badge - page" }),
  };
  return <span class="badge-outline">{labels[type] ?? type}</span>;
};

export const PostList: FC<PostListProps> = ({ posts }) => {
  const { t } = useLingui();
  if (posts.length === 0) {
    return (
      <div class="text-center py-12 text-muted-foreground">
        <p>{t({ message: "No posts yet.", comment: "@context: Empty state message when no posts exist" })}</p>
        <a href="/dash/posts/new" class="btn mt-4">
          {t({ message: "Create your first post", comment: "@context: Button in empty state to create first post" })}
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
              <TypeBadge type={post.type} />
              <VisibilityBadge visibility={post.visibility} />
              <span class="text-xs text-muted-foreground">
                {time.formatDate(post.publishedAt)}
              </span>
            </div>
            <a
              href={`/dash/posts/${sqid.encode(post.id)}`}
              class="font-medium hover:underline"
            >
              {post.title || post.content?.slice(0, 60) || t({ message: "Untitled", comment: "@context: Default title for untitled post" })}
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
              {t({ message: "Edit", comment: "@context: Button to edit post" })}
            </a>
            <a href={`/p/${sqid.encode(post.id)}`} class="btn-sm-ghost" target="_blank">
              {t({ message: "View", comment: "@context: Button to view post on public site" })}
            </a>
          </div>
        </div>
      ))}
    </div>
  );
};
