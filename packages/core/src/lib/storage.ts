/**
 * Storage Driver Abstraction
 *
 * Provides a common interface for file storage with R2 and S3-compatible backends.
 */

import type { Bindings } from "../types.js";
import {
  getConfiguredStorageDriver,
  getEnvString,
  getLocalStoragePath,
} from "./env.js";
import { now } from "./time.js";

export interface StorageObjectOptions {
  contentType?: string;
  contentDisposition?: string;
  cacheControl?: string;
}

export interface StorageObjectInfo extends StorageObjectOptions {
  size?: number;
}

export interface PresignedPutOptions extends StorageObjectOptions {
  checksumSha256?: string;
  expiresInSeconds: number;
}

export interface PresignedPutTarget {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: number;
}

/** Tracks an in-progress multipart upload */
export interface MultipartUploadSession {
  uploadId: string;
  key: string;
}

/** Represents a successfully uploaded part */
export interface UploadedPart {
  partNumber: number;
  etag: string;
}

/**
 * Common interface for storage operations.
 *
 * Both R2 and S3-compatible drivers implement this interface,
 * allowing the rest of the application to be storage-agnostic.
 */
export interface StorageDriver {
  /** Upload a file to storage */
  put(
    key: string,
    body: ReadableStream | Uint8Array,
    opts?: StorageObjectOptions,
  ): Promise<void>;

  /** Retrieve a file (or byte range) from storage. Returns null if not found. */
  get(
    key: string,
    opts?: { range?: { offset: number; length: number } },
  ): Promise<({ body: ReadableStream } & StorageObjectInfo) | null>;

  /** Retrieve file metadata without downloading the body. Returns null if not found. */
  head(key: string): Promise<StorageObjectInfo | null>;

  /** Delete a file from storage */
  delete(key: string): Promise<void>;

  /** List all object keys in storage. Used by admin maintenance tasks. */
  listAllKeys?(prefix?: string): Promise<string[]>;

  /** Copy a file within the same storage backend. */
  copy?(
    sourceKey: string,
    destKey: string,
    opts?: StorageObjectOptions,
  ): Promise<void>;

  /** Create a browser-usable signed PUT target. */
  presignPut?(
    key: string,
    opts: PresignedPutOptions,
  ): Promise<PresignedPutTarget>;

  /** Start a multipart upload (optional — R2 only) */
  createMultipartUpload?(
    key: string,
    opts?: StorageObjectOptions,
  ): Promise<MultipartUploadSession>;

  /** Upload a single part of a multipart upload */
  uploadPart?(
    key: string,
    uploadId: string,
    partNumber: number,
    body: ReadableStream | ArrayBuffer | Uint8Array,
  ): Promise<UploadedPart>;

  /** Finalize a multipart upload by combining all parts */
  completeMultipartUpload?(
    key: string,
    uploadId: string,
    parts: UploadedPart[],
  ): Promise<void>;

  /** Cancel a multipart upload and discard uploaded parts */
  abortMultipartUpload?(key: string, uploadId: string): Promise<void>;
}

type StorageRuntime = "cloudflare" | "node" | "unknown";

function resolveStorageRuntime(env: Bindings): StorageRuntime {
  if (env.NODE_DATABASE || env.NODE_SQLITE) {
    return "node";
  }

  if (env.DB || env.R2) {
    return "cloudflare";
  }

  return "unknown";
}

function assertSupportedStorageDriver(env: Bindings, driver: string): void {
  const runtime = resolveStorageRuntime(env);

  if (runtime === "node" && driver === "r2") {
    throw new Error(
      "Node runtime does not support R2 storage. Use STORAGE_DRIVER=local or STORAGE_DRIVER=s3.",
    );
  }

  if (runtime === "cloudflare" && driver === "local") {
    throw new Error(
      "Cloudflare runtime does not support local storage. Use the default R2 storage or set STORAGE_DRIVER=s3.",
    );
  }
}

/**
 * Type guard that checks whether a storage driver supports multipart uploads.
 *
 * @param driver - The storage driver to check
 * @returns true if all multipart methods are present
 */
export function supportsMultipart(
  driver: StorageDriver,
): driver is StorageDriver &
  Required<
    Pick<
      StorageDriver,
      | "createMultipartUpload"
      | "uploadPart"
      | "completeMultipartUpload"
      | "abortMultipartUpload"
    >
  > {
  return (
    typeof driver.createMultipartUpload === "function" &&
    typeof driver.uploadPart === "function" &&
    typeof driver.completeMultipartUpload === "function" &&
    typeof driver.abortMultipartUpload === "function"
  );
}

