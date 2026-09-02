/**
 * Upload Session Service
 *
 * Orchestrates temporary uploads, provider-specific transports, and final media
 * creation. Routes stay thin: validate request -> call this service -> format
 * response.
 */

import { and, asc, eq, inArray, lt } from "drizzle-orm";
import type { Database } from "../db/index.js";
import {
  sqliteSchemaBundle,
  type DatabaseSchema,
} from "../db/schema-bundle.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../lib/errors.js";
import { createEntityId } from "../lib/ids.js";
import {
  detectPosterMimeType,
  getPosterExtension,
  getPosterStorageKey,
  getStoredUploadPolicy,
  getStoredUploadSignaturePeekLength,
  getTemporaryPosterStorageKey,
  getTemporaryUploadStorageKey,
  type UploadContentDisposition,
  validateStoredUploadMetadata,
  validateStoredUploadSignature,
  generateStorageKeyForId,
} from "../lib/upload.js";
import {
  IMAGE_DIMENSION_PEEK_BYTES,
  parseImageDimensions,
} from "../lib/image-dimensions.js";
import {
  supportsCopy,
  supportsMultipart,
  supportsPresignedPut,
  type PresignedPutTarget,
  type StorageDriver,
  type StorageObjectOptions,
  type UploadedPart,
} from "../lib/storage.js";
import { now } from "../lib/time.js";
import type { MediaService } from "./media.js";

const DEFAULT_UPLOAD_TTL_SECONDS = 15 * 60;
const RELAY_MULTIPART_THRESHOLD = 95 * 1024 * 1024;
const RELAY_MULTIPART_PART_SIZE = 50 * 1024 * 1024;
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const DEFAULT_EXPIRED_UPLOAD_CLEANUP_LIMIT = 20;
type CleanupableUploadSessionState = "pending" | "uploaded" | "failed";
const CLEANUPABLE_UPLOAD_SESSION_STATES = [
  "pending",
  "uploaded",
  "failed",
] as const satisfies readonly CleanupableUploadSessionState[];

export interface InitiateUploadData {
  originalName: string;
  contentType: string;
  size: number;
  checksumSha256?: string;
}

export interface CompleteUploadData {
  width?: number;
  height?: number;
  durationSeconds?: number;
  blurhash?: string;
  waveform?: string;
  summary?: string;
  chars?: number;
  parts?: UploadedPart[];
}

export interface RelayTransport {
  kind: "relay";
}

export interface MultipartRelayTransport {
  kind: "multipartRelay";
  partSize: number;
}

export interface PutTransport extends PresignedPutTarget {
  kind: "put";
}

export type UploadTransport =
  RelayTransport | MultipartRelayTransport | PutTransport;

export interface InitiateUploadResult {
  id: string;
  transport: UploadTransport;
}

export interface UploadSessionService {
  initiate(
    data: InitiateUploadData,
    deps: {
      storage: StorageDriver;
      storageDriver: string;
      maxFileSizeMB: number;
    },
  ): Promise<InitiateUploadResult>;
  uploadRelayBody(
    id: string,
    bytes: Uint8Array,
    deps: { storage: StorageDriver },
  ): Promise<void>;
  uploadRelayPart(
    id: string,
    partNumber: number,
    bytes: ArrayBuffer,
    deps: { storage: StorageDriver },
  ): Promise<UploadedPart>;
  uploadPoster(
    id: string,
    bytes: Uint8Array,
    deps: { storage: StorageDriver },
  ): Promise<void>;
  complete(
    id: string,
    data: CompleteUploadData,
    deps: { storage: StorageDriver; storageDriver: string },
  ): Promise<{
    id: string;
    filename: string;
    storageKey: string;
    mimeType: string;
    size: number;
  }>;
  cleanupExpired(deps: {
    storage: StorageDriver;
    storageDriver: string;
    limit?: number;
  }): Promise<{
    abortedMultipartUploads: number;
    deletedSessions: number;
    deletedOrphanMedia: number;
    purgedStorageObjects: number;
  }>;
  abort(id: string, deps: { storage: StorageDriver }): Promise<void>;
}

