/**
 * Upload API Routes
 *
 * Handles single-request uploads through the legacy relay endpoint.
 * Supports both JSON and SSE (Datastar) responses.
 */

import { Hono, type Context } from "hono";
import { html } from "hono/html";
import { msg } from "@lingui/core/macro";
import { z } from "zod";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { requireAuthApi } from "../../middleware/auth.js";
import {
  getMediaUrl,
  getImageUrl,
  getPublicUrlForProvider,
} from "../../lib/image.js";
import { sse } from "../../lib/sse.js";
import {
  detectPosterMimeType,
  getPosterExtension,
  getStoredUploadPolicy,
  getStoredUploadSignaturePeekLength,
  generateStorageKey,
  getPosterStorageKey,
  validateStoredUploadMetadata,
  validateStoredUploadSignature,
} from "../../lib/upload.js";
import {
  IMAGE_DIMENSION_PEEK_BYTES,
  parseImageDimensions,
} from "../../lib/image-dimensions.js";
import {
  assertFound,
  MediaQuotaExceededError,
  parseIdParam,
} from "../../lib/errors.js";
import { getI18n } from "../../i18n/index.js";
import { ID_PREFIX } from "../../lib/ids.js";
import { MediaIdSchema, parseValidated } from "../../lib/schemas.js";
import { toApiMedia } from "../../lib/api-media.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const uploadApiRoutes = new Hono<Env>();

const ListMediaQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  mimePrefix: z.string().trim().min(1).optional(),
  cursor: MediaIdSchema.optional(),
});

const UpdateMediaSchema = z.object({
  alt: z
    .string()
    .max(500)
    .transform((value) => value.trim()),
});

// Require auth for all upload routes
uploadApiRoutes.use("*", requireAuthApi());

/**
 * Render a media card HTML string for SSE response
 */