export function supportsPresignedPut(
  driver: StorageDriver,
): driver is StorageDriver & Required<Pick<StorageDriver, "presignPut">> {
  return typeof driver.presignPut === "function";
}

export function supportsCopy(
  driver: StorageDriver,
): driver is StorageDriver & Required<Pick<StorageDriver, "copy">> {
  return typeof driver.copy === "function";
}

/**
 * Creates an R2 storage driver that delegates to a Cloudflare R2 bucket binding.
 *
 * @param r2 - The R2 bucket binding from the Cloudflare Workers environment
 * @returns A StorageDriver backed by R2
 */
export function createR2Driver(r2: R2Bucket): StorageDriver {
  return {
    async put(key, body, opts) {
      await r2.put(key, body, {
        httpMetadata:
          opts?.contentType || opts?.contentDisposition || opts?.cacheControl
            ? {
                contentType: opts?.contentType,
                contentDisposition: opts?.contentDisposition,
                cacheControl: opts?.cacheControl,
              }
            : undefined,
      });
    },

    async get(key, opts) {
      const object = await r2.get(
        key,
        opts?.range ? { range: opts.range } : undefined,
      );
      if (!object) return null;
      return {
        body: object.body,
        contentType: object.httpMetadata?.contentType ?? undefined,
        contentDisposition:
          object.httpMetadata?.contentDisposition ?? undefined,
        cacheControl: object.httpMetadata?.cacheControl ?? undefined,
        size: object.size,
      };
    },

    async head(key) {
      const object = await r2.head(key);
      if (!object) return null;
      return {
        contentType: object.httpMetadata?.contentType ?? undefined,
        contentDisposition:
          object.httpMetadata?.contentDisposition ?? undefined,
        cacheControl: object.httpMetadata?.cacheControl ?? undefined,
        size: object.size,
      };
    },

    async delete(key) {
      await r2.delete(key);
    },

    async listAllKeys(prefix) {
      const keys: string[] = [];
      let cursor: string | undefined;

      for (;;) {
        const page = await r2.list({
          cursor,
          limit: 1000,
          prefix: prefix || undefined,
        });
        keys.push(...page.objects.map((object) => object.key));
        if (!page.truncated) {
          return keys;
        }
        cursor = page.cursor;
      }
    },

    async createMultipartUpload(key, opts) {
      const upload = await r2.createMultipartUpload(key, {
        httpMetadata:
          opts?.contentType || opts?.contentDisposition || opts?.cacheControl
            ? {
                contentType: opts?.contentType,
                contentDisposition: opts?.contentDisposition,
                cacheControl: opts?.cacheControl,
              }
            : undefined,
      });
      return { uploadId: upload.uploadId, key: upload.key };
    },

    async uploadPart(key, uploadId, partNumber, body) {
      const upload = r2.resumeMultipartUpload(key, uploadId);
      const part = await upload.uploadPart(partNumber, body);
      return { partNumber: part.partNumber, etag: part.etag };
    },

    async completeMultipartUpload(key, uploadId, parts) {
      const upload = r2.resumeMultipartUpload(key, uploadId);
      await upload.complete(parts);
    },

    async abortMultipartUpload(key, uploadId) {
      const upload = r2.resumeMultipartUpload(key, uploadId);
      await upload.abort();
    },
  };
}

/**
 * Configuration for the S3-compatible storage driver.
 */
export interface S3DriverConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

interface LocalDriverConfig {
  rootPath: string;
}

/** Constructor for an S3 command object */
interface S3CommandCtor<TInput> {
  new (input: TInput): unknown;
}

/** Input for PutObject */
interface PutObjectInput {
  Bucket: string;
  Key: string;
  Body?: Uint8Array;
  ContentType?: string;
  ContentDisposition?: string;
  CacheControl?: string;
  ChecksumSHA256?: string;
}

/** Input for GetObject */
interface GetObjectInput {
  Bucket: string;
  Key: string;
  Range?: string;
}

/** Input for DeleteObject */
interface ObjectKeyInput {
  Bucket: string;
  Key: string;
}

