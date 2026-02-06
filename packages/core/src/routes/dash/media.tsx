/**
 * Dashboard Media Routes
 *
 * Media management with Datastar-powered uploads.
 * Uses SSE for real-time UI updates without page reloads.
 */

import { Hono } from "hono";
import { useLingui } from "../../i18n/index.js";
import type { Bindings, Media } from "../../types.js";
import type { AppVariables } from "../../app.js";
import { DashLayout } from "../../theme/layouts/index.js";
import { EmptyState, DangerZone } from "../../theme/components/index.js";
import * as time from "../../lib/time.js";
import { getMediaUrl, getImageUrl } from "../../lib/image.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const mediaRoutes = new Hono<Env>();

/**
 * Format file size for display
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Media card component for the grid
 */
function MediaCard({
  media,
  r2PublicUrl,
  imageTransformUrl,
}: {
  media: Media;
  r2PublicUrl?: string;
  imageTransformUrl?: string;
}) {
  const fullUrl = getMediaUrl(media.id, media.r2Key, r2PublicUrl);
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

/**
 * Media list page content
 *
 * Uses plain JavaScript for upload state management (more reliable than Datastar signals
 * for complex async flows like file uploads with SSE responses).
 */
function MediaListContent({
  mediaList,
  r2PublicUrl,
  imageTransformUrl,
}: {
  mediaList: Media[];
  r2PublicUrl?: string;
  imageTransformUrl?: string;
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

  // Plain JavaScript upload handler - shows progress in the list
  const uploadScript = `
async function handleMediaUpload(input) {
  if (!input.files || !input.files[0]) return;

  const file = input.files[0];
  const errorBox = document.getElementById('upload-error');
  errorBox.classList.add('hidden');

  // Ensure grid exists (remove empty state if needed)
  let grid = document.getElementById('media-grid');
  if (!grid) {
    document.getElementById('empty-state')?.remove();
    grid = document.createElement('div');
    grid.id = 'media-grid';
    grid.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4';
    document.getElementById('media-content').appendChild(grid);
  }

  // Create placeholder card showing progress
  const placeholder = document.createElement('div');
  placeholder.id = 'upload-placeholder';
  placeholder.className = 'group relative';
  placeholder.innerHTML = \`
    <div class="aspect-square bg-muted rounded-lg overflow-hidden border flex items-center justify-center">
      <div class="text-center px-2">
        <svg class="animate-spin h-6 w-6 text-muted-foreground mx-auto mb-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <span id="upload-status" class="text-xs text-muted-foreground">${processingText}</span>
      </div>
    </div>
    <div class="mt-2 text-xs truncate" title="\${file.name}">\${file.name}</div>
    <div class="text-xs text-muted-foreground">\${formatFileSize(file.size)}</div>
  \`;
  grid.prepend(placeholder);

  try {
    if (typeof ImageProcessor === 'undefined') {
      throw new Error('ImageProcessor not loaded');
    }

    // Process image client-side
    const processed = await ImageProcessor.processToFile(file);
    document.getElementById('upload-status').textContent = '${uploadingText}';

    // Upload with SSE response
    const fd = new FormData();
    fd.append('file', processed);

    const response = await fetch('/api/upload', {
      method: 'POST',
      body: fd,
      headers: { 'Accept': 'text/event-stream' }
    });

    if (!response.ok) throw new Error('Upload failed: ' + response.status);

    // Parse SSE stream - will replace placeholder with real card
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\\n\\n');
      buffer = events.pop() || '';

      for (const event of events) {
        if (!event.trim()) continue;
        processSSEEvent(event);
      }
    }

  } catch (err) {
    console.error('Upload error:', err);
    // Show error in placeholder
    placeholder.innerHTML = \`
      <div class="aspect-square bg-destructive/10 rounded-lg overflow-hidden border border-destructive flex items-center justify-center">
        <div class="text-center px-2">
          <span class="text-xs text-destructive">\${err.message || '${errorText}'}</span>
        </div>
      </div>
      <div class="mt-2 text-xs truncate text-destructive">\${file.name}</div>
      <button type="button" class="text-xs text-muted-foreground hover:underline" onclick="this.closest('.group').remove()">Remove</button>
    \`;
  }

  input.value = '';
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function processSSEEvent(event) {
  const lines = event.split('\\n');
  let eventType = '';
  const data = {};
  let elementsLines = [];
  let inElements = false;

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      eventType = line.slice(7);
    } else if (line.startsWith('data: ')) {
      const content = line.slice(6);
      if (content.startsWith('mode ')) {
        data.mode = content.slice(5);
        inElements = false;
      } else if (content.startsWith('selector ')) {
        data.selector = content.slice(9);
        inElements = false;
      } else if (content.startsWith('elements ')) {
        elementsLines = [content.slice(9)];
        inElements = true;
      } else if (inElements) {
        // Continuation of elements content
        elementsLines.push(content);
      }
    }
  }

  if (elementsLines.length > 0) {
    data.elements = elementsLines.join('\\n');
  }

  if (eventType === 'datastar-patch-elements') {
    if (data.mode === 'remove' && data.selector) {
      document.querySelector(data.selector)?.remove();
    } else if (data.mode === 'outer' && data.selector && data.elements) {
      // Replace element entirely (used for placeholder -> real card)
      const target = document.querySelector(data.selector);
      if (target) {
        const temp = document.createElement('div');
        temp.innerHTML = data.elements;
        const newElement = temp.firstElementChild;
        if (newElement) {
          target.replaceWith(newElement);
          if (window.Datastar) Datastar.apply(newElement);
        }
      }
    }
  }
}
`.trim();

  return (
    <>
      {/* Upload script */}
      <script dangerouslySetInnerHTML={{ __html: uploadScript }}></script>

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
            onchange="handleMediaUpload(this)"
          />
        </label>
      </div>

      {/* Hidden error container for global errors */}
      <div id="upload-error" class="hidden"></div>

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
              />
            ))}
          </div>
        )}
      </div>

      {/* Lightbox - uses plain JS, not Datastar signals */}
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

