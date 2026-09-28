/**
 * One-shot Upload API Routes
 *
 * `POST /api/upload`: the whole file in one multipart request, answered with
 * the media object. Resumable and large uploads use `/api/uploads`.
 */

import { Hono, type Context } from "hono";
import { msg } from "@lingui/core/macro";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { requireAuthApi } from "../../middleware/auth.js";
import { toApiMedia } from "../../lib/api-media.js";
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
  DomainError,
  ExternalServiceError,
  MediaQuotaExceededError,
  ValidationError,
} from "../../lib/errors.js";
import { requireStorage } from "../../lib/storage.js";
import { getI18n } from "../../i18n/index.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const uploadApiRoutes = new Hono<Env>();

// Require auth for all upload routes
uploadApiRoutes.use("*", requireAuthApi());

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
  const storage = requireStorage(c.var.storage);

  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    throw new ValidationError(
      i18n._(
        msg({
          message: "No file selected. Choose a file to upload.",
          comment: "@context: Error when no file was selected for upload",
        }),
      ),
    );
  }

  // Validate file type and size
  const uploadError = validateStoredUploadMetadata(file.type, file.size, {
    maxFileSizeMB: c.var.appConfig.uploadMaxFileSize,
  });
  if (uploadError) {
    throw new ValidationError(uploadError);
  }

  // Generate a media TypeID-backed filename and storage key
  const { id, filename, storageKey } = generateStorageKey(
    c.var.currentSite.id,
    file.name,
  );
  const uploadPolicy = getStoredUploadPolicy(file.type);
  if (!uploadPolicy) {
    throw new ValidationError(`File type "${file.type}" is not supported.`);
  }

  try {
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
        throw new ValidationError(signatureError);
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

    // The same shape `GET /api/media/:id` returns, as for every other create.
    return c.json(toApiMedia(media, c.var.appConfig), 201);
  } catch (err) {
    // The quota error carries the hosted service's own wording; a validation
    // error thrown above passes through; anything else is a failed write.
    if (err instanceof MediaQuotaExceededError) {
      throw new MediaQuotaExceededError(getHostedMediaQuotaExceededText(c));
    }
    if (err instanceof DomainError) throw err;
    // eslint-disable-next-line no-console -- Error logging is intentional
    console.error("Upload error:", err);
    throw new ExternalServiceError(
      i18n._(
        msg({
          message: "Upload didn't go through. Try again in a moment.",
          comment: "@context: Error when file upload fails",
        }),
      ),
    );
  }
});