function renderMediaCard(
  media: {
    id: string;
    storageKey: string;
    mimeType: string;
    originalName: string;
    alt: string | null;
    size: number;
  },
  publicUrl?: string,
  imageTransformUrl?: string,
  sitePathPrefix?: string,
): string {
  const fullUrl = getMediaUrl(media.storageKey, publicUrl, sitePathPrefix);
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
          data-on:click="document.getElementById('lightbox-img').src = '${fullUrl}'; document.getElementById('lightbox').showModal()"
        >
          <img
            src="${thumbnailUrl}"
            alt="${displayName}"
            class="w-full h-full object-cover"
            loading="lazy"
          />
        </button>
        <span class="block mt-2 text-xs truncate" title="${media.originalName}">
          ${media.originalName}
        </span>
        <div class="text-xs text-muted-foreground">${sizeStr}</div>
      </div>
    `.toString();
  }

  return html`
    <div class="group relative" data-media-id="${media.id}">
      <div
        class="block aspect-square bg-muted rounded-lg overflow-hidden border"
      >
        <div
          class="w-full h-full flex items-center justify-center text-muted-foreground"
        >
          <span class="text-xs">${media.mimeType}</span>
        </div>
      </div>
      <span class="block mt-2 text-xs truncate" title="${media.originalName}">
        ${media.originalName}
      </span>
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
function wantsSSE(c: {
  req: { header: (name: string) => string | undefined };
}): boolean {
  const accept = c.req.header("accept") || "";
  return accept.includes("text/event-stream");
}

/**
 * Return an SSE error response that removes the upload placeholder and shows a toast
 */
function sseUploadError(c: Context<Env>, message: string): Response {
  return sse(c, async (stream) => {
    await stream.remove("#upload-placeholder");
    await stream.toast(message, "error");
  });
}

function getHostedMediaQuotaExceededText(c: Context<Env>): string {
  return getI18n(c)._(
    msg({
      message:
        "This upload would exceed your shared hosted media limit. Remove files or upgrade storage to continue.",
      comment:
        "@context: Error shown when a hosted upload would exceed the shared account media limit",
    }),
  );
}

// Upload a file
uploadApiRoutes.post("/", async (c) => {
  const i18n = getI18n(c);
  const storage = c.var.storage;
  if (!storage) {
    const errorText = i18n._(
      msg({
        message: "File storage isn't set up. Check your server config.",
        comment: "@context: Error when file storage is not set up",
      }),
    );
    if (wantsSSE(c)) {
      return sseUploadError(c, errorText);
    }
    return c.json({ error: errorText }, 500);
  }

  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    const errorText = i18n._(
      msg({
        message: "No file selected. Choose a file to upload.",
        comment: "@context: Error when no file was selected for upload",
      }),
    );
    if (wantsSSE(c)) {
      return sseUploadError(c, errorText);
    }
    return c.json({ error: errorText }, 400);
  }

  // Validate file type and size
  const uploadError = validateStoredUploadMetadata(file.type, file.size, {
    maxFileSizeMB: c.var.appConfig.uploadMaxFileSize,
  });
  if (uploadError) {
    if (wantsSSE(c)) {
      return sseUploadError(c, uploadError);
    }
    return c.json({ error: uploadError }, 400);
  }

  // Generate a media TypeID-backed filename and storage key
  const { id, filename, storageKey } = generateStorageKey(
    c.var.currentSite.id,
    file.name,
  );
  const uploadPolicy = getStoredUploadPolicy(file.type);
  if (!uploadPolicy) {
    const errorText = `File type "${file.type}" is not supported.`;
    if (wantsSSE(c)) {
      return sseUploadError(c, errorText);
    }
    return c.json({ error: errorText }, 400);
  }

  try {
    const sitePathPrefix = c.var.appConfig.sitePathPrefix;

    await c.var.services.media.assertCanWriteBytes(file.size);

    const peekLength = getStoredUploadSignaturePeekLength(file.type);
    if (peekLength > 0) {
      const signatureBytes = new Uint8Array(
        await file.slice(0, peekLength).arrayBuffer(),
      );
      const signatureError = validateStoredUploadSignature(
        file.type,
        signatureBytes,
      );
      if (signatureError) {
        if (wantsSSE(c)) {
          return sseUploadError(c, signatureError);
        }
        return c.json({ error: signatureError }, 400);
      }
    }

    // Read optional summary (provided for text attachments)
    let summary = (formData.get("summary") as string) || undefined;
    let chars: number | undefined;
    // Buffer for text files — file.stream() may not work after file.text()
    let textBuffer: Uint8Array | undefined;

    // Extract summary and char count BEFORE consuming the stream for storage,
    // because file.text() may not work after file.stream() is consumed.
    if (
      file.type === "text/plain" ||
      file.type === "text/markdown" ||
      file.type === "text/csv"
    ) {
      try {
        const textContent = await file.text();
        textBuffer = new TextEncoder().encode(textContent);
        chars = textContent.length;
        if (!summary) {
          summary = textContent.slice(0, 100).trim() || undefined;
        }
      } catch {
        // Ignore — summary and chars are optional
      }
    }

    // Upload to storage — use buffered bytes for text files (stream may be consumed)
    await storage.put(storageKey, textBuffer ?? file.stream(), {
      contentType: file.type,
      contentDisposition: uploadPolicy.contentDisposition,
      cacheControl: "public, max-age=31536000, immutable",
    });

    // Read optional client-side metadata
    const widthRaw = parseInt(formData.get("width") as string) || undefined;
    const heightRaw = parseInt(formData.get("height") as string) || undefined;
    const durationSecondsRaw =
      parseInt(formData.get("durationSeconds") as string) || undefined;
    const altRaw = (formData.get("alt") as string) || undefined;
    const blurhashRaw = (formData.get("blurhash") as string) || undefined;
    const waveformRaw = (formData.get("waveform") as string) || undefined;

    let width = widthRaw && widthRaw > 0 ? widthRaw : undefined;
    let height = heightRaw && heightRaw > 0 ? heightRaw : undefined;
    if ((!width || !height) && file.type.startsWith("image/")) {
      try {
        const headerBytes = new Uint8Array(
          await file.slice(0, IMAGE_DIMENSION_PEEK_BYTES).arrayBuffer(),
        );
        const dimensions = parseImageDimensions(file.type, headerBytes);
        if (dimensions) {
          width ??= dimensions.width;
          height ??= dimensions.height;
        }
      } catch {
        // Dimensions are optional — fall through with whatever the client sent.
      }
    }

    // Upload poster frame for videos (if provided by client)
    let posterKey: string | undefined;
    const posterFile = formData.get("poster") as File | null;
    if (posterFile && file.type.startsWith("video/")) {
      const posterBytes = new Uint8Array(await posterFile.arrayBuffer());
      const posterMime = detectPosterMimeType(posterBytes);
      if (posterMime) {
        const posterExt = getPosterExtension(posterMime);
        posterKey = getPosterStorageKey(c.var.currentSite.id, id, posterExt);
        await storage.put(posterKey, posterBytes, {
          contentType: posterMime,
        });
      }
    }

    // Save to database
    const media = await c.var.services.media.create({
      id,
      filename,
      originalName: file.name,
      mimeType: file.type,
      size: file.size,
      storageKey,
      provider: c.var.appConfig.storageDriver,
      width,
      height,
      durationSeconds:
        durationSecondsRaw && durationSecondsRaw > 0
          ? durationSecondsRaw
          : undefined,
      alt: altRaw?.trim() || undefined,
      blurhash:
        blurhashRaw && blurhashRaw.length < 200 ? blurhashRaw : undefined,
      waveform:
        waveformRaw && waveformRaw.length < 2000 ? waveformRaw : undefined,
      posterKey,
      summary,
      chars,
      mediaKind: uploadPolicy.mediaKind,
    });

    // SSE response for Datastar
    if (wantsSSE(c)) {
      const mediaPublicUrl = getPublicUrlForProvider(
        c.var.appConfig.storageDriver,
        c.var.appConfig.r2PublicUrl,
        c.var.appConfig.s3PublicUrl,
        c.var.appConfig.localPublicUrl,
      );
      const cardHtml = renderMediaCard(
        media,
        mediaPublicUrl,
        c.var.appConfig.imageTransformUrl,
        sitePathPrefix,
      );

      return sse(c, async (stream) => {
        // Replace placeholder with real media card
        await stream.patchElements(cardHtml, {
          mode: "outer",
          selector: "#upload-placeholder",
        });
        await stream.toast(
          i18n._(
            msg({
              message: "File uploaded.",
              comment: "@context: Toast after successful file upload",
            }),
          ),
        );
      });
    }

    // JSON response for API clients
    const mediaPublicUrl = getPublicUrlForProvider(
      c.var.appConfig.storageDriver,
      c.var.appConfig.r2PublicUrl,
      c.var.appConfig.s3PublicUrl,
      c.var.appConfig.localPublicUrl,
    );
    const publicUrl = getMediaUrl(storageKey, mediaPublicUrl, sitePathPrefix);
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

    const errorText =
      err instanceof MediaQuotaExceededError
        ? getHostedMediaQuotaExceededText(c)
        : i18n._(
            msg({
              message: "Upload didn't go through. Try again in a moment.",
              comment: "@context: Error when file upload fails",
            }),
          );
    if (wantsSSE(c)) {
      return sse(c, async (stream) => {
        await stream.remove("#upload-placeholder");
        await stream.toast(errorText, "error");
      });
    }
    return c.json(
      { error: errorText },
      err instanceof MediaQuotaExceededError ? 409 : 500,
    );
  }
});