/**
 * View single media content
 */
function ViewMediaContent({
  media,
  r2PublicUrl,
  imageTransformUrl,
}: {
  media: Media;
  r2PublicUrl?: string;
  imageTransformUrl?: string;
}) {
  const { t } = useLingui();
  const url = getMediaUrl(media.id, media.r2Key, r2PublicUrl);
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

// List media
mediaRoutes.get("/", async (c) => {
  const mediaList = await c.var.services.media.list(100);
  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";
  const r2PublicUrl = c.env.R2_PUBLIC_URL;
  const imageTransformUrl = c.env.IMAGE_TRANSFORM_URL;

  return c.html(
    <DashLayout
      c={c}
      title="Media"
      siteName={siteName}
      currentPath="/dash/media"
    >
      <MediaListContent
        mediaList={mediaList}
        r2PublicUrl={r2PublicUrl}
        imageTransformUrl={imageTransformUrl}
      />
    </DashLayout>,
  );
});

// View single media
mediaRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const media = await c.var.services.media.getById(id);
  if (!media) return c.notFound();

  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";
  const r2PublicUrl = c.env.R2_PUBLIC_URL;
  const imageTransformUrl = c.env.IMAGE_TRANSFORM_URL;

  return c.html(
    <DashLayout
      c={c}
      title={media.originalName}
      siteName={siteName}
      currentPath="/dash/media"
    >
      <ViewMediaContent
        media={media}
        r2PublicUrl={r2PublicUrl}
        imageTransformUrl={imageTransformUrl}
      />
    </DashLayout>,
  );
});

// Delete media
mediaRoutes.post("/:id/delete", async (c) => {
  const id = c.req.param("id");
  const media = await c.var.services.media.getById(id);
  if (!media) return c.notFound();

  // Delete from R2
  if (c.env.R2) {
    try {
      await c.env.R2.delete(media.r2Key);
    } catch (err) {
      // eslint-disable-next-line no-console -- Error logging is intentional
      console.error("R2 delete error:", err);
    }
  }

  // Delete from database
  await c.var.services.media.delete(id);

  return c.redirect("/dash/media");
});
