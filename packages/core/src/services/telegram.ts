/**
 * Telegram Service
 *
 * Owns the two Telegram binding tables:
 *
 * - `telegram_pending_binding` — short-lived, single-use binding codes. One
 *   per site; regenerating replaces the previous code.
 * - `telegram_binding` — active links between a Telegram account and a site.
 *   One per site, and unique per `(bot_id, telegram_user_id)` so a Telegram
 *   account uses a distinct pool bot for each site it posts to.
 *
 * Code-lookup and binding-upsert methods are deliberately cross-site: the
 * webhook handler runs without a host-resolved site (hosted mode forwards the
 * webhook through the control plane), so it resolves the target site from the
 * binding tables instead. Site-scoped methods (`getStatus`, `generateCode`,
 * `disconnect`, and the bring-your-own-bot token management) operate on the
 * site this service instance was created for.
 */

import { and, eq } from "drizzle-orm";
import type { Database } from "../db/index.js";
import {
  sqliteSchemaBundle,
  type DatabaseSchema,
} from "../db/schema-bundle.js";
import { createEntityId } from "../lib/ids.js";
import { generateRandomId } from "../lib/nanoid.js";
import { now } from "../lib/time.js";
import {
  deleteWebhook,
  downloadFile,
  getFile,
  getMe,
  parseBotId,
  setMyCommands,
  setWebhook,
} from "../lib/telegram.js";
import { generateStorageKey, getPosterStorageKey } from "../lib/upload.js";
import type { StorageDriver } from "../lib/storage.js";
import type { Media, MediaKind } from "../types.js";
import { ValidationError } from "../lib/errors.js";
import type { MediaService } from "./media.js";

/** How long a freshly generated binding code stays valid (seconds). */
const BINDING_CODE_TTL = 30 * 60;
const BINDING_CODE_LENGTH = 12;

export interface TelegramBinding {
  id: string;
  siteId: string;
  botId: string;
  telegramUserId: string;
  telegramUsername: string | null;
  lastUpdateId: number | null;
  boundAt: number;
}

/** Kind of media held in a buffered album item. */
export type TelegramMediaGroupKind = "image" | "video" | "document";

/** A single buffered album item awaiting the rest of its group. */
export interface TelegramMediaGroupItem {
  id: string;
  siteId: string;
  botId: string;
  telegramUserId: string;
  mediaGroupId: string;
  chatId: number;
  messageId: number;
  updateId: number;
  fileId: string;
  mediaKind: TelegramMediaGroupKind;
  mimeType: string | null;
  originalName: string | null;
  captionMarkdown: string | null;
  /** Photo/video pixel dimensions from the original Telegram message. */
  width: number | null;
  height: number | null;
  /** Video duration in seconds, when applicable. */
  durationSeconds: number | null;
  /** Telegram thumbnail `file_id` for poster extraction at flush time. */
  posterFileId: string | null;
  createdAt: number;
}

export interface IngestTelegramMediaInput {
  /** Bot token used to fetch the file. */
  botToken: string;
  /** Identifier returned by Telegram for the file to download. */
  fileId: string;
  /** Human-readable name to record on the media row. */
  originalName: string;
  /** Effective MIME type; `image/jpeg` for compressed photos, falls back to `application/octet-stream`. */
  mimeType: string;
  /** Coarse classification for filtering and rendering. */
  mediaKind: MediaKind;
  /**
   * Optional pixel dimensions. Telegram always supplies these for photos and
   * videos, so passing them through lets timeline thumbnails reserve the
   * right aspect ratio instead of falling back to a default box.
   */
  width?: number;
  height?: number;
  /** Optional video duration in seconds. */
  durationSeconds?: number;
  /**
   * Optional Telegram `thumbnail.file_id` to download alongside the main file
   * and store as the media row's `posterKey`. Used for videos and previewable
   * documents so timeline thumbnails have a static frame to render before the
   * full asset loads.
   */
  posterFileId?: string;
}

