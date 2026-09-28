import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import type {
  PresignedPutOptions,
  StorageDriver,
  StorageObjectOptions,
} from "../../../lib/storage.js";
import { uploadsApiRoutes } from "../uploads.js";

// Sideloading resolves hosts before fetching; keep these tests off real DNS.
vi.mock("node:dns/promises", () => {
  const lookup = async () => [{ address: "93.184.215.14", family: 4 }];
  return { lookup, default: { lookup } };
});

interface StoredFile extends StorageObjectOptions {
  body: Uint8Array;
}

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

function createMockStorage(options?: {
  presign?: boolean;
  copy?: boolean;
}): StorageDriver & {
  files: Map<string, StoredFile>;
  presignedTargets: Map<
    string,
    {
      key: string;
      opts: PresignedPutOptions;
    }
  >;
} {
  const files = new Map<string, StoredFile>();
  const presignedTargets = new Map<
    string,
    {
      key: string;
      opts: PresignedPutOptions;
    }
  >();

  async function readBody(
    body: ReadableStream | Uint8Array,
  ): Promise<Uint8Array> {
    if (body instanceof Uint8Array) {
      return body;
    }
    return new Uint8Array(await new Response(body).arrayBuffer());
  }

  return {
    files,
    presignedTargets,

    async put(key, body, opts) {
      files.set(key, {
        ...(opts ?? {}),
        body: await readBody(body),
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
        contentDisposition: file.contentDisposition,
        cacheControl: file.cacheControl,
        size: file.body.byteLength,
      };
    },

    async head(key) {
      const file = files.get(key);
      if (!file) return null;
      return {
        contentType: file.contentType,
        contentDisposition: file.contentDisposition,
        cacheControl: file.cacheControl,
        size: file.body.byteLength,
      };
    },

    async delete(key) {
      files.delete(key);
    },

    async copy(sourceKey, destKey, opts) {
      const file = files.get(sourceKey);
      if (!file) {
        throw new Error(`Missing source object ${sourceKey}`);
      }
      files.set(destKey, {
        body: file.body.slice(),
        contentType: opts?.contentType ?? file.contentType,
        contentDisposition: opts?.contentDisposition ?? file.contentDisposition,
        cacheControl: opts?.cacheControl ?? file.cacheControl,
      });
    },

    async presignPut(key, opts) {
      if (!options?.presign) {
        throw new Error("presignPut not enabled");
      }
      const url = `https://uploads.example.test/${encodeURIComponent(key)}`;
      presignedTargets.set(url, { key, opts });
      const headers: Record<string, string> = {};
      if (opts.contentType) headers["Content-Type"] = opts.contentType;
      if (opts.contentDisposition) {
        headers["Content-Disposition"] = opts.contentDisposition;
      }
      if (opts.cacheControl) headers["Cache-Control"] = opts.cacheControl;
      if (opts.checksumSha256) {
        headers["x-amz-checksum-sha256"] = opts.checksumSha256;
      }
      return {
        url,
        method: "PUT" as const,
        headers,
        expiresAt: Math.floor(Date.now() / 1000) + opts.expiresInSeconds,
      };
    },
  };
}

describe("POST /api/uploads/sideload", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function pngBytes(): Uint8Array {
    return new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x06,
      0x08, 0x06, 0x00, 0x00, 0x00,
    ]);
  }

  it("rehosts a remote image and returns its stored URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(pngBytes(), {
            headers: { "content-type": "image/png" },
          }),
      ),
    );
    const storage = createMockStorage();
    const { app, services } = createTestApp({ authenticated: true, storage });
    app.route("/api/uploads", uploadsApiRoutes);

    const res = await app.request("/api/uploads/sideload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/photo.png" }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      id: string;
      url: string;
      mimeType: string;
      width: number;
      height: number;
    };
    expect(data.mimeType).toBe("image/png");
    expect(data.width).toBe(4);
    expect(data.height).toBe(6);
    const media = await services.media.getById(data.id);
    expect(media?.mimeType).toBe("image/png");
  });

  it("requires authentication", async () => {
    const { app } = createTestApp({ authenticated: false });
    app.route("/api/uploads", uploadsApiRoutes);

    const res = await app.request("/api/uploads/sideload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/photo.png" }),
    });

    expect(res.status).toBe(401);
  });
});