/** Subset of GetObjectOutput used by the S3 driver */
interface S3GetObjectOutput {
  Body?: { transformToWebStream(): ReadableStream };
  ContentType?: string;
  ContentDisposition?: string;
  CacheControl?: string;
  ContentLength?: number;
}

/** Input for HeadObject */
interface HeadObjectInput {
  Bucket: string;
  Key: string;
}

/** Subset of HeadObjectOutput used by the S3 driver */
interface S3HeadObjectOutput {
  ContentType?: string;
  ContentDisposition?: string;
  CacheControl?: string;
  ContentLength?: number;
}

interface CopyObjectInput {
  Bucket: string;
  Key: string;
  CopySource: string;
  MetadataDirective?: "COPY" | "REPLACE";
  ContentType?: string;
  ContentDisposition?: string;
  CacheControl?: string;
}

interface ListObjectsV2Input {
  Bucket: string;
  ContinuationToken?: string;
  MaxKeys?: number;
  Prefix?: string;
}

interface S3ListObjectsV2Output {
  Contents?: Array<{ Key?: string }>;
  IsTruncated?: boolean;
  NextContinuationToken?: string;
}

interface S3SignedUrlOptions {
  expiresIn: number;
  signableHeaders?: Set<string>;
  unhoistableHeaders?: Set<string>;
}

/** Lazy-loaded S3 client bundle */
interface S3ClientBundle {
  send: (command: unknown) => Promise<unknown>;
  getSignedUrl: (
    client: unknown,
    command: unknown,
    options: S3SignedUrlOptions,
  ) => Promise<string>;
  client: unknown;
  PutObjectCommand: S3CommandCtor<PutObjectInput>;
  GetObjectCommand: S3CommandCtor<GetObjectInput>;
  DeleteObjectCommand: S3CommandCtor<ObjectKeyInput>;
  HeadObjectCommand: S3CommandCtor<HeadObjectInput>;
  ListObjectsV2Command: S3CommandCtor<ListObjectsV2Input>;
  CopyObjectCommand: S3CommandCtor<CopyObjectInput>;
  bucket: string;
}

/**
 * Creates an S3-compatible storage driver using the AWS SDK.
 *
 * Supports any S3-compatible service: AWS S3, Backblaze B2, MinIO, etc.
 * Uses path-style addressing for non-AWS endpoints.
 *
 * @param config - S3 connection configuration
 * @returns A StorageDriver backed by S3
 */
