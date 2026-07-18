import { describe, it, expect } from "vitest";
import { createTestApp } from "../../__tests__/helpers/app.js";
import { composeRoutes } from "../compose.js";

function createMockStorage() {
  const files = new Map<string, { body: Uint8Array; contentType?: string }>();

  return {
    files,
    async put(
      key: string,
      body: Uint8Array | ReadableStream,
      opts?: { contentType?: string },
    ) {
      const bytes =
        body instanceof Uint8Array
          ? body
          : new Uint8Array(await new Response(body).arrayBuffer());
      files.set(key, { body: bytes, contentType: opts?.contentType });
    },
    async get(key: string) {
      const file = files.get(key);
      if (!file) return null;
      return {
        body: new Response(file.body).body as ReadableStream,
        contentType: file.contentType,
      };
    },
    async delete(key: string) {
      files.delete(key);
    },
  };
}

describe("Compose Routes", () => {
  describe("POST /compose", () => {
    it("redirects to signin when not authenticated", async () => {
      const { app } = createTestApp({ authenticated: false });
      app.route("/compose", composeRoutes);

      const res = await app.request("/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: "note", bodyMarkdown: "Hello" }),
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/signin?redirect=%2Fcompose");
    });

    it("creates a note post and returns timeline card via SSE", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/compose", composeRoutes);

      const res = await app.request("/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: "note", bodyMarkdown: "Hello world" }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/event-stream");

      const text = await res.text();
      // SSE closes the compose dialog and resets signals
      expect(text).toContain("datastar-patch-elements");
      expect(text).toContain("compose-dialog");

      // Verify post was created
      const posts = await services.posts.list();
      expect(posts).toHaveLength(1);
      expect(posts[0].format).toBe("note");
      expect(posts[0].bodyText).toBe("Hello world");
      expect(posts[0].status).toBe("published");
    });

    it("creates a link post", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/compose", composeRoutes);

      const res = await app.request("/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "link",
          title: "Example link",
          bodyMarkdown: "Check this out",
          url: "https://example.com",
        }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/event-stream");

      const posts = await services.posts.list();
      expect(posts).toHaveLength(1);
      expect(posts[0].format).toBe("link");
      expect(posts[0].url).toBe("https://example.com");
    });

    it("creates a quote post", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/compose", composeRoutes);

      const res = await app.request("/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "quote",
          bodyMarkdown: "Great insight",
          quoteText: "The original quote",
          sourceUrl: "https://example.com/source",
        }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/event-stream");

      const posts = await services.posts.list();
      expect(posts).toHaveLength(1);
      expect(posts[0].format).toBe("quote");
      expect(posts[0].quoteText).toBe("The original quote");
    });

    it("creates a draft and closes dialog with toast", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/compose", composeRoutes);

      const res = await app.request("/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "note",
          bodyMarkdown: "Draft content",
          status: "draft",
        }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/event-stream");

      const text = await res.text();
      // Should close dialog and show toast, not prepend to timeline
      expect(text).toContain("compose-dialog");
      expect(text).toContain("Draft saved");
      expect(text).not.toContain("selector #timeline-items");

      const posts = await services.posts.list({ includeDrafts: true });
      expect(posts).toHaveLength(1);
      expect(posts[0].status).toBe("draft");
    });

    it("returns error for invalid format", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/compose", composeRoutes);

      const res = await app.request("/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: "invalid", bodyMarkdown: "Hello" }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/html");
      // Returns a toast error (text/html with error message)
      const text = await res.text();
      expect(text).toContain("toast-error");
    });

    it("attaches ordered attachment inputs when provided", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/compose", composeRoutes);

      // Create media first
      const media = await services.media.create({
        filename: "test.jpg",
        originalName: "test.jpg",
        mimeType: "image/jpeg",
        size: 1024,
        storageKey: "media/test.jpg",
        width: 800,
        height: 600,
      });

      const res = await app.request("/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "note",
          bodyMarkdown: "Post with media",
          attachments: [{ type: "media", mediaId: media.id }],
        }),
      });

      expect(res.status).toBe(200);

      const posts = await services.posts.list();
      expect(posts).toHaveLength(1);

      // Verify media is attached
      const attachments = await services.media.getByPostId(posts[0].id);
      expect(attachments).toHaveLength(1);
      expect(attachments[0].id).toBe(media.id);
    });

    it("creates inline text attachments through the shared attachments schema", async () => {
      const storage = createMockStorage();
      const { app, services } = createTestApp({
        authenticated: true,
        storage,
      });
      app.route("/compose", composeRoutes);

      const res = await app.request("/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "note",
          bodyMarkdown: "Post with attached text",
          attachments: [
            {
              type: "text",
              contentFormat: "markdown",
              content: "Attached body",
              summary: "Attached body",
            },
          ],
        }),
      });

      expect(res.status).toBe(200);

      const posts = await services.posts.list();
      expect(posts).toHaveLength(1);

      const attachments = await services.media.getByPostId(posts[0].id);
      expect(attachments).toHaveLength(1);
      expect(attachments[0].mimeType).toBe("text/markdown; charset=utf-8");
      expect(attachments[0].mediaKind).toBe("text");

      const content = await services.media.getTextAttachmentContent(
        attachments[0].id,
        storage,
      );
      expect(content?.content).toBe("Attached body");
      // Markdown-only storage: a single .md object per text attachment.
      expect(storage.files.size).toBe(1);
    });

    it("resets compose signals after publishing", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/compose", composeRoutes);

      const res = await app.request("/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: "note", bodyMarkdown: "Hello" }),
      });

      const text = await res.text();
      // SSE should include signal reset
      expect(text).toContain("datastar-patch-signals");
      expect(text).toContain('"_composeLoading":false');
    });

    it("returns error when format is missing", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/compose", composeRoutes);

      const res = await app.request("/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bodyMarkdown: "No format" }),
      });

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("toast-error");
    });
  });

  describe("POST /compose (JSON mode)", () => {
    it("returns JSON for published note", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/compose", composeRoutes);

      const res = await app.request("/compose", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ format: "note", bodyMarkdown: "Hello JSON" }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("application/json");

      const data = await res.json();
      expect(data.status).toBe("published");
      expect(data.permalink).toBeDefined();

      const posts = await services.posts.list();
      expect(posts).toHaveLength(1);
      expect(posts[0].bodyText).toBe("Hello JSON");
    });

    it("returns JSON for draft", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/compose", composeRoutes);

      const res = await app.request("/compose", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          format: "note",
          bodyMarkdown: "Draft JSON",
          status: "draft",
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe("draft");
      expect(data.toast).toBe("Draft saved.");

      const posts = await services.posts.list({ includeDrafts: true });
      expect(posts).toHaveLength(1);
      expect(posts[0].status).toBe("draft");
    });

    it("returns JSON error for invalid input", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/compose", composeRoutes);

      const res = await app.request("/compose", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ format: "invalid", bodyMarkdown: "Hello" }),
      });

      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.status).toBe("error");
      expect(data.error).toBeDefined();
    });
  });

  describe("POST /compose/thread", () => {
    it("keeps the existing thread activity unchanged for a quiet multi-post reply", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/compose", composeRoutes);

      const root = await services.posts.create({
        format: "note",
        bodyMarkdown: "Existing root",
        publishedAt: 1000,
      });

      const res = await app.request("/compose/thread", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          posts: [
            {
              format: "note",
              bodyMarkdown: "Quiet reply one",
              status: "published",
              replyToId: root.id,
              quietReply: true,
              publishedAt: 9000,
            },
            {
              format: "note",
              bodyMarkdown: "Quiet reply two",
              status: "published",
            },
          ],
        }),
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ status: "published" });

      const thread = await services.posts.getThread(root.id);
      expect(thread.map((post) => post.bodyText)).toEqual([
        "Existing root",
        "Quiet reply one",
        "Quiet reply two",
      ]);
      expect((await services.posts.getById(root.id))?.lastActivityAt).toBe(
        1000,
      );
    });
  });
});
