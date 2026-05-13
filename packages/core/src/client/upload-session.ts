import {
  getJsonNumber,
  getJsonString,
  isJsonObject,
  readJsonObject,
} from "./json.js";
import { publicPath } from "./runtime-paths.js";

interface RelayTransportResponse {
  kind: "relay";
  method: "PUT";
  url: string;
}

interface MultipartRelayTransportResponse {
  kind: "multipartRelay";
  method: "PUT";
  url: string;
  partSize: number;
}

interface PutTransportResponse {
  kind: "put";
  method: "PUT";
  url: string;
  headers: Record<string, string>;
  expiresAt: number;
}

type UploadTransportResponse =
  | RelayTransportResponse
  | MultipartRelayTransportResponse
  | PutTransportResponse;

interface InitiateResponse {
  id: string;
  transport: UploadTransportResponse;
}

export interface UploadSessionMetadata {
  width?: number;
  height?: number;
  durationSeconds?: number;
  blurhash?: string;
  waveform?: string;
  poster?: Blob;
  summary?: string;
  chars?: number;
}

export interface UploadSessionResult {
  id: string;
  filename: string;
  url: string;
  mimeType: string;
  size: number;
}

function parseTransport(value: unknown): UploadTransportResponse | null {
  if (!isJsonObject(value)) return null;
  const kind = getJsonString(value, "kind");
  const method = getJsonString(value, "method");
  const url = getJsonString(value, "url");
  if (!kind || method !== "PUT" || !url) return null;

  if (kind === "relay") {
    return { kind, method: "PUT", url };
  }

  if (kind === "multipartRelay") {
    const partSize = getJsonNumber(value, "partSize");
    if (!partSize) return null;
    return { kind, method: "PUT", url, partSize };
  }

  if (kind === "put") {
    const expiresAt = getJsonNumber(value, "expiresAt");
    const headersValue = value["headers"];
    if (!expiresAt || !isJsonObject(headersValue)) return null;
    const headers: Record<string, string> = {};
    for (const [header, headerValue] of Object.entries(headersValue)) {
      if (typeof headerValue === "string") {
        headers[header] = headerValue;
      }
    }
    return { kind, method: "PUT", url, headers, expiresAt };
  }

  return null;
}

interface XhrPutResult {
  status: number;
  ok: boolean;
  text: string;
}

/**
 * PUT a request body via XMLHttpRequest so we can observe upload progress.
 * `fetch()` does not expose `upload.progress`, so byte-level progress for
 * single-PUT and per-part requests requires XHR.
 */
function xhrPut(
  url: string,
  body: Blob | File,
  headers: Record<string, string>,
  onProgress?: (progress: number) => void,
): Promise<XhrPutResult> {
  return new Promise((resolve, reject) => {
    const xhr = new globalThis.XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(event.loaded / event.total);
      }
    });
    xhr.addEventListener("load", () => {
      resolve({
        status: xhr.status,
        ok: xhr.status >= 200 && xhr.status < 300,
        text: xhr.responseText,
      });
    });
    xhr.addEventListener("error", () => reject(new Error("Network error")));
    xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));
    xhr.send(body);
  });
}

function parseJsonObjectFromText(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function initiateUpload(file: File): Promise<InitiateResponse> {
  // Note: no client-side SHA-256 here. Hashing the whole file would force a
  // full File.arrayBuffer() read, which on mobile Safari pushes peak memory
  // past the per-tab cap for large videos and gets the page killed.
  // Server-side size + storage ETag are sufficient integrity checks.
  const res = await fetch(publicPath("/api/uploads/init"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      size: file.size,
    }),
  });

  if (!res.ok) {
    const data = await readJsonObject(res);
    throw new Error(getJsonString(data, "error") ?? "Failed to start upload");
  }

  const data = await readJsonObject(res);
  const id = getJsonString(data, "id");
  const transport = parseTransport(data["transport"]);
  if (!id || !transport) {
    throw new Error("Failed to start upload");
  }

  return { id, transport };
}

