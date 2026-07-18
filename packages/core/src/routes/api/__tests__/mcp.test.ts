import { describe, expect, it } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { createEntityId } from "../../../lib/ids.js";
import { mcpApiRoutes } from "../mcp.js";

function createFakeWebpBytes(length = 32): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set([
    0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]);
  return bytes;
}

function createMockStorage() {
  const files = new Map<
    string,
    {
      body: Uint8Array;
      cacheControl?: string;
      contentDisposition?: string;
      contentType?: string;
    }
  >();

  return {
    files,
    async put(
      key: string,
      body: ReadableStream | Uint8Array,
      opts?: {
        cacheControl?: string;
        contentDisposition?: string;
        contentType?: string;
      },
    ) {
      const bytes =
        body instanceof Uint8Array
          ? body
          : new Uint8Array(await new Response(body).arrayBuffer());
      files.set(key, {
        body: bytes,
        cacheControl: opts?.cacheControl,
        contentDisposition: opts?.contentDisposition,
        contentType: opts?.contentType,
      });
    },
    async get(key: string) {
      const file = files.get(key);
      if (!file) return null;
      return {
        body: new Response(file.body).body as ReadableStream,
        cacheControl: file.cacheControl,
        contentDisposition: file.contentDisposition,
        contentType: file.contentType,
        size: file.body.byteLength,
      };
    },
    async head(key: string) {
      const file = files.get(key);
      if (!file) return null;
      return {
        cacheControl: file.cacheControl,
        contentDisposition: file.contentDisposition,
        contentType: file.contentType,
        size: file.body.byteLength,
      };
    },
    async delete(key: string) {
      files.delete(key);
    },
  };
}

function tiptapDoc(text: string): string {
  return JSON.stringify({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text }],
      },
    ],
  });
}