export function createUploadSessionService(
  db: Database,
  siteId: string,
  media: MediaService,
  databaseSchema: DatabaseSchema = sqliteSchemaBundle,
): UploadSessionService {
  const { uploadSessions } = databaseSchema;

  type UploadSessionRow = typeof uploadSessions.$inferSelect;

  async function getSessionOrThrow(id: string): Promise<UploadSessionRow> {
    const row = await db
      .select()
      .from(uploadSessions)
      .where(and(eq(uploadSessions.siteId, siteId), eq(uploadSessions.id, id)))
      .limit(1);
    if (!row[0]) {
      throw new NotFoundError("Upload session");
    }
    return row[0];
  }

  function assertSessionActive(session: UploadSessionRow): void {
    if (session.state === "completed") {
      throw new ConflictError("This upload is already complete.");
    }

    if (session.state === "aborted") {
      throw new ConflictError("This upload has already been cancelled.");
    }

    if (session.expiresAt <= now()) {
      throw new ValidationError("This upload link expired. Start again.");
    }
  }

  async function updateSession(
    id: string,
    values: Partial<typeof uploadSessions.$inferInsert>,
  ): Promise<void> {
    await db
      .update(uploadSessions)
      .set({ ...values, updatedAt: now() })
      .where(and(eq(uploadSessions.siteId, siteId), eq(uploadSessions.id, id)));
  }

  function buildObjectOptions(
    contentType: string,
    contentDisposition: UploadContentDisposition,
  ): StorageObjectOptions {
    return {
      contentType,
      contentDisposition,
      cacheControl: IMMUTABLE_CACHE_CONTROL,
    };
  }

  function getObjectOptions(session: UploadSessionRow): StorageObjectOptions {
    return buildObjectOptions(
      session.expectedContentType,
      session.contentDisposition as UploadContentDisposition,
    );
  }

  async function readBytes(
    storage: StorageDriver,
    key: string,
    length?: number,
  ): Promise<Uint8Array> {
    const object = await storage.get(
      key,
      length ? { range: { offset: 0, length } } : undefined,
    );
    if (!object) {
      throw new ValidationError("The uploaded file could not be found.");
    }

    const buffer = await new Response(object.body).arrayBuffer();
    return new Uint8Array(buffer);
  }

  async function deleteIfPresent(
    storage: StorageDriver,
    key: string,
  ): Promise<void> {
    await storage.delete(key).catch(() => {});
  }

  async function tryDelete(
    storage: StorageDriver,
    key: string,
  ): Promise<boolean> {
    try {
      await storage.delete(key);
      return true;
    } catch {
      return false;
    }
  }

  async function copyObject(
    storage: StorageDriver,
    sourceKey: string,
    destKey: string,
    opts: StorageObjectOptions,
  ): Promise<void> {
    if (supportsCopy(storage)) {
      await storage.copy(sourceKey, destKey, opts);
      return;
    }

    const source = await storage.get(sourceKey);
    if (!source) {
      throw new ValidationError("The uploaded file could not be found.");
    }
    await storage.put(destKey, source.body, opts);
  }

  async function sha256Base64(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const raw = new Uint8Array(digest);
    let ascii = "";
    for (const byte of raw) {
      ascii += String.fromCharCode(byte);
    }
    return btoa(ascii);
  }

  async function validateStoredChecksum(
    storage: StorageDriver,
    session: UploadSessionRow,
  ): Promise<void> {
    if (!session.expectedChecksumSha256) {
      return;
    }

    const object = await storage.get(session.tempStorageKey);
    if (!object) {
      throw new ValidationError("The uploaded file could not be found.");
    }

    const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
    const actualChecksum = await sha256Base64(bytes);
    if (actualChecksum !== session.expectedChecksumSha256) {
      throw new ValidationError("The uploaded file checksum does not match.");
    }
  }

  async function validateStoredObject(
    storage: StorageDriver,
    session: UploadSessionRow,
    sniffDimensions: boolean,
  ): Promise<{ width: number; height: number } | null> {
    const head = await storage.head(session.tempStorageKey);
    if (!head) {
      throw new ValidationError("The uploaded file could not be found.");
    }

    if (head.size !== session.expectedSize) {
      throw new ValidationError("The uploaded file size does not match.");
    }

    if (head.contentType !== session.expectedContentType) {
      throw new ValidationError("The uploaded file type does not match.");
    }

    const signaturePeekLength = getStoredUploadSignaturePeekLength(
      session.expectedContentType,
    );
    const peekLength = sniffDimensions
      ? Math.max(signaturePeekLength, IMAGE_DIMENSION_PEEK_BYTES)
      : signaturePeekLength;

    if (peekLength === 0) return null;

    const bytes = await readBytes(storage, session.tempStorageKey, peekLength);

    if (signaturePeekLength > 0) {
      const signatureError = validateStoredUploadSignature(
        session.expectedContentType,
        bytes.subarray(0, signaturePeekLength),
      );
      if (signatureError) {
        throw new ValidationError(signatureError);
      }
    }

    if (sniffDimensions) {
      return parseImageDimensions(session.expectedContentType, bytes);
    }

    return null;
  }

  async function validatePoster(
    storage: StorageDriver,
    uploadId: string,
  ): Promise<{ contentType: string; ext: string } | null> {
    // Try each supported poster format
    for (const ext of ["webp", "png"] as const) {
      const posterTempKey = getTemporaryPosterStorageKey(siteId, uploadId, ext);
      const posterHead = await storage.head(posterTempKey);
      if (!posterHead) continue;

      const contentType =
        ext === "webp" ? "image/webp" : ("image/png" as string);
      if (posterHead.contentType !== contentType) {
        throw new ValidationError(
          "Poster content type does not match file extension.",
        );
      }

      const posterBytes = await readBytes(storage, posterTempKey, 32);
      const posterError = validateStoredUploadSignature(
        contentType,
        posterBytes,
      );
      if (posterError) {
        throw new ValidationError(posterError);
      }

      return { contentType, ext };
    }

    return null;
  }

  async function cleanupExpiredSessionArtifacts(
    session: UploadSessionRow,
    storage: StorageDriver,
  ): Promise<{ abortedMultipartUpload: boolean; cleaned: boolean }> {
    let cleaned = true;
    let abortedMultipartUpload = false;

    if (session.multipartUploadId) {
      if (!supportsMultipart(storage)) {
        return { abortedMultipartUpload: false, cleaned: false };
      }

      try {
        await storage.abortMultipartUpload(
          session.tempStorageKey,
          session.multipartUploadId,
        );
        abortedMultipartUpload = true;
      } catch {
        cleaned = false;
      }
    }

    const deletedSource = await tryDelete(storage, session.tempStorageKey);
    const deletedPosterWebp = await tryDelete(
      storage,
      getTemporaryPosterStorageKey(siteId, session.id, "webp"),
    );
    const deletedPosterPng = await tryDelete(
      storage,
      getTemporaryPosterStorageKey(siteId, session.id, "png"),
    );

    return {
      abortedMultipartUpload,
      cleaned:
        cleaned && deletedSource && (deletedPosterWebp || deletedPosterPng),
    };
  }

  return {
    async initiate(data, deps) {
      const validationError = validateStoredUploadMetadata(
        data.contentType,
        data.size,
        { maxFileSizeMB: deps.maxFileSizeMB },
      );
      if (validationError) {
        throw new ValidationError(validationError);
      }

      const policy = getStoredUploadPolicy(data.contentType);
      if (!policy) {
        throw new ValidationError(
          `File type "${data.contentType}" is not supported.`,
        );
      }

      await media.assertCanWriteBytes(data.size);

      const sessionId = createEntityId("uploadSession");
      const mediaId = createEntityId("media");
      const finalObject = generateStorageKeyForId(
        siteId,
        mediaId,
        data.originalName,
      );
      const tempStorageKey = getTemporaryUploadStorageKey(
        siteId,
        sessionId,
        data.originalName,
      );
      const startedAt = now();
      let transport: UploadTransport = { kind: "relay" };
      let multipartUploadId: string | null = null;

      if (deps.storageDriver === "s3" && supportsPresignedPut(deps.storage)) {
        const presigned = await deps.storage.presignPut(tempStorageKey, {
          ...buildObjectOptions(data.contentType, policy.contentDisposition),
          checksumSha256: data.checksumSha256,
          expiresInSeconds: DEFAULT_UPLOAD_TTL_SECONDS,
        });
        transport = { kind: "put", ...presigned };
      } else if (
        data.size >= RELAY_MULTIPART_THRESHOLD &&
        supportsMultipart(deps.storage)
      ) {
        const upload = await deps.storage.createMultipartUpload(
          tempStorageKey,
          buildObjectOptions(data.contentType, policy.contentDisposition),
        );
        multipartUploadId = upload.uploadId;
        transport = {
          kind: "multipartRelay",
          partSize: RELAY_MULTIPART_PART_SIZE,
        };
      }

      await db.insert(uploadSessions).values({
        id: sessionId,
        siteId,
        mediaId,
        originalName: data.originalName,
        filename: finalObject.filename,
        provider: deps.storageDriver,
        expectedContentType: data.contentType,
        expectedSize: data.size,
        expectedChecksumSha256: data.checksumSha256 ?? null,
        contentDisposition: policy.contentDisposition,
        tempStorageKey,
        finalStorageKey: finalObject.storageKey,
        multipartUploadId,
        state: "pending",
        expiresAt:
          transport.kind === "put"
            ? transport.expiresAt
            : startedAt + DEFAULT_UPLOAD_TTL_SECONDS,
        createdAt: startedAt,
        updatedAt: startedAt,
      });

      return {
        id: sessionId,
        transport,
      };
    },

    async uploadRelayBody(id, bytes, deps) {
      const session = await getSessionOrThrow(id);
      assertSessionActive(session);

      if (session.multipartUploadId) {
        throw new ConflictError("This upload expects multipart relay parts.");
      }

      if (bytes.byteLength !== session.expectedSize) {
        throw new ValidationError("The uploaded file size does not match.");
      }

      if (session.expectedChecksumSha256) {
        const actualChecksum = await sha256Base64(bytes);
        if (actualChecksum !== session.expectedChecksumSha256) {
          throw new ValidationError(
            "The uploaded file checksum does not match.",
          );
        }
      }

      await deps.storage.put(
        session.tempStorageKey,
        bytes,
        getObjectOptions(session),
      );
      await updateSession(id, { state: "uploaded" });
    },

    async uploadRelayPart(id, partNumber, bytes, deps) {
      const session = await getSessionOrThrow(id);
      assertSessionActive(session);

      if (!session.multipartUploadId || !supportsMultipart(deps.storage)) {
        throw new ConflictError(
          "This upload does not support multipart relay.",
        );
      }

      return deps.storage.uploadPart(
        session.tempStorageKey,
        session.multipartUploadId,
        partNumber,
        bytes,
      );
    },

    async uploadPoster(id, bytes, deps) {
      const session = await getSessionOrThrow(id);
      assertSessionActive(session);

      const detectedType = detectPosterMimeType(bytes);
      if (!detectedType) {
        throw new ValidationError(
          "Unsupported poster format. Only WebP and PNG are accepted.",
        );
      }

      const ext = getPosterExtension(detectedType);
      await deps.storage.put(
        getTemporaryPosterStorageKey(siteId, id, ext),
        bytes,
        {
          contentType: detectedType,
          cacheControl: IMMUTABLE_CACHE_CONTROL,
        },
      );
    },

    async complete(id, data, deps) {
      const session = await getSessionOrThrow(id);
      assertSessionActive(session);

      if (session.multipartUploadId) {
        if (!supportsMultipart(deps.storage)) {
          throw new ConflictError(
            "Storage no longer supports multipart uploads.",
          );
        }
        if (!data.parts || data.parts.length === 0) {
          throw new ValidationError(
            "Multipart uploads must include uploaded parts.",
          );
        }
        await deps.storage.completeMultipartUpload(
          session.tempStorageKey,
          session.multipartUploadId,
          data.parts,
        );
        await updateSession(id, { state: "uploaded" });
      } else if (session.state !== "uploaded" && deps.storageDriver !== "s3") {
        throw new ConflictError("Upload the file body before completing.");
      }

      try {
        if (session.multipartUploadId) {
          await validateStoredChecksum(deps.storage, session);
        }
        let width = data.width;
        let height = data.height;
        const needsDimensionSniff =
          (!width || !height) &&
          session.expectedContentType.startsWith("image/");
        const sniffed = await validateStoredObject(
          deps.storage,
          session,
          needsDimensionSniff,
        );
        if (sniffed) {
          width ??= sniffed.width;
          height ??= sniffed.height;
        }
        const posterInfo = await validatePoster(deps.storage, id);

        const objectOptions = getObjectOptions(session);
        await copyObject(
          deps.storage,
          session.tempStorageKey,
          session.finalStorageKey,
          objectOptions,
        );

        let posterKey: string | undefined;
        if (posterInfo) {
          posterKey = getPosterStorageKey(
            siteId,
            session.mediaId,
            posterInfo.ext,
          );
          await copyObject(
            deps.storage,
            getTemporaryPosterStorageKey(siteId, id, posterInfo.ext),
            posterKey,
            {
              contentType: posterInfo.contentType,
              cacheControl: IMMUTABLE_CACHE_CONTROL,
            },
          );
        }

        await media.create({
          id: session.mediaId,
          filename: session.filename,
          originalName: session.originalName,
          mimeType: session.expectedContentType,
          size: session.expectedSize,
          storageKey: session.finalStorageKey,
          provider: deps.storageDriver,
          width,
          height,
          durationSeconds: data.durationSeconds,
          blurhash: data.blurhash,
          waveform: data.waveform,
          posterKey,
          summary: data.summary,
          chars: data.chars,
          mediaKind: getStoredUploadPolicy(session.expectedContentType)
            ?.mediaKind,
        });

        await deleteIfPresent(deps.storage, session.tempStorageKey);
        await deleteIfPresent(
          deps.storage,
          getTemporaryPosterStorageKey(siteId, id, "webp"),
        );
        await deleteIfPresent(
          deps.storage,
          getTemporaryPosterStorageKey(siteId, id, "png"),
        );
        await updateSession(id, { state: "completed" });

        return {
          id: session.mediaId,
          filename: session.filename,
          storageKey: session.finalStorageKey,
          mimeType: session.expectedContentType,
          size: session.expectedSize,
        };
      } catch (error) {
        await updateSession(id, { state: "failed" });
        throw error;
      }
    },

    async abort(id, deps) {
      const session = await getSessionOrThrow(id);

      if (
        session.multipartUploadId &&
        session.state !== "completed" &&
        session.state !== "aborted" &&
        supportsMultipart(deps.storage)
      ) {
        await deps.storage
          .abortMultipartUpload(
            session.tempStorageKey,
            session.multipartUploadId,
          )
          .catch(() => {});
      }

      await deleteIfPresent(deps.storage, session.tempStorageKey);
      await deleteIfPresent(
        deps.storage,
        getTemporaryPosterStorageKey(siteId, id, "webp"),
      );
      await deleteIfPresent(
        deps.storage,
        getTemporaryPosterStorageKey(siteId, id, "png"),
      );
      await updateSession(id, { state: "aborted" });
    },

    async cleanupExpired(deps) {
      const limit = Math.max(
        1,
        Math.min(deps.limit ?? DEFAULT_EXPIRED_UPLOAD_CLEANUP_LIMIT, 200),
      );
      const expiredSessions = await db
        .select()
        .from(uploadSessions)
        .where(
          and(
            eq(uploadSessions.siteId, siteId),
            eq(uploadSessions.provider, deps.storageDriver),
            lt(uploadSessions.expiresAt, now()),
            inArray(uploadSessions.state, CLEANUPABLE_UPLOAD_SESSION_STATES),
          ),
        )
        .orderBy(asc(uploadSessions.expiresAt))
        .limit(limit);

      let deletedSessions = 0;
      let abortedMultipartUploads = 0;

      for (const session of expiredSessions) {
        const cleanup = await cleanupExpiredSessionArtifacts(
          session,
          deps.storage,
        );
        if (!cleanup.cleaned) {
          continue;
        }

        if (cleanup.abortedMultipartUpload) {
          abortedMultipartUploads += 1;
        }

        await db
          .delete(uploadSessions)
          .where(
            and(
              eq(uploadSessions.siteId, siteId),
              eq(uploadSessions.id, session.id),
            ),
          );
        deletedSessions += 1;
      }

      // Physically delete storage objects whose recycle window has elapsed.
      // Skips any object a live media row still references (re-uploads).
      const purgedStorageObjects = await media.purgeDueStorageObjects(
        { before: now(), limit, provider: deps.storageDriver },
        deps.storage,
      );

      return {
        abortedMultipartUploads,
        deletedSessions,
        // Retained for response compatibility. Finalized media may be referenced
        // from post bodies without a `media.post_id`, so upload cleanup must not
        // infer liveness from attachment state.
        deletedOrphanMedia: 0,
        purgedStorageObjects,
      };
    },
  };
}
