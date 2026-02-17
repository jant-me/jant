/**
 * Post Creation/Edit Form
 */

import type { FC } from "hono/jsx";
import type { Post, Media, Collection } from "../../types.js";
import { useLingui } from "@lingui/react/macro";
import {
  getMediaUrl,
  getImageUrl,
  getPublicUrlForProvider,
} from "../../lib/image.js";

export interface PostFormProps {
  post?: Post;
  action: string;
  mediaAttachments?: Media[];
  r2PublicUrl?: string;
  imageTransformUrl?: string;
  s3PublicUrl?: string;
  collections?: Collection[];
}

export const PostForm: FC<PostFormProps> = ({
  post,
  action,
  mediaAttachments,
  r2PublicUrl,
  imageTransformUrl,
  s3PublicUrl,
  collections,
}) => {
  const { t } = useLingui();
  const isEdit = !!post;

  const existingMediaIds = (mediaAttachments ?? []).map((m) => m.id);

  const signals = JSON.stringify({
    format: post?.format ?? "note",
    title: post?.title ?? "",
    body: post?.body ?? "",
    url: post?.url ?? "",
    quoteText: post?.quoteText ?? "",
    status: post?.status ?? "published",
    featured: post?.featured === 1,
    pinned: post?.pinned === 1,
    rating: post?.rating ?? 0,
    collectionId: post?.collectionId ?? 0,
    mediaIds: existingMediaIds,
  }).replace(/</g, "\\u003c");

  return (
    <form
      data-signals={signals}
      data-on:submit__prevent={`@post('${action}')`}
      data-indicator="_loading"
      class="flex flex-col gap-4"
    >
      <div id="post-form-message"></div>

      {/* Format selector */}
      <div class="field">
        <label class="label">
          {t({
            message: "Format",
            comment: "@context: Post form field - post format",
          })}
        </label>
        <select data-bind="format" class="select" required>
          <option value="note" selected={post?.format === "note" || !post}>
            {t({ message: "Note", comment: "@context: Post format option" })}
          </option>
          <option value="link" selected={post?.format === "link"}>
            {t({ message: "Link", comment: "@context: Post format option" })}
          </option>
          <option value="quote" selected={post?.format === "quote"}>
            {t({ message: "Quote", comment: "@context: Post format option" })}
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

      {/* Body */}
      <div class="field">
        <label class="label">
          {t({ message: "Content", comment: "@context: Post form field" })}
        </label>
        <textarea
          data-bind="body"
          class="textarea min-h-32"
          placeholder={t({
            message: "What's on your mind?",
            comment: "@context: Post content placeholder",
          })}
        >
          {post?.body ?? ""}
        </textarea>
      </div>

      {/* URL (for link/quote formats) */}
      <div class="field">
        <label class="label">
          {t({
            message: "URL (optional)",
            comment: "@context: Post form field - source URL",
          })}
        </label>
        <input
          type="url"
          data-bind="url"
          class="input"
          placeholder="https://..."
        />
      </div>

      {/* Quote Text (for quote format) */}
      <div class="field" data-show="$format === 'quote'">
        <label class="label">
          {t({
            message: "Quote Text",
            comment: "@context: Post form field - quoted text",
          })}
        </label>
        <textarea
          data-bind="quoteText"
          class="textarea"
          placeholder={t({
            message: "The text being quoted...",
            comment: "@context: Quote text placeholder",
          })}
          rows={3}
        >
          {post?.quoteText ?? ""}
        </textarea>
      </div>

      {/* Media attachments */}
      <div class="field">
        <label class="label">
          {t({
            message: "Media",
            comment: "@context: Post form field - media attachments",
          })}
        </label>
        {mediaAttachments && mediaAttachments.length > 0 && (
          <div class="grid grid-cols-4 sm:grid-cols-6 gap-2 mb-2">
            {mediaAttachments.map((m) => {
              const pUrl = getPublicUrlForProvider(
                m.provider,
                r2PublicUrl,
                s3PublicUrl,
              );
              const mUrl = getMediaUrl(m.storageKey, pUrl);
              const thumbUrl = getImageUrl(mUrl, imageTransformUrl, {
                width: 150,
                quality: 80,
                format: "auto",
                fit: "cover",
              });
              return (
                <div
                  key={m.id}
                  class="relative group aspect-square"
                  data-show={`$mediaIds.includes('${m.id}')`}
                >
                  <img
                    src={thumbUrl}
                    alt={m.alt || m.originalName}
                    class="w-full h-full object-cover rounded-lg border"
                    loading="lazy"
                  />
                  <button
                    type="button"
                    class="absolute top-1 right-1 w-5 h-5 flex items-center justify-center bg-black/60 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                    data-on:click={`$mediaIds = $mediaIds.filter(id => id !== '${m.id}')`}
                    title={t({
                      message: "Remove",
                      comment: "@context: Remove media attachment button",
                    })}
                  >
                    &times;
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <button
          type="button"
          class="btn-outline text-sm"
          data-on:click="document.getElementById('media-picker-dialog').showModal(); fetch('/dash/media/picker').then(r => r.text()).then(html => document.getElementById('media-picker-grid').innerHTML = html)"
        >
          {t({
            message: "Add Media",
            comment: "@context: Button to open media picker",
          })}
        </button>
      </div>

      {/* Status */}
      <div class="field">
        <label class="label">
          {t({ message: "Status", comment: "@context: Post form field" })}
        </label>
        <select data-bind="status" class="select">
          <option
            value="published"
            selected={post?.status === "published" || !post}
          >
            {t({
              message: "Published",
              comment: "@context: Post status option",
            })}
          </option>
          <option value="draft" selected={post?.status === "draft"}>
            {t({
              message: "Draft",
              comment: "@context: Post status option",
            })}
          </option>
        </select>
      </div>

      {/* Featured & Pinned */}
      <div class="flex gap-4">
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" class="checkbox" data-bind="featured" />
          {t({
            message: "Featured",
            comment: "@context: Post form checkbox - mark as featured",
          })}
        </label>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" class="checkbox" data-bind="pinned" />
          {t({
            message: "Pinned",
            comment: "@context: Post form checkbox - pin to top",
          })}
        </label>
      </div>

      {/* Collection */}
      {collections && collections.length > 0 && (
        <div class="field">
          <label class="label">
            {t({
              message: "Collection (optional)",
              comment: "@context: Post form field - assign to collection",
            })}
          </label>
          <select data-bind="collectionId" class="select">
            <option value="0">
              {t({
                message: "None",
                comment: "@context: No collection selected",
              })}
            </option>
            {collections.map((col) => (
              <option
                key={col.id}
                value={col.id}
                selected={post?.collectionId === col.id}
              >
                {col.title}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Submit */}
      <div class="flex gap-2">
        <button type="submit" class="btn" data-attr:disabled="$_loading">
          <svg
            data-show="$_loading"
            style="display:none"
            class="animate-spin size-4"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            role="status"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
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

      {/* Media picker dialog */}
      <dialog
        id="media-picker-dialog"
        class="p-6 rounded-lg max-w-2xl w-full backdrop:bg-black/50"
        onclick="event.target === this && this.close()"
      >
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold">
            {t({
              message: "Select Media",
              comment: "@context: Media picker dialog title",
            })}
          </h2>
          <button
            type="button"
            class="btn-outline text-sm"
            onclick="this.closest('dialog').close()"
          >
            {t({
              message: "Done",
              comment: "@context: Close media picker button",
            })}
          </button>
        </div>
        <div
          id="media-picker-grid"
          class="grid grid-cols-4 gap-2 max-h-96 overflow-y-auto"
        >
          <p class="text-muted-foreground text-sm col-span-4">
            {t({
              message: "Loading...",
              comment: "@context: Loading state for media picker",
            })}
          </p>
        </div>
      </dialog>
    </form>
  );
};
