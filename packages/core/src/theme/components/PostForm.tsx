/**
 * Post Creation/Edit Form
 */

import type { FC } from "hono/jsx";
import type { Post, PostType, Visibility } from "../../types.js";

export interface PostFormProps {
  post?: Post;
  action: string;
  method?: "get" | "post";
}

export const PostForm: FC<PostFormProps> = ({ post, action, method = "post" }) => {
  const isEdit = !!post;

  return (
    <form method={method} action={action} class="flex flex-col gap-4">
      {/* Type selector */}
      <div class="field">
        <label class="label">Type</label>
        <select name="type" class="select" required>
          <option value="note" selected={post?.type === "note"}>
            Note
          </option>
          <option value="article" selected={post?.type === "article"}>
            Article
          </option>
          <option value="link" selected={post?.type === "link"}>
            Link
          </option>
          <option value="quote" selected={post?.type === "quote"}>
            Quote
          </option>
          <option value="image" selected={post?.type === "image"}>
            Image
          </option>
        </select>
      </div>

      {/* Title (optional) */}
      <div class="field">
        <label class="label">Title (optional)</label>
        <input
          type="text"
          name="title"
          class="input"
          placeholder="Post title..."
          value={post?.title ?? ""}
        />
      </div>

      {/* Content */}
      <div class="field">
        <label class="label">Content</label>
        <textarea
          name="content"
          class="textarea min-h-32"
          placeholder="What's on your mind?"
          required
        >
          {post?.content ?? ""}
        </textarea>
      </div>

      {/* Source URL (for link/quote types) */}
      <div class="field">
        <label class="label">Source URL (optional)</label>
        <input
          type="url"
          name="sourceUrl"
          class="input"
          placeholder="https://..."
          value={post?.sourceUrl ?? ""}
        />
      </div>

      {/* Visibility */}
      <div class="field">
        <label class="label">Visibility</label>
        <select name="visibility" class="select">
          <option value="quiet" selected={post?.visibility === "quiet" || !post}>
            Quiet (normal)
          </option>
          <option value="featured" selected={post?.visibility === "featured"}>
            Featured
          </option>
          <option value="unlisted" selected={post?.visibility === "unlisted"}>
            Unlisted
          </option>
          <option value="draft" selected={post?.visibility === "draft"}>
            Draft
          </option>
        </select>
      </div>

      {/* Custom path (optional) */}
      <div class="field">
        <label class="label">Custom Path (optional)</label>
        <input
          type="text"
          name="path"
          class="input"
          placeholder="my-custom-url"
          value={post?.path ?? ""}
        />
      </div>

      {/* Submit */}
      <div class="flex gap-2">
        <button type="submit" class="btn">
          {isEdit ? "Update" : "Publish"}
        </button>
        <a href="/dash/posts" class="btn-outline">
          Cancel
        </a>
      </div>
    </form>
  );
};
