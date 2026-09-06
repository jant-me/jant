/**
 * Telegram Webhook Route
 *
 * Receives Telegram bot updates and turns text messages into Notes.
 *
 * One route serves both deployment modes. It is host-agnostic: it never
 * trusts the request hostname (in hosted mode the update is forwarded through
 * the control plane and arrives without a tenant host). The target site is
 * resolved from the binding tables — by `(botId, telegramUserId)` for a normal
 * message, or by the pending binding `code` for a `/start <code>`.
 *
 * Authentication is the Telegram `secret_token` echoed in the
 * `X-Telegram-Bot-Api-Secret-Token` header — the same auth model whether the
 * webhook is delivered straight to a self-hosted site or forwarded by the
 * hosted control plane.
 */

import { Hono } from "hono";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import {
  getConfiguredStorageDriver,
  getEnvString,
  getTelegramBotPool,
  getTelegramWebhookSecret,
} from "../../lib/env.js";
import { timingSafeEqualText } from "../../lib/crypto.js";
import { runDeferred } from "../../lib/deferred.js";
import {
  answerCallbackQuery,
  buildDeepLink,
  getMe,
  sendMessage,
  type TelegramInlineButton,
  type TelegramMessage,
  type TelegramUpdate,
} from "../../lib/telegram.js";
import { entitiesToMarkdown } from "../../lib/telegram-entities.js";
import type { MediaKind, PostAttachmentInput } from "../../types.js";
import type {
  IngestTelegramMediaInput,
  TelegramMediaGroupKind,
} from "../../services/telegram.js";

/** Message-derived ingest payload; the bot token is added at the call site. */
type MessageMedia = Omit<IngestTelegramMediaInput, "botToken">;

/**
 * How long to hold each album item in the buffer before claiming the group.
 *
 * Telegram delivers album webhook updates within tens of milliseconds of one
 * another, so 2 s is generous enough to collect every item without making the
 * publish noticeably slow. The wait runs in-line on the webhook handler, so a
 * shorter value risks splitting an album into multiple posts and a longer one
 * delays the bot's "Posted." reply.
 */
const ALBUM_BUFFER_DELAY_MS = 2_000;

/**
 * The Telegram webhook intentionally bypasses the site-resolution middleware
 * chain, so `c.var.appConfig` is not populated here. The two upload settings
 * the media flow needs are env-driven anyway, so read them straight from the
 * bindings without rebuilding the full appConfig.
 */
function uploadConfigFromEnv(env: Bindings): {
  storageDriver: string;
  maxFileSizeMB: number;
} {
  const maxFileSizeMB =
    parseInt(getEnvString(env, "UPLOAD_MAX_FILE_SIZE_MB") ?? "1024", 10) ||
    1024;
  return {
    storageDriver: getConfiguredStorageDriver(env),
    maxFileSizeMB,
  };
}

type Env = { Bindings: Bindings; Variables: AppVariables };

export const telegramWebhookRoutes = new Hono<Env>();

/**
 * Bot id → username cache. `getMe` results are stable for a bot's lifetime,
 * so this avoids an API round-trip per webhook when building deep links.
 */
const botUsernameCache = new Map<string, string>();

async function resolveBotUsername(
  botId: string,
  token: string,
): Promise<string> {
  const cached = botUsernameCache.get(botId);
  if (cached) return cached;
  try {
    const identity = await getMe(token);
    if (identity.username) {
      botUsernameCache.set(botId, identity.username);
    }
    return identity.username;
  } catch {
    return "";
  }
}

/** Resolves the bot token + expected webhook secret for an incoming request. */
async function resolveBot(
  c: { env: Bindings; var: AppVariables },
  botId: string,
): Promise<{ token: string; secret: string } | null> {
  const pool = getTelegramBotPool(c.env);
  if (pool.length > 0) {
    const bot = pool.find((entry) => entry.botId === botId);
    const secret = getTelegramWebhookSecret(c.env);
    if (!bot || !secret) return null;
    return { token: bot.token, secret };
  }

  // Bring-your-own bot: config lives in the resolved site's settings. The
  // webhook hits the site's own host in this mode, so `c.var.services` is
  // already scoped to the right site.
  const settings = c.var.services.settings;
  const storedBotId = await settings.get("TELEGRAM_BOT_ID");
  if (storedBotId !== botId) return null;
  const token = await settings.get("TELEGRAM_BOT_TOKEN");
  const secret = await settings.get("TELEGRAM_BOT_WEBHOOK_SECRET");
  if (!token || !secret) return null;
  return { token, secret };
}