export interface IngestTelegramMediaDeps {
  storage: StorageDriver;
  storageDriver: string;
  maxFileSizeMB: number;
  media: MediaService;
}

export interface BufferAlbumItemInput {
  siteId: string;
  botId: string;
  telegramUserId: string;
  mediaGroupId: string;
  chatId: number;
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
}

/** Bring-your-own-bot config stored per site (single-site, no env pool). */
export interface TelegramUserBot {
  botId: string;
  username: string;
}

export interface TelegramStatus {
  /** Active binding for this site, or null when nothing is connected. */
  binding: TelegramBinding | null;
  /**
   * The site's own bot, when the operator pasted a token in the settings
   * page. Null in env-managed-pool deployments (the route hides the token
   * field there) and before a token has been saved.
   */
  userBot: TelegramUserBot | null;
}

export interface TelegramService {
  /** Status for the current site — drives the settings page. */
  getStatus(): Promise<TelegramStatus>;
  /**
   * Return the current site's pending binding code, creating one when none
   * exists or the existing one has expired. Stable across page loads.
   */
  getOrCreateCode(): Promise<string>;
  /**
   * Replace the current site's pending binding code with a fresh one.
   *
   * @returns The new code; valid for 30 minutes and single-use.
   */
  generateCode(): Promise<string>;
  /** Remove the current site's active binding. */
  disconnect(): Promise<void>;
  /**
   * Resolve a pending binding code to its site.
   *
   * @param code - Code sent to the bot via `/start <code>`
   * @returns The owning site id, or null when unknown or expired.
   */
  resolvePendingCode(code: string): Promise<{ siteId: string } | null>;
  /**
   * Find the active binding for a `(botId, telegramUserId)` pair, across all
   * sites.
   */
  findBindingByUser(
    botId: string,
    telegramUserId: string,
  ): Promise<TelegramBinding | null>;
  /**
   * Bind a Telegram account to a site (or move an existing binding to it).
   *
   * Last-write-wins: any prior binding for the same `(botId, user)` and any
   * prior binding for the target site are dropped first, then a fresh row is
   * inserted. The site's pending code is consumed.
   */
  bindAccount(input: {
    siteId: string;
    botId: string;
    telegramUserId: string;
    telegramUsername: string | null;
  }): Promise<TelegramBinding>;
  /** Record the latest processed `update_id` for retry de-duplication. */
  markUpdateProcessed(bindingId: string, updateId: number): Promise<void>;
  /**
   * Bring-your-own-bot: validate a pasted token, register its webhook, and
   * persist it for this site. Used only when no env bot pool is configured.
   *
   * @param token - Full `<bot_id>:<secret>` bot token
   * @param webhookBaseUrl - Public origin (+ path prefix) of this site
   */
  connectUserBot(token: string, webhookBaseUrl: string): Promise<void>;
  /** Bring-your-own-bot: delete the webhook and clear the stored token. */
  removeUserBot(): Promise<void>;
  /**
   * Buffer one album item so the rest of its `media_group_id` can join it
   * before the post is published. Idempotent on `(botId, mediaGroupId,
   * messageId)` — duplicate Telegram retries are ignored.
   */
  bufferAlbumItem(input: BufferAlbumItemInput): Promise<void>;
  /**
   * Atomically remove every buffered row for `(botId, mediaGroupId)`. The
   * caller that wins the `DELETE ... RETURNING` race owns the group and
   * publishes the post; concurrent waking handlers see an empty result and
   * exit silently. Returns rows ordered by `messageId` so attachment order
   * matches the order the user typed in Telegram.
   */
  claimAlbumGroup(
    botId: string,
    mediaGroupId: string,
  ): Promise<TelegramMediaGroupItem[]>;
  /**
   * Download a Telegram-hosted file into Jant's media storage and create the
   * corresponding `media` row. The caller is responsible for attaching the
   * returned media to a post.
   *
   * Throws `ValidationError` when the file exceeds `deps.maxFileSizeMB`, and
   * propagates any `TelegramApiError` from `getFile`/`downloadFile`.
   */
  ingestMediaFile(
    input: IngestTelegramMediaInput,
    deps: IngestTelegramMediaDeps,
  ): Promise<Media>;
}

