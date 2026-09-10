import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { DEFAULT_TEST_SITE_ID } from "../../../__tests__/helpers/db.js";
import { telegramWebhookRoutes } from "../telegram.js";
import type { StorageDriver } from "../../../lib/storage.js";
import type { DeferredPendingEnv } from "../../../lib/deferred.js";

const BOT_ID = "111111";
const BOT_TOKEN = `${BOT_ID}:AA-test-token`;
const SECRET = "test-webhook-secret";
const USER_ID = 999999;

/** Records every outbound Telegram API call so tests can assert on them. */
interface TelegramCall {
  method: string;
  body: Record<string, unknown>;
}

interface MockTelegramOptions {
  /**
   * Map of `file_id` → bytes returned by the file CDN. `getFile` resolves a
   * `file_id` to a synthetic `file_path` of the form `mock/<file_id>` so the
   * download stub can locate the matching bytes by inspecting the URL.
   */
  files?: Map<string, Uint8Array>;
}

function mockTelegramFetch(opts: MockTelegramOptions = {}): TelegramCall[] {
  const calls: TelegramCall[] = [];
  const files = opts.files ?? new Map<string, Uint8Array>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: unknown }) => {
      const urlStr = String(url);
      // File download: /file/bot<token>/<file_path>
      if (urlStr.includes("/file/bot")) {
        const filePath =
          urlStr.split("/file/bot")[1]?.split("/").slice(1).join("/") ?? "";
        const fileId = filePath.replace(/^mock\//, "");
        const bytes =
          files.get(fileId) ?? new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
        return new Response(bytes);
      }
      // Method call: /bot<token>/<method>
      const method = urlStr.split("/").pop() ?? "";
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      calls.push({ method, body });
      let result: unknown = true;
      if (method === "getMe") {
        result = { id: Number(BOT_ID), username: "JantTestBot" };
      } else if (method === "getFile") {
        const fileId = String((body as { file_id?: string }).file_id ?? "");
        const bytes = files.get(fileId);
        result = {
          file_id: fileId,
          file_unique_id: fileId,
          file_path: `mock/${fileId}`,
          file_size: bytes?.byteLength,
        };
      }
      return new Response(JSON.stringify({ ok: true, result }), {
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

/** Minimal in-memory storage so the webhook can persist downloaded files. */
function createMockStorage(): StorageDriver & {
  files: Map<string, { body: Uint8Array; contentType?: string }>;
} {
  const files = new Map<string, { body: Uint8Array; contentType?: string }>();
  return {
    files,
    async put(key, body, opts) {
      const bytes =
        body instanceof Uint8Array
          ? body
          : new Uint8Array(await new Response(body).arrayBuffer());
      files.set(key, { body: bytes, contentType: opts?.contentType });
    },
    async get(key) {
      const file = files.get(key);
      if (!file) return null;
      return {
        body: new Response(file.body).body as ReadableStream,
        size: file.body.byteLength,
        contentType: file.contentType,
        etag: "",
        uploaded: new Date(),
      };
    },
    async head(key) {
      const file = files.get(key);
      if (!file) return null;
      return {
        size: file.body.byteLength,
        contentType: file.contentType,
        etag: "",
        uploaded: new Date(),
      };
    },
    async delete(key) {
      files.delete(key);
    },
  };
}

function setup(
  options: { storage?: ReturnType<typeof createMockStorage> | null } = {},
) {
  const ctx = createTestApp({
    telegramBotTokens: BOT_TOKEN,
    telegramWebhookSecret: SECRET,
    storage: options.storage ?? null,
  });

  // The webhook ACKs Telegram immediately and runs the album flush in
  // detached promises so subsequent webhooks on the same chat aren't
  // serialized behind it. Tests have no `executionCtx.waitUntil`, so
  // `runDeferred` falls back to writing each promise into
  // `env.__pendingDeferred` — collect them here so tests can await the flush
  // before asserting.
  const pending: Promise<unknown>[] = [];
  ctx.app.use("/api/telegram/*", async (c, next) => {
    (c.env as DeferredPendingEnv).__pendingDeferred = pending;
    return next();
  });
  ctx.app.route("/api/telegram", telegramWebhookRoutes);
  return { ...ctx, pending };
}

function post(
  app: ReturnType<typeof setup>["app"],
  botId: string,
  secret: string | null,
  update: unknown,
) {
  return app.request(`/api/telegram/webhook/${botId}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret === null ? {} : { "x-telegram-bot-api-secret-token": secret }),
    },
    body: JSON.stringify(update),
  });
}

function textUpdate(updateId: number, text: string) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      from: { id: USER_ID, is_bot: false, first_name: "Al", username: "al" },
      chat: { id: USER_ID },
      text,
    },
  };
}

function countPosts(sqlite: ReturnType<typeof setup>["sqlite"]): number {
  return (
    sqlite.prepare("SELECT COUNT(*) AS n FROM post").get() as { n: number }
  ).n;
}

describe("Telegram webhook route", () => {
  let calls: TelegramCall[];

  beforeEach(() => {
    calls = mockTelegramFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects a request with a bad secret token", async () => {
    const { app } = setup();
    const res = await post(app, BOT_ID, "wrong-secret", textUpdate(1, "hi"));
    expect(res.status).toBe(401);
  });

  it("rejects a request for an unknown bot", async () => {
    const { app } = setup();
    const res = await post(app, "222222", SECRET, textUpdate(1, "hi"));
    expect(res.status).toBe(404);
  });

  it("publishes a note for a bound user's text message", async () => {
    const { app, services, sqlite } = setup();
    await services.telegram.bindAccount({
      siteId: DEFAULT_TEST_SITE_ID,
      botId: BOT_ID,
      telegramUserId: String(USER_ID),
      telegramUsername: "al",
    });

    const res = await post(app, BOT_ID, SECRET, textUpdate(5, "hello world"));
    expect(res.status).toBe(200);
    expect(countPosts(sqlite)).toBe(1);
    expect(calls.some((c) => c.method === "sendMessage")).toBe(true);
  });

  it("folds telegram entities into markdown on the saved post body", async () => {
    const { app, services, sqlite } = setup();
    await services.telegram.bindAccount({
      siteId: DEFAULT_TEST_SITE_ID,
      botId: BOT_ID,
      telegramUserId: String(USER_ID),
      telegramUsername: "al",
    });

    const res = await post(app, BOT_ID, SECRET, {
      update_id: 11,
      message: {
        message_id: 11,
        from: { id: USER_ID, is_bot: false, first_name: "Al", username: "al" },
        chat: { id: USER_ID },
        text: "hello bold world",
        entities: [{ type: "bold", offset: 6, length: 4 }],
      },
    });
    expect(res.status).toBe(200);
    // The post body is stored as the parsed ProseMirror JSON, so the
    // round-trip proof is that the word "bold" carries a `bold` mark — that
    // can only happen if entitiesToMarkdown emitted `**bold**` for the
    // markdown parser to pick up.
    const row = sqlite
      .prepare("SELECT body FROM post ORDER BY rowid DESC LIMIT 1")
      .get() as { body: string };
    const doc = JSON.parse(row.body) as {
      content: Array<{
        content: Array<{ text: string; marks?: Array<{ type: string }> }>;
      }>;
    };
    const spans = doc.content[0].content;
    expect(spans.find((s) => s.text === "bold")?.marks).toEqual([
      { type: "bold" },
    ]);
  });

  it("skips a duplicate update id", async () => {
    const { app, services, sqlite } = setup();
    await services.telegram.bindAccount({
      siteId: DEFAULT_TEST_SITE_ID,
      botId: BOT_ID,
      telegramUserId: String(USER_ID),
      telegramUsername: "al",
    });

    await post(app, BOT_ID, SECRET, textUpdate(7, "first"));
    await post(app, BOT_ID, SECRET, textUpdate(7, "first again"));
    expect(countPosts(sqlite)).toBe(1);
  });

  it("declines an unsupported message type without posting", async () => {
    const { app, services, sqlite } = setup();
    await services.telegram.bindAccount({
      siteId: DEFAULT_TEST_SITE_ID,
      botId: BOT_ID,
      telegramUserId: String(USER_ID),
      telegramUsername: "al",
    });

    const res = await post(app, BOT_ID, SECRET, {
      update_id: 9,
      message: {
        message_id: 9,
        from: { id: USER_ID, is_bot: false, first_name: "Al" },
        chat: { id: USER_ID },
        // Voice notes aren't on the supported list; the handler should reply
        // explaining what it accepts instead of posting anything.
        voice: { file_id: "vf", file_unique_id: "vu", duration: 3 },
      },
    });
    expect(res.status).toBe(200);
    expect(countPosts(sqlite)).toBe(0);
    const reply = calls.find((c) => c.method === "sendMessage");
    expect(String(reply?.body.text)).toMatch(/photos, videos, and documents/);
  });

  it("posts a photo as a note with the photo attached", async () => {
    const photoBytes = new Uint8Array([1, 2, 3, 4, 5]);
    calls = mockTelegramFetch({
      files: new Map([["photo-file-id", photoBytes]]),
    });
    const storage = createMockStorage();
    const { app, services, sqlite } = setup({ storage });
    await services.telegram.bindAccount({
      siteId: DEFAULT_TEST_SITE_ID,
      botId: BOT_ID,
      telegramUserId: String(USER_ID),
      telegramUsername: "al",
    });

    const res = await post(app, BOT_ID, SECRET, {
      update_id: 50,
      message: {
        message_id: 50,
        from: { id: USER_ID, is_bot: false, first_name: "Al" },
        chat: { id: USER_ID },
        photo: [
          { file_id: "small", file_unique_id: "su", width: 90, height: 90 },
          {
            file_id: "photo-file-id",
            file_unique_id: "pu",
            width: 1280,
            height: 720,
          },
        ],
      },
    });

    expect(res.status).toBe(200);
    expect(countPosts(sqlite)).toBe(1);

    // The media row points at the stored object, and the post is wired to it
    // via the post_id column.
    const mediaRows = sqlite
      .prepare("SELECT id, mime_type, media_kind, size, post_id FROM media")
      .all() as Array<{
      id: string;
      mime_type: string;
      media_kind: string;
      size: number;
      post_id: string | null;
    }>;
    expect(mediaRows.length).toBe(1);
    expect(mediaRows[0]?.mime_type).toBe("image/jpeg");
    expect(mediaRows[0]?.media_kind).toBe("image");
    expect(mediaRows[0]?.size).toBe(photoBytes.byteLength);
    expect(mediaRows[0]?.post_id).not.toBeNull();
    expect(storage.files.size).toBe(1);

    // `getFile` was called with the highest-resolution `file_id` from the
    // photo array, never the smaller thumbnails.
    const getFileCall = calls.find((c) => c.method === "getFile");
    expect(getFileCall?.body.file_id).toBe("photo-file-id");
  });

  it("uses the caption as the note body and folds caption entities to markdown", async () => {
    calls = mockTelegramFetch({
      files: new Map([["photo-file-id", new Uint8Array([9, 8, 7])]]),
    });
    const storage = createMockStorage();
    const { app, services, sqlite } = setup({ storage });
    await services.telegram.bindAccount({
      siteId: DEFAULT_TEST_SITE_ID,
      botId: BOT_ID,
      telegramUserId: String(USER_ID),
      telegramUsername: "al",
    });

    const res = await post(app, BOT_ID, SECRET, {
      update_id: 60,
      message: {
        message_id: 60,
        from: { id: USER_ID, is_bot: false, first_name: "Al" },
        chat: { id: USER_ID },
        photo: [
          {
            file_id: "photo-file-id",
            file_unique_id: "pu",
            width: 800,
            height: 600,
          },
        ],
        caption: "look bold here",
        caption_entities: [{ type: "bold", offset: 5, length: 4 }],
      },
    });
    expect(res.status).toBe(200);

    const row = sqlite
      .prepare("SELECT body FROM post ORDER BY rowid DESC LIMIT 1")
      .get() as { body: string };
    const doc = JSON.parse(row.body) as {
      content: Array<{
        content: Array<{ text: string; marks?: Array<{ type: string }> }>;
      }>;
    };
    expect(
      doc.content[0]?.content.find((s) => s.text === "bold")?.marks,
    ).toEqual([{ type: "bold" }]);
  });

  it("downloads the video thumbnail as the media poster", async () => {
    const videoBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const thumbBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]);
    calls = mockTelegramFetch({
      files: new Map([
        ["video-file-id", videoBytes],
        ["video-thumb-id", thumbBytes],
      ]),
    });
    const storage = createMockStorage();
    const { app, services, sqlite } = setup({ storage });
    await services.telegram.bindAccount({
      siteId: DEFAULT_TEST_SITE_ID,
      botId: BOT_ID,
      telegramUserId: String(USER_ID),
      telegramUsername: "al",
    });

    const res = await post(app, BOT_ID, SECRET, {
      update_id: 80,
      message: {
        message_id: 80,
        from: { id: USER_ID, is_bot: false, first_name: "Al" },
        chat: { id: USER_ID },
        video: {
          file_id: "video-file-id",
          file_unique_id: "vu",
          width: 1920,
          height: 1080,
          duration: 12,
          mime_type: "video/mp4",
          thumbnail: {
            file_id: "video-thumb-id",
            file_unique_id: "tu",
            width: 320,
            height: 180,
            file_size: thumbBytes.byteLength,
          },
        },
      },
    });
    expect(res.status).toBe(200);

    const row = sqlite
      .prepare(
        "SELECT poster_key, media_kind FROM media ORDER BY rowid DESC LIMIT 1",
      )
      .get() as { poster_key: string | null; media_kind: string };
    expect(row.media_kind).toBe("video");
    expect(row.poster_key).toBeTruthy();
    expect(row.poster_key).toMatch(/\.jpg$/);
    // The poster bytes actually landed in storage at the recorded key.
    const stored = storage.files.get(row.poster_key as string);
    expect(stored?.body).toEqual(thumbBytes);
  });

  it("posts a video document with mime + filename preserved", async () => {
    const docBytes = new Uint8Array([10, 20, 30, 40]);
    calls = mockTelegramFetch({ files: new Map([["doc-id", docBytes]]) });
    const storage = createMockStorage();
    const { app, services, sqlite } = setup({ storage });
    await services.telegram.bindAccount({
      siteId: DEFAULT_TEST_SITE_ID,
      botId: BOT_ID,
      telegramUserId: String(USER_ID),
      telegramUsername: "al",
    });

    const res = await post(app, BOT_ID, SECRET, {
      update_id: 70,
      message: {
        message_id: 70,
        from: { id: USER_ID, is_bot: false, first_name: "Al" },
        chat: { id: USER_ID },
        document: {
          file_id: "doc-id",
          file_unique_id: "du",
          file_name: "notes.pdf",
          mime_type: "application/pdf",
          file_size: docBytes.byteLength,
        },
      },
    });
    expect(res.status).toBe(200);

    const mediaRow = sqlite
      .prepare(
        "SELECT mime_type, media_kind, original_name FROM media ORDER BY rowid DESC LIMIT 1",
      )
      .get() as {
      mime_type: string;
      media_kind: string;
      original_name: string;
    };
    expect(mediaRow.mime_type).toBe("application/pdf");
    expect(mediaRow.media_kind).toBe("document");
    expect(mediaRow.original_name).toBe("notes.pdf");
  });

  it("merges an album (media_group_id) into a single post with both photos", async () => {
    vi.useFakeTimers();
    const a = new Uint8Array([1, 1, 1]);
    const b = new Uint8Array([2, 2, 2]);
    calls = mockTelegramFetch({
      files: new Map([
        ["file-a", a],
        ["file-b", b],
      ]),
    });
    const storage = createMockStorage();
    const { app, services, sqlite, pending } = setup({ storage });
    await services.telegram.bindAccount({
      siteId: DEFAULT_TEST_SITE_ID,
      botId: BOT_ID,
      telegramUserId: String(USER_ID),
      telegramUsername: "al",
    });

    // Each webhook ACKs Telegram before its background flush starts. Send
    // both messages SEQUENTIALLY here to match Telegram's per-chat ordering
    // in production — if the route serialized inline on the buffer wait,
    // the second message would queue behind the first 2-second sleep and
    // become its own post.
    const r1 = await post(app, BOT_ID, SECRET, {
      update_id: 100,
      message: {
        message_id: 100,
        from: { id: USER_ID, is_bot: false, first_name: "Al" },
        chat: { id: USER_ID },
        media_group_id: "group-1",
        photo: [
          { file_id: "file-a", file_unique_id: "ua", width: 800, height: 600 },
        ],
        caption: "album caption",
      },
    });
    const r2 = await post(app, BOT_ID, SECRET, {
      update_id: 101,
      message: {
        message_id: 101,
        from: { id: USER_ID, is_bot: false, first_name: "Al" },
        chat: { id: USER_ID },
        media_group_id: "group-1",
        photo: [
          { file_id: "file-b", file_unique_id: "ub", width: 800, height: 600 },
        ],
      },
    });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    // Advance past the deferred buffer window; both backgrounds wake and
    // race for the group claim. Drain the deferred promises so we observe
    // the final DB state before asserting.
    await vi.advanceTimersByTimeAsync(3_000);
    await Promise.all(pending);
    vi.useRealTimers();

    expect(countPosts(sqlite)).toBe(1);
    expect(
      (
        sqlite.prepare("SELECT COUNT(*) AS n FROM media").get() as {
          n: number;
        }
      ).n,
    ).toBe(2);
    expect(
      (
        sqlite
          .prepare("SELECT COUNT(*) AS n FROM telegram_media_group_item")
          .get() as { n: number }
      ).n,
    ).toBe(0);

    const post1 = sqlite.prepare("SELECT body FROM post LIMIT 1").get() as {
      body: string;
    };
    const doc = JSON.parse(post1.body) as {
      content: Array<{ content?: Array<{ text?: string }> }>;
    };
    const text = doc.content[0]?.content?.[0]?.text ?? "";
    expect(text).toBe("album caption");
  });

  it("prompts an unbound user instead of posting", async () => {
    const { app, sqlite } = setup();
    const res = await post(app, BOT_ID, SECRET, textUpdate(3, "stray message"));
    expect(res.status).toBe(200);
    expect(countPosts(sqlite)).toBe(0);
    expect(calls.some((c) => c.method === "sendMessage")).toBe(true);
  });

  it("binds an account via /start <code>", async () => {
    const { app, services } = setup();
    const code = await services.telegram.getOrCreateCode();

    const res = await post(
      app,
      BOT_ID,
      SECRET,
      textUpdate(2, `/start ${code}`),
    );
    expect(res.status).toBe(200);

    const binding = await services.telegram.findBindingByUser(
      BOT_ID,
      String(USER_ID),
    );
    expect(binding?.siteId).toBe(DEFAULT_TEST_SITE_ID);
  });

  it("binds an account when an unbound user sends just the bare code", async () => {
    const { app, services } = setup();
    const code = await services.telegram.getOrCreateCode();

    const res = await post(app, BOT_ID, SECRET, textUpdate(4, code));
    expect(res.status).toBe(200);

    const binding = await services.telegram.findBindingByUser(
      BOT_ID,
      String(USER_ID),
    );
    expect(binding?.siteId).toBe(DEFAULT_TEST_SITE_ID);
  });
});
