/**
 * Compose Bridge
 *
 * Handles server communication between the Lit compose dialog and the server.
 * Manages file uploads, deferred submit flow, and toast notifications.
 */

import type { ComposeSubmitDetail } from "./components/compose-types.js";
import type { ComposeAttachment } from "./components/compose-types.js";
import type { ComposeSubmitAttachment } from "./components/compose-types.js";
import type { LocalDraftMedia } from "./components/compose-types.js";
import type { JantComposeDialog } from "./components/jant-compose-dialog.js";
import type { JantComposeEditor } from "./components/jant-compose-editor.js";
import type { PostAttachmentInput } from "../types.js";
import { AudioProcessor } from "./audio-processor.js";
import { ImageProcessor } from "./image-processor.js";
import { VideoProcessor } from "./video-processor.js";
import { extractAudioWaveform } from "./audio-waveform.js";
import {
  showToast,
  showPersistentToast,
  updateToast,
  replaceWithAutoClose,
  queueToastForNextPage,
} from "./toast.js";
import { getComposeDialog, openReplyForArticle } from "./compose-launch.js";
import {
  refreshPostCardView,
  refreshPostPageView,
  refreshTimelineThreadView,
} from "./post-refresh.js";
import { getJsonString, readJsonObject } from "./json.js";
import { uploadViaSession } from "./upload-session.js";
import type { UploadSessionResult } from "./upload-session.js";
import { publicPath } from "./runtime-paths.js";
import { tiptapJsonToMarkdown } from "../lib/tiptap-to-markdown.js";
import { getMediaCategory, sniffImageMimeType } from "../lib/upload.js";
import {
  resolveInlineImageUrls,
  hasPendingInlineImagePlaceholders,
} from "./tiptap/inline-image-upload.js";

/**
 * Whether a serialized post body still references inline image placeholders
 * pending upload or paste-rehost. Drives the "uploading" toast and whether to
 * resolve placeholders before submit.
 */
function bodyHasPendingInline(body: string): boolean {
  try {
    return hasPendingInlineImagePlaceholders(JSON.parse(body));
  } catch {
    return false;
  }
}

function getComposeEditorFromEventTarget(
  target: globalThis.EventTarget | null,
): JantComposeEditor | null {
  return target instanceof globalThis.Element
    ? (target.closest("jant-compose-editor") as JantComposeEditor | null)
    : null;
}

function getComposeDialogFromEventTarget(
  target: globalThis.EventTarget | null,
): JantComposeDialog | null {
  return target instanceof globalThis.Element
    ? (target.closest("jant-compose-dialog") as JantComposeDialog | null)
    : null;
}

async function refreshReplyTarget(
  detail: ComposeSubmitDetail,
): Promise<boolean> {
  if (!detail.replyRefreshKind || !detail.replyRefreshId) {
    return false;
  }

  if (detail.replyRefreshKind === "timeline-item") {
    return refreshTimelineThreadView(
      detail.replyThreadRootId ?? detail.replyRefreshId,
    );
  }

  if (detail.replyRefreshKind === "post-view") {
    return refreshPostPageView(detail.replyRefreshId);
  }

  return refreshPostCardView(detail.replyRefreshId);
}

// ── Upload manager ──────────────────────────────────────────────────

/** Track in-flight upload promises keyed by clientId */
const uploadPromises = new Map<string, Promise<string | null>>();

/** Track attachments removed while their upload is still in flight */
const removedClientIds = new Set<string>();

/**
 * Track upload-phase progress (0..1) per clientId for live toast aggregation.
 * Populated only during the actual byte-upload phase — processing/transcoding
 * progress is intentionally excluded so the percentage doesn't reset mid-flight.
 */
const uploadProgress = new Map<string, number>();

interface ActiveUploadToast {
  clientIds: string[];
  baseMsg: string;
}

let activeUploadToast: ActiveUploadToast | null = null;

function refreshUploadToast() {
  if (!activeUploadToast) return;
  const { clientIds, baseMsg } = activeUploadToast;
  if (clientIds.length === 0) return;

  let sum = 0;
  let done = 0;
  for (const id of clientIds) {
    const p = uploadProgress.get(id) ?? 0;
    sum += Math.min(1, Math.max(0, p));
    if (p >= 1) done += 1;
  }
  const total = clientIds.length;
  const pct = Math.floor((sum / total) * 100);
  // Show "currently on item N of M" rather than "N completed of M": while any
  // work is in flight we report the next-in-progress index (capped at total),
  // so 2 files with neither done shows "1/2" instead of the confusing "0/2".
  const current = Math.min(done + 1, total);

  const message =
    total === 1
      ? `${baseMsg} ${pct}%`
      : `${baseMsg} ${pct}% ${current}/${total}`;
  updateToast("compose-deferred", message);
}

