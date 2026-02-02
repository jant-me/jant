/**
 * Upload API Routes
 *
 * Handles file uploads to R2 storage.
 * Supports both JSON and SSE (Datastar) responses.
 */

import { Hono } from "hono";
import { html } from "hono/html";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../app.js";
import { requireAuthApi } from "../../middleware/auth.js";
import { getMediaUrl, getImageUrl } from "../../lib/image.js";
import { sse } from "../../lib/sse.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const uploadApiRoutes = new Hono<Env>();

// Require auth for all upload routes
uploadApiRoutes.use("*", requireAuthApi());

/**
 * Render a media card HTML string for SSE response
 */
function renderMediaCard(
  media: { id: string; r2Key: string; mimeType: string; originalName: string; alt: string | null; size: number },
  r2PublicUrl?: string,
  imageTransformUrl?: string
): string {
  const fullUrl = getMediaUrl(media.id, media.r2Key, r2PublicUrl);
  const thumbnailUrl = getImageUrl(fullUrl, imageTransformUrl, {
    width: 300,
    quality: 80,
    format: "auto",
    fit: "cover",
  });
  const isImage = media.mimeType.startsWith("image/");
  const displayName = media.alt || media.originalName;
  const sizeStr = formatSize(media.size);

  if (isImage) {
    return html`
      <div class="group relative" data-media-id="${media.id}">
        <button
          type="button"
          class="block w-full aspect-square bg-muted rounded-lg overflow-hidden border hover:border-primary cursor-pointer"
          onclick="document.getElementById('lightbox-img').src = '${fullUrl}'; document.getElementById('lightbox').showModal()"
        >
          <img
            src="${thumbnailUrl}"
            alt="${displayName}"
            class="w-full h-full object-cover"
            loading="lazy"
          />
        </button>
        <a href="/dash/media/${media.id}" class="block mt-2 text-xs truncate hover:underline" title="${media.originalName}">
          ${media.originalName}
        </a>
        <div class="text-xs text-muted-foreground">${sizeStr}</div>
      </div>
    `.toString();
  }

  return html`
    <div class="group relative" data-media-id="${media.id}">
      <a
        href="/dash/media/${media.id}"
        class="block aspect-square bg-muted rounded-lg overflow-hidden border hover:border-primary"
      >
        <div class="w-full h-full flex items-center justify-center text-muted-foreground">
          <span class="text-xs">${media.mimeType}</span>
        </div>
      </a>
      <a href="/dash/media/${media.id}" class="block mt-2 text-xs truncate hover:underline" title="${media.originalName}">
        ${media.originalName}
      </a>
      <div class="text-xs text-muted-foreground">${sizeStr}</div>
    </div>
  `.toString();
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Check if request wants SSE response (from Datastar)
 */
function wantsSSE(c: { req: { header: (name: string) => string | undefined } }): boolean {
  const accept = c.req.header("accept") || "";
  return accept.includes("text/event-stream");
}

// Upload a file
uploadApiRoutes.post("/", async (c) => {
  if (!c.env.R2) {
    if (wantsSSE(c)) {
      return sse(c, async (stream) => {
        await stream.patchSignals({ _uploadError: "R2 storage not configured" });
      });
    }
    return c.json({ error: "R2 storage not configured" }, 500);
  }

  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    if (wantsSSE(c)) {
      return sse(c, async (stream) => {
        await stream.patchSignals({ _uploadError: "No file provided" });
      });
    }
    return c.json({ error: "No file provided" }, 400);
  }

  // Validate file type
  const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"];
  if (!allowedTypes.includes(file.type)) {
    if (wantsSSE(c)) {
      return sse(c, async (stream) => {
        await stream.patchSignals({ _uploadError: "File type not allowed" });
      });
    }
    return c.json({ error: "File type not allowed" }, 400);
  }

  // Validate file size (max 10MB)
  const maxSize = 10 * 1024 * 1024;
  if (file.size > maxSize) {
    if (wantsSSE(c)) {
      return sse(c, async (stream) => {
        await stream.patchSignals({ _uploadError: "File too large (max 10MB)" });
      });
    }
    return c.json({ error: "File too large (max 10MB)" }, 400);
  }

  // Generate unique filename
  const ext = file.name.split(".").pop() || "bin";
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const filename = `${timestamp}-${random}.${ext}`;
  const r2Key = `uploads/${filename}`;

  try {
    // Upload to R2
    await c.env.R2.put(r2Key, file.stream(), {
      httpMetadata: {
        contentType: file.type,
      },
    });

    // Save to database
    const media = await c.var.services.media.create({
      filename,
      originalName: file.name,
      mimeType: file.type,
      size: file.size,
      r2Key,
    });

    // SSE response for Datastar
    if (wantsSSE(c)) {
      const cardHtml = renderMediaCard(
        media,
        c.env.R2_PUBLIC_URL,
        c.env.IMAGE_TRANSFORM_URL
      );

      return sse(c, async (stream) => {
        // Replace placeholder with real media card
        await stream.patchElements(cardHtml, {
          mode: "outer",
          selector: "#upload-placeholder",
        });
      });
    }

    // JSON response for API clients
    const publicUrl = getMediaUrl(media.id, r2Key, c.env.R2_PUBLIC_URL);
    return c.json({
      id: media.id,
      filename: media.filename,
      url: publicUrl,
      mimeType: media.mimeType,
      size: media.size,
    });
  } catch (err) {
    // eslint-disable-next-line no-console -- Error logging is intentional
    console.error("Upload error:", err);

    // Return error - client will handle updating the placeholder
    return c.json({ error: "Upload failed" }, 500);
  }
});

// List uploaded files (JSON only)
uploadApiRoutes.get("/", async (c) => {
  const limit = parseInt(c.req.query("limit") ?? "50", 10);
  const mediaList = await c.var.services.media.list(limit);

  return c.json({
    media: mediaList.map((m) => ({
      id: m.id,
      filename: m.filename,
      url: getMediaUrl(m.id, m.r2Key, c.env.R2_PUBLIC_URL),
      mimeType: m.mimeType,
      size: m.size,
      createdAt: m.createdAt,
    })),
  });
});

// Delete a file
uploadApiRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const media = await c.var.services.media.getById(id);
  if (!media) {
    return c.json({ error: "Not found" }, 404);
  }

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

  return c.json({ success: true });
});