export function createS3Driver(config: S3DriverConfig): StorageDriver {
  // Lazy-load the AWS SDK to avoid bundling it when using R2
  let clientPromise: Promise<S3ClientBundle> | null = null;

  function getClient(): Promise<S3ClientBundle> {
    if (!clientPromise) {
      clientPromise = Promise.all([
        import("@aws-sdk/client-s3"),
        import("@aws-sdk/s3-request-presigner"),
      ]).then(([sdk, presigner]) => {
        const forcePathStyle = !config.endpoint.includes("amazonaws.com");
        const client = new sdk.S3Client({
          endpoint: config.endpoint,
          region: config.region,
          credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          },
          forcePathStyle,
          // S3-compatible providers such as R2 can return whole-object checksum
          // headers on ranged GET responses, which breaks the SDK's automatic
          // response validation for partial reads. Jant already validates
          // uploaded object checksums during finalize, so only enable response
          // checksum verification when a request explicitly asks for it.
          responseChecksumValidation: "WHEN_REQUIRED",
          // Presigning runs with an empty body, so the SDK's default
          // "WHEN_SUPPORTED" request checksums bake CRC32-of-nothing
          // (x-amz-checksum-crc32=AAAAAA==) into every presigned PUT URL. The
          // browser then uploads real bytes and the storage provider rejects
          // the mismatch. Only send a request checksum when the caller asked
          // for one (presignPut passes ChecksumSHA256 explicitly).
          requestChecksumCalculation: "WHEN_REQUIRED",
        });
        return {
          send: (cmd: unknown) => client.send(cmd as never),
          getSignedUrl: (
            awsClient: unknown,
            command: unknown,
            options: S3SignedUrlOptions,
          ) =>
            presigner.getSignedUrl(
              awsClient as Parameters<typeof presigner.getSignedUrl>[0],
              command as Parameters<typeof presigner.getSignedUrl>[1],
              options,
            ),
          client,
          PutObjectCommand: sdk.PutObjectCommand,
          GetObjectCommand: sdk.GetObjectCommand,
          DeleteObjectCommand: sdk.DeleteObjectCommand,
          HeadObjectCommand: sdk.HeadObjectCommand,
          ListObjectsV2Command: sdk.ListObjectsV2Command,
          CopyObjectCommand: sdk.CopyObjectCommand,
          bucket: config.bucket,
        };
      });
    }
    return clientPromise;
  }

  return {
    async put(key, body, opts) {
      const s3 = await getClient();

      // Buffer the stream to Uint8Array for the S3 SDK
      let bodyBytes: Uint8Array;
      if (body instanceof Uint8Array) {
        bodyBytes = body;
      } else {
        const reader = body.getReader();
        const chunks: Uint8Array[] = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        let totalLength = 0;
        for (const chunk of chunks) totalLength += chunk.length;
        bodyBytes = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          bodyBytes.set(chunk, offset);
          offset += chunk.length;
        }
      }

      const command = new s3.PutObjectCommand({
        Bucket: s3.bucket,
        Key: key,
        Body: bodyBytes,
        ContentType: opts?.contentType,
        ContentDisposition: opts?.contentDisposition,
        CacheControl: opts?.cacheControl,
      });
      await s3.send(command);
    },

    async get(key, opts) {
      const s3 = await getClient();
      try {
        const command = new s3.GetObjectCommand({
          Bucket: s3.bucket,
          Key: key,
          Range: opts?.range
            ? `bytes=${opts.range.offset}-${opts.range.offset + opts.range.length - 1}`
            : undefined,
        });
        const response = (await s3.send(command)) as S3GetObjectOutput;
        if (!response.Body) return null;
        return {
          body: response.Body.transformToWebStream(),
          contentType: response.ContentType ?? undefined,
          contentDisposition: response.ContentDisposition ?? undefined,
          cacheControl: response.CacheControl ?? undefined,
          size: response.ContentLength ?? undefined,
        };
      } catch (err: unknown) {
        // NoSuchKey → return null instead of throwing
        if (
          err instanceof Error &&
          (err.name === "NoSuchKey" || err.name === "NotFound")
        ) {
          return null;
        }
        throw err;
      }
    },

    async head(key) {
      const s3 = await getClient();
      try {
        const command = new s3.HeadObjectCommand({
          Bucket: s3.bucket,
          Key: key,
        });
        const response = (await s3.send(command)) as S3HeadObjectOutput;
        return {
          contentType: response.ContentType ?? undefined,
          contentDisposition: response.ContentDisposition ?? undefined,
          cacheControl: response.CacheControl ?? undefined,
          size: response.ContentLength ?? undefined,
        };
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          (err.name === "NotFound" || err.name === "NoSuchKey")
        ) {
          return null;
        }
        throw err;
      }
    },

    async delete(key) {
      const s3 = await getClient();
      const command = new s3.DeleteObjectCommand({
        Bucket: s3.bucket,
        Key: key,
      });
      await s3.send(command);
    },

    async listAllKeys(prefix) {
      const s3 = await getClient();
      const keys: string[] = [];
      let continuationToken: string | undefined;

      for (;;) {
        const command = new s3.ListObjectsV2Command({
          Bucket: s3.bucket,
          ContinuationToken: continuationToken,
          MaxKeys: 1000,
          Prefix: prefix || undefined,
        });
        const response = (await s3.send(command)) as S3ListObjectsV2Output;
        keys.push(
          ...(response.Contents ?? [])
            .map((entry) => entry.Key)
            .filter((key): key is string => typeof key === "string"),
        );

        if (!response.IsTruncated || !response.NextContinuationToken) {
          return keys;
        }
        continuationToken = response.NextContinuationToken;
      }
    },

    async copy(sourceKey, destKey, opts) {
      const s3 = await getClient();
      const command = new s3.CopyObjectCommand({
        Bucket: s3.bucket,
        Key: destKey,
        CopySource: `${s3.bucket}/${sourceKey.split("/").map(encodeURIComponent).join("/")}`,
        MetadataDirective:
          opts?.contentType || opts?.contentDisposition || opts?.cacheControl
            ? "REPLACE"
            : "COPY",
        ContentType: opts?.contentType,
        ContentDisposition: opts?.contentDisposition,
        CacheControl: opts?.cacheControl,
      });
      await s3.send(command);
    },

    async presignPut(key, opts) {
      const s3 = await getClient();
      const command = new s3.PutObjectCommand({
        Bucket: s3.bucket,
        Key: key,
        ContentType: opts.contentType,
        ContentDisposition: opts.contentDisposition,
        CacheControl: opts.cacheControl,
        ChecksumSHA256: opts.checksumSha256,
      });
      const signableHeaders = new Set<string>();
      if (opts.contentType) {
        signableHeaders.add("content-type");
      }
      if (opts.contentDisposition) {
        signableHeaders.add("content-disposition");
      }
      if (opts.cacheControl) {
        signableHeaders.add("cache-control");
      }
      const url = await s3.getSignedUrl(s3.client, command, {
        expiresIn: opts.expiresInSeconds,
        signableHeaders: signableHeaders.size > 0 ? signableHeaders : undefined,
        unhoistableHeaders: opts.checksumSha256
          ? new Set(["x-amz-checksum-sha256"])
          : undefined,
      });
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
        method: "PUT",
        headers,
        expiresAt: now() + opts.expiresInSeconds,
      };
    },
  };
}

