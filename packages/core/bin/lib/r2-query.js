import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parseWranglerFailure } from "./d1-query.js";
import { resolveWranglerR2BucketName } from "./wrangler-config.js";
import { runLocalWrangler } from "./wrangler-cli.js";

const DEFAULT_RETRY_ATTEMPTS = 4;
const DEFAULT_RETRY_DELAY_MS = 500;

function getR2Flag(runtime) {
  return runtime === "d1-remote" ? "--remote" : "--local";
}

function appendWranglerContext(args, options = {}) {
  if (options.configPath) {
    args.push("--config", options.configPath);
  }

  if (options.env) {
    args.push("--env", options.env);
  }

  if (options.persistTo) {
    args.push("--persist-to", options.persistTo);
  }

  return args;
}

function sleepSync(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return;
  }

  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function isRetryableWranglerR2Failure(output, error) {
  const combined = `${output ?? ""}\n${error?.message ?? ""}`.toLowerCase();
  return [
    "timed out",
    "network connection lost",
    "fetch failed",
    "socket hang up",
    "econnreset",
    "etimedout",
    "temporarily unavailable",
    "temporary failure",
  ].some((fragment) => combined.includes(fragment));
}

function runWrangler(args, options = {}) {
  const retryAttempts = Math.max(
    1,
    Number(options.retryAttempts ?? DEFAULT_RETRY_ATTEMPTS),
  );
  const retryDelayMs = Math.max(
    0,
    Number(options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS),
  );

  for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
    try {
      return runLocalWrangler(args, options);
    } catch (error) {
      const output = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
      const wranglerError = parseWranglerFailure(error);
      const retryable = isRetryableWranglerR2Failure(output, error);

      if (retryable && attempt < retryAttempts) {
        console.warn(
          `Transient Wrangler R2 failure (${attempt}/${retryAttempts}) for ${args.slice(0, 4).join(" ")}. Retrying...`,
        );
        sleepSync(retryDelayMs * attempt);
        continue;
      }

      if (wranglerError) {
        throw new Error(`Wrangler error: ${wranglerError}`);
      }
      throw new Error(output || error.message, { cause: error });
    }
  }
}

function resolveBucketName(options = {}) {
  return (
    options.bucket ||
    resolveWranglerR2BucketName({
      binding: options.bucketBinding,
      configPath: options.configPath,
      env: options.env,
    })
  );
}

function getObjectPath(key, options = {}) {
  return `${resolveBucketName(options)}/${key}`;
}

export async function downloadR2ObjectFromPublicUrl(publicUrl, key, filePath) {
  const baseUrl = String(publicUrl).replace(/\/+$/, "");
  const url = new URL(String(key), `${baseUrl}/`);
  const response = await fetch(url);

  if (!response.ok || !response.body) {
    throw new Error(
      `Public object download failed with ${response.status} for ${url.toString()}`,
    );
  }

  await mkdir(dirname(filePath), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(filePath));
}

export function downloadR2Object(key, filePath, runtime, options = {}) {
  runWrangler(
    appendWranglerContext(
      [
        "r2",
        "object",
        "get",
        getObjectPath(key, options),
        getR2Flag(runtime),
        "--file",
        filePath,
      ],
      options,
    ),
  );
}

export function uploadR2Object(key, filePath, runtime, options = {}) {
  const args = appendWranglerContext(
    [
      "r2",
      "object",
      "put",
      getObjectPath(key, options),
      getR2Flag(runtime),
      "--file",
      filePath,
    ],
    options,
  );

  if (options.contentType) {
    args.push("--content-type", options.contentType);
  }

  runWrangler(args);
}

export function deleteR2Object(key, runtime, options = {}) {
  runWrangler(
    appendWranglerContext(
      [
        "r2",
        "object",
        "delete",
        getObjectPath(key, options),
        getR2Flag(runtime),
      ],
      options,
    ),
  );
}
