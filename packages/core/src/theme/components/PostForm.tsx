/**
 * Post Creation/Edit Form
 */

import type { FC } from "hono/jsx";
import { msg } from "@lingui/core/macro";
import type { Post, PostType, Visibility } from "../../types.js";
import type { Context } from "hono";
import { getI18n } from "../../i18n/index.js";

export interface PostFormProps {
  c: Context;
  post?: Post;
  action: string;
  method?: "get" | "post";
}

export const PostForm: FC<PostFormProps> = ({ c, post, action, method = "post" }) => {
  const i18n = getI18n(c);
  const isEdit = !!post;

  return (
    <form method={method} action={action} class="flex flex-col gap-4">
      {/* Type selector */}
      <div class="field">
        <label class="label">{i18n._(msg({ message: "Type", comment: "@context: Post form field - post type" }))}</label>
        <select name="type" class="select" required>
          <option value="note" selected={post?.type === "note"}>
            {i18n._(msg({ message: "Note", comment: "@context: Post type option" }))}
          </option>
          <option value="article" selected={post?.type === "article"}>
            {i18n._(msg({ message: "Article", comment: "@context: Post type option" }))}
          </option>
          <option value="link" selected={post?.type === "link"}>
            {i18n._(msg({ message: "Link", comment: "@context: Post type option" }))}
          </option>
          <option value="quote" selected={post?.type === "quote"}>
            {i18n._(msg({ message: "Quote", comment: "@context: Post type option" }))}
          </option>
          <option value="image" selected={post?.type === "image"}>
            {i18n._(msg({ message: "Image", comment: "@context: Post type option" }))}
          </option>
        </select>
      </div>

      {/* Title (optional) */}
      <div class="field">
        <label class="label">{i18n._(msg({ message: "Title (optional)", comment: "@context: Post form field" }))}</label>
        <input
          type="text"
          name="title"
          class="input"
          placeholder={i18n._(msg({ message: "Post title...", comment: "@context: Post title placeholder" }))}
          value={post?.title ?? ""}
        />
      </div>

      {/* Content */}
      <div class="field">
        <label class="label">{i18n._(msg({ message: "Content", comment: "@context: Post form field" }))}</label>
        <textarea
          name="content"
          class="textarea min-h-32"
          placeholder={i18n._(msg({ message: "What's on your mind?", comment: "@context: Post content placeholder" }))}
          required
        >
          {post?.content ?? ""}
        </textarea>
      </div>

      {/* Source URL (for link/quote types) */}
      <div class="field">
        <label class="label">{i18n._(msg({ message: "Source URL (optional)", comment: "@context: Post form field" }))}</label>
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
        <label class="label">{i18n._(msg({ message: "Visibility", comment: "@context: Post form field" }))}</label>
        <select name="visibility" class="select">
          <option value="quiet" selected={post?.visibility === "quiet" || !post}>
            {i18n._(msg({ message: "Quiet (normal)", comment: "@context: Post visibility option" }))}
          </option>
          <option value="featured" selected={post?.visibility === "featured"}>
            {i18n._(msg({ message: "Featured", comment: "@context: Post visibility option" }))}
          </option>
          <option value="unlisted" selected={post?.visibility === "unlisted"}>
            {i18n._(msg({ message: "Unlisted", comment: "@context: Post visibility option" }))}
          </option>
          <option value="draft" selected={post?.visibility === "draft"}>
            {i18n._(msg({ message: "Draft", comment: "@context: Post visibility option" }))}
          </option>
        </select>
      </div>

      {/* Custom path (optional) */}
      <div class="field">
        <label class="label">{i18n._(msg({ message: "Custom Path (optional)", comment: "@context: Post form field" }))}</label>
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
          {isEdit ? i18n._(msg({ message: "Update", comment: "@context: Button to update existing post" })) : i18n._(msg({ message: "Publish", comment: "@context: Button to publish new post" }))}
        </button>
        <a href="/dash/posts" class="btn-outline">
          {i18n._(msg({ message: "Cancel", comment: "@context: Button to cancel form" }))}
        </a>
      </div>
    </form>
  );
};