async function siteName(
  c: { var: AppVariables },
  siteId: string,
): Promise<string> {
  const name = await c.var.servicesForSite(siteId).settings.get("SITE_NAME");
  return name && name.trim() ? name.trim() : "your site";
}

telegramWebhookRoutes.post("/webhook/:botId", async (c) => {
  const botId = c.req.param("botId");
  const bot = await resolveBot(c, botId);
  if (!bot) {
    return c.json({ error: "Unknown bot" }, 404);
  }

  const providedSecret = c.req.header("X-Telegram-Bot-Api-Secret-Token") ?? "";
  if (!timingSafeEqualText(providedSecret, bot.secret)) {
    return c.json({ error: "Invalid secret token" }, 401);
  }

  let update: TelegramUpdate;
  try {
    update = (await c.req.json()) as TelegramUpdate;
  } catch {
    return c.json({ error: "Invalid JSON payload" }, 400);
  }

  // Telegram retries failed deliveries; a slow handler causes duplicate
  // posts. Process inline (posting a note is fast) but never let an error
  // escape — Telegram only needs a 200, and the user-facing error goes back
  // as a chat message so the sender knows something went wrong instead of
  // staring at a silent client.
  try {
    await processUpdate(c, update, botId, bot.token);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console -- Webhook failures must be visible in server logs.
    console.error(`[Jant] Telegram webhook error: ${message}`);
    const chatId =
      update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    if (chatId) {
      await sendMessage(
        bot.token,
        chatId,
        `Couldn't process that message: ${message}`,
      ).catch(() => undefined);
    }
  }

  return c.json({ ok: true });
});