async function uploadPoster(uploadId: string, poster: Blob): Promise<void> {
  const response = await fetch(publicPath(`/api/uploads/${uploadId}/poster`), {
    method: "PUT",
    headers: { "Content-Type": poster.type || "image/webp" },
    body: poster,
  });
  if (!response.ok) {
    throw new Error("Failed to upload poster");
  }
}

async function abortUpload(uploadId: string): Promise<void> {
  await fetch(publicPath(`/api/uploads/${uploadId}/abort`), {
    method: "POST",
  }).catch(() => {});
}

async function completeUpload(
  uploadId: string,
  metadata: UploadSessionMetadata & {
    parts?: { partNumber: number; etag: string }[];
  },
): Promise<UploadSessionResult> {
  const completeRes = await fetch(
    publicPath(`/api/uploads/${uploadId}/complete`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metadata),
    },
  );

  if (!completeRes.ok) {
    const data = await readJsonObject(completeRes);
    throw new Error(
      getJsonString(data, "error") ?? "Failed to complete upload",
    );
  }

  const data = await readJsonObject(completeRes);
  const id = getJsonString(data, "id");
  const filename = getJsonString(data, "filename");
  const url = getJsonString(data, "url");
  const mimeType = getJsonString(data, "mimeType");
  const size = getJsonNumber(data, "size");
  if (!id || !filename || !url || !mimeType || size === undefined) {
    throw new Error("Failed to complete upload");
  }

  return { id, filename, url, mimeType, size };
}

async function uploadMultipartRelay(
  uploadId: string,
  transport: MultipartRelayTransportResponse,
  file: File,
  onProgress?: (progress: number) => void,
): Promise<{ partNumber: number; etag: string }[]> {
  const totalParts = Math.ceil(file.size / transport.partSize);
  const parts: { partNumber: number; etag: string }[] = [];
  let uploadedBytes = 0;

  for (let i = 0; i < totalParts; i += 1) {
    const start = i * transport.partSize;
    const end = Math.min(start + transport.partSize, file.size);
    const partNumber = i + 1;
    const chunk = file.slice(start, end);
    const partBytes = end - start;
    const response = await xhrPut(
      publicPath(`${transport.url}?partNumber=${partNumber}`),
      chunk,
      {},
      (partProgress) => {
        onProgress?.((uploadedBytes + partBytes * partProgress) / file.size);
      },
    );
    if (!response.ok) {
      throw new Error(`Failed to upload part ${partNumber}`);
    }
    const data = parseJsonObjectFromText(response.text);
    const uploadedPart = data ? getJsonNumber(data, "partNumber") : null;
    const etag = data ? getJsonString(data, "etag") : null;
    if (!uploadedPart || !etag) {
      throw new Error(`Failed to upload part ${partNumber}`);
    }
    parts.push({ partNumber: uploadedPart, etag });
    uploadedBytes += partBytes;
    onProgress?.(uploadedBytes / file.size);
  }

  return parts;
}

export async function uploadViaSession(
  file: File,
  metadata: UploadSessionMetadata,
  onProgress?: (progress: number) => void,
): Promise<UploadSessionResult> {
  const { id, transport } = await initiateUpload(file);

  try {
    if (transport.kind === "put") {
      const response = await xhrPut(
        transport.url,
        file,
        transport.headers,
        onProgress,
      );
      if (!response.ok) {
        throw new Error("Upload failed");
      }
      onProgress?.(1);
    } else if (transport.kind === "relay") {
      const response = await xhrPut(
        publicPath(transport.url),
        file,
        { "Content-Type": file.type },
        onProgress,
      );
      if (!response.ok) {
        const data = parseJsonObjectFromText(response.text);
        throw new Error(
          (data && getJsonString(data, "error")) ?? "Upload failed",
        );
      }
      onProgress?.(1);
    }

    const parts =
      transport.kind === "multipartRelay"
        ? await uploadMultipartRelay(id, transport, file, onProgress)
        : undefined;

    if (metadata.poster) {
      await uploadPoster(id, metadata.poster);
    }

    return completeUpload(id, {
      ...metadata,
      parts,
    });
  } catch (error) {
    await abortUpload(id);
    throw error;
  }
}
