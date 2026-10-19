import { Hono } from "hono";
import { z } from "zod";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { requireAuthApi } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { parseIdParam } from "../../lib/errors.js";
import { requireStorage } from "../../lib/storage.js";
import { ID_PREFIX } from "../../lib/ids.js";
import { getMediaUrl, getPublicUrlForProvider } from "../../lib/image.js";
import { toApiMedia } from "../../lib/api-media.js";
import { toPublicPath } from "../../lib/url.js";

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

const PART_NUMBER_REQUIRED = "partNumber query parameter is required";
const PART_NUMBER_INVALID = "partNumber must be a positive integer";

const UploadPartQuerySchema = z.object({
  partNumber: z
    .string({ error: PART_NUMBER_REQUIRED })
    .min(1, PART_NUMBER_REQUIRED)
    .transform((raw) => Number.parseInt(raw, 10))
    .pipe(
      z
        .number({ error: PART_NUMBER_INVALID })
        .int(PART_NUMBER_INVALID)
        .min(1, PART_NUMBER_INVALID),
    ),
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
uploadsApiRoutes.post(
  "/sideload",
  validate("json", SideloadSchema),
  async (c) => {
    const storage = requireStorage(c.var.storage);

    const { url, alt } = c.req.valid("json");

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
  },
);

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

uploadsApiRoutes.post(
  "/init",
  validate("json", InitiateUploadSchema),
  async (c) => {
    const storage = requireStorage(c.var.storage);

    scheduleExpiredUploadCleanup(c);

    const data = c.req.valid("json");
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
          // A site under a path prefix answers there; the client sends to
          // this URL as given.
          url: toPublicPath(
            `/api/uploads/${result.id}/part`,
            c.var.appConfig.sitePathPrefix,
          ),
          partSize: result.transport.partSize,
        },
      });
    }

    return c.json({
      id: result.id,
      transport: {
        kind: "relay",
        method: "PUT",
        url: toPublicPath(
          `/api/uploads/${result.id}/body`,
          c.var.appConfig.sitePathPrefix,
        ),
      },
    });
  },
);

uploadsApiRoutes.put("/:id/body", async (c) => {
  const storage = requireStorage(c.var.storage);

  const id = parseIdParam(c.req.param("id"), ID_PREFIX.uploadSession);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  await c.var.services.uploads.uploadRelayBody(id, bytes, { storage });
  return c.body(null, 204);
});

uploadsApiRoutes.put(
  "/:id/part",
  validate("query", UploadPartQuerySchema),
  async (c) => {
    const storage = requireStorage(c.var.storage);

    const id = parseIdParam(c.req.param("id"), ID_PREFIX.uploadSession);
    const { partNumber } = c.req.valid("query");

    const part = await c.var.services.uploads.uploadRelayPart(
      id,
      partNumber,
      await c.req.arrayBuffer(),
      { storage },
    );
    return c.json(part);
  },
);

uploadsApiRoutes.put("/:id/poster", async (c) => {
  const storage = requireStorage(c.var.storage);

  const id = parseIdParam(c.req.param("id"), ID_PREFIX.uploadSession);
  await c.var.services.uploads.uploadPoster(
    id,
    new Uint8Array(await c.req.arrayBuffer()),
    { storage },
  );
  return c.body(null, 204);
});

uploadsApiRoutes.post(
  "/:id/complete",
  validate("json", CompleteUploadSchema),
  async (c) => {
    const storage = requireStorage(c.var.storage);

    const id = parseIdParam(c.req.param("id"), ID_PREFIX.uploadSession);
    const data = c.req.valid("json");
    const result = await c.var.services.uploads.complete(id, data, {
      storage,
      storageDriver: c.var.appConfig.storageDriver,
    });

    // The same shape `GET /api/media/:id` returns, as for every other create.
    return c.json(toApiMedia(result, c.var.appConfig), 201);
  },
);

uploadsApiRoutes.post("/:id/abort", async (c) => {
  const storage = requireStorage(c.var.storage);

  const id = parseIdParam(c.req.param("id"), ID_PREFIX.uploadSession);
  await c.var.services.uploads.abort(id, { storage });
  return c.json({ success: true });
});
