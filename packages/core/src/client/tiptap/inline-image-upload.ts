/**
 * Shared inline image upload helper for TipTap editors.
 *
 * Tracks in-flight uploads so content can be transferred between editors
 * (e.g. fullscreen → compose) without waiting for uploads to finish.
 */

import type { Editor, JSONContent } from "@tiptap/core";
import { uploadWithMetadata } from "../upload-with-metadata.js";
import { publicPath } from "../runtime-paths.js";

type InlineImageUpload = (file: File) => Promise<{ url: string }>;

/**
 * Registry of in-flight inline image uploads.
 * Maps blob: placeholder URLs to a promise that resolves with the final URL.
 * Entries are removed when the upload completes and the original editor handles
 * replacement, or when another editor adopts ownership.
 */
const inflightUploads = new Map<string, Promise<string>>();

/**
 * Registry of adopted inline image uploads.
 * When another editor takes ownership of an upload via adoptPendingInlineImageUploads,
 * the promise is moved here so resolveInlineImageUrls can still find it at submit time.
 * Entries are removed when the upload settles.
 */
const adoptedUploads = new Map<string, Promise<string>>();

function replaceInlineImage(editor: Editor, fromUrl: string, realUrl: string) {
  if (editor.isDestroyed) return;
  const { doc } = editor.state;
  // Replace every node sharing this src. Blob placeholders are unique, but a
  // deduped remote URL can appear in several nodes after a paste, and they all
  // need to point at the one rehosted copy. setNodeMarkup preserves node size,
  // so positions stay valid across the walk.
  doc.descendants((node, pos) => {
    if (node.type.name !== "image" || node.attrs.src !== fromUrl) {
      return;
    }

    editor
      .chain()
      .command(({ tr }) => {
        tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          src: realUrl,
        });
        return true;
      })
      .run();
  });
}

function removeInlineImage(editor: Editor, blobUrl: string) {
  if (editor.isDestroyed) return;
  const { doc } = editor.state;
  doc.descendants((node, pos) => {
    if (node.type.name === "image" && node.attrs.src === blobUrl) {
      editor
        .chain()
        .command(({ tr }) => {
          tr.delete(pos, pos + node.nodeSize);
          return true;
        })
        .run();
    }
  });
}

/**
 * Apply the outcome of an inline upload/rehost to the placeholder node(s).
 *
 * On success the src is swapped to the final URL. On failure a `blob:`
 * placeholder (from the insert flow) is removed, while a remote/`data:`
 * placeholder (from the rehost flow) is left untouched so the original image
 * still shows — rehosting is best-effort.
 */
function settlePlaceholder(
  editor: Editor,
  placeholderSrc: string,
  realUrl: string | null,
) {
  if (realUrl) {
    replaceInlineImage(editor, placeholderSrc, realUrl);
  } else if (placeholderSrc.startsWith("blob:")) {
    removeInlineImage(editor, placeholderSrc);
  }
}

/**
 * Uploads an image file and inserts it into the editor as an inline image.
 *
 * The upload is tracked in a shared registry so other editors can adopt
 * ownership if the content is transferred (e.g. fullscreen close).
 *
 * @param editor - TipTap editor instance that should receive the uploaded image
 * @param file - Image file to upload
 * @param uploadImage - Upload implementation used to turn a File into a public URL
 * @returns Resolves after the placeholder image is replaced or removed
 * @example
 * ```ts
 * await uploadAndInsertInlineImage(editor, file);
 * ```
 */
export async function uploadAndInsertInlineImage(
  editor: Editor,
  file: File,
  uploadImage: InlineImageUpload = uploadWithMetadata,
): Promise<void> {
  const placeholderUrl = URL.createObjectURL(file);
  editor.chain().focus().setImage({ src: placeholderUrl }).run();

  const uploaded = uploadImage(file).then((data) => data.url);
  inflightUploads.set(placeholderUrl, uploaded);

  try {
    const realUrl = await uploaded;
    settlePlaceholder(editor, placeholderUrl, realUrl);
  } catch {
    settlePlaceholder(editor, placeholderUrl, null);
  } finally {
    // Only cleanup if not adopted by another editor
    if (inflightUploads.delete(placeholderUrl)) {
      URL.revokeObjectURL(placeholderUrl);
    }
  }
}

