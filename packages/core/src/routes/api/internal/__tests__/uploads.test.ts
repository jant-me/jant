import { describe, expect, it } from "vitest";
import { createTestApp } from "../../../../__tests__/helpers/app.js";
import type { StorageDriver } from "../../../../lib/storage.js";
import { internalUploadsRoutes } from "../uploads.js";

function createFakeWebpBytes(length = 32): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set([
    0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]);
  return bytes;
}

async function sha256Base64(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Buffer.from(digest).toString("base64");
}

function createMockStorage(): StorageDriver & {
  files: Map<string, { body: Uint8Array; contentType?: string }>;
} {
  const files = new Map<string, { body: Uint8Array; contentType?: string }>();

  return {
    files,

    async put(key, body, opts) {
      const bytes =
        body instanceof Uint8Array
          ? body
          : new Uint8Array(await new Response(body).arrayBuffer());
      files.set(key, {
        body: bytes,
        contentType: opts?.contentType,
      });
    },

    async get(key, opts) {
      const file = files.get(key);
      if (!file) return null;
      const start = opts?.range?.offset ?? 0;
      const end = opts?.range
        ? start + opts.range.length
        : file.body.byteLength;
      const slice = file.body.slice(start, end);
      return {
        body: new Response(slice).body as ReadableStream,
        contentType: file.contentType,
        size: file.body.byteLength,
      };
    },

    async head(key) {
      const file = files.get(key);
      if (!file) return null;
      return {
        contentType: file.contentType,
        size: file.body.byteLength,
      };
    },

    async delete(key) {
      files.delete(key);
    },

    async copy(sourceKey, destKey) {
      const file = files.get(sourceKey);
      if (file) files.set(destKey, { ...file });
    },
  };
}

describe("Internal upload admin routes", () => {
  it("cleans up expired temporary upload sessions for the current site", async () => {
    const storage = createMockStorage();
    const { app, services, sqlite } = createTestApp({
      authenticated: false,
      internalAdminToken: "internal-secret",
      storage,
    });
    app.route("/api/internal/uploads", internalUploadsRoutes);

    const bytes = createFakeWebpBytes();
    const session = await services.uploads.initiate(
      {
        originalName: "stale.webp",
        contentType: "image/webp",
        size: bytes.byteLength,
        checksumSha256: await sha256Base64(bytes),
      },
      {
        storage,
        storageDriver: "local",
        maxFileSizeMB: 500,
      },
    );
    await services.uploads.uploadRelayBody(session.id, bytes, { storage });

    const row = sqlite
      .prepare(
        "select temp_storage_key as tempStorageKey from upload_session where id = ?",
      )
      .get(session.id) as { tempStorageKey: string } | undefined;
    expect(row).toBeDefined();
    if (!row) {
      throw new Error("Expected stale upload session row");
    }

    sqlite
      .prepare(
        "update upload_session set expires_at = 0, updated_at = 0 where id = ?",
      )
      .run(session.id);

    const res = await app.request("/api/internal/uploads/cleanup", {
      method: "POST",
      headers: {
        Authorization: "Bearer internal-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ limit: 10 }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      abortedMultipartUploads: 0,
      deletedSessions: 1,
      deletedOrphanMedia: 0,
      purgedStorageObjects: 0,
      done: true,
    });

    const remaining = sqlite
      .prepare("select id from upload_session where id = ?")
      .get(session.id);
    expect(remaining).toBeUndefined();
    expect(storage.files.has(row.tempStorageKey)).toBe(false);
  });

  it("keeps finalized unattached media during upload cleanup", async () => {
    const storage = createMockStorage();
    const { app, services, sqlite } = createTestApp({
      authenticated: false,
      internalAdminToken: "internal-secret",
      storage,
    });
    app.route("/api/internal/uploads", internalUploadsRoutes);

    const oldStorageKey = "media/old-orphan.jpg";
    const freshStorageKey = "media/fresh-orphan.jpg";
    await storage.put(oldStorageKey, createFakeWebpBytes(), {
      contentType: "image/jpeg",
    });
    await storage.put(freshStorageKey, createFakeWebpBytes(), {
      contentType: "image/jpeg",
    });

    const oldOrphan = await services.media.create({
      filename: "old.jpg",
      originalName: "old.jpg",
      mimeType: "image/jpeg",
      size: 1024,
      storageKey: oldStorageKey,
    });
    const freshOrphan = await services.media.create({
      filename: "fresh.jpg",
      originalName: "fresh.jpg",
      mimeType: "image/jpeg",
      size: 1024,
      storageKey: freshStorageKey,
    });

    // Backdate the first orphan beyond the 7-day grace window.
    sqlite
      .prepare("update media set created_at = 0 where id = ?")
      .run(oldOrphan.id);

    const res = await app.request("/api/internal/uploads/cleanup", {
      method: "POST",
      headers: {
        Authorization: "Bearer internal-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ limit: 10 }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      abortedMultipartUploads: 0,
      deletedSessions: 0,
      deletedOrphanMedia: 0,
      purgedStorageObjects: 0,
      done: true,
    });

    // Finalized media may be referenced from post body JSON without being a
    // post attachment, so upload cleanup must not delete it from `postId IS
    // NULL` alone.
    expect(
      sqlite.prepare("select id from media where id = ?").get(oldOrphan.id),
    ).toBeDefined();
    expect(storage.files.has(oldStorageKey)).toBe(true);
    expect(
      sqlite
        .prepare("select id from storage_purge where original_key = ?")
        .get(oldStorageKey),
    ).toBeUndefined();

    // Fresh unattached media is also untouched.
    expect(
      sqlite.prepare("select id from media where id = ?").get(freshOrphan.id),
    ).toBeDefined();
    expect(storage.files.has(freshStorageKey)).toBe(true);
  });
});