/**
 * Track completed upload results by clientId.
 *
 * When an attachment is migrated between editor instances (e.g. entering thread
 * mode while an upload is in-flight), `updateAttachmentStatus` fires on the old
 * detached editor — not the new thread editor. By the time the user submits,
 * the upload promise has been deleted from `uploadPromises`, so the deferred
 * handler can't look it up. This map provides a fallback: we record the result
 * here as soon as any upload succeeds, and `buildRequestAttachments` reads it
 * when `attachment.mediaId` is null and the clientId isn't in `uploadPromises`.
 *
 * The full result (not just the id) is kept so a failed publish can restore
 * uploaded attachments into the reopened compose dialog.
 */
const completedUploads = new Map<string, UploadSessionResult>();

/**
 * Quickly grab the very first decoded frame of a video as a small poster.
 * Uses a 3s timeout — returns null on any failure so callers don't stall.
 */
function captureQuickPoster(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 3000);

    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";

    function cleanup() {
      clearTimeout(timeout);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    }

    video.onloadeddata = () => {
      try {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (!w || !h) {
          cleanup();
          resolve(null);
          return;
        }
        const scale = Math.min(640 / w, 1);
        const pw = Math.round(w * scale);
        const ph = Math.round(h * scale);
        const canvas = document.createElement("canvas");
        canvas.width = pw;
        canvas.height = ph;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          cleanup();
          resolve(null);
          return;
        }
        ctx.drawImage(video, 0, 0, pw, ph);
        canvas.toBlob(
          (blob) => {
            cleanup();
            resolve(blob);
          },
          "image/webp",
          0.6,
        );
      } catch {
        cleanup();
        resolve(null);
      }
    };

    video.onerror = () => {
      cleanup();
      resolve(null);
    };

    video.src = url;
  });
}

/** Bytes that settle whether a file is HEIC: the `ftyp` box and its brand. */
const HEIC_SNIFF_BYTES = 12;

/**
 * Whether the file's bytes say HEIC/HEIF, whatever its name or type claims.
 * Reads the header only — the decoder's own check pulled the whole file into
 * memory to look at four bytes of it.
 */
async function isHeicFile(file: File): Promise<boolean> {
  const head = await file.slice(0, HEIC_SNIFF_BYTES).arrayBuffer();
  return sniffImageMimeType(new Uint8Array(head)) === "image/heic";
}

/**
 * Upload a single file: process locally, then send it through the upload
 * session API so the backend can choose relay vs direct transport.
 * Returns the mediaId on success, null on failure.
 */
