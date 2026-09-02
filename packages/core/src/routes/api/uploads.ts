import { Hono } from "hono";
import { z } from "zod";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { requireAuthApi } from "../../middleware/auth.js";
import { parseIdParam, ValidationError } from "../../lib/errors.js";
import { ID_PREFIX } from "../../lib/ids.js";
import { parseValidated } from "../../lib/schemas.js";
import { getMediaUrl, getPublicUrlForProvider } from "../../lib/image.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

const InitiateUploadSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
  size: z.number().int().positive(),
  checksumSha256: z.string().min(1).optional(),
});

const CompleteUploadSchema = z.object({
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationSeconds: z.number().int().positive().optional(),
  blurhash: z.string().max(200).optional(),
  waveform: z.string().max(2000).optional(),
  summary: z.string().max(500).optional(),
  chars: z.number().int().nonnegative().optional(),
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().positive(),
        etag: z.string().min(1),
      }),
    )
    .optional(),
});

const SideloadSchema = z.object({
  url: z.string().url(),
  alt: z.string().max(2000).optional(),
});

export const uploadsApiRoutes = new Hono<Env>();

uploadsApiRoutes.use("*", requireAuthApi());

/**
 * Rehost a remote image into the site's own storage. Used when an author pastes
 * an article whose `<img>` tags point at external URLs — the server fetches the
 * bytes (bypassing browser CORS) and stores them. Returns the new media's
 * public URL so the editor can swap the node's `src`.
 */
uploadsApiRoutes.post("/sideload", async (c) => {
  const storage = c.var.storage;
  if (!storage) {
    return c.json(
      { error: "File storage isn't set up. Check your server config." },
      500,
    );
  }

  const { url, alt } = parseValidated(SideloadSchema, await c.req.json());

  const media = await c.var.services.media.ingestFromUrl(
    { url, alt },
    {
      storage,
      storageDriver: c.var.appConfig.storageDriver,
      maxFileSizeMB: c.var.appConfig.uploadMaxFileSize,
    },
  );

  const mediaPublicUrl = getPublicUrlForProvider(
    c.var.appConfig.storageDriver,
    c.var.appConfig.r2PublicUrl,
    c.var.appConfig.s3PublicUrl,
    c.var.appConfig.localPublicUrl,
  );

  return c.json({
    id: media.id,
    url: getMediaUrl(
      media.storageKey,
      mediaPublicUrl,
      c.var.appConfig.sitePathPrefix,
    ),
    width: media.width,
    height: media.height,
    mimeType: media.mimeType,
    size: media.size,
  });
});

function scheduleExpiredUploadCleanup(
  c: {
    executionCtx?: { waitUntil: (promise: Promise<unknown>) => void };
    var: {
      appConfig: AppVariables["appConfig"];
      services: AppVariables["services"];
      storage: AppVariables["storage"];
    };
  },
  limit?: number,
): void {
  const storage = c.var.storage;
  if (!storage) {
    return;
  }

  const cleanupPromise = c.var.services.uploads
    .cleanupExpired({
      storage,
      storageDriver: c.var.appConfig.storageDriver,
      limit,
    })
    .catch(() => {});

  let executionCtx:
    { waitUntil: (promise: Promise<unknown>) => void } | undefined;
  try {
    executionCtx = c.executionCtx;
  } catch {
    // executionCtx not available (for example in tests)
  }

  if (executionCtx) {
    executionCtx.waitUntil(cleanupPromise);
    return;
  }

  if (!executionCtx) {
    void cleanupPromise;
  }
}