interface LocalMultipartState {
  contentType?: string;
  contentDisposition?: string;
  cacheControl?: string;
  key: string;
}

interface LocalMetaFile {
  contentType?: string;
  contentDisposition?: string;
  cacheControl?: string;
}

interface NodeFsBundle {
  appendFile: (path: string, data: Uint8Array) => Promise<void>;
  createHash: (algorithm: string) => {
    update: (data: Uint8Array) => void;
    digest: (encoding: "hex") => string;
  };
  createReadStream: (
    path: string,
    options?: { start?: number; end?: number },
  ) => unknown;
  createWriteStream: (path: string) => unknown;
  dirname: (path: string) => string;
  mkdir: (path: string, options?: { recursive?: boolean }) => Promise<unknown>;
  readFile: (
    path: string,
    encoding?: "utf-8" | "utf8",
  ) => Promise<string | Uint8Array>;
  readdir: (path: string) => Promise<string[]>;
  rename: (from: string, to: string) => Promise<void>;
  resolve: (...paths: string[]) => string;
  rm: (
    path: string,
    options?: { force?: boolean; recursive?: boolean },
  ) => Promise<void>;
  stat: (path: string) => Promise<{ size: number; isDirectory(): boolean }>;
  writeFile: (path: string, data: string | Uint8Array) => Promise<unknown>;
  Readable: {
    fromWeb(stream: ReadableStream): unknown;
    toWeb(stream: unknown): ReadableStream;
  };
  pipeline: (...streams: unknown[]) => Promise<void>;
  randomUUID: () => string;
}

let nodeFsBundlePromise: Promise<NodeFsBundle> | null = null;

async function getNodeFsBundle(): Promise<NodeFsBundle> {
  if (!nodeFsBundlePromise) {
    nodeFsBundlePromise = Promise.all([
      import("node:crypto"),
      import("node:fs"),
      import("node:fs/promises"),
      import("node:path"),
      import("node:stream"),
      import("node:stream/promises"),
    ]).then(
      ([crypto, fs, fsPromises, path, stream, streamPromises]) =>
        ({
          appendFile: fsPromises.appendFile,
          createHash: crypto.createHash,
          createReadStream: fs.createReadStream,
          createWriteStream: fs.createWriteStream,
          dirname: path.dirname,
          mkdir: fsPromises.mkdir,
          readFile: fsPromises.readFile,
          readdir: fsPromises.readdir,
          rename: fsPromises.rename,
          resolve: path.resolve,
          rm: fsPromises.rm,
          stat: fsPromises.stat,
          writeFile: fsPromises.writeFile,
          Readable: stream.Readable,
          pipeline: streamPromises.pipeline,
          randomUUID: crypto.randomUUID,
        }) as unknown as NodeFsBundle,
    );
  }

  return nodeFsBundlePromise as Promise<NodeFsBundle>;
}

function ensureSafeStorageKey(key: string) {
  if (!key || key.startsWith("/") || key.includes("..")) {
    throw new Error("Invalid storage key.");
  }
}

async function resolveLocalPath(
  rootPath: string,
  key: string,
): Promise<string> {
  ensureSafeStorageKey(key);
  const node = await getNodeFsBundle();
  const root = node.resolve(rootPath);
  const target = node.resolve(root, key);
  if (target !== root && !target.startsWith(root + "/")) {
    throw new Error("Storage key resolves outside the configured root path.");
  }
  return target;
}

