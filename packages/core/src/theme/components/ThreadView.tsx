/**
 * Thread View Component
 *
 * Displays a thread of posts with reply chain visualization
 */

import type { FC } from "hono/jsx";
import { useLingui } from "../../i18n/index.js";
import type { Post } from "../../types.js";
import * as sqid from "../../lib/sqid.js";
import * as time from "../../lib/time.js";

export interface ThreadViewProps {
  /** All posts in the thread, ordered by createdAt */
  posts: Post[];
  /** ID of the currently viewed post (to highlight) */
  currentPostId: number;
}

const ThreadPost: FC<{
  post: Post;
  isCurrent: boolean;
  isRoot: boolean;
}> = ({ post, isCurrent, isRoot }) => {
  const { t } = useLingui();
  return (
    <article
      id={`post-${post.id}`}
      class={`h-entry p-4 rounded-lg border ${
        isCurrent
          ? "border-primary bg-primary/5 ring-2 ring-primary/20"
          : "border-border hover:border-muted-foreground/30"
      }`}
    >
      {post.title && (
        <h2 class="p-name text-lg font-medium mb-2">
          <a href={`/p/${sqid.encode(post.id)}`} class="u-url hover:underline">
            {post.title}
          </a>
        </h2>
      )}

      <div
        class="e-content prose prose-sm"
        dangerouslySetInnerHTML={{ __html: post.contentHtml || "" }}
      />

      <footer class="mt-3 flex items-center gap-3 text-sm text-muted-foreground">
        <time class="dt-published" datetime={time.toISOString(post.publishedAt)}>
          {time.formatDate(post.publishedAt)}
        </time>
        {isRoot && (
          <span class="text-xs">
            {t({ message: "Thread start", comment: "@context: Thread view indicator - first post in thread" })}
          </span>
        )}
        {!isCurrent && (
          <a
            href={`/p/${sqid.encode(post.id)}`}
            class="text-xs hover:underline"
          >
            {t({ message: "Permalink", comment: "@context: Link to individual post in thread" })}
          </a>
        )}
      </footer>
    </article>
  );
};

export const ThreadView: FC<ThreadViewProps> = ({ posts, currentPostId }) => {
  const { t } = useLingui();
  if (posts.length === 0) {
    return null;
  }

  const rootPost = posts[0];
  const isThread = posts.length > 1;

  // Single post, no thread
  if (!isThread) {
    return (
      <ThreadPost post={rootPost!} isCurrent={true} isRoot={false} />
    );
  }

  const threadLabel = posts.length === 1
    ? t({ message: "Thread with 1 post", comment: "@context: Thread view header - single post" })
    : t({ message: "Thread with {count} posts", comment: "@context: Thread view header - multiple posts", values: { count: String(posts.length) } });

  return (
    <div class="thread-view">
      <div class="mb-4 text-sm text-muted-foreground">
        {threadLabel}
      </div>

      <div class="flex flex-col gap-3">
        {posts.map((post, index) => (
          <div key={post.id} class="relative">
            {/* Connection line */}
            {index > 0 && (
              <div class="absolute left-6 -top-3 w-0.5 h-3 bg-border" />
            )}
            {index < posts.length - 1 && (
              <div class="absolute left-6 -bottom-3 w-0.5 h-3 bg-border" />
            )}

            <ThreadPost
              post={post}
              isCurrent={post.id === currentPostId}
              isRoot={index === 0}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