export function createTelegramService(
  db: Database,
  siteId: string,
  databaseSchema: DatabaseSchema = sqliteSchemaBundle,
): TelegramService {
  const {
    telegramBindings,
    telegramPendingBindings,
    telegramMediaGroupItems,
    settings,
  } = databaseSchema;

  async function readSetting(key: string): Promise<string | null> {
    const rows = await db
      .select({ value: settings.value })
      .from(settings)
      .where(and(eq(settings.siteId, siteId), eq(settings.key, key)))
      .limit(1);
    return rows[0]?.value ?? null;
  }

  async function writeSetting(key: string, value: string): Promise<void> {
    const timestamp = now();
    await db
      .insert(settings)
      .values({ siteId, key, value, updatedAt: timestamp })
      .onConflictDoUpdate({
        target: [settings.siteId, settings.key],
        set: { value, updatedAt: timestamp },
      });
  }

  async function findBindingForSite(
    targetSiteId: string,
  ): Promise<TelegramBinding | null> {
    const rows = await db
      .select()
      .from(telegramBindings)
      .where(eq(telegramBindings.siteId, targetSiteId))
      .limit(1);
    return rows[0] ?? null;
  }

  async function generateCode(): Promise<string> {
    const code = generateRandomId(BINDING_CODE_LENGTH);
    const timestamp = now();
    await db
      .insert(telegramPendingBindings)
      .values({
        id: createEntityId("telegramBindingCode"),
        siteId,
        code,
        createdAt: timestamp,
        expiresAt: timestamp + BINDING_CODE_TTL,
      })
      .onConflictDoUpdate({
        target: telegramPendingBindings.siteId,
        set: {
          code,
          createdAt: timestamp,
          expiresAt: timestamp + BINDING_CODE_TTL,
        },
      });
    return code;
  }

  return {
    async getStatus() {
      const binding = await findBindingForSite(siteId);
      const botId = await readSetting("TELEGRAM_BOT_ID");
      const username = await readSetting("TELEGRAM_BOT_USERNAME");
      return {
        binding,
        userBot: botId ? { botId, username: username ?? "" } : null,
      };
    },

    async getOrCreateCode() {
      const rows = await db
        .select()
        .from(telegramPendingBindings)
        .where(eq(telegramPendingBindings.siteId, siteId))
        .limit(1);
      const existing = rows[0];
      if (existing && existing.expiresAt > now()) {
        return existing.code;
      }
      return generateCode();
    },

    generateCode,

    async disconnect() {
      await db
        .delete(telegramBindings)
        .where(eq(telegramBindings.siteId, siteId));
    },

    async resolvePendingCode(code) {
      const rows = await db
        .select()
        .from(telegramPendingBindings)
        .where(eq(telegramPendingBindings.code, code))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      if (row.expiresAt < now()) {
        await db
          .delete(telegramPendingBindings)
          .where(eq(telegramPendingBindings.id, row.id));
        return null;
      }
      return { siteId: row.siteId };
    },

    async findBindingByUser(botId, telegramUserId) {
      const rows = await db
        .select()
        .from(telegramBindings)
        .where(
          and(
            eq(telegramBindings.botId, botId),
            eq(telegramBindings.telegramUserId, telegramUserId),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async bindAccount(input) {
      // Last-write-wins: clear any prior binding for this Telegram account
      // and any prior binding for the target site, then insert fresh. This
      // covers a first-time bind, a rebind to a different site, and
      // re-binding a site to a different account in one path.
      await db
        .delete(telegramBindings)
        .where(
          and(
            eq(telegramBindings.botId, input.botId),
            eq(telegramBindings.telegramUserId, input.telegramUserId),
          ),
        );
      await db
        .delete(telegramBindings)
        .where(eq(telegramBindings.siteId, input.siteId));

      const binding: TelegramBinding = {
        id: createEntityId("telegramBinding"),
        siteId: input.siteId,
        botId: input.botId,
        telegramUserId: input.telegramUserId,
        telegramUsername: input.telegramUsername,
        lastUpdateId: null,
        boundAt: now(),
      };
      await db.insert(telegramBindings).values(binding);
      await db
        .delete(telegramPendingBindings)
        .where(eq(telegramPendingBindings.siteId, input.siteId));
      return binding;
    },

    async markUpdateProcessed(bindingId, updateId) {
      await db
        .update(telegramBindings)
        .set({ lastUpdateId: updateId })
        .where(eq(telegramBindings.id, bindingId));
    },

    async connectUserBot(token, webhookBaseUrl) {
      const botId = parseBotId(token);
      if (!botId) {
        throw new Error("That doesn't look like a bot token.");
      }
      // Validates the token and surfaces a clear error for a bad one.
      const identity = await getMe(token);
      const secret = generateRandomId(32);
      const webhookUrl = `${webhookBaseUrl.replace(/\/+$/, "")}/api/telegram/webhook/${botId}`;
      await setWebhook(token, webhookUrl, secret);
      try {
        await setMyCommands(token);
      } catch {
        // `/` autocomplete is a polish feature — never fail the connect
        // flow over it. The webhook is set, the bot works.
      }
      await writeSetting("TELEGRAM_BOT_TOKEN", token);
      await writeSetting("TELEGRAM_BOT_ID", botId);
      await writeSetting("TELEGRAM_BOT_USERNAME", identity.username);
      await writeSetting("TELEGRAM_BOT_WEBHOOK_SECRET", secret);
    },

    async bufferAlbumItem(input) {
      // ON CONFLICT DO NOTHING keeps Telegram's retry semantics safe: the
      // same `(botId, mediaGroupId, messageId)` can arrive twice if the
      // first webhook response was lost, and we want the second one to be a
      // no-op rather than a duplicate row.
      await db
        .insert(telegramMediaGroupItems)
        .values({
          id: createEntityId("telegramMediaGroupItem"),
          siteId: input.siteId,
          botId: input.botId,
          telegramUserId: input.telegramUserId,
          mediaGroupId: input.mediaGroupId,
          chatId: input.chatId,
          messageId: input.messageId,
          updateId: input.updateId,
          fileId: input.fileId,
          mediaKind: input.mediaKind,
          mimeType: input.mimeType,
          originalName: input.originalName,
          captionMarkdown: input.captionMarkdown,
          width: input.width,
          height: input.height,
          durationSeconds: input.durationSeconds,
          posterFileId: input.posterFileId,
          createdAt: now(),
        })
        .onConflictDoNothing({
          target: [
            telegramMediaGroupItems.botId,
            telegramMediaGroupItems.mediaGroupId,
            telegramMediaGroupItems.messageId,
          ],
        });
    },

    async claimAlbumGroup(botId, mediaGroupId) {
      // `DELETE ... RETURNING` is atomic on both SQLite and Postgres, so two
      // handlers waking up at the same instant cannot both win the group —
      // whoever runs second gets an empty result and exits.
      const rows = await db
        .delete(telegramMediaGroupItems)
        .where(
          and(
            eq(telegramMediaGroupItems.botId, botId),
            eq(telegramMediaGroupItems.mediaGroupId, mediaGroupId),
          ),
        )
        .returning();
      return rows
        .map((row): TelegramMediaGroupItem => ({
          id: row.id,
          siteId: row.siteId,
          botId: row.botId,
          telegramUserId: row.telegramUserId,
          mediaGroupId: row.mediaGroupId,
          chatId: row.chatId,
          messageId: row.messageId,
          updateId: row.updateId,
          fileId: row.fileId,
          mediaKind: row.mediaKind as TelegramMediaGroupKind,
          mimeType: row.mimeType,
          originalName: row.originalName,
          captionMarkdown: row.captionMarkdown,
          width: row.width,
          height: row.height,
          durationSeconds: row.durationSeconds,
          posterFileId: row.posterFileId,
          createdAt: row.createdAt,
        }))
        .sort((a, b) => a.messageId - b.messageId);
    },

    async ingestMediaFile(input, deps) {
      const fileInfo = await getFile(input.botToken, input.fileId);
      if (!fileInfo.file_path) {
        throw new ValidationError(
          "Telegram returned no file path for the attachment.",
        );
      }
      const maxBytes = deps.maxFileSizeMB * 1024 * 1024;
      if (fileInfo.file_size !== undefined && fileInfo.file_size > maxBytes) {
        throw new ValidationError(
          `Attachment exceeds the ${deps.maxFileSizeMB} MB upload limit.`,
        );
      }

      const response = await downloadFile(input.botToken, fileInfo.file_path);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > maxBytes) {
        throw new ValidationError(
          `Attachment exceeds the ${deps.maxFileSizeMB} MB upload limit.`,
        );
      }

      await deps.media.assertCanWriteBytes(bytes.byteLength);

      const { id, filename, storageKey } = generateStorageKey(
        siteId,
        input.originalName,
      );

      // Telegram's CDN serves trusted bytes already validated on their side,
      // so we skip the signature peek that browser uploads need and just
      // pass the bytes straight through to storage.
      await deps.storage.put(storageKey, bytes, {
        contentType: input.mimeType,
        contentDisposition:
          input.mediaKind === "document" ? "attachment" : "inline",
        cacheControl: "public, max-age=31536000, immutable",
      });

      // Telegram videos and previewable documents carry a `thumbnail`
      // PhotoSize alongside the main file. It's already a small JPEG, so we
      // can store it directly as the media poster without any server-side
      // image decoding.
      let posterKey: string | undefined;
      if (input.posterFileId) {
        try {
          const posterFile = await getFile(input.botToken, input.posterFileId);
          if (posterFile.file_path) {
            const posterResp = await downloadFile(
              input.botToken,
              posterFile.file_path,
            );
            const posterBytes = new Uint8Array(await posterResp.arrayBuffer());
            posterKey = getPosterStorageKey(siteId, id, "jpg");
            await deps.storage.put(posterKey, posterBytes, {
              contentType: "image/jpeg",
              cacheControl: "public, max-age=31536000, immutable",
            });
          }
        } catch {
          // Posters are a nice-to-have; never fail the whole ingest if the
          // thumbnail download stumbles. The media row still publishes with
          // no posterKey and the timeline falls back to its default.
          posterKey = undefined;
        }
      }

      return deps.media.create({
        id,
        filename,
        originalName: input.originalName,
        mimeType: input.mimeType,
        size: bytes.byteLength,
        storageKey,
        provider: deps.storageDriver,
        mediaKind: input.mediaKind,
        width: input.width,
        height: input.height,
        durationSeconds: input.durationSeconds,
        posterKey,
      });
    },

    async removeUserBot() {
      const token = await readSetting("TELEGRAM_BOT_TOKEN");
      if (token) {
        try {
          await deleteWebhook(token);
        } catch {
          // The bot or webhook may already be gone — clearing local state
          // is what matters, so don't block on Telegram's response.
        }
      }
      await writeSetting("TELEGRAM_BOT_TOKEN", "");
      await writeSetting("TELEGRAM_BOT_ID", "");
      await writeSetting("TELEGRAM_BOT_USERNAME", "");
      await writeSetting("TELEGRAM_BOT_WEBHOOK_SECRET", "");
      await db
        .delete(telegramBindings)
        .where(eq(telegramBindings.siteId, siteId));
    },
  };
}