async function uploadFile(
  file: File,
  clientId: string,
  editor: JantComposeEditor | null,
): Promise<string | null> {
  // Capture cheap metadata up-front so we can release `file` (the original
  // potentially-huge blob) as soon as transcoding finishes. On iOS Safari
  // holding a 300MB+ source blob alongside the transcoded output, upload
  // chunks, and decoder buffers can push the tab past the per-process
  // memory cap and get it silently reloaded mid-publish.
  const fileType = file.type;
  const fileName = file.name;
  try {
    let toUpload: File;
    let width: number | undefined;
    let height: number | undefined;
    let durationSeconds: number | undefined;
    let blurhash: string | undefined;
    let waveform: string | undefined;
    let poster: Blob | undefined;

    if (fileType.startsWith("video/")) {
      // Video: transcode with mediabunny (requires WebCodecs)
      if (!VideoProcessor.isSupported()) {
        editor?.updateAttachmentStatus(
          clientId,
          "error",
          null,
          "Your browser doesn't support video processing. Use Chrome or Edge to upload videos.",
        );
        return null;
      }

      // Capture the first frame quickly so Safari shows a preview while
      // the heavy transcoding runs. Chrome shows it natively via
      // <video preload="metadata">, Safari does not. Kept, rather than shown
      // and dropped: it is also the fallback for the upload below, so the
      // card and the stored media can never disagree about having a poster.
      const quickPoster = captureQuickPoster(file)
        .then((blob) => {
          if (blob) editor?.updateAttachmentPoster(clientId, blob);
          return blob;
        })
        .catch(() => null);

      editor?.updateAttachmentStatus(clientId, "processing", null, null);
      const result = await VideoProcessor.processToFile(file, (progress) => {
        editor?.updateAttachmentProgress(clientId, progress);
      });
      toUpload = result.file;
      // Drop the original blob ref now that we have the transcoded output.
      file = null as unknown as File;
      width = result.width;
      height = result.height;
      durationSeconds = result.durationSeconds;
      blurhash = result.blurhash;
      // The probe's poster is the better one — a frame from a tenth of the way
      // in, at full decode quality. Falling back to the quick one costs a
      // slightly worse still; not falling back costs a thumbnail entirely, on
      // exactly the files whose frames the probe could not read.
      poster = result.poster ?? (await quickPoster) ?? undefined;
      if (poster) {
        editor?.updateAttachmentPoster(clientId, poster);
      }
    } else if (fileType.startsWith("audio/")) {
      // Audio: transcode to AAC (.m4a) (requires WebCodecs)
      if (!AudioProcessor.isSupported()) {
        editor?.updateAttachmentStatus(
          clientId,
          "error",
          null,
          "Your browser doesn't support audio processing. Use Chrome or Edge to upload audio.",
        );
        return null;
      }

      // Extract waveform from the original file before AudioProcessor runs
      try {
        waveform = await extractAudioWaveform(file);
      } catch {
        // Waveform extraction is best-effort
      }

      editor?.updateAttachmentStatus(clientId, "processing", null, null);
      const result = await AudioProcessor.processToFile(file, (progress) => {
        editor?.updateAttachmentProgress(clientId, progress);
      });
      toUpload = result.file;
      file = null as unknown as File;
    } else if (
      fileType.startsWith("image/") ||
      /\.heic$/i.test(fileName) ||
      /\.heif$/i.test(fileName)
    ) {
      // Image: convert HEIC/HEIF if needed, then resize + convert to WebP
      let imageFile = file;
      try {
        if (await isHeicFile(imageFile)) {
          // heic-to carries libheif — a 3MB chunk — so it is fetched for a
          // file whose bytes say HEIC, not for every photo on the off chance.
          const { heicTo } = await import("heic-to");
          editor?.updateAttachmentStatus(clientId, "processing", null, null);
          const blob = await heicTo({
            blob: imageFile,
            type: "image/jpeg",
            quality: 0.92,
          });
          imageFile = new File([blob], fileName.replace(/\.heic$/i, ".jpg"), {
            type: "image/jpeg",
          });
          editor?.updateAttachmentPreview(clientId, imageFile);
        }
        const result = await ImageProcessor.processToFile(imageFile);
        toUpload = result.file;
        width = result.width;
        height = result.height;
        blurhash = result.blurhash;
        file = null as unknown as File;
        imageFile = null as unknown as File;
      } catch {
        editor?.removeAttachment(clientId);
        showToast("Image format not supported.", "error");
        return null;
      }
    } else {
      toUpload = file;
    }

    // Update status to uploading
    editor?.updateAttachmentStatus(clientId, "uploading", null, null);

    // Text attachments keep summary/chars in the media record. This covers
    // plain text-file uploads (.md, .txt, .csv). Jant-composed rich text
    // attachments do not go through this upload path — they are sent as
    // markdown via the compose API and materialized by `createTextAttachment`.
    let summary: string | undefined;
    let chars: number | undefined;
    const category = getMediaCategory(fileType);
    if (category === "text") {
      try {
        const textContent = await toUpload.text();
        const trimmed = textContent.replace(/\s+/g, " ").trim();
        chars = textContent.length;
        summary =
          trimmed.length <= 100 ? trimmed : trimmed.slice(0, 100) + "\u2026";
      } catch {
        // Ignore — summary is optional
      }
    }

    uploadProgress.set(clientId, 0);
    refreshUploadToast();

    const result = await uploadViaSession(
      toUpload,
      {
        width,
        height,
        durationSeconds,
        blurhash,
        waveform,
        poster,
        summary,
        chars,
      },
      (progress) => {
        editor?.updateAttachmentProgress(clientId, progress);
        uploadProgress.set(clientId, progress);
        refreshUploadToast();
      },
    );

    uploadProgress.set(clientId, 1);
    refreshUploadToast();
    editor?.updateAttachmentStatus(
      clientId,
      "done",
      result.id,
      null,
      result.url,
    );
    completedUploads.set(clientId, result);
    return result.id;
  } catch (error) {
    uploadProgress.delete(clientId);
    refreshUploadToast();
    const message = error instanceof Error ? error.message : "Upload failed";
    editor?.updateAttachmentStatus(clientId, "error", null, message);
    // Error is shown on the attachment thumbnail; only toast when there's no editor context.
    if (!editor) showToast(message, "error");
    return null;
  }
}

// ── Attachment removal handler ───────────────────────────────────────

document.addEventListener("jant:attachment-removed", (e: Event) => {
  const { clientId, mediaId } = (
    e as CustomEvent<{ clientId: string; mediaId: string | null }>
  ).detail;

  completedUploads.delete(clientId);

  if (mediaId) {
    // Upload already finished — fire-and-forget delete
    fetch(`/api/upload/${mediaId}`, { method: "DELETE" }).catch(() => {});
  } else {
    // Upload still in flight — mark for cleanup after it finishes
    removedClientIds.add(clientId);
  }
});

