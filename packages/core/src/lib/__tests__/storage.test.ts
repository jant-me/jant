/* eslint-disable @typescript-eslint/no-non-null-assertion -- Test assertions use ! for readability */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import {
  createS3Driver,
  createR2Driver,
  createStorageDriver,
  supportsMultipart,
} from "../storage.js";
import type { Bindings } from "../../types.js";

async function createTempDir() {
  return mkdtemp(join(tmpdir(), "jant-local-storage-"));
}

describe("createStorageDriver", () => {
  it("returns null when no storage is configured", () => {
    const env = { DB: {} } as Bindings;
    const driver = createStorageDriver(env);
    expect(driver).toBeNull();
  });

  it("returns R2 driver when R2 binding is present", () => {
    const env = {
      DB: {},
      R2: { put: vi.fn(), get: vi.fn(), delete: vi.fn() },
    } as unknown as Bindings;
    const driver = createStorageDriver(env);
    expect(driver).not.toBeNull();
  });

  it("returns R2 driver by default even with STORAGE_DRIVER unset", () => {
    const env = {
      DB: {},
      R2: { put: vi.fn(), get: vi.fn(), delete: vi.fn() },
    } as unknown as Bindings;
    const driver = createStorageDriver(env);
    expect(driver).not.toBeNull();
  });

  it("defaults to local storage for the Node runtime", () => {
    const env = {
      NODE_SQLITE: {} as Bindings["NODE_SQLITE"],
      LOCAL_STORAGE_PATH: "/tmp/jant-local-default",
    } as Bindings;

    const driver = createStorageDriver(env);
    expect(driver).not.toBeNull();
  });

  it("defaults to local storage for the Node Postgres runtime", () => {
    const env = {
      NODE_DATABASE: {
        db: {} as Bindings["NODE_DATABASE"]["db"],
        dialect: "pg",
        rawQuery: {} as Bindings["NODE_DATABASE"]["rawQuery"],
        schema: {} as Bindings["NODE_DATABASE"]["schema"],
      },
      LOCAL_STORAGE_PATH: "/tmp/jant-local-default-pg",
    } as Bindings;

    const driver = createStorageDriver(env);
    expect(driver).not.toBeNull();
  });

  it("rejects R2 storage in the Node runtime", () => {
    expect(() =>
      createStorageDriver({
        NODE_DATABASE: {
          db: {} as Bindings["NODE_DATABASE"]["db"],
          dialect: "pg",
          rawQuery: {} as Bindings["NODE_DATABASE"]["rawQuery"],
          schema: {} as Bindings["NODE_DATABASE"]["schema"],
        },
        STORAGE_DRIVER: "r2",
      } as Bindings),
    ).toThrow(/Node runtime does not support R2 storage/);
  });

  it("rejects local storage in the Cloudflare runtime", () => {
    expect(() =>
      createStorageDriver({
        DB: {} as Bindings["DB"],
        STORAGE_DRIVER: "local",
      } as Bindings),
    ).toThrow(/Cloudflare runtime does not support local storage/);
  });

  it("derives the local storage path from DATA_DIR", async () => {
    const rootPath = await createTempDir();
    try {
      const driver = createStorageDriver({
        NODE_SQLITE: {} as Bindings["NODE_SQLITE"],
        STORAGE_DRIVER: "local",
        DATA_DIR: rootPath,
      } as Bindings);

      expect(driver).not.toBeNull();
      await driver!.put(
        "media/nested/data-dir.txt",
        new TextEncoder().encode("from data dir"),
      );

      const object = await driver!.get("media/nested/data-dir.txt");
      expect(object).not.toBeNull();
      expect(await new Response(object!.body).text()).toBe("from data dir");
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it("returns null for S3 driver when S3 config is incomplete", () => {
    const env = {
      DB: {},
      STORAGE_DRIVER: "s3",
      S3_ENDPOINT: "https://s3.example.com",
      // Missing S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
    } as unknown as Bindings;
    const driver = createStorageDriver(env);
    expect(driver).toBeNull();
  });

  it("returns S3 driver when fully configured", () => {
    const env = {
      DB: {},
      STORAGE_DRIVER: "s3",
      S3_ENDPOINT: "https://s3.example.com",
      S3_BUCKET: "my-bucket",
      S3_ACCESS_KEY_ID: "access-key",
      S3_SECRET_ACCESS_KEY: "secret-key",
      S3_REGION: "us-east-1",
    } as unknown as Bindings;
    const driver = createStorageDriver(env);
    expect(driver).not.toBeNull();
  });

  it("defaults S3_REGION to 'auto' when not set", () => {
    const env = {
      DB: {},
      STORAGE_DRIVER: "s3",
      S3_ENDPOINT: "https://s3.example.com",
      S3_BUCKET: "my-bucket",
      S3_ACCESS_KEY_ID: "access-key",
      S3_SECRET_ACCESS_KEY: "secret-key",
    } as unknown as Bindings;
    // Should not throw - region defaults to "auto"
    const driver = createStorageDriver(env);
    expect(driver).not.toBeNull();
  });

  it("prefers S3 driver over R2 when STORAGE_DRIVER=s3", () => {
    const env = {
      DB: {},
      R2: { put: vi.fn(), get: vi.fn(), delete: vi.fn() },
      STORAGE_DRIVER: "s3",
      S3_ENDPOINT: "https://s3.example.com",
      S3_BUCKET: "my-bucket",
      S3_ACCESS_KEY_ID: "access-key",
      S3_SECRET_ACCESS_KEY: "secret-key",
    } as unknown as Bindings;
    const driver = createStorageDriver(env);
    expect(driver).not.toBeNull();
  });
});

describe("createS3Driver", () => {
  it("signs the upload headers that the browser must send", async () => {
    const driver = createS3Driver({
      endpoint: "https://s3.example.com",
      bucket: "jant-media",
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
      region: "auto",
    });

    const presigned = await driver.presignPut?.("media/test.webp", {
      contentType: "image/webp",
      contentDisposition: "inline",
      cacheControl: "public, max-age=31536000, immutable",
      checksumSha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      expiresInSeconds: 900,
    });

    expect(presigned).toBeDefined();
    if (!presigned) {
      throw new Error("Expected presigned PUT target");
    }

    const signedHeaders = new URL(presigned.url).searchParams
      .get("X-Amz-SignedHeaders")
      ?.split(";")
      .sort();

    expect(signedHeaders).toEqual([
      "cache-control",
      "content-disposition",
      "content-type",
      "host",
      "x-amz-checksum-sha256",
    ]);
    expect(
      new URL(presigned.url).searchParams.has("x-amz-checksum-sha256"),
    ).toBe(false);
    expect(presigned.headers).toEqual({
      "Content-Type": "image/webp",
      "Content-Disposition": "inline",
      "Cache-Control": "public, max-age=31536000, immutable",
      "x-amz-checksum-sha256": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    });
  });

  it("omits a request checksum when the caller did not supply one", async () => {
    const driver = createS3Driver({
      endpoint: "https://s3.example.com",
      bucket: "jant-media",
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
      region: "auto",
    });

    const presigned = await driver.presignPut?.("media/test.webp", {
      contentType: "image/webp",
      contentDisposition: "inline",
      cacheControl: "public, max-age=31536000, immutable",
      expiresInSeconds: 900,
    });

    if (!presigned) {
      throw new Error("Expected presigned PUT target");
    }

    // Presigning runs with an empty body, so a default request checksum would
    // pin CRC32-of-nothing to the URL and every real upload would 400.
    const params = new URL(presigned.url).searchParams;
    expect(params.has("x-amz-checksum-crc32")).toBe(false);
    expect(params.has("x-amz-sdk-checksum-algorithm")).toBe(false);
    expect(presigned.headers).toEqual({
      "Content-Type": "image/webp",
      "Content-Disposition": "inline",
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  });
});

describe("createR2Driver", () => {
  it("delegates put to R2 bucket", async () => {
    const mockR2 = {
      put: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
      delete: vi.fn(),
    } as unknown as R2Bucket;

    const driver = createR2Driver(mockR2);
    const body = new ReadableStream();
    await driver.put("media/test.jpg", body, { contentType: "image/jpeg" });

    expect(mockR2.put).toHaveBeenCalledWith("media/test.jpg", body, {
      httpMetadata: { contentType: "image/jpeg" },
    });
  });

  it("delegates put without contentType", async () => {
    const mockR2 = {
      put: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
      delete: vi.fn(),
    } as unknown as R2Bucket;

    const driver = createR2Driver(mockR2);
    await driver.put("media/test.jpg", new ReadableStream());

    expect(mockR2.put).toHaveBeenCalledWith(
      "media/test.jpg",
      expect.any(ReadableStream),
      { httpMetadata: undefined },
    );
  });

  it("delegates get and returns body and contentType", async () => {
    const mockBody = new ReadableStream();
    const mockR2 = {
      put: vi.fn(),
      get: vi.fn().mockResolvedValue({
        body: mockBody,
        httpMetadata: { contentType: "image/jpeg" },
      }),
      delete: vi.fn(),
    } as unknown as R2Bucket;

    const driver = createR2Driver(mockR2);
    const result = await driver.get("media/test.jpg");

    expect(result).not.toBeNull();
    expect(result!.body).toBe(mockBody);
    expect(result!.contentType).toBe("image/jpeg");
  });

  it("returns null when R2 get returns null", async () => {
    const mockR2 = {
      put: vi.fn(),
      get: vi.fn().mockResolvedValue(null),
      delete: vi.fn(),
    } as unknown as R2Bucket;

    const driver = createR2Driver(mockR2);
    const result = await driver.get("nonexistent");
    expect(result).toBeNull();
  });

  it("delegates delete to R2 bucket", async () => {
    const mockR2 = {
      put: vi.fn(),
      get: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as R2Bucket;

    const driver = createR2Driver(mockR2);
    await driver.delete("media/test.jpg");

    expect(mockR2.delete).toHaveBeenCalledWith("media/test.jpg");
  });
});

describe("local storage driver", () => {
  it("returns null when local storage is selected without a path", () => {
    const env = {
      STORAGE_DRIVER: "local",
    } as Bindings;

    expect(createStorageDriver(env)).toBeNull();
  });

  it("stores and retrieves files from the local media root", async () => {
    const rootPath = await createTempDir();
    try {
      const driver = createStorageDriver({
        NODE_SQLITE: {} as Bindings["NODE_SQLITE"],
        STORAGE_DRIVER: "local",
        LOCAL_STORAGE_PATH: rootPath,
      } as Bindings);

      expect(driver).not.toBeNull();
      await driver!.put(
        "media/nested/example.txt",
        new TextEncoder().encode("hello local storage"),
        { contentType: "text/plain" },
      );

      const head = await driver!.head("media/nested/example.txt");
      expect(head).toEqual({
        contentType: "text/plain",
        size: 19,
      });

      const object = await driver!.get("media/nested/example.txt");
      expect(object).not.toBeNull();
      expect(await new Response(object!.body).text()).toBe(
        "hello local storage",
      );
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it("supports multipart uploads for local storage", async () => {
    const rootPath = await createTempDir();
    try {
      const driver = createStorageDriver({
        NODE_SQLITE: {} as Bindings["NODE_SQLITE"],
        STORAGE_DRIVER: "local",
        LOCAL_STORAGE_PATH: rootPath,
      } as Bindings);

      expect(driver).not.toBeNull();
      expect(supportsMultipart(driver!)).toBe(true);
      if (!supportsMultipart(driver!)) {
        throw new Error("Local driver should support multipart uploads.");
      }

      const upload = await driver.createMultipartUpload(
        "media/nested/multipart.txt",
        { contentType: "text/plain" },
      );
      const part1 = await driver.uploadPart(
        upload.key,
        upload.uploadId,
        1,
        new TextEncoder().encode("hello "),
      );
      const part2 = await driver.uploadPart(
        upload.key,
        upload.uploadId,
        2,
        new TextEncoder().encode("multipart"),
      );

      await driver.completeMultipartUpload(upload.key, upload.uploadId, [
        part1,
        part2,
      ]);

      const object = await driver.get(upload.key);
      expect(object).not.toBeNull();
      expect(await new Response(object!.body).text()).toBe("hello multipart");
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});
