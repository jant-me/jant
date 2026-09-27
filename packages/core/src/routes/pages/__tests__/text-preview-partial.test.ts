import { describe, expect, it } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import type { StorageDriver } from "../../../lib/storage.js";
import { partialPageRoutes } from "../partials.js";

function createMemoryStorage() {
  const files = new Map<string, Uint8Array>();
  const storage = {
    async put(key: string, body: Uint8Array | ReadableStream) {
      files.set(
        key,
        body instanceof Uint8Array
          ? body
          : new Uint8Array(await new Response(body).arrayBuffer()),
      );
    },
    async get(key: string) {
      const bytes = files.get(key);
      return bytes
        ? { body: new Response(bytes).body as ReadableStream }
        : null;
    },
    async delete(key: string) {
      files.delete(key);
    },
  };
  return { files, storage: storage as unknown as StorageDriver };
}

function setup(options: { authenticated: boolean }) {
  const { files, storage } = createMemoryStorage();
  const testApp = createTestApp({ ...options, storage });
  testApp.app.route("/", partialPageRoutes);
  const { services } = testApp;

  /** A post with a Markdown text attachment; returns the attachment's ID. */
  async function postWithText(
    overrides: { status?: "draft"; visibility?: "private" } = {},
  ) {
    const post = await services.posts.createWithAttachments(
      { format: "note", bodyMarkdown: "With notes", ...overrides },
      [{ type: "text", contentFormat: "markdown", content: "# Notes\n\nBody" }],
      {
        media: services.media,
        storage,
        storageDriver: "r2",
        maxFileSizeMB: 10,
      },
    );
    const [media] = await services.media.getByPostId(post.id);
    return media!.id;
  }

  /** An uploaded plain-text file attached to a published post. */
  async function postWithPlainText(content: string) {
    const post = await services.posts.create({
      format: "note",
      bodyMarkdown: "With a file",
    });
    const key = "media/site/notes.txt";
    await storage.put(key, new TextEncoder().encode(content));
    const media = await services.media.create({
      filename: "notes.txt",
      originalName: "notes.txt",
      mimeType: "text/plain",
      size: content.length,
      storageKey: key,
      postId: post.id,
    });
    return media.id;
  }

  return { ...testApp, files, postWithText, postWithPlainText };
}

describe("/_/text/:mediaId", () => {
  it("answers a public post's attachment with its HTML and source", async () => {
    const { app, postWithText } = setup({ authenticated: false });
    const id = await postWithText();

    const res = await app.request(`/_/text/${id}`);

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, no-cache");
    const body = (await res.json()) as { html: string; source: string };
    expect(body.html).toContain("<h1");
    expect(body.source).toBe("# Notes\n\nBody");

    const again = await app.request(`/_/text/${id}`, {
      headers: { "If-None-Match": res.headers.get("etag") ?? "" },
    });
    expect(again.status).toBe(304);
  });

  it("keeps a draft's attachment from everyone", async () => {
    const { app, postWithText } = setup({ authenticated: true });
    const id = await postWithText({ status: "draft" });

    expect((await app.request(`/_/text/${id}`)).status).toBe(404);
  });

  it("gives a private post's attachment to the signed-in author only", async () => {
    // The endpoint it replaces served any file by ID, whoever asked.
    const reader = setup({ authenticated: false });
    const readerId = await reader.postWithText({ visibility: "private" });
    expect((await reader.app.request(`/_/text/${readerId}`)).status).toBe(404);

    const author = setup({ authenticated: true });
    const authorId = await author.postWithText({ visibility: "private" });
    const res = await author.app.request(`/_/text/${authorId}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
  });

  it("escapes an uploaded plain-text file instead of passing its markup through", async () => {
    const { app, postWithPlainText } = setup({ authenticated: false });
    const id = await postWithPlainText("<img src=x onerror=alert(1)>");

    const body = (await (await app.request(`/_/text/${id}`)).json()) as {
      html: string;
      source: string;
    };

    expect(body.html).toBe("<pre>&lt;img src=x onerror=alert(1)&gt;</pre>");
    expect(body.source).toBe("<img src=x onerror=alert(1)>");
  });

  it("knows nothing of a file that belongs to no post", async () => {
    const { app, services } = setup({ authenticated: true });
    const media = await services.media.create({
      filename: "loose.txt",
      originalName: "loose.txt",
      mimeType: "text/plain",
      size: 5,
      storageKey: "media/site/loose.txt",
    });

    expect((await app.request(`/_/text/${media.id}`)).status).toBe(404);
  });
});