// ── File selection handler ──────────────────────────────────────────

document.addEventListener("jant:files-selected", (e: Event) => {
  const event = e as CustomEvent<{
    files: { file: File; clientId: string }[];
  }>;
  const editor = getComposeEditorFromEventTarget(event.target);

  for (const { file, clientId } of event.detail.files) {
    const promise = uploadFile(file, clientId, editor).then((mediaId) => {
      // If the attachment was removed while uploading, delete it immediately
      if (removedClientIds.has(clientId)) {
        removedClientIds.delete(clientId);
        if (mediaId) {
          fetch(`/api/upload/${mediaId}`, { method: "DELETE" }).catch(() => {});
        }
        return null;
      }
      return mediaId;
    });
    uploadPromises.set(clientId, promise);
    promise.finally(() => uploadPromises.delete(clientId));
  }
});

// ── Reply trigger handler ───────────────────────────────────────────

document.addEventListener("click", (e: MouseEvent) => {
  const trigger = (e.target as HTMLElement).closest<HTMLButtonElement>(
    "[data-reply-trigger]",
  );
  if (!trigger) return;

  const article = trigger.closest<HTMLElement>("article[data-post]");
  if (!article) return;
  void openReplyForArticle(article);
});

// ── Draft badge → editor ────────────────────────────────────────────
//
// The badge on an inline draft doubles as its most likely next action. Publish
// and Delete live in the post menu with every other post action.

document.addEventListener("click", (e: MouseEvent) => {
  const trigger = (e.target as HTMLElement).closest<HTMLElement>(
    "[data-draft-continue]",
  );
  if (!trigger) return;

  const postId =
    trigger.dataset.postId ??
    trigger.closest<HTMLElement>("article[data-post]")?.dataset.postId;
  if (!postId) return;

  void getComposeDialog()?.openEdit(postId);
});

// ── Submit handler ──────────────────────────────────────────────────

/** Build the JSON body for both create and update requests */
function buildPostBody(
  detail: ComposeSubmitDetail,
  attachments: PostAttachmentInput[],
) {
  const isQuote = detail.format === "quote";
  const isLink = detail.format === "link";
  const isEdit = !!detail.editPostId;
  const optionalTextValue = (value: string) => value || undefined;
  const nullableTextValue = (value: string) => value || null;

  return {
    format: detail.format,
    title: !isQuote
      ? isEdit
        ? nullableTextValue(detail.title)
        : optionalTextValue(detail.title)
      : undefined,
    body: isEdit
      ? nullableTextValue(detail.body)
      : optionalTextValue(detail.body),
    url: isLink
      ? isEdit
        ? nullableTextValue(detail.url)
        : optionalTextValue(detail.url)
      : isEdit
        ? null
        : undefined,
    sourceName: isQuote
      ? isEdit
        ? nullableTextValue(detail.quoteAuthor)
        : optionalTextValue(detail.quoteAuthor)
      : undefined,
    sourceUrl: isQuote
      ? isEdit
        ? nullableTextValue(detail.url)
        : optionalTextValue(detail.url)
      : undefined,
    quoteText: isQuote
      ? isEdit
        ? nullableTextValue(detail.quoteText)
        : optionalTextValue(detail.quoteText)
      : isEdit
        ? null
        : undefined,
    slug: detail.slug || undefined,
    status: detail.status,
    publishedAt: detail.status === "published" ? detail.publishedAt : undefined,
    visibility: detail.visibility || undefined,
    rating: isEdit
      ? detail.rating > 0
        ? detail.rating
        : null
      : detail.rating || undefined,
    // Reply creation and Child edits must not reorganize their existing
    // Thread as a side effect. Collection management stays on Thread-level
    // organization surfaces; JSON.stringify omits this undefined field.
    collectionIds: detail.replyToId ? undefined : detail.collectionIds,
    attachments: attachments.length > 0 ? attachments : undefined,
    replyToId: detail.replyToId || undefined,
    quietReply: detail.quietReply || undefined,
    // Absent means the author left the language to detection; the server runs
    // the same detector against the final text.
    language: detail.language || undefined,
    // A translation group is only ever minted on create — an edit that carried
    // this would silently regroup an existing post.
    translationOfId: isEdit ? undefined : detail.translationOfId || undefined,
  };
}

function hasAttachedTextChanged(
  attachment: Extract<ComposeSubmitAttachment, { type: "text" }>,
): boolean {
  return (
    JSON.stringify(attachment.bodyJson) !==
    JSON.stringify(attachment.originalBodyJson ?? null)
  );
}

