/**
 * Single media detail view
 */

import { useLingui } from "@lingui/react/macro";
import type { Media } from "../../../types.js";
import { DangerZone } from "../index.js";
import * as time from "../../../lib/time.js";
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

export function ViewMediaContent({
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
  const { t } = useLingui();
  const publicUrl = getPublicUrlForProvider(
    media.provider,
    r2PublicUrl,
    s3PublicUrl,
  );
  const url = getMediaUrl(media.storageKey, publicUrl);
  const thumbnailUrl = getImageUrl(url, imageTransformUrl, {
    width: 600,
    quality: 85,
    format: "auto",
  });
  const isImage = media.mimeType.startsWith("image/");

  return (
    <>
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl font-semibold">{media.originalName}</h1>
          <p class="text-muted-foreground mt-1">
            {formatSize(media.size)} · {media.mimeType} ·{" "}
            {time.formatDate(media.createdAt)}
          </p>
        </div>
        <a href="/dash/media" class="btn-outline">
          {t({
            message: "Back",
            comment: "@context: Button to go back to media list",
          })}
        </a>
      </div>

      <div class="grid gap-6 md:grid-cols-2">
        {/* Preview */}
        <div class="card">
          <header>
            <h2>
              {t({
                message: "Preview",
                comment: "@context: Media detail section - preview",
              })}
            </h2>
          </header>
          <section>
            {isImage ? (
              <>
                <button
                  type="button"
                  class="cursor-pointer"
                  onclick={`document.getElementById('lightbox-img').src = '${url}'; document.getElementById('lightbox').showModal()`}
                >
                  <img
                    src={thumbnailUrl}
                    alt={media.alt || media.originalName}
                    class="max-w-full rounded-lg hover:opacity-90 transition-opacity"
                  />
                </button>
                <p class="text-xs text-muted-foreground mt-2">
                  {t({
                    message: "Click image to view full size",
                    comment: "@context: Hint to click image for lightbox",
                  })}
                </p>
              </>
            ) : (
              <div class="aspect-video bg-muted rounded-lg flex items-center justify-center text-muted-foreground">
                <span>{media.mimeType}</span>
              </div>
            )}
          </section>
        </div>

        {/* Details */}
        <div class="space-y-6">
          <div class="card">
            <header>
              <h2>
                {t({
                  message: "URL",
                  comment: "@context: Media detail section - URL",
                })}
              </h2>
            </header>
            <section>
              <div class="flex items-center gap-2">
                <input
                  type="text"
                  class="input flex-1 font-mono text-sm"
                  value={url}
                  readonly
                />
                <button
                  type="button"
                  class="btn-outline"
                  onclick={`navigator.clipboard.writeText('${url}')`}
                >
                  {t({
                    message: "Copy",
                    comment: "@context: Button to copy URL to clipboard",
                  })}
                </button>
              </div>
              <p class="text-xs text-muted-foreground mt-2">
                {t({
                  message: "Use this URL to embed the media in your posts.",
                  comment: "@context: Media URL helper text",
                })}
              </p>
            </section>
          </div>

          <div class="card">
            <header>
              <h2>
                {t({
                  message: "Markdown",
                  comment: "@context: Media detail section - Markdown snippet",
                })}
              </h2>
            </header>
            <section>
              <div class="flex items-center gap-2">
                <input
                  type="text"
                  class="input flex-1 font-mono text-sm"
                  value={`![${media.alt || media.originalName}](${url})`}
                  readonly
                />
                <button
                  type="button"
                  class="btn-outline"
                  onclick={`navigator.clipboard.writeText('![${media.alt || media.originalName}](${url})')`}
                >
                  {t({
                    message: "Copy",
                    comment: "@context: Button to copy Markdown to clipboard",
                  })}
                </button>
              </div>
            </section>
          </div>

          {/* Delete */}
          <DangerZone
            actionLabel={t({
              message: "Delete Media",
              comment: "@context: Button to delete media",
            })}
            formAction={`/dash/media/${media.id}/delete`}
            confirmMessage="Are you sure you want to delete this media?"
            description={t({
              message:
                "Deleting this media will remove it permanently from storage.",
              comment: "@context: Warning message before deleting media",
            })}
          />
        </div>
      </div>

      {/* Lightbox */}
      {isImage && (
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
      )}
    </>
  );
}