/**
 * Result of the remote-image sideload endpoint.
 */
export interface SideloadResult {
  id: string;
  url: string;
  width?: number;
  height?: number;
}

/**
 * Ask the server to rehost a remote image URL into the site's own storage.
 *
 * The server fetches the bytes (browser fetch of a third-party image is blocked
 * by CORS), stores them, and returns the new public URL.
 *
 * @param url - The remote http(s) image URL
 * @param alt - Optional alt text to persist on the media row
 * @returns The created media's id, public URL, and dimensions
 * @throws {Error} When the endpoint responds with a non-OK status
 */
export async function sideloadImage(
  url: string,
  alt?: string,
): Promise<SideloadResult> {
  const res = await fetch(publicPath("/api/uploads/sideload"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, alt }),
  });
  if (!res.ok) {
    throw new Error(`Sideload failed: HTTP ${res.status}`);
  }
  return (await res.json()) as SideloadResult;
}

/**
 * Rehost an image node that already exists in the document (inserted by a paste)
 * whose `src` is a remote or `data:` URL. Tracks the work in the shared registry
 * so submit waits for it, swaps the src to the stored URL on success, and leaves
 * the node untouched on failure (the original image keeps showing).
 *
 * Does NOT insert a node — the paste already created it.
 *
 * @param editor - TipTap editor containing the placeholder node
 * @param placeholderSrc - The current (remote/data) src of the node to rehost
 * @param resolveUrl - Produces the final stored URL (server sideload or client upload)
 * @returns Resolves after the node is updated or left in place
 * @example
 * ```ts
 * await rehostInlineImage(editor, src, () => sideloadImage(src).then((r) => r.url));
 * ```
 */
export async function rehostInlineImage(
  editor: Editor,
  placeholderSrc: string,
  resolveUrl: () => Promise<string>,
): Promise<void> {
  const uploaded = resolveUrl();
  inflightUploads.set(placeholderSrc, uploaded);

  try {
    const realUrl = await uploaded;
    settlePlaceholder(editor, placeholderSrc, realUrl);
  } catch {
    settlePlaceholder(editor, placeholderSrc, null);
  } finally {
    inflightUploads.delete(placeholderSrc);
  }
}

/**
 * Adopt in-flight inline image uploads/rehosts into a new editor instance.
 *
 * Scans the editor's document for image srcs that match pending registry entries
 * (`blob:` placeholders from the insert flow, or remote/`data:` placeholders
 * from the paste-rehost flow). For each match, takes ownership from the original
 * editor and sets up replacement/removal watchers on the new editor. Content can
 * pass through several editors before it is submitted, so an upload adopted once
 * can be adopted again.
 *
 * Call this immediately after `setContent` with JSON that may contain pending
 * placeholders (e.g. after fullscreen close transfers content back to compose).
 *
 * @param editor - The TipTap editor that now contains the placeholder content
 * @returns Array of promises that resolve when each adopted upload completes
 */
export function adoptPendingInlineImageUploads(
  editor: Editor,
): Promise<void>[] {
  const adopted: Promise<void>[] = [];
  const { doc } = editor.state;

  doc.descendants((node) => {
    if (node.type.name !== "image") return;
    const src = node.attrs.src as string;
    if (typeof src !== "string") return;

    const uploaded = inflightUploads.get(src) ?? adoptedUploads.get(src);
    if (!uploaded) return;

    // Take ownership — prevents original editor's finally from revoking the URL.
    // Move to adoptedUploads so resolveInlineImageUrls can still find the promise
    // if the user submits before the upload completes. Content can be handed on
    // more than once (fullscreen → compose → a format switch), so an entry
    // already sitting in adoptedUploads is adopted again rather than skipped.
    inflightUploads.delete(src);
    adoptedUploads.set(src, uploaded);

    // Blob placeholders own an object URL and are removed on failure; remote/
    // data rehost placeholders have neither (keep the node, nothing to revoke).
    const isBlob = src.startsWith("blob:");
    const promise = uploaded
      .then(
        (realUrl) => replaceInlineImage(editor, src, realUrl),
        () => settlePlaceholder(editor, src, null),
      )
      .finally(() => {
        adoptedUploads.delete(src);
        if (isBlob) URL.revokeObjectURL(src);
      });
    adopted.push(promise);
  });

  return adopted;
}

