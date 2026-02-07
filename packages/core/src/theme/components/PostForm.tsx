/**
 * Post Creation/Edit Form
 */

import type { FC } from "hono/jsx";
import type { Post } from "../../types.js";
import { useLingui } from "../../i18n/index.js";

export interface PostFormProps {
  post?: Post;
  action: string;
}

export const PostForm: FC<PostFormProps> = ({ post, action }) => {
  const { t } = useLingui();
  const isEdit = !!post;

  const signals = JSON.stringify({
    type: post?.type ?? "note",
    title: post?.title ?? "",
    content: post?.content ?? "",
    sourceUrl: post?.sourceUrl ?? "",
    visibility: post?.visibility ?? "quiet",
    path: post?.path ?? "",
  }).replace(/</g, "\\u003c");

  return (
    <form
      data-signals={signals}
      data-on:submit__prevent={`@post('${action}')`}
      class="flex flex-col gap-4"
    >
      <div id="post-form-message"></div>

      {/* Type selector */}
      <div class="field">
        <label class="label">
          {t({
            message: "Type",
            comment: "@context: Post form field - post type",
          })}
        </label>
        <select data-bind="type" class="select" required>
          <option value="note" selected={post?.type === "note"}>
            {t({ message: "Note", comment: "@context: Post type option" })}
          </option>
          <option value="article" selected={post?.type === "article"}>
            {t({ message: "Article", comment: "@context: Post type option" })}
          </option>
          <option value="link" selected={post?.type === "link"}>
            {t({ message: "Link", comment: "@context: Post type option" })}
          </option>
          <option value="quote" selected={post?.type === "quote"}>
            {t({ message: "Quote", comment: "@context: Post type option" })}
          </option>
          <option value="image" selected={post?.type === "image"}>
            {t({ message: "Image", comment: "@context: Post type option" })}
          </option>
        </select>
      </div>

      {/* Title (optional) */}
      <div class="field">
        <label class="label">
          {t({
            message: "Title (optional)",
            comment: "@context: Post form field",
          })}
        </label>
        <input
          type="text"
          data-bind="title"
          class="input"
          placeholder={t({
            message: "Post title...",
            comment: "@context: Post title placeholder",
          })}
        />
      </div>

      {/* Content */}
      <div class="field">
        <label class="label">
          {t({ message: "Content", comment: "@context: Post form field" })}
        </label>
        <textarea
          data-bind="content"
          class="textarea min-h-32"
          placeholder={t({
            message: "What's on your mind?",
            comment: "@context: Post content placeholder",
          })}
          required
        >
          {post?.content ?? ""}
        </textarea>
      </div>

      {/* Source URL (for link/quote types) */}
      <div class="field">
        <label class="label">
          {t({
            message: "Source URL (optional)",
            comment: "@context: Post form field",
          })}
        </label>
        <input
          type="url"
          data-bind="sourceUrl"
          class="input"
          placeholder="https://..."
        />
      </div>

      {/* Visibility */}
      <div class="field">
        <label class="label">
          {t({ message: "Visibility", comment: "@context: Post form field" })}
        </label>
        <select data-bind="visibility" class="select">
          <option
            value="quiet"
            selected={post?.visibility === "quiet" || !post}
          >
            {t({
              message: "Quiet (normal)",
              comment: "@context: Post visibility option",
            })}
          </option>
          <option value="featured" selected={post?.visibility === "featured"}>
            {t({
              message: "Featured",
              comment: "@context: Post visibility option",
            })}
          </option>
          <option value="unlisted" selected={post?.visibility === "unlisted"}>
            {t({
              message: "Unlisted",
              comment: "@context: Post visibility option",
            })}
          </option>
          <option value="draft" selected={post?.visibility === "draft"}>
            {t({
              message: "Draft",
              comment: "@context: Post visibility option",
            })}
          </option>
        </select>
      </div>

      {/* Custom path (optional) */}
      <div class="field">
        <label class="label">
          {t({
            message: "Custom Path (optional)",
            comment: "@context: Post form field",
          })}
        </label>
        <input
          type="text"
          data-bind="path"
          class="input"
          placeholder="my-custom-url"
        />
      </div>

      {/* Submit */}
      <div class="flex gap-2">
        <button type="submit" class="btn">
          {isEdit
            ? t({
                message: "Update",
                comment: "@context: Button to update existing post",
              })
            : t({
                message: "Publish",
                comment: "@context: Button to publish new post",
              })}
        </button>
        <a href="/dash/posts" class="btn-outline">
          {t({ message: "Cancel", comment: "@context: Button to cancel form" })}
        </a>
      </div>
    </form>
  );
};