async function writeLocalBody(
  filePath: string,
  body: ReadableStream | Uint8Array | ArrayBuffer,
) {
  const node = await getNodeFsBundle();
  await node.mkdir(node.dirname(filePath), { recursive: true });

  if (body instanceof Uint8Array) {
    await node.writeFile(filePath, body);
    return;
  }

  if (body instanceof ArrayBuffer) {
    await node.writeFile(filePath, new Uint8Array(body));
    return;
  }

  await node.pipeline(
    node.Readable.fromWeb(body as ReadableStream),
    node.createWriteStream(filePath),
  );
}

async function writeLocalMeta(filePath: string, meta: LocalMetaFile) {
  const node = await getNodeFsBundle();
  await node.writeFile(`${filePath}.meta.json`, JSON.stringify(meta));
}

async function readLocalMeta(filePath: string): Promise<LocalMetaFile | null> {
  const node = await getNodeFsBundle();
  try {
    const raw = await node.readFile(`${filePath}.meta.json`, "utf-8");
    return JSON.parse(raw as string) as LocalMetaFile;
  } catch {
    return null;
  }
}

async function hashLocalFile(filePath: string): Promise<string> {
  const node = await getNodeFsBundle();
  const bytes = await node.readFile(filePath);
  const hash = node.createHash("sha1");
  hash.update(
    typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes,
  );
  return hash.digest("hex");
}

export function createLocalDriver(config: LocalDriverConfig): StorageDriver {
  async function getMultipartDir(uploadId: string): Promise<string> {
    const node = await getNodeFsBundle();
    return node.resolve(config.rootPath, ".multipart", uploadId);
  }

  async function getMultipartStatePath(uploadId: string): Promise<string> {
    const dir = await getMultipartDir(uploadId);
    const node = await getNodeFsBundle();
    return node.resolve(dir, "upload.json");
  }

  async function readMultipartState(
    uploadId: string,
  ): Promise<LocalMultipartState> {
    const node = await getNodeFsBundle();
    const statePath = await getMultipartStatePath(uploadId);
    const raw = await node.readFile(statePath, "utf-8");
    return JSON.parse(raw as string) as LocalMultipartState;
  }

  return {
    async put(key, body, opts) {
      const filePath = await resolveLocalPath(config.rootPath, key);
      await writeLocalBody(filePath, body);
      await writeLocalMeta(filePath, {
        contentType: opts?.contentType,
        contentDisposition: opts?.contentDisposition,
        cacheControl: opts?.cacheControl,
      });
    },

    async get(key, opts) {
      const node = await getNodeFsBundle();
      const filePath = await resolveLocalPath(config.rootPath, key);
      try {
        const stat = await node.stat(filePath);
        const meta = await readLocalMeta(filePath);
        const stream = node.createReadStream(filePath, {
          start: opts?.range?.offset,
          end: opts?.range
            ? opts.range.offset + opts.range.length - 1
            : undefined,
        });
        return {
          body: node.Readable.toWeb(stream),
          contentType: meta?.contentType,
          contentDisposition: meta?.contentDisposition,
          cacheControl: meta?.cacheControl,
          size: stat.size,
        };
      } catch {
        return null;
      }
    },

    async head(key) {
      const node = await getNodeFsBundle();
      const filePath = await resolveLocalPath(config.rootPath, key);
      try {
        const stat = await node.stat(filePath);
        const meta = await readLocalMeta(filePath);
        return {
          contentType: meta?.contentType,
          contentDisposition: meta?.contentDisposition,
          cacheControl: meta?.cacheControl,
          size: stat.size,
        };
      } catch {
        return null;
      }
    },

    async delete(key) {
      const node = await getNodeFsBundle();
      const filePath = await resolveLocalPath(config.rootPath, key);
      await node.rm(filePath, { force: true });
      await node.rm(`${filePath}.meta.json`, { force: true });
    },

    async listAllKeys(prefix) {
      const node = await getNodeFsBundle();
      const root = node.resolve(config.rootPath);
      const keys: string[] = [];

      async function walk(dir: string) {
        const entries = await node.readdir(dir);

        for (const entry of entries) {
          const fullPath = node.resolve(dir, entry);
          const relativePath = fullPath
            .slice(root.length + 1)
            .replace(/\\/g, "/");

          if (relativePath.startsWith(".multipart/")) {
            continue;
          }

          try {
            const stat = await node.stat(fullPath);
            if (stat.isDirectory()) {
              await walk(fullPath);
              continue;
            }
          } catch {
            continue;
          }

          if (relativePath.endsWith(".meta.json")) {
            continue;
          }

          if (!prefix || relativePath.startsWith(prefix)) {
            keys.push(relativePath);
          }
        }
      }

      await walk(root);
      keys.sort();
      return keys;
    },

    async createMultipartUpload(key, opts) {
      const node = await getNodeFsBundle();
      const uploadId = node.randomUUID();
      const dir = await getMultipartDir(uploadId);
      await node.mkdir(dir, { recursive: true });
      await node.writeFile(
        await getMultipartStatePath(uploadId),
        JSON.stringify({
          key,
          contentType: opts?.contentType,
          contentDisposition: opts?.contentDisposition,
          cacheControl: opts?.cacheControl,
        } satisfies LocalMultipartState),
      );
      return { uploadId, key };
    },

    async uploadPart(key, uploadId, partNumber, body) {
      const node = await getNodeFsBundle();
      const state = await readMultipartState(uploadId);
      if (state.key !== key) {
        throw new Error("Multipart upload key mismatch.");
      }

      const partPath = node.resolve(
        await getMultipartDir(uploadId),
        `${partNumber}.part`,
      );
      await writeLocalBody(partPath, body);
      const etag = await hashLocalFile(partPath);
      return { partNumber, etag };
    },

    async completeMultipartUpload(key, uploadId, parts) {
      const node = await getNodeFsBundle();
      const state = await readMultipartState(uploadId);
      if (state.key !== key) {
        throw new Error("Multipart upload key mismatch.");
      }

      const finalPath = await resolveLocalPath(config.rootPath, key);
      const tempPath = `${finalPath}.uploading`;
      await node.mkdir(node.dirname(finalPath), { recursive: true });
      await node.rm(tempPath, { force: true });

      for (const part of [...parts].sort(
        (a, b) => a.partNumber - b.partNumber,
      )) {
        const partPath = node.resolve(
          await getMultipartDir(uploadId),
          `${part.partNumber}.part`,
        );
        const bytes = await node.readFile(partPath);
        await node.appendFile(
          tempPath,
          typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes,
        );
      }

      await node.rename(tempPath, finalPath);
      await writeLocalMeta(finalPath, {
        contentType: state.contentType,
        contentDisposition: state.contentDisposition,
        cacheControl: state.cacheControl,
      });
      await node.rm(await getMultipartDir(uploadId), {
        force: true,
        recursive: true,
      });
    },

    async abortMultipartUpload(_key, uploadId) {
      const node = await getNodeFsBundle();
      await node.rm(await getMultipartDir(uploadId), {
        force: true,
        recursive: true,
      });
    },
  };
}

