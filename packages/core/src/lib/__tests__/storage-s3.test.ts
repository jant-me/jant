/**
 * The S3 driver against a real S3-compatible server.
 *
 * `storage.test.ts` checks the commands the driver builds against a mocked
 * SDK, which cannot tell whether a server accepts them: whether a presigned
 * PUT's signed headers match what the browser sends, whether `CopyObject`
 * keeps or replaces metadata, whether a key with spaces survives the copy
 * source encoding. These run the driver and the media trash against one.
 *
 * Skipped unless `S3_SMOKE_ENDPOINT` is set. CI points it at a RustFS
 * container; locally:
 *
 *   docker run -d --name jant-s3-smoke -p 59000:9000 \
 *     -e RUSTFS_ACCESS_KEY=jantsmoke -e RUSTFS_SECRET_KEY=jantsmoke-secret \
 *     rustfs/rustfs:1.0.0
 *   S3_SMOKE_ENDPOINT=http://127.0.0.1:59000 \
 *   S3_SMOKE_ACCESS_KEY_ID=jantsmoke S3_SMOKE_SECRET_ACCESS_KEY=jantsmoke-secret \
 *     pnpm exec vitest run src/lib/__tests__/storage-s3.test.ts
 */

import { createHash, randomUUID } from "node:crypto";
import {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "../../__tests__/helpers/app.js";
import { DEFAULT_TEST_SITE_ID } from "../../__tests__/helpers/db.js";
import { createS3Driver, type StorageDriver } from "../storage.js";

const endpoint = process.env.S3_SMOKE_ENDPOINT ?? "";
const accessKeyId = process.env.S3_SMOKE_ACCESS_KEY_ID ?? "";
const secretAccessKey = process.env.S3_SMOKE_SECRET_ACCESS_KEY ?? "";
const bucket = process.env.S3_SMOKE_BUCKET ?? "jant-smoke";
const region = "us-east-1";

async function ensureBucket(): Promise<void> {
  const client = new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  } finally {
    client.destroy();
  }
}

async function readText(
  object: { body: ReadableStream } | null,
): Promise<string | null> {
  return object ? new Response(object.body).text() : null;
}

describe.skipIf(!endpoint)("S3 driver against a real server", () => {
  let storage: StorageDriver;
  // One prefix per run, so runs against a shared bucket never see each other.
  const prefix = `smoke/${randomUUID()}`;

  beforeAll(async () => {
    await ensureBucket();
    storage = createS3Driver({
      endpoint,
      bucket,
      accessKeyId,
      secretAccessKey,
      region,
    });
  });

  it("writes, reads, ranges, lists, and deletes an object", async () => {
    const key = `${prefix}/notes/a file é.txt`;
    await storage.put(key, new TextEncoder().encode("hello world"), {
      contentType: "text/plain; charset=utf-8",
      cacheControl: "public, max-age=60",
      contentDisposition: 'inline; filename="a.txt"',
    });

    expect(await storage.head(key)).toEqual({
      contentType: "text/plain; charset=utf-8",
      cacheControl: "public, max-age=60",
      contentDisposition: 'inline; filename="a.txt"',
      size: 11,
    });
    expect(await readText(await storage.get(key))).toBe("hello world");
    expect(
      await readText(
        await storage.get(key, { range: { offset: 6, length: 5 } }),
      ),
    ).toBe("world");
    expect(await storage.listAllKeys?.(`${prefix}/notes/`)).toEqual([key]);

    await storage.delete(key);
    expect(await storage.head(key)).toBeNull();
    expect(await storage.get(key)).toBeNull();
  });

  it("copies an object, keeping its metadata or replacing it", async () => {
    // The copy source travels in a header, so a key with characters that
    // mean something in a URL or fall outside ASCII has to be encoded.
    const source = `${prefix}/copy/café 1+1=2 50%.webp`;
    await storage.put(source, new Uint8Array([1, 2, 3]), {
      contentType: "image/webp",
      cacheControl: "public, max-age=31536000, immutable",
    });

    const kept = `${prefix}/copy/kept.webp`;
    await storage.copy?.(source, kept);
    expect(await storage.head(kept)).toMatchObject({
      contentType: "image/webp",
      cacheControl: "public, max-age=31536000, immutable",
      size: 3,
    });

    const replaced = `${prefix}/copy/replaced.bin`;
    await storage.copy?.(source, replaced, {
      contentType: "application/octet-stream",
    });
    expect(await storage.head(replaced)).toMatchObject({
      contentType: "application/octet-stream",
      size: 3,
    });
  });

  it("accepts an upload to a presigned PUT with the headers it returns", async () => {
    const key = `${prefix}/presigned/photo.jpg`;
    const body = new TextEncoder().encode("jpeg bytes");
    const target = await storage.presignPut?.(key, {
      contentType: "image/jpeg",
      cacheControl: "public, max-age=31536000, immutable",
      checksumSha256: createHash("sha256").update(body).digest("base64"),
      expiresInSeconds: 300,
    });
    if (!target) throw new Error("The S3 driver presigns PUTs");

    const res = await fetch(target.url, {
      method: target.method,
      headers: target.headers,
      body,
    });
    expect(res.status, await res.text()).toBe(200);
    expect(await storage.head(key)).toMatchObject({
      contentType: "image/jpeg",
      size: body.length,
    });

    // The checksum is signed, so different bytes are refused.
    const tampered = await fetch(target.url, {
      method: target.method,
      headers: target.headers,
      body: new TextEncoder().encode("other bytes"),
    });
    expect(tampered.ok).toBe(false);
  });

  it("moves a deleted file to trash, frees its key, and purges it after the window", async () => {
    const { services } = createTestApp({ storage });
    const key = `${prefix}/media/clip.mp4`;
    const posterKey = `${prefix}/media/clip-poster.jpg`;
    await storage.put(key, new Uint8Array([1]), { contentType: "video/mp4" });
    await storage.put(posterKey, new Uint8Array([2]), {
      contentType: "image/jpeg",
    });
    const clip = await services.media.create({
      filename: "clip.mp4",
      originalName: "clip.mp4",
      mimeType: "video/mp4",
      size: 1,
      storageKey: key,
      posterKey,
      provider: "s3",
    });

    expect(await services.media.delete(clip.id, storage)).toBe(true);

    expect(await storage.head(key)).toBeNull();
    expect(await storage.head(posterKey)).toBeNull();
    const trashPrefix = `trash/${DEFAULT_TEST_SITE_ID}/`;
    const trashed = (await storage.listAllKeys?.(trashPrefix)) ?? [];
    const ours = trashed.filter(
      (trashKey) =>
        trashKey.endsWith("/clip.mp4") || trashKey.endsWith("/clip-poster.jpg"),
    );
    expect(ours).toHaveLength(2);
    for (const trashKey of ours) {
      expect(await storage.head(trashKey)).not.toBeNull();
    }

    const oneDay = 24 * 60 * 60;
    const soon = Math.floor(Date.now() / 1000) + oneDay;
    expect(
      await services.media.purgeDueStorageObjects(
        { before: soon, limit: 10, provider: "s3" },
        storage,
      ),
    ).toBe(0);

    const afterWindow = Math.floor(Date.now() / 1000) + 31 * oneDay;
    expect(
      await services.media.purgeDueStorageObjects(
        { before: afterWindow, limit: 10, provider: "s3" },
        storage,
      ),
    ).toBe(2);
    for (const trashKey of ours) {
      expect(await storage.head(trashKey)).toBeNull();
    }
  });
});
