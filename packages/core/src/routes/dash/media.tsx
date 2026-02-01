/**
 * Dashboard Media Routes
 *
 * Management for uploaded media files
 */

import { Hono } from "hono";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../app.js";
import { DashLayout } from "../../theme/layouts/index.js";
import { msg } from "@lingui/core/macro";
import { getI18n } from "../../i18n/index.js";
import * as time from "../../lib/time.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const mediaRoutes = new Hono<Env>();

// Helper to format file size
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Helper to get media URL
function getMediaUrl(r2Key: string, r2PublicUrl?: string): string {
  if (r2PublicUrl) {
    return `${r2PublicUrl}/${r2Key}`;
  }
  // Extract filename from r2Key (e.g., "uploads/1234-abc.jpg" -> "1234-abc.jpg")
  const filename = r2Key.split("/").pop() || r2Key;
  return `/media/${filename}`;
}

// List media
mediaRoutes.get("/", async (c) => {
  const i18n = getI18n(c);
  const mediaList = await c.var.services.media.list(100);
  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";
  const r2PublicUrl = c.env.R2_PUBLIC_URL;

  return c.html(
    <DashLayout c={c} title={i18n._(msg({ message: "Media", comment: "@context: Media page title" }))} siteName={siteName} currentPath="/dash/media">
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-2xl font-semibold">
          {i18n._(msg({ message: "Media", comment: "@context: Media main heading" }))}
        </h1>
        <label class="btn cursor-pointer">
          {i18n._(msg({ message: "Upload", comment: "@context: Button to upload media file" }))}
          <input
            type="file"
            class="hidden"
            accept="image/*"
            data-on-change="$$post('/api/upload', {body: new FormData().tap(fd => fd.append('file', evt.target.files[0]))}))"
          />
        </label>
      </div>

      {/* Upload instructions */}
      <div class="card mb-6">
        <section class="text-sm text-muted-foreground">
          <p>
            {i18n._(msg({ message: "Upload images via the API: POST /api/upload with a file form field.", comment: "@context: Media upload instructions - API usage" }))}
          </p>
          <p class="mt-2">
            {i18n._(msg({ message: "Supported formats: JPEG, PNG, GIF, WebP, SVG. Max size: 10MB.", comment: "@context: Media upload instructions - supported formats" }))}
          </p>
        </section>
      </div>

      {mediaList.length === 0 ? (
        <div class="text-center py-12 text-muted-foreground">
          <p>{i18n._(msg({ message: "No media uploaded yet.", comment: "@context: Empty state message when no media exists" }))}</p>
        </div>
      ) : (
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {mediaList.map((m) => {
            const url = getMediaUrl(m.r2Key, r2PublicUrl);
            const isImage = m.mimeType.startsWith("image/");

            return (
              <div key={m.id} class="group relative">
                <a
                  href={`/dash/media/${m.id}`}
                  class="block aspect-square bg-muted rounded-lg overflow-hidden border hover:border-primary"
                >
                  {isImage ? (
                    <img
                      src={url}
                      alt={m.alt || m.originalName}
                      class="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div class="w-full h-full flex items-center justify-center text-muted-foreground">
                      <span class="text-xs">{m.mimeType}</span>
                    </div>
                  )}
                </a>
                <div class="mt-2 text-xs truncate" title={m.originalName}>
                  {m.originalName}
                </div>
                <div class="text-xs text-muted-foreground">
                  {formatSize(m.size)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </DashLayout>
  );
});

// View single media
mediaRoutes.get("/:id", async (c) => {
  const i18n = getI18n(c);
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.notFound();

  const media = await c.var.services.media.getById(id);
  if (!media) return c.notFound();

  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";
  const r2PublicUrl = c.env.R2_PUBLIC_URL;
  const url = getMediaUrl(media.r2Key, r2PublicUrl);
  const isImage = media.mimeType.startsWith("image/");

  return c.html(
    <DashLayout c={c} title={media.originalName} siteName={siteName} currentPath="/dash/media">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl font-semibold">{media.originalName}</h1>
          <p class="text-muted-foreground mt-1">
            {formatSize(media.size)} · {media.mimeType} · {time.formatDate(media.createdAt)}
          </p>
        </div>
        <a href="/dash/media" class="btn-outline">
          {i18n._(msg({ message: "Back", comment: "@context: Button to go back to media list" }))}
        </a>
      </div>

      <div class="grid gap-6 md:grid-cols-2">
        {/* Preview */}
        <div class="card">
          <header>
            <h2>{i18n._(msg({ message: "Preview", comment: "@context: Media detail section - preview" }))}</h2>
          </header>
          <section>
            {isImage ? (
              <img
                src={url}
                alt={media.alt || media.originalName}
                class="max-w-full rounded-lg"
              />
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
              <h2>{i18n._(msg({ message: "URL", comment: "@context: Media detail section - URL" }))}</h2>
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
                  {i18n._(msg({ message: "Copy", comment: "@context: Button to copy URL to clipboard" }))}
                </button>
              </div>
              <p class="text-xs text-muted-foreground mt-2">
                {i18n._(msg({ message: "Use this URL to embed the media in your posts.", comment: "@context: Media URL helper text" }))}
              </p>
            </section>
          </div>

          <div class="card">
            <header>
              <h2>{i18n._(msg({ message: "Markdown", comment: "@context: Media detail section - Markdown snippet" }))}</h2>
            </header>
            <section>
              <div class="flex items-center gap-2">
                <input
                  type="text"
                  class="input flex-1 font-mono text-sm"
                  value={`![${media.alt || media.originalName}](${url}))`}
                  readonly
                />
                <button
                  type="button"
                  class="btn-outline"
                  onclick={`navigator.clipboard.writeText('![${media.alt || media.originalName}](${url}))')`}
                >
                  {i18n._(msg({ message: "Copy", comment: "@context: Button to copy Markdown to clipboard" }))}
                </button>
              </div>
            </section>
          </div>

          {/* Delete */}
          <div class="card border-destructive/50">
            <header>
              <h2 class="text-destructive">
                {i18n._(msg({ message: "Danger Zone", comment: "@context: Section heading for dangerous/destructive actions" }))}
              </h2>
            </header>
            <section>
              <p class="text-sm text-muted-foreground mb-4">
                {i18n._(msg({ message: "Deleting this media will remove it permanently from storage.", comment: "@context: Warning message before deleting media" }))}
              </p>
              <form method="post" action={`/dash/media/${media.id}/delete`}>
                <button
                  type="submit"
                  class="btn-destructive"
                  onclick="return confirm('Are you sure you want to delete this media?')"
                >
                  {i18n._(msg({ message: "Delete Media", comment: "@context: Button to delete media" }))}
                </button>
              </form>
            </section>
          </div>
        </div>
      </div>
    </DashLayout>
  );
});

// Delete media
mediaRoutes.post("/:id/delete", async (c) => {
  const i18n = getI18n(c);
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.notFound();

  const media = await c.var.services.media.getById(id);
  if (!media) return c.notFound();

  // Delete from R2
  if (c.env.R2) {
    try {
      await c.env.R2.delete(media.r2Key);
    } catch (err) {
      console.error("R2 delete error:", err);
    }
  }

  // Delete from database
  await c.var.services.media.delete(id);

  return c.redirect("/dash/media");
});