/**
 * Creates the appropriate storage driver based on environment configuration.
 *
 * Returns `null` if no storage is configured (no R2 binding and no S3 config).
 *
 * @param env - The Cloudflare Workers environment bindings
 * @returns A StorageDriver instance or null
 *
 * @example
 * ```ts
 * const storage = createStorageDriver(c.env);
 * if (storage) {
 *   await storage.put("media/file.jpg", stream, { contentType: "image/jpeg" });
 * }
 * ```
 */
export function createStorageDriver(env: Bindings): StorageDriver | null {
  const driver = getConfiguredStorageDriver(env);
  assertSupportedStorageDriver(env, driver);

  if (driver === "s3") {
    const endpoint = getEnvString(env, "S3_ENDPOINT") || "";
    const bucket = getEnvString(env, "S3_BUCKET") || "";
    const accessKeyId = getEnvString(env, "S3_ACCESS_KEY_ID") || "";
    const secretAccessKey = getEnvString(env, "S3_SECRET_ACCESS_KEY") || "";
    const region = getEnvString(env, "S3_REGION") || "auto";

    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      return null;
    }
    return createS3Driver({
      endpoint,
      bucket,
      accessKeyId,
      secretAccessKey,
      region,
    });
  }

  if (driver === "local") {
    const rootPath = getLocalStoragePath(env) || "";
    if (!rootPath) {
      return null;
    }
    return createLocalDriver({ rootPath });
  }

  // Default: R2
  if (!env.R2) return null;
  return createR2Driver(env.R2);
}