function buildRequestAttachments(
  detail: ComposeSubmitDetail,
  pendingMediaIds: Map<string, string>,
): PostAttachmentInput[] {
  const requestAttachments: PostAttachmentInput[] = [];

  for (const attachment of detail.attachments) {
    if (attachment.type === "media") {
      const mediaId =
        attachment.mediaId ??
        pendingMediaIds.get(attachment.clientId) ??
        completedUploads.get(attachment.clientId)?.id;
      if (!mediaId) continue;

      requestAttachments.push({
        type: "media",
        mediaId,
        alt: attachment.alt,
      });
      continue;
    }

    if (attachment.mediaId && !hasAttachedTextChanged(attachment)) {
      requestAttachments.push({
        type: "media",
        mediaId: attachment.mediaId,
      });
      continue;
    }

    requestAttachments.push({
      type: "text",
      contentFormat: "markdown",
      content: tiptapJsonToMarkdown(JSON.stringify(attachment.bodyJson)),
      summary: attachment.summary,
    });
  }

  return requestAttachments;
}

// ── Deferred submit handler ─────────────────────────────────────────

interface DeferredDetail extends ComposeSubmitDetail {
  pendingAttachments: ComposeAttachment[];
}

document.addEventListener("jant:compose-submit-deferred", async (e: Event) => {
  const event = e as CustomEvent<DeferredDetail>;
  const detail = event.detail;
  const composeEl =
    getComposeDialogFromEventTarget(event.target) ??
    (document.querySelector("jant-compose-dialog") as JantComposeDialog | null);
  const isPageMode = !!composeEl?.pageMode;
  const isDraftPreviewPage = !!document.querySelector("[data-preview-status]");

  // Get labels for toast messages
  const labels = composeEl?.labels;
  const uploadingMsg = labels?.uploading ?? "Uploading...";
  const hasInlinePending = detail.threadPosts
    ? detail.threadPosts.some((p) => bodyHasPendingInline(p.body))
    : bodyHasPendingInline(detail.body);
  const hasPending = detail.pendingAttachments.length > 0 || hasInlinePending;
  const publishedMsg = labels?.published ?? "Published!";
  const viewLabel = labels?.view ?? "View";

  // Show persistent toast only when uploads are still in flight
  if (hasPending) {
    showPersistentToast("compose-deferred", uploadingMsg);
    if (detail.pendingAttachments.length > 0) {
      activeUploadToast = {
        clientIds: detail.pendingAttachments.map((a) => a.clientId),
        baseMsg: uploadingMsg,
      };
      refreshUploadToast();
    }
  }

  /** Show result toast — replaces persistent toast if one exists, otherwise shows a new one */
  const toastMsg = (msg: string, type: "success" | "error" = "success") => {
    if (activeUploadToast) {
      for (const id of activeUploadToast.clientIds) uploadProgress.delete(id);
      activeUploadToast = null;
    }
    if (hasPending) {
      replaceWithAutoClose("compose-deferred", msg, type);
    } else {
      showToast(msg, type);
    }
  };
  const resetPageCompose = () => {
    if (!isPageMode || !composeEl) return;
    composeEl.reset();
    composeEl.updateComplete.then(() => {
      composeEl
        .querySelector<JantComposeEditor>("jant-compose-editor")
        ?.focusInput();
    });
  };
  const clearPageLoading = () => {
    if (!isPageMode || !composeEl) return;
    composeEl.loading = false;
  };
  const clearRecoveredLocalDraft = () => {
    if (isEdit) {
      if (detail.editPostId) {
        composeEl?.clearEditDraftFromStorage?.(detail.editPostId);
      }
      return;
    }
    composeEl?.clearLocalDraftFromStorage?.();
  };
  /**
   * Uploads that completed before the publish failed. The local draft's own
   * media snapshot misses uploads that finished after the dialog closed, so
   * the reopened compose merges these over it.
   */
  const collectRestorableMedia = (): LocalDraftMedia[] => {
    const details = detail.threadPosts?.length ? detail.threadPosts : [detail];
    const media: LocalDraftMedia[] = [];
    const seen = new Set<string>();
    for (const d of details) {
      for (const attachment of d.attachments) {
        if (attachment.type !== "media" || seen.has(attachment.clientId)) {
          continue;
        }
        seen.add(attachment.clientId);
        const upload = completedUploads.get(attachment.clientId);
        if (!upload) continue;
        media.push({
          clientId: attachment.clientId,
          mediaId: upload.id,
          url: upload.url,
          mimeType: upload.mimeType,
          name: upload.filename || undefined,
          alt: attachment.alt || undefined,
        });
      }
    }
    return media;
  };

  const reopenComposeAfterFailure = async () => {
    if (!composeEl || isPageMode) return;

    if (detail.draftSourceId) {
      if (typeof composeEl.openDraft !== "function") return;
      await composeEl.openDraft(detail.draftSourceId);
      return;
    }

    if (isEdit && detail.editPostId) {
      if (typeof composeEl.openEdit !== "function") return;
      await composeEl.openEdit(detail.editPostId, { restoreToast: false });
      return;
    }

    if (detail.replyToId) {
      if (typeof composeEl.openReply !== "function") return;
      await composeEl.openReply(
        detail.replyToId,
        undefined,
        detail.replyThreadRootId,
        detail.replyRefreshKind && detail.replyRefreshId
          ? {
              kind: detail.replyRefreshKind,
              id: detail.replyRefreshId,
            }
          : undefined,
        {
          restoreDraft: true,
          initialFormat: detail.format,
          restoreToast: false,
          restoreMedia: collectRestorableMedia(),
        },
      );
      return;
    }

    if (typeof composeEl.openNew !== "function") return;
    await composeEl.openNew({
      restoreDraft: true,
      restoreToast: false,
      restoreMedia: collectRestorableMedia(),
    });
  };
  const handleSubmitError = async (message: string) => {
    clearPageLoading();
    await reopenComposeAfterFailure();
    toastMsg(message, "error");
  };
  const refreshComposeCollections = async () => {
    await composeEl?.refreshCollections();
  };
  const queueSuccessToast = (
    msg: string,
    action?: { label: string; href: string },
  ) => {
    queueToastForNextPage(msg, "success", action);
  };
  const leavePageAfterConfirmSave = () => {
    if (!isPageMode || !composeEl) return false;
    if (!composeEl.consumePageLeaveRequest()) return false;
    composeEl.preparePageLeave();
    globalThis.location.assign(composeEl.closeHref || publicPath("/"));
    return true;
  };
  const isEdit = !!detail.editPostId;
  const isThread = !!(detail.threadPosts && detail.threadPosts.length >= 2);
  let draftFallback: "upload" | "server" | null = null;

  try {
    // Wait for all pending uploads to complete (for thread mode, pendingAttachments
    // already contains combined attachments from all posts).
    // Use Promise.resolve(null) for uploads whose promise was already consumed
    // (e.g. completed before thread-mode migration) to keep indices aligned.
    const pendingClientIds = detail.pendingAttachments.map((a) => a.clientId);
    const pendingPromises = pendingClientIds.map(
      (id) => uploadPromises.get(id) ?? Promise.resolve(null as string | null),
    );

    const results = await Promise.all(pendingPromises);

    // If any pending upload failed (null result where we expected a mediaId
    // AND the upload wasn't already tracked in completedUploads):
    const failedCount = results.filter(
      (id, i) =>
        id === null && !completedUploads.has(pendingClientIds[i] ?? ""),
    ).length;
    if (failedCount > 0) {
      if (detail.status === "published" && !isEdit) {
        draftFallback = "upload";
      } else {
        await handleSubmitError("Upload failed. Post not created.");
        return;
      }
    }

    // Build clientId → mediaId map for file attachments completed by this submit
    // For thread mode, this covers attachments from ALL posts (they were combined).
    const mediaClientIdMap = new Map<string, string>();
    for (let i = 0; i < pendingClientIds.length; i++) {
      const clientId = pendingClientIds[i];
      const mediaId = results[i];
      if (clientId && mediaId) mediaClientIdMap.set(clientId, mediaId);
    }

    // ── Thread submission ────────────────────────────────────────────
    if (isThread && detail.threadPosts) {
      const threadPosts = detail.threadPosts;
      const effectiveStatus = draftFallback ? "draft" : detail.status;

      // Resolve inline blob URLs in each post's body
      const resolvedPosts = await Promise.all(
        threadPosts.map(async (post) => {
          let body = post.body;
          if (bodyHasPendingInline(body)) {
            try {
              const bodyJson = JSON.parse(body);
              const resolved = await resolveInlineImageUrls(bodyJson);
              body = resolved ? JSON.stringify(resolved) : "";
            } catch {
              // keep original
            }
          }
          return { ...post, body, status: effectiveStatus };
        }),
      );

      const postsPayload = resolvedPosts.map((post) =>
        buildPostBody(post, buildRequestAttachments(post, mediaClientIdMap)),
      );

      const threadBody: Record<string, unknown> = { posts: postsPayload };
      if (isEdit && detail.editPostId) {
        threadBody.replaceThreadId = detail.editPostId;
      }

      const res = await fetch("/compose/thread", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(threadBody),
      });

      if (!res.ok) {
        // Server error on publish: retry as draft
        if (detail.status === "published" && !draftFallback) {
          const retryPayload = {
            posts: postsPayload.map((p) => ({ ...p, status: "draft" })),
          };
          const retryRes = await fetch("/compose/thread", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify(retryPayload),
          });
          if (retryRes.ok) {
            draftFallback = "server";
            clearRecoveredLocalDraft();
            const fallbackMsg =
              labels?.publishFailedDraft ?? "Couldn't publish. Saved as draft.";
            await refreshComposeCollections();
            if (!leavePageAfterConfirmSave()) resetPageCompose();
            toastMsg(fallbackMsg);
            return;
          }
        }
        const data = await readJsonObject(res);
        await handleSubmitError(
          getJsonString(data, "error") ?? "Something went wrong",
        );
        return;
      }

      if (draftFallback === "upload") {
        clearRecoveredLocalDraft();
        const fallbackMsg =
          labels?.uploadFailedDraft ?? "Some uploads failed. Saved as draft.";
        await refreshComposeCollections();
        resetPageCompose();
        toastMsg(fallbackMsg);
        return;
      }

      const threadData = await readJsonObject(res);
      const threadStatus = getJsonString(threadData, "status");
      const threadPermalink = getJsonString(threadData, "permalink");
      const threadToast = getJsonString(threadData, "toast");

      if (threadStatus === "published") {
        clearRecoveredLocalDraft();
        if (isDraftPreviewPage && detail.draftSourceId) {
          queueSuccessToast(publishedMsg);
          globalThis.location.assign(
            threadPermalink ?? globalThis.location.pathname,
          );
        } else if (isPageMode) {
          await refreshComposeCollections();
          resetPageCompose();
          toastMsg(publishedMsg);
        } else {
          queueSuccessToast(
            publishedMsg,
            threadPermalink
              ? { label: viewLabel, href: threadPermalink }
              : undefined,
          );
          globalThis.location.reload();
        }
      } else {
        clearRecoveredLocalDraft();
        if (isDraftPreviewPage && detail.draftSourceId) {
          queueSuccessToast(threadToast ?? "Draft saved.");
          globalThis.location.assign(globalThis.location.pathname);
          return;
        }
        await refreshComposeCollections();
        if (!leavePageAfterConfirmSave()) resetPageCompose();
        toastMsg(threadToast ?? "Draft saved.");
        dispatchSubmitComplete(composeEl, "draft");
      }
      return;
    }

    // ── Single-post submission ───────────────────────────────────────
    const requestAttachments = buildRequestAttachments(
      detail,
      mediaClientIdMap,
    );

    // Resolve any pending inline image placeholders (blob upload + paste rehost)
    // to their stored URLs before submitting.
    if (hasInlinePending) {
      try {
        const bodyJson = JSON.parse(detail.body);
        const resolved = await resolveInlineImageUrls(bodyJson);
        detail.body = resolved ? JSON.stringify(resolved) : "";
      } catch {
        // If resolution fails, keep original body — server will handle invalid URLs
      }
    }

    const endpoint = isEdit ? `/api/posts/${detail.editPostId}` : "/compose";
    const method = isEdit ? "PUT" : "POST";

    const bodyPayload = buildPostBody(
      {
        ...detail,
        status: draftFallback ? "draft" : detail.status,
      },
      requestAttachments,
    );

    const res = await fetch(endpoint, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(bodyPayload),
    });

    if (!res.ok) {
      // Server error on a new publish: retry as draft
      if (detail.status === "published" && !isEdit && !draftFallback) {
        const retryPayload = { ...bodyPayload, status: "draft" };
        const retryRes = await fetch(endpoint, {
          method,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(retryPayload),
        });

        if (retryRes.ok) {
          draftFallback = "server";
          clearRecoveredLocalDraft();
          const retryData = await readJsonObject(retryRes);
          const fallbackMsg =
            labels?.publishFailedDraft ?? "Couldn't publish. Saved as draft.";
          await refreshComposeCollections();
          if (!leavePageAfterConfirmSave()) {
            resetPageCompose();
          }
          toastMsg(fallbackMsg);
          const retryToast = getJsonString(retryData, "toast");
          if (retryToast) toastMsg(retryToast);
          return;
        }
      }

      const data = await readJsonObject(res);
      await handleSubmitError(
        getJsonString(data, "error") ?? "Something went wrong",
      );
      return;
    }

    if (isEdit) {
      clearRecoveredLocalDraft();
      const editData = await readJsonObject(res);
      const editPostId = detail.editPostId ?? "";
      const newSlug = getJsonString(editData, "slug");
      const nextStatus = getJsonString(editData, "status") ?? detail.status;
      const newPath = newSlug
        ? publicPath(
            nextStatus === "draft" ? `/preview/${newSlug}` : `/${newSlug}`,
          )
        : null;
      const editSuccessMessage =
        nextStatus === "draft"
          ? "Draft saved."
          : detail.draftSourceId
            ? publishedMsg
            : "Post updated.";

      // Draft preview pages cannot use the public post-view refresh endpoint.
      // Reload the authenticated preview so saved content stays visible.
      if (nextStatus === "draft") {
        if (isDraftPreviewPage) {
          queueSuccessToast(editSuccessMessage);
          globalThis.location.assign(newPath ?? globalThis.location.pathname);
          return;
        }

        // Drafts opened from the compose panel stay in that workflow. The
        // completion event lets a pending "save and open drafts" action fetch
        // the updated list only after the write has finished.
        await refreshComposeCollections();
        toastMsg(editSuccessMessage);
        dispatchSubmitComplete(composeEl, "draft");
        return;
      }

      if (isPageMode) {
        // On the post detail page: refresh or navigate if slug changed
        if (newPath && newPath !== globalThis.location.pathname) {
          queueSuccessToast(editSuccessMessage);
          globalThis.location.assign(newPath);
        } else {
          const refreshed =
            editPostId && (await refreshPostPageView(editPostId));
          if (!refreshed) {
            queueSuccessToast(editSuccessMessage);
            globalThis.location.assign(globalThis.location.pathname);
          } else {
            toastMsg(editSuccessMessage);
          }
        }
      } else if (editPostId) {
        // On the post detail page: refresh the full view
        const postView = document.querySelector<HTMLElement>(
          `[data-post-view][data-post-view-id="${editPostId}"]`,
        );
        if (postView) {
          if (newPath && newPath !== globalThis.location.pathname) {
            queueSuccessToast(editSuccessMessage);
            globalThis.location.assign(newPath);
            return;
          }
          const refreshed = await refreshPostPageView(editPostId);
          if (refreshed) {
            toastMsg(editSuccessMessage);
          } else {
            queueSuccessToast(editSuccessMessage);
            globalThis.location.reload();
          }
        } else {
          // On the timeline: try in-place refresh
          const article = document.querySelector<HTMLElement>(
            `article[data-post-id="${editPostId}"]`,
          );
          const threadRootId = article?.closest<HTMLElement>(
            "[data-timeline-item]",
          )?.dataset.threadRootId;
          const refreshed = threadRootId
            ? await refreshTimelineThreadView(threadRootId)
            : await refreshPostCardView(editPostId);
          if (refreshed) {
            toastMsg(editSuccessMessage);
          } else {
            queueSuccessToast(editSuccessMessage);
            globalThis.location.reload();
          }
        }
      } else {
        queueSuccessToast(editSuccessMessage);
        globalThis.location.reload();
      }
      return;
    }

    // Upload fallback: show specific message instead of normal flow
    if (draftFallback === "upload") {
      clearRecoveredLocalDraft();
      const fallbackMsg =
        labels?.uploadFailedDraft ?? "Some uploads failed. Saved as draft.";
      await refreshComposeCollections();
      resetPageCompose();
      toastMsg(fallbackMsg);
      return;
    }

    const data = await readJsonObject(res);
    const status = getJsonString(data, "status");
    const permalink = getJsonString(data, "permalink");
    const toast = getJsonString(data, "toast");

    if (status === "published") {
      clearRecoveredLocalDraft();
      if (isPageMode) {
        await refreshComposeCollections();
        resetPageCompose();
        toastMsg(publishedMsg);
      } else if (detail.replyToId) {
        await refreshComposeCollections();
        const updated = await refreshReplyTarget(detail);
        if (!updated) {
          queueSuccessToast(
            publishedMsg,
            permalink ? { label: viewLabel, href: permalink } : undefined,
          );
          globalThis.location.reload();
          return;
        }
        toastMsg(publishedMsg);
      } else {
        // Reload the page so the timeline picks up the new post via a
        // full assembleTimeline() pass (correct thread previews, filters, etc.)
        queueSuccessToast(
          publishedMsg,
          permalink ? { label: viewLabel, href: permalink } : undefined,
        );
        globalThis.location.reload();
      }
      return;
    } else {
      clearRecoveredLocalDraft();
      await refreshComposeCollections();
      if (!leavePageAfterConfirmSave()) {
        resetPageCompose();
      }
      toastMsg(toast ?? "Draft saved.");
      dispatchSubmitComplete(composeEl, "draft");
    }
  } catch {
    await handleSubmitError("Something went wrong");
  }
});

/**
 * Notify any interested listeners (e.g. the compose dialog waiting to open
 * its drafts panel) that a compose submission has finished writing to the
 * server. Dispatched on the compose element so it bubbles to the document.
 */
function dispatchSubmitComplete(
  composeEl: JantComposeDialog | null,
  status: "published" | "draft",
) {
  const target = composeEl ?? document;
  target.dispatchEvent(
    new CustomEvent("jant:compose-submit-complete", {
      bubbles: true,
      detail: { status },
    }),
  );
}