async function processUpdate(
  c: { env: Bindings; var: AppVariables },
  update: TelegramUpdate,
  botId: string,
  botToken: string,
): Promise<void> {
  const telegram = c.var.services.telegram;

  // --- Inline keyboard tap (ambiguous-bind resolution) ---
  if (update.callback_query) {
    const query = update.callback_query;
    await answerCallbackQuery(botToken, query.id);
    const chatId = query.message?.chat.id;
    if (!chatId) return;

    const [action, code] = (query.data ?? "").split(":");
    const pending = code ? await telegram.resolvePendingCode(code) : null;
    if (!pending) {
      await sendMessage(
        botToken,
        chatId,
        "That binding code expired. Open Telegram settings in Jant for a fresh one.",
      );
      return;
    }
    if (action === "rebind") {
      await telegram.bindAccount({
        siteId: pending.siteId,
        botId,
        telegramUserId: String(query.from.id),
        telegramUsername: query.from.username ?? null,
      });
      await sendMessage(
        botToken,
        chatId,
        `Connected to ${await siteName(c, pending.siteId)}. Send me any text and I'll post it as a note.`,
      );
    }
    return;
  }

  // --- Message ---
  const message = update.message;
  if (!message?.from) return;
  const chatId = message.chat.id;
  const telegramUserId = String(message.from.id);
  const text = (message.text ?? "").trim();

  // `/start <code>` — binding flow.
  if (text === "/start" || text.startsWith("/start ")) {
    const code = text.slice("/start".length).trim();
    if (!code) {
      await sendMessage(
        botToken,
        chatId,
        "Open Telegram settings in Jant and tap Connect to link this chat.",
      );
      return;
    }
    await handleStart(c, {
      botId,
      botToken,
      chatId,
      code,
      telegramUserId,
      telegramUsername: message.from.username ?? null,
    });
    return;
  }

  // Plain message — publish as a note.
  const binding = await telegram.findBindingByUser(botId, telegramUserId);
  if (!binding) {
    // Defensive: users who copy the binding code without the `/start `
    // prefix still get bound. The settings page formats the code as
    // `/start CODE`, but a fraction of users will paste only the trailing
    // token. Codes are lowercase alphanumeric (see lib/nanoid.ts) and
    // short, so the false-positive surface is tiny.
    if (/^[0-9a-z]+$/.test(text) && text.length <= 24) {
      const pending = await telegram.resolvePendingCode(text);
      if (pending) {
        await handleStart(c, {
          botId,
          botToken,
          chatId,
          code: text,
          telegramUserId,
          telegramUsername: message.from.username ?? null,
        });
        return;
      }
    }
    await sendMessage(
      botToken,
      chatId,
      "This chat isn't connected yet. Open Telegram settings in Jant to get a binding code.",
    );
    return;
  }
  // Retry de-duplication: Telegram resends on a missed 200.
  if (
    binding.lastUpdateId !== null &&
    update.update_id <= binding.lastUpdateId
  ) {
    return;
  }

  const media = extractMediaIngestInput(message);

  // --- Album item: buffer, ACK Telegram, then claim+publish in background. ---
  //
  // Telegram delivers webhooks for the SAME chat strictly sequentially — the
  // next update isn't sent until the previous one's 200 lands. If we waited
  // inline for the buffer window, the second album item couldn't arrive
  // during the wait and we'd publish each item as its own post. Returning
  // 200 immediately lets sibling items queue into the buffer while the first
  // arrival's background job sleeps.
  if (message.media_group_id && media) {
    const mediaGroupId = message.media_group_id;
    await telegram.bufferAlbumItem({
      siteId: binding.siteId,
      botId,
      telegramUserId,
      mediaGroupId,
      chatId,
      messageId: message.message_id,
      updateId: update.update_id,
      fileId: media.fileId,
      mediaKind: mediaKindToAlbumKind(media.mediaKind),
      mimeType: media.mimeType,
      originalName: media.originalName,
      captionMarkdown: captionMarkdown(message),
      width: media.width ?? null,
      height: media.height ?? null,
      durationSeconds: media.durationSeconds ?? null,
      posterFileId: media.posterFileId ?? null,
    });

    runDeferred(c, "Telegram", async () => {
      await sleep(ALBUM_BUFFER_DELAY_MS);
      const claimed = await telegram.claimAlbumGroup(botId, mediaGroupId);
      if (claimed.length === 0) return;
      await publishAlbum(c, { botToken, chatId, binding, items: claimed });
    });
    return;
  }

  // --- Single media item (no album). ---
  if (media) {
    await publishSingleMedia(c, {
      botToken,
      chatId,
      binding,
      media,
      captionMarkdown: captionMarkdown(message),
      updateId: update.update_id,
    });
    return;
  }

  // --- Plain text note. ---
  if (text) {
    // Fold Telegram's rich-text entities back into markdown so bold/italic/
    // code/links typed in the Telegram client survive into the published note.
    // Entity offsets index into the raw `message.text`, so convert first and
    // trim the resulting markdown only at the very end.
    const bodyMarkdown = entitiesToMarkdown(
      message.text ?? "",
      message.entities,
    ).trim();
    await c.var.servicesForSite(binding.siteId).posts.create({
      format: "note",
      bodyMarkdown,
      status: "published",
      visibility: "public",
    });
    await telegram.markUpdateProcessed(binding.id, update.update_id);
    await sendMessage(botToken, chatId, "Posted.");
    return;
  }

  // Unsupported attachment kind (voice, sticker, animation, …).
  await sendMessage(
    botToken,
    chatId,
    "I can post text, photos, videos, and documents. Other message types aren't supported yet.",
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Convert a message's caption + caption_entities into markdown, returning
 * `null` when there's nothing to record. Centralized so single-media and album
 * code paths can't drift apart on entity handling.
 */
function captionMarkdown(message: TelegramMessage): string | null {
  if (!message.caption) return null;
  const md = entitiesToMarkdown(
    message.caption,
    message.caption_entities,
  ).trim();
  return md || null;
}

/**
 * Pick the single ingestable media payload from a Telegram message, if any.
 *
 * Telegram never sends multiple media kinds on one message, so a `switch`-like
 * waterfall is sufficient — albums duplicate the message N times rather than
 * stuffing arrays into one message.
 */
function extractMediaIngestInput(
  message: TelegramMessage,
): MessageMedia | null {
  // Photos arrive as an array of sizes ordered low → high; the last entry is
  // the highest-resolution rendition Telegram chose for the recipient.
  if (message.photo && message.photo.length > 0) {
    const largest = message.photo[message.photo.length - 1];
    if (!largest) return null;
    return {
      fileId: largest.file_id,
      originalName: `telegram-photo-${message.message_id}.jpg`,
      mimeType: "image/jpeg",
      mediaKind: "image",
      width: largest.width,
      height: largest.height,
    };
  }
  if (message.video) {
    const v = message.video;
    return {
      fileId: v.file_id,
      originalName: v.file_name ?? `telegram-video-${message.message_id}.mp4`,
      mimeType: v.mime_type ?? "video/mp4",
      mediaKind: "video",
      width: v.width,
      height: v.height,
      durationSeconds: v.duration,
      // Telegram pre-renders a small JPEG thumbnail for every video. Saving
      // it as the media poster gives the timeline a static frame to show
      // before the full video element loads.
      posterFileId: v.thumbnail?.file_id,
    };
  }
  if (message.document) {
    const d = message.document;
    const docKind = documentMediaKind(d.mime_type);
    return {
      fileId: d.file_id,
      originalName:
        d.file_name ?? `telegram-document-${message.message_id}.bin`,
      mimeType: d.mime_type ?? "application/octet-stream",
      mediaKind: docKind,
      // Telegram only ships thumbnails for media-shaped documents (videos
      // sent as files, large images). Documents like PDFs may not include
      // one; the optional chain handles both cases.
      posterFileId: docKind === "video" ? d.thumbnail?.file_id : undefined,
    };
  }
  return null;
}

/**
 * Decide which `mediaKind` slot a document belongs in. Telegram lets users
 * send a photo as a "file" to skip compression, in which case the document's
 * mime_type is still `image/*`; classify those as images so they render in the
 * site's image flow rather than the attachment list.
 */
function documentMediaKind(mime: string | undefined): MediaKind {
  if (!mime) return "document";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("text/")) return "text";
  return "document";
}

async function publishSingleMedia(
  c: { env: Bindings; var: AppVariables },
  input: {
    botToken: string;
    chatId: number;
    binding: { id: string; siteId: string };
    media: MessageMedia;
    captionMarkdown: string | null;
    updateId: number;
  },
): Promise<void> {
  const siteSvcs = c.var.servicesForSite(input.binding.siteId);
  const storage = c.var.storage;
  if (!storage) {
    await sendMessage(
      input.botToken,
      input.chatId,
      "File storage isn't set up on this site, so I can't accept attachments.",
    );
    return;
  }

  const uploadConfig = uploadConfigFromEnv(c.env);
  const ingested = await siteSvcs.telegram.ingestMediaFile(
    { ...input.media, botToken: input.botToken },
    {
      storage,
      ...uploadConfig,
      media: siteSvcs.media,
    },
  );

  const attachments: PostAttachmentInput[] = [
    { type: "media", mediaId: ingested.id },
  ];

  await siteSvcs.posts.createWithAttachments(
    {
      format: "note",
      bodyMarkdown: input.captionMarkdown ?? "",
      status: "published",
      visibility: "public",
    },
    attachments,
    {
      media: siteSvcs.media,
      storage,
      ...uploadConfig,
    },
  );

  await c.var.services.telegram.markUpdateProcessed(
    input.binding.id,
    input.updateId,
  );
  await sendMessage(input.botToken, input.chatId, "Posted.");
}

async function publishAlbum(
  c: { env: Bindings; var: AppVariables },
  input: {
    botToken: string;
    chatId: number;
    binding: { id: string; siteId: string };
    items: Array<{
      messageId: number;
      updateId: number;
      fileId: string;
      mediaKind: TelegramMediaGroupKind;
      mimeType: string | null;
      originalName: string | null;
      captionMarkdown: string | null;
      width: number | null;
      height: number | null;
      durationSeconds: number | null;
      posterFileId: string | null;
    }>;
  },
): Promise<void> {
  const siteSvcs = c.var.servicesForSite(input.binding.siteId);
  const storage = c.var.storage;
  if (!storage) {
    await sendMessage(
      input.botToken,
      input.chatId,
      "File storage isn't set up on this site, so I can't accept attachments.",
    );
    return;
  }

  // Telegram only carries one caption per album (typically on the first item).
  // Take the first non-empty one in message order so the post body reflects
  // what the user actually typed.
  const bodyMarkdown =
    input.items.find((i) => i.captionMarkdown)?.captionMarkdown ?? "";

  const uploadConfig = uploadConfigFromEnv(c.env);

  // Run downloads in parallel — they're independent and disk/network bound;
  // serializing would multiply the publish latency by the album size.
  const mediaRecords = await Promise.all(
    input.items.map((item) =>
      siteSvcs.telegram.ingestMediaFile(
        {
          botToken: input.botToken,
          fileId: item.fileId,
          originalName:
            item.originalName ??
            defaultAlbumName(item.messageId, item.mediaKind),
          mimeType: item.mimeType ?? defaultAlbumMime(item.mediaKind),
          mediaKind: albumKindToMediaKind(item.mediaKind),
          width: item.width ?? undefined,
          height: item.height ?? undefined,
          durationSeconds: item.durationSeconds ?? undefined,
          posterFileId: item.posterFileId ?? undefined,
        },
        {
          storage,
          ...uploadConfig,
          media: siteSvcs.media,
        },
      ),
    ),
  );

  const attachments: PostAttachmentInput[] = mediaRecords.map((m) => ({
    type: "media",
    mediaId: m.id,
  }));

  await siteSvcs.posts.createWithAttachments(
    {
      format: "note",
      bodyMarkdown,
      status: "published",
      visibility: "public",
    },
    attachments,
    {
      media: siteSvcs.media,
      storage,
      ...uploadConfig,
    },
  );

  // Mark the latest update_id as processed so a Telegram retry of any one
  // item in the group is a no-op.
  const maxUpdateId = Math.max(...input.items.map((i) => i.updateId));
  await c.var.services.telegram.markUpdateProcessed(
    input.binding.id,
    maxUpdateId,
  );
  await sendMessage(input.botToken, input.chatId, "Posted.");
}

function defaultAlbumName(
  messageId: number,
  kind: TelegramMediaGroupKind,
): string {
  switch (kind) {
    case "image":
      return `telegram-photo-${messageId}.jpg`;
    case "video":
      return `telegram-video-${messageId}.mp4`;
    default:
      return `telegram-document-${messageId}.bin`;
  }
}

function defaultAlbumMime(kind: TelegramMediaGroupKind): string {
  switch (kind) {
    case "image":
      return "image/jpeg";
    case "video":
      return "video/mp4";
    default:
      return "application/octet-stream";
  }
}

function albumKindToMediaKind(kind: TelegramMediaGroupKind): MediaKind {
  // The buffered `media_kind` mirrors what we recorded at intake; documents
  // have already been classified by mime by then, so the mapping is direct.
  return kind === "image" ? "image" : kind === "video" ? "video" : "document";
}

/**
 * Reduce a fine-grained `MediaKind` to the coarse `TelegramMediaGroupKind`
 * the buffer table understands. `audio` and `text` documents both fold into
 * `document` because the buffer only cares about which download path applies.
 */
function mediaKindToAlbumKind(kind: MediaKind): TelegramMediaGroupKind {
  if (kind === "image") return "image";
  if (kind === "video") return "video";
  return "document";
}

async function handleStart(
  c: { env: Bindings; var: AppVariables },
  input: {
    botId: string;
    botToken: string;
    chatId: number;
    code: string;
    telegramUserId: string;
    telegramUsername: string | null;
  },
): Promise<void> {
  const telegram = c.var.services.telegram;
  const pending = await telegram.resolvePendingCode(input.code);
  if (!pending) {
    await sendMessage(
      input.botToken,
      input.chatId,
      "That binding code is invalid or expired. Get a fresh one from Jant settings.",
    );
    return;
  }

  const existing = await telegram.findBindingByUser(
    input.botId,
    input.telegramUserId,
  );

  // Already connected through this bot to the same site — nothing to do.
  if (existing && existing.siteId === pending.siteId) {
    await sendMessage(
      input.botToken,
      input.chatId,
      "This chat is already connected. Send me any text to post a note.",
    );
    return;
  }

  // This bot is taken by a different site. The intent is ambiguous — the
  // user might want to move this bot, or keep it and use a free pool bot for
  // the new site — so offer an explicit choice instead of guessing.
  if (existing) {
    const buttons: TelegramInlineButton[][] = [
      [
        {
          text: `Rebind this bot to ${await siteName(c, pending.siteId)}`,
          callback_data: `rebind:${input.code}`,
        },
      ],
    ];
    for (const other of getTelegramBotPool(c.env)) {
      if (other.botId === input.botId) continue;
      const taken = await telegram.findBindingByUser(
        other.botId,
        input.telegramUserId,
      );
      if (taken) continue;
      const username = await resolveBotUsername(other.botId, other.token);
      if (!username) continue;
      buttons.push([
        {
          text: `Connect to @${username} instead`,
          url: buildDeepLink(username, input.code),
        },
      ]);
    }
    await sendMessage(
      input.botToken,
      input.chatId,
      `This bot is already connected to ${await siteName(c, existing.siteId)}. Choose how to connect ${await siteName(c, pending.siteId)}:`,
      { inline_keyboard: buttons },
    );
    return;
  }

  // Fresh bind.
  await telegram.bindAccount({
    siteId: pending.siteId,
    botId: input.botId,
    telegramUserId: input.telegramUserId,
    telegramUsername: input.telegramUsername,
  });
  await sendMessage(
    input.botToken,
    input.chatId,
    `Connected to ${await siteName(c, pending.siteId)}. Send me any text and I'll post it as a note.`,
  );
}