uploadsApiRoutes.post("/init", async (c) => {
  const storage = c.var.storage;
  if (!storage) {
    return c.json(
      { error: "File storage isn't set up. Check your server config." },
      500,
    );
  }

  scheduleExpiredUploadCleanup(c);

  const body = await c.req.json();
  const data = parseValidated(InitiateUploadSchema, body);
  const result = await c.var.services.uploads.initiate(
    {
      originalName: data.filename,
      contentType: data.contentType,
      size: data.size,
      checksumSha256: data.checksumSha256,
    },
    {
      storage,
      storageDriver: c.var.appConfig.storageDriver,
      maxFileSizeMB: c.var.appConfig.uploadMaxFileSize,
    },
  );

  if (result.transport.kind === "put") {
    return c.json(result);
  }

  if (result.transport.kind === "multipartRelay") {
    return c.json({
      id: result.id,
      transport: {
        kind: "multipartRelay",
        method: "PUT",
        url: `/api/uploads/${result.id}/part`,
        partSize: result.transport.partSize,
      },
    });
  }

  return c.json({
    id: result.id,
    transport: {
      kind: "relay",
      method: "PUT",
      url: `/api/uploads/${result.id}/body`,
    },
  });
});

uploadsApiRoutes.put("/:id/body", async (c) => {
  const storage = c.var.storage;
  if (!storage) {
    return c.json(
      { error: "File storage isn't set up. Check your server config." },
      500,
    );
  }

  const id = parseIdParam(c.req.param("id"), ID_PREFIX.uploadSession);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  await c.var.services.uploads.uploadRelayBody(id, bytes, { storage });
  return c.body(null, 204);
});

uploadsApiRoutes.put("/:id/part", async (c) => {
  const storage = c.var.storage;
  if (!storage) {
    return c.json(
      { error: "File storage isn't set up. Check your server config." },
      500,
    );
  }

  const id = parseIdParam(c.req.param("id"), ID_PREFIX.uploadSession);
  const partNumberRaw = c.req.query("partNumber");
  if (!partNumberRaw) {
    throw new ValidationError("partNumber query parameter is required");
  }
  const partNumber = Number.parseInt(partNumberRaw, 10);
  if (!Number.isInteger(partNumber) || partNumber < 1) {
    throw new ValidationError("partNumber must be a positive integer");
  }

  const part = await c.var.services.uploads.uploadRelayPart(
    id,
    partNumber,
    await c.req.arrayBuffer(),
    { storage },
  );
  return c.json(part);
});

uploadsApiRoutes.put("/:id/poster", async (c) => {
  const storage = c.var.storage;
  if (!storage) {
    return c.json(
      { error: "File storage isn't set up. Check your server config." },
      500,
    );
  }

  const id = parseIdParam(c.req.param("id"), ID_PREFIX.uploadSession);
  await c.var.services.uploads.uploadPoster(
    id,
    new Uint8Array(await c.req.arrayBuffer()),
    { storage },
  );
  return c.body(null, 204);
});

uploadsApiRoutes.post("/:id/complete", async (c) => {
  const storage = c.var.storage;
  if (!storage) {
    return c.json(
      { error: "File storage isn't set up. Check your server config." },
      500,
    );
  }

  const id = parseIdParam(c.req.param("id"), ID_PREFIX.uploadSession);
  const body = await c.req.json();
  const data = parseValidated(CompleteUploadSchema, body);
  const result = await c.var.services.uploads.complete(id, data, {
    storage,
    storageDriver: c.var.appConfig.storageDriver,
  });

  const mediaPublicUrl = getPublicUrlForProvider(
    c.var.appConfig.storageDriver,
    c.var.appConfig.r2PublicUrl,
    c.var.appConfig.s3PublicUrl,
    c.var.appConfig.localPublicUrl,
  );

  return c.json({
    id: result.id,
    filename: result.filename,
    url: getMediaUrl(
      result.storageKey,
      mediaPublicUrl,
      c.var.appConfig.sitePathPrefix,
    ),
    mimeType: result.mimeType,
    size: result.size,
  });
});

uploadsApiRoutes.post("/:id/abort", async (c) => {
  const storage = c.var.storage;
  if (!storage) {
    return c.json(
      { error: "File storage isn't set up. Check your server config." },
      500,
    );
  }

  const id = parseIdParam(c.req.param("id"), ID_PREFIX.uploadSession);
  await c.var.services.uploads.abort(id, { storage });
  return c.json({ success: true });
});