/**
 * Resolve all pending inline image placeholders in a TipTap JSON document.
 *
 * Covers both placeholder kinds tracked in the registries: `blob:` URLs from
 * the insert/upload flow and remote/`data:` URLs from the paste-rehost flow.
 * Waits for the pending work and returns a new JSON tree with stored URLs.
 * Unresolved `blob:` placeholders (upload failed) are removed; unresolved
 * remote/`data:` placeholders are kept with their original src (rehost is
 * best-effort, so the original image still shows).
 *
 * Used by the submit bridge to finalize content before posting.
 *
 * @param json - TipTap JSON document that may contain placeholder image srcs
 * @returns Resolved JSON with placeholder srcs replaced (or kept/removed)
 */
export async function resolveInlineImageUrls(
  json: JSONContent | null,
): Promise<JSONContent | null> {
  if (!json) return json;

  // Collect every placeholder src present in the registries + its promise.
  const placeholders = new Map<string, Promise<string>>();
  collectPlaceholderUrls(json, placeholders);

  if (placeholders.size === 0) return json;

  // Wait for all pending work; record success (URL) or failure (null) per src.
  const outcomes = new Map<string, string | null>();
  await Promise.allSettled(
    Array.from(placeholders.entries()).map(async ([src, promise]) => {
      try {
        outcomes.set(src, await promise);
      } catch {
        outcomes.set(src, null);
      }
    }),
  );

  return applyPlaceholderOutcomes(json, outcomes);
}

/**
 * Whether a TipTap JSON document still references inline image placeholders that
 * are pending upload/rehost. Used to decide the "uploading" toast and whether to
 * run {@link resolveInlineImageUrls} before submit.
 *
 * @param json - TipTap JSON document to inspect
 * @returns True if any image src is a pending placeholder
 */
export function hasPendingInlineImagePlaceholders(
  json: JSONContent | null,
): boolean {
  if (!json) return false;
  const placeholders = new Map<string, Promise<string>>();
  collectPlaceholderUrls(json, placeholders);
  return placeholders.size > 0;
}

function collectPlaceholderUrls(
  node: JSONContent,
  out: Map<string, Promise<string>>,
) {
  if (node.type === "image" && typeof node.attrs?.src === "string") {
    const src = node.attrs.src;
    const promise = inflightUploads.get(src) ?? adoptedUploads.get(src);
    if (promise) {
      out.set(src, promise);
    }
  }
  if (node.content) {
    for (const child of node.content) {
      collectPlaceholderUrls(child, out);
    }
  }
}

function applyPlaceholderOutcomes(
  node: JSONContent,
  outcomes: Map<string, string | null>,
): JSONContent {
  if (
    node.type === "image" &&
    typeof node.attrs?.src === "string" &&
    outcomes.has(node.attrs.src)
  ) {
    const src = node.attrs.src;
    const realUrl = outcomes.get(src);
    if (realUrl) {
      return { ...node, attrs: { ...node.attrs, src: realUrl } };
    }
    // Unresolved: drop blob placeholders (orphaned upload), keep remote/data.
    if (src.startsWith("blob:")) {
      return { type: "__removed__" };
    }
    return node;
  }

  if (!node.content) return node;

  const newContent = node.content
    .map((child) => applyPlaceholderOutcomes(child, outcomes))
    .filter((child) => child.type !== "__removed__");

  return newContent === node.content ? node : { ...node, content: newContent };
}
