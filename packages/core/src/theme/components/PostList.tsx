/**
 * Post List Component
 */

import type { FC } from "hono/jsx";
import type { Post } from "../../types.js";
import * as sqid from "../../lib/sqid.js";
import * as time from "../../lib/time.js";

export interface PostListProps {
  posts: Post[];
}

const VisibilityBadge: FC<{ visibility: string }> = ({ visibility }) => {
  const variants: Record<string, string> = {
    featured: "badge-primary",
    quiet: "badge-secondary",
    unlisted: "badge-outline",
    draft: "badge-outline",
  };
  return <span class={variants[visibility] ?? "badge"}>{visibility}</span>;
};

const TypeBadge: FC<{ type: string }> = ({ type }) => {
  return <span class="badge-outline">{type}</span>;
};

export const PostList: FC<PostListProps> = ({ posts }) => {
  if (posts.length === 0) {
    return (
      <div class="text-center py-12 text-muted-foreground">
        <p>No posts yet.</p>
        <a href="/dash/posts/new" class="btn mt-4">
          Create your first post
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
              {post.title || post.content?.slice(0, 60) || "Untitled"}
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
              Edit
            </a>
            <a href={`/p/${sqid.encode(post.id)}`} class="btn-sm-ghost" target="_blank">
              View
            </a>
          </div>
        </div>
      ))}
    </div>
  );
};
