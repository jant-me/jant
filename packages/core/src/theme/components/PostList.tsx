/**
 * Post List Component
 */

import type { FC } from "hono/jsx";
import { useLingui } from "../../i18n/index.js";
import type { Post } from "../../types.js";
import * as sqid from "../../lib/sqid.js";
import * as time from "../../lib/time.js";
import { VisibilityBadge } from "./VisibilityBadge.js";
import { TypeBadge } from "./TypeBadge.js";
import { EmptyState } from "./EmptyState.js";
import { ListItemRow } from "./ListItemRow.js";
import { ActionButtons } from "./ActionButtons.js";

export interface PostListProps {
  posts: Post[];
}

export const PostList: FC<PostListProps> = ({ posts }) => {
  const { t } = useLingui();
  if (posts.length === 0) {
    return (
      <EmptyState
        message={t({
          message: "No posts yet.",
          comment: "@context: Empty state message when no posts exist",
        })}
        ctaText={t({
          message: "Create your first post",
          comment: "@context: Button in empty state to create first post",
        })}
        ctaHref="/dash/posts/new"
      />
    );
  }

  return (
    <div class="flex flex-col divide-y">
      {posts.map((post) => (
        <ListItemRow
          key={post.id}
          actions={
            <ActionButtons
              editHref={`/dash/posts/${sqid.encode(post.id)}/edit`}
              editLabel={t({ message: "Edit", comment: "@context: Button to edit post" })}
              viewHref={`/p/${sqid.encode(post.id)}`}
              viewLabel={t({
                message: "View",
                comment: "@context: Button to view post on public site",
              })}
            />
          }
        >
          <div class="flex items-center gap-2 mb-1">
            <TypeBadge type={post.type} />
            <VisibilityBadge visibility={post.visibility} />
            <span class="text-xs text-muted-foreground">{time.formatDate(post.publishedAt)}</span>
          </div>
          <a href={`/dash/posts/${sqid.encode(post.id)}`} class="font-medium hover:underline">
            {post.title ||
              post.content?.slice(0, 60) ||
              t({ message: "Untitled", comment: "@context: Default title for untitled post" })}
          </a>
          {post.content && !post.title && (
            <p class="text-sm text-muted-foreground mt-1 line-clamp-2">
              {post.content.slice(0, 120)}
            </p>
          )}
        </ListItemRow>
      ))}
    </div>
  );
};