// List uploaded files (JSON only)
uploadApiRoutes.get("/", async (c) => {
  const { limit, mimePrefix, cursor } = parseValidated(
    ListMediaQuerySchema,
    c.req.query(),
  );
  const mediaList = await c.var.services.media.list({
    limit,
    mimePrefix,
    cursor,
  });

  return c.json({
    media: mediaList.map((media) => toApiMedia(media, c.var.appConfig)),
    nextCursor:
      mediaList.length === limit ? (mediaList.at(-1)?.id ?? null) : null,
  });
});

uploadApiRoutes.get("/:id", async (c) => {
  const id = parseIdParam(c.req.param("id"), ID_PREFIX.media);
  const media = assertFound(await c.var.services.media.getById(id), "Media");
  return c.json(toApiMedia(media, c.var.appConfig));
});

uploadApiRoutes.patch("/:id", async (c) => {
  const id = parseIdParam(c.req.param("id"), ID_PREFIX.media);
  const { alt } = parseValidated(UpdateMediaSchema, await c.req.json());
  assertFound(await c.var.services.media.getById(id), "Media");

  await c.var.services.media.updateAlt(id, alt);

  const media = assertFound(await c.var.services.media.getById(id), "Media");
  return c.json(toApiMedia(media, c.var.appConfig));
});

// Delete a file
uploadApiRoutes.delete("/:id", async (c) => {
  const id = parseIdParam(c.req.param("id"), ID_PREFIX.media);
  assertFound(await c.var.services.media.getById(id), "Media");

  await c.var.services.media.delete(id, c.var.storage);

  return c.json({ success: true });
});