describe("Upload Session API Routes", () => {
  it("names a relay transport at the site's path prefix", async () => {
    const storage = createMockStorage();
    const { app } = createTestApp({
      authenticated: true,
      storage,
      sitePathPrefix: "/blog",
    });
    app.route("/api/uploads", uploadsApiRoutes);

    const res = await app.request("/api/uploads/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "photo.webp",
        contentType: "image/webp",
        size: 12,
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      transport: { url: string };
    };
    expect(body.transport.url).toBe(`/blog/api/uploads/${body.id}/body`);
  });

  it("completes a relay image upload and stores inline media metadata", async () => {
    const storage = createMockStorage();
    const { app, services } = createTestApp({
      authenticated: true,
      storage,
    });
    app.route("/api/uploads", uploadsApiRoutes);

    const bytes = createFakeWebpBytes();
    const checksumSha256 = await sha256Base64(bytes);

    const initRes = await app.request("/api/uploads/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "photo.webp",
        contentType: "image/webp",
        size: bytes.byteLength,
        checksumSha256,
      }),
    });

    expect(initRes.status).toBe(200);
    const initData = (await initRes.json()) as {
      id: string;
      transport: { kind: string; url: string };
    };
    expect(initData.transport.kind).toBe("relay");

    const bodyRes = await app.request(initData.transport.url, {
      method: "PUT",
      headers: { "Content-Type": "image/webp" },
      body: bytes,
    });
    expect(bodyRes.status).toBe(204);

    const completeRes = await app.request(
      `/api/uploads/${initData.id}/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          width: 1200,
          height: 800,
          durationSeconds: 12,
          blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
        }),
      },
    );
    expect(completeRes.status).toBe(201);

    const completeData = (await completeRes.json()) as {
      id: string;
      mimeType: string;
    };
    const media = await services.media.getById(completeData.id);
    expect(media).not.toBeNull();
    expect(media).toMatchObject({
      mimeType: "image/webp",
      width: 1200,
      height: 800,
      durationSeconds: 12,
    });

    const storedObject = storage.files.get(String(media?.storageKey));
    expect(storedObject?.contentDisposition).toBe("inline");
    expect(storedObject?.contentType).toBe("image/webp");
  });

  it("rejects relay uploads when the checksum does not match", async () => {
    const storage = createMockStorage();
    const { app } = createTestApp({
      authenticated: true,
      storage,
    });
    app.route("/api/uploads", uploadsApiRoutes);

    const bytes = createFakeWebpBytes();
    const initRes = await app.request("/api/uploads/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "photo.webp",
        contentType: "image/webp",
        size: bytes.byteLength,
        checksumSha256: "not-the-real-checksum",
      }),
    });
    expect(initRes.status).toBe(200);

    const initData = (await initRes.json()) as {
      transport: { url: string };
    };
    const bodyRes = await app.request(initData.transport.url, {
      method: "PUT",
      headers: { "Content-Type": "image/webp" },
      body: bytes,
    });

    expect(bodyRes.status).toBe(400);
    await expect(bodyRes.json()).resolves.toMatchObject({
      error: "The uploaded file checksum does not match.",
    });
  });

  it("returns a presigned PUT target for S3 uploads and keeps HTML as attachment-only", async () => {
    const storage = createMockStorage({ presign: true, copy: true });
    const { app, services } = createTestApp({
      authenticated: true,
      storage,
    });
    app.use("*", async (c, next) => {
      c.set("appConfig", {
        ...c.var.appConfig,
        storageDriver: "s3",
      });
      await next();
    });
    app.route("/api/uploads", uploadsApiRoutes);

    const bytes = new TextEncoder().encode(
      "<!doctype html><title>download</title>",
    );
    const checksumSha256 = await sha256Base64(bytes);

    const initRes = await app.request("/api/uploads/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "download.html",
        contentType: "text/html",
        size: bytes.byteLength,
        checksumSha256,
      }),
    });

    expect(initRes.status).toBe(200);
    const initData = (await initRes.json()) as {
      id: string;
      transport: {
        kind: string;
        url: string;
        headers: Record<string, string>;
      };
    };
    expect(initData.transport.kind).toBe("put");
    expect(initData.transport.headers).toMatchObject({
      "Content-Type": "text/html",
      "Content-Disposition": "attachment",
      "x-amz-checksum-sha256": checksumSha256,
    });

    const presigned = storage.presignedTargets.get(initData.transport.url);
    expect(presigned).toBeDefined();
    if (!presigned) {
      throw new Error("Expected a presigned target");
    }
    await storage.put(presigned.key, bytes, {
      contentType: presigned.opts.contentType,
      contentDisposition: presigned.opts.contentDisposition,
      cacheControl: presigned.opts.cacheControl,
    });

    const completeRes = await app.request(
      `/api/uploads/${initData.id}/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(completeRes.status).toBe(201);

    const completeData = (await completeRes.json()) as {
      id: string;
      mimeType: string;
    };
    expect(completeData.mimeType).toBe("text/html");

    const media = await services.media.getById(completeData.id);
    expect(media).not.toBeNull();
    const storedObject = storage.files.get(String(media?.storageKey));
    expect(storedObject?.contentDisposition).toBe("attachment");
    expect(storedObject?.contentType).toBe("text/html");
  });

  it("rejects unsupported final preview formats at initiation time", async () => {
    const storage = createMockStorage();
    const { app } = createTestApp({
      authenticated: true,
      storage,
    });
    app.route("/api/uploads", uploadsApiRoutes);

    const res = await app.request("/api/uploads/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "photo.bmp",
        contentType: "image/bmp",
        size: 128,
      }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'File type "image/bmp" is not supported.',
    });
  });

  it("schedules expired temp upload cleanup during initiation", async () => {
    const storage = createMockStorage();
    const { app, services, sqlite } = createTestApp({
      authenticated: true,
      storage,
    });
    app.route("/api/uploads", uploadsApiRoutes);

    const staleBytes = createFakeWebpBytes();
    const staleSession = await services.uploads.initiate(
      {
        originalName: "stale.webp",
        contentType: "image/webp",
        size: staleBytes.byteLength,
        checksumSha256: await sha256Base64(staleBytes),
      },
      {
        storage,
        storageDriver: "local",
        maxFileSizeMB: 500,
      },
    );
    await services.uploads.uploadRelayBody(staleSession.id, staleBytes, {
      storage,
    });

    const tempRow = sqlite
      .prepare(
        "select temp_storage_key as tempStorageKey from upload_session where id = ?",
      )
      .get(staleSession.id) as { tempStorageKey: string } | undefined;
    expect(tempRow).toBeDefined();
    if (!tempRow) {
      throw new Error("Expected stale upload session row");
    }

    sqlite
      .prepare(
        "update upload_session set expires_at = 0, updated_at = 0 where id = ?",
      )
      .run(staleSession.id);

    const waitUntilPromises: Promise<unknown>[] = [];
    const res = await app.fetch(
      new Request("http://localhost/api/uploads/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "fresh.webp",
          contentType: "image/webp",
          size: staleBytes.byteLength,
          checksumSha256: await sha256Base64(staleBytes),
        }),
      }),
      undefined,
      {
        waitUntil(promise) {
          waitUntilPromises.push(promise);
        },
      },
    );

    expect(res.status).toBe(200);
    expect(waitUntilPromises).toHaveLength(1);
    await Promise.all(waitUntilPromises);

    const staleRow = sqlite
      .prepare("select id from upload_session where id = ?")
      .get(staleSession.id);
    expect(staleRow).toBeUndefined();
    expect(storage.files.has(tempRow.tempStorageKey)).toBe(false);
  });
});