async function postMcp(
  app: ReturnType<typeof createTestApp>["app"],
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return app.request("/api/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("MCP API Routes", () => {
  it("initializes the MCP endpoint", async () => {
    const { app } = createTestApp({ authenticated: true });
    app.route("/api/mcp", mcpApiRoutes);

    const res = await postMcp(app, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
      },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("MCP-Protocol-Version")).toBe("2025-06-18");

    const body = await res.json();
    expect(body.result.protocolVersion).toBe("2025-06-18");
    expect(body.result.capabilities.tools.listChanged).toBe(false);
    expect(body.result.serverInfo.name).toBe("jant");
  });

  it("lists the available Jant tools", async () => {
    const { app } = createTestApp({ authenticated: true });
    app.route("/api/mcp", mcpApiRoutes);

    const res = await postMcp(
      app,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      },
      {
        "MCP-Protocol-Version": "2025-06-18",
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    const toolNames = body.result.tools.map(
      (tool: { name: string }) => tool.name,
    );

    expect(toolNames).toContain("jant_posts_list");
    expect(toolNames).toContain("jant_collections_add_thread");
    expect(toolNames).toContain("jant_collections_remove_thread");
    expect(toolNames).toContain("jant_settings_update");
    expect(toolNames).toContain("jant_search_posts");
  });

  it("manages collection membership at the thread root", async () => {
    const { app, services } = createTestApp({ authenticated: true });
    app.route("/api/mcp", mcpApiRoutes);

    const collection = await services.collections.create({
      slug: "notes",
      title: "Notes",
    });
    const root = await services.posts.create({
      format: "note",
      bodyMarkdown: "Root",
    });
    const child = await services.posts.create({
      format: "note",
      bodyMarkdown: "Child",
      replyToId: root.id,
    });

    const addRes = await postMcp(
      app,
      {
        jsonrpc: "2.0",
        id: 21,
        method: "tools/call",
        params: {
          name: "jant_collections_add_thread",
          arguments: {
            collectionId: collection.id,
            threadId: child.id,
          },
        },
      },
      { "MCP-Protocol-Version": "2025-06-18" },
    );

    expect(addRes.status).toBe(200);
    expect((await addRes.json()).result.isError).toBe(false);
    expect(await services.collections.getThreadIds(collection.id)).toEqual([
      root.id,
    ]);

    const removeRes = await postMcp(
      app,
      {
        jsonrpc: "2.0",
        id: 22,
        method: "tools/call",
        params: {
          name: "jant_collections_remove_thread",
          arguments: {
            collectionId: collection.id,
            threadId: child.id,
          },
        },
      },
      { "MCP-Protocol-Version": "2025-06-18" },
    );

    expect(removeRes.status).toBe(200);
    expect((await removeRes.json()).result.isError).toBe(false);
    expect(await services.collections.getThreadIds(collection.id)).toEqual([]);
  });

  it("creates posts through tools/call", async () => {
    const { app, services } = createTestApp({ authenticated: true });
    app.route("/api/mcp", mcpApiRoutes);

    const res = await postMcp(
      app,
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "jant_posts_create",
          arguments: {
            format: "note",
            bodyMarkdown: "Hello via MCP",
          },
        },
      },
      {
        "MCP-Protocol-Version": "2025-06-18",
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent.format).toBe("note");
    expect(body.result.structuredContent.bodyText).toBe("Hello via MCP");

    const posts = await services.posts.list();
    expect(posts).toHaveLength(1);
    expect(posts[0]?.bodyText).toBe("Hello via MCP");
  });

  it("searches posts through tools/call", async () => {
    const { app, services } = createTestApp({ authenticated: true, fts: true });
    app.route("/api/mcp", mcpApiRoutes);

    await services.posts.create({
      format: "note",
      body: tiptapDoc("Quiet design systems"),
    });

    const res = await postMcp(
      app,
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "jant_search_posts",
          arguments: {
            query: "quiet",
          },
        },
      },
      {
        "MCP-Protocol-Version": "2025-06-18",
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent.query).toBe("quiet");
    expect(body.result.structuredContent.count).toBeGreaterThanOrEqual(1);
    expect(body.result.structuredContent.results[0].slug).toBeTruthy();
  });

  it("uploads media through tools/call", async () => {
    const storage = createMockStorage();
    const { app, services } = createTestApp({
      authenticated: true,
      storage,
    });
    app.route("/api/mcp", mcpApiRoutes);
    const bytes = createFakeWebpBytes();

    const res = await postMcp(
      app,
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "jant_media_upload",
          arguments: {
            filename: "photo.webp",
            contentType: "image/webp",
            contentBase64: Buffer.from(bytes).toString("base64"),
            alt: "Cover image",
            width: 1200,
            height: 800,
          },
        },
      },
      {
        "MCP-Protocol-Version": "2025-06-18",
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent).toMatchObject({
      alt: "Cover image",
      mimeType: "image/webp",
      type: "media",
      width: 1200,
      height: 800,
    });
    expect(await services.media.list()).toHaveLength(1);
  });

  it("returns text attachment content through tools/call", async () => {
    const storage = createMockStorage();
    const { app, services } = createTestApp({
      authenticated: true,
      storage,
    });
    app.route("/api/mcp", mcpApiRoutes);

    const attachment = await services.media.createTextAttachment(
      {
        contentFormat: "markdown",
        content: "# Heading\n\nBody text",
      },
      {
        storage,
        storageDriver: "local",
        maxFileSizeMB: 10,
      },
    );

    const res = await postMcp(
      app,
      {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "jant_attachments_get_content",
          arguments: {
            id: attachment.id,
          },
        },
      },
      {
        "MCP-Protocol-Version": "2025-06-18",
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent).toEqual({
      id: attachment.id,
      type: "text",
      contentFormat: "markdown",
      content: "# Heading\n\nBody text",
      summary: "Heading Body text",
      chars: 17,
    });
  });

  it("deletes media through tools/call", async () => {
    const storage = createMockStorage();
    const { app, services } = createTestApp({
      authenticated: true,
      storage,
    });
    app.route("/api/mcp", mcpApiRoutes);

    const media = await services.media.create({
      filename: "photo.webp",
      originalName: "photo.webp",
      mimeType: "image/webp",
      size: 32,
      storageKey: "media/photo.webp",
    });
    await storage.put("media/photo.webp", createFakeWebpBytes(), {
      contentType: "image/webp",
    });

    const res = await postMcp(
      app,
      {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: {
          name: "jant_media_delete",
          arguments: {
            id: media.id,
          },
        },
      },
      {
        "MCP-Protocol-Version": "2025-06-18",
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent).toEqual({ success: true });
    expect(await services.media.getById(media.id)).toBeNull();
  });

  it("returns tool-level errors as isError results", async () => {
    const { app } = createTestApp({ authenticated: true });
    app.route("/api/mcp", mcpApiRoutes);
    const missingId = createEntityId("post");

    const res = await postMcp(
      app,
      {
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: {
          name: "jant_posts_get",
          arguments: {
            id: missingId,
          },
        },
      },
      {
        "MCP-Protocol-Version": "2025-06-18",
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toBe("Post not found");
  });
});
