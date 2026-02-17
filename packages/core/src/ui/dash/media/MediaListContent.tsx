/**
 * Media grid list with upload UI
 */

import { useLingui } from "@lingui/react/macro";
import type { Media } from "../../../types.js";
import { EmptyState } from "../index.js";
import {
  getMediaUrl,
  getImageUrl,
  getPublicUrlForProvider,
} from "../../../lib/image.js";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function MediaCard({
  media,
  r2PublicUrl,
  imageTransformUrl,
  s3PublicUrl,
}: {
  media: Media;
  r2PublicUrl?: string;
  imageTransformUrl?: string;
  s3PublicUrl?: string;
}) {
  const publicUrl = getPublicUrlForProvider(
    media.provider,
    r2PublicUrl,
    s3PublicUrl,
  );
  const fullUrl = getMediaUrl(media.storageKey, publicUrl);
  const thumbnailUrl = getImageUrl(fullUrl, imageTransformUrl, {
    width: 300,
    quality: 80,
    format: "auto",
    fit: "cover",
  });
  const isImage = media.mimeType.startsWith("image/");

  return (
    <div class="group relative" data-media-id={media.id}>
      {isImage ? (
        <button
          type="button"
          class="block w-full aspect-square bg-muted rounded-lg overflow-hidden border hover:border-primary cursor-pointer"
          onclick={`document.getElementById('lightbox-img').src = '${fullUrl}'; document.getElementById('lightbox').showModal()`}
        >
          <img
            src={thumbnailUrl}
            alt={media.alt || media.originalName}
            class="w-full h-full object-cover"
            loading="lazy"
          />
        </button>
      ) : (
        <a
          href={`/dash/media/${media.id}`}
          class="block aspect-square bg-muted rounded-lg overflow-hidden border hover:border-primary"
        >
          <div class="w-full h-full flex items-center justify-center text-muted-foreground">
            <span class="text-xs">{media.mimeType}</span>
          </div>
        </a>
      )}
      <a
        href={`/dash/media/${media.id}`}
        class="block mt-2 text-xs truncate hover:underline"
        title={media.originalName}
      >
        {media.originalName}
      </a>
      <div class="text-xs text-muted-foreground">{formatSize(media.size)}</div>
    </div>
  );
}

export function MediaListContent({
  mediaList,
  r2PublicUrl,
  imageTransformUrl,
  s3PublicUrl,
}: {
  mediaList: Media[];
  r2PublicUrl?: string;
  imageTransformUrl?: string;
  s3PublicUrl?: string;
}) {
  const { t } = useLingui();

  const processingText = t({
    message: "Processing...",
    comment: "@context: Upload status - processing",
  });
  const uploadingText = t({
    message: "Uploading...",
    comment: "@context: Upload status - uploading",
  });
  const uploadText = t({
    message: "Upload",
    comment: "@context: Button to upload media file",
  });
  const errorText = t({
    message: "Upload failed. Please try again.",
    comment: "@context: Upload error message",
  });

  return (
    <>
      {/* Hidden form for Datastar-driven upload */}
      <form
        id="upload-form"
        class="hidden"
        enctype="multipart/form-data"
        data-on:submit__prevent="@post('/api/upload', {contentType: 'form'})"
      >
        <input id="upload-file-input" type="file" name="file" />
      </form>

      {/* Header */}
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-2xl font-semibold">
          {t({ message: "Media", comment: "@context: Media main heading" })}
        </h1>
        <label class="btn cursor-pointer">
          <span>{uploadText}</span>
          <input
            type="file"
            class="hidden"
            accept="image/*"
            data-media-upload
            data-text-processing={processingText}
            data-text-uploading={uploadingText}
            data-text-error={errorText}
          />
        </label>
      </div>

      {/* Upload instructions */}
      <div class="card mb-6">
        <section class="text-sm text-muted-foreground">
          <p>
            {t({
              message:
                "Images are automatically optimized: resized to max 1920px, converted to WebP, and metadata stripped.",
              comment:
                "@context: Media upload instructions - auto optimization",
            })}
          </p>
        </section>
      </div>

      {/* Media grid or empty state */}
      <div id="media-content">
        {mediaList.length === 0 ? (
          <div id="empty-state">
            <EmptyState
              message={t({
                message: "No media uploaded yet.",
                comment: "@context: Empty state message when no media exists",
              })}
            />
          </div>
        ) : (
          <div
            id="media-grid"
            class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4"
          >
            {mediaList.map((m) => (
              <MediaCard
                key={m.id}
                media={m}
                r2PublicUrl={r2PublicUrl}
                imageTransformUrl={imageTransformUrl}
                s3PublicUrl={s3PublicUrl}
              />
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      <dialog
        id="lightbox"
        class="p-0 m-auto bg-transparent backdrop:bg-black/80"
        onclick="event.target === this && this.close()"
      >
        <img
          id="lightbox-img"
          src=""
          alt=""
          class="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
        />
      </dialog>
    </>
  );
}
