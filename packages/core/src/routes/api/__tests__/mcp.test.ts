import { describe, expect, it, vi } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { postsApiRoutes } from "../posts.js";
import { createEntityId } from "../../../lib/ids.js";
import { handleMcpHttpRequest } from "../../../services/mcp.js";
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
  it("advertises each tool's input from the schema its handler reads", async () => {
    const { app } = createTestApp({ authenticated: true });
    app.route("/api/mcp", mcpApiRoutes);

    const res = await postMcp(
      app,
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { "MCP-Protocol-Version": "2025-06-18" },
    );
    const { tools } = (await res.json()).result as {
      tools: Array<{
        name: string;
        inputSchema: {
          type: string;
          properties?: Record<string, { enum?: string[] }>;
          required?: string[];
        };
      }>;
    };
    const byName = new Map(tools.map((tool) => [tool.name, tool.inputSchema]));

    for (const tool of tools) {
      expect(tool.inputSchema.type, tool.name).toBe("object");
    }
    // These once went missing from the hand-written schemas while the
    // handlers accepted them.
    expect(
      Object.keys(byName.get("jant_posts_create")?.properties ?? {}),
    ).toEqual(
      expect.arrayContaining([
        "language",
        "translationOfId",
        "pinnedAt",
        "featuredAt",
        "collectionEntries",
      ]),
    );
    expect(byName.get("jant_posts_update")?.required).toContain("id");
    expect(
      byName.get("jant_threads_list")?.properties?.visibility?.enum,
    ).toContain("any");
  });

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
    expect(toolNames).toContain("jant_threads_list");
    expect(toolNames).toContain("jant_threads_get");
    expect(toolNames).toContain("jant_threads_list_posts");
    expect(toolNames).toContain("jant_collections_add_thread");
    expect(toolNames).toContain("jant_collections_remove_thread");
    expect(toolNames).toContain("jant_settings_update");
    expect(toolNames).toContain("jant_posts_search");

    // Deleting reads nothing back, so it takes only the post to delete.
    const deleteTool = body.result.tools.find(
      (tool: { name: string }) => tool.name === "jant_posts_delete",
    );
    expect(Object.keys(deleteTool.inputSchema.properties)).toEqual(["id"]);
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

  it("reads Threads through tools/call", async () => {
    const { app, services } = createTestApp({ authenticated: true });
    app.route("/api/mcp", mcpApiRoutes);

    const collection = await services.collections.create({
      slug: "notes",
      title: "Notes",
    });
    const root = await services.posts.create({
      format: "note",
      bodyMarkdown: "Root",
      publishedAt: 1000,
      collectionIds: [collection.id],
    });
    const replies = [];
    let parent = root;
    for (let i = 1; i <= 7; i++) {
      parent = await services.posts.create({
        format: "note",
        bodyMarkdown: `Reply ${i}`,
        replyToId: parent.id,
        publishedAt: 1000 + i,
        createdAt: 1000 + i,
      });
      replies.push(parent);
    }
    const other = await services.posts.create({
      format: "note",
      bodyMarkdown: "Elsewhere",
      publishedAt: 500,
    });

    const call = async (name: string, args: Record<string, unknown>) => {
      const res = await postMcp(
        app,
        {
          jsonrpc: "2.0",
          id: 40,
          method: "tools/call",
          params: { name, arguments: args },
        },
        { "MCP-Protocol-Version": "2025-06-18" },
      );
      expect(res.status).toBe(200);
      const { result } = await res.json();
      expect(result.isError).toBe(false);
      return result.structuredContent;
    };

    const all = await call("jant_threads_list", { sort: "published" });
    expect(all.threads.map((thread: { id: string }) => thread.id)).toEqual([
      root.id,
      other.id,
    ]);
    expect(all.threads[0].postCount).toBe(8);
    expect(all.threads[0].fold).toBeUndefined();

    const inCollection = await call("jant_threads_list", {
      collection: "notes",
      fold: true,
    });
    expect(inCollection.threads).toHaveLength(1);
    expect(inCollection.threads[0].fold.hidden).toBe(2);
    expect(inCollection.threads[0].fold.gap).toEqual({
      id: replies[2]?.id,
      slug: replies[2]?.slug,
      cursor: expect.any(String),
    });

    const thread = await call("jant_threads_get", { id: replies[4]?.id });
    expect(thread).toMatchObject({ id: root.id, postCount: 8 });

    const walked: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const result = await call("jant_threads_list_posts", {
        id: root.id,
        limit: 3,
        ...(cursor ? { cursor } : {}),
      });
      walked.push(...result.posts.map((post: { id: string }) => post.id));
      cursor = result.nextCursor ?? undefined;
      if (!cursor) break;
    }
    expect(walked).toEqual([root.id, ...replies.map((reply) => reply.id)]);
  });

  it("pages posts through tools/call with nextCursor", async () => {
    const { app, services } = createTestApp({ authenticated: true });
    app.route("/api/mcp", mcpApiRoutes);

    const created = [];
    for (let i = 0; i < 3; i++) {
      created.push(
        await services.posts.create({
          format: "note",
          bodyMarkdown: `post ${i}`,
          publishedAt: 1000 + i,
        }),
      );
    }

    const listPosts = async (args: Record<string, unknown>) => {
      const res = await postMcp(
        app,
        {
          jsonrpc: "2.0",
          id: 30,
          method: "tools/call",
          params: { name: "jant_posts_list", arguments: args },
        },
        { "MCP-Protocol-Version": "2025-06-18" },
      );
      expect(res.status).toBe(200);
      return (await res.json()).result;
    };

    const ids: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const result = await listPosts({
        limit: 1,
        ...(cursor ? { cursor } : {}),
      });
      expect(result.isError).toBe(false);
      ids.push(
        ...result.structuredContent.posts.map(
          (post: { id: string }) => post.id,
        ),
      );
      cursor = result.structuredContent.nextCursor ?? undefined;
      if (!cursor) break;
    }
    expect(ids).toEqual(created.map((post) => post.id).reverse());

    for (const cursor of [created[2]?.id, "nope"]) {
      const unreadable = await listPosts({ cursor });
      expect(unreadable.isError).toBe(true);
      expect(unreadable.structuredContent.error).toMatch(/cursor/);
    }
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
          name: "jant_posts_search",
          arguments: {
            q: "quiet",
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

  it("searches private posts and says which results are private", async () => {
    const { app, services } = createTestApp({ authenticated: true, fts: true });
    app.route("/api/mcp", mcpApiRoutes);

    const root = await services.posts.create({
      format: "note",
      title: "Secret diary",
      body: tiptapDoc("Private root about lanterns"),
      visibility: "private",
    });
    const reply = await services.posts.create({
      format: "note",
      body: tiptapDoc("Private reply about lanterns"),
      replyToId: root.id,
    });
    const publicPost = await services.posts.create({
      format: "note",
      body: tiptapDoc("Public post about lanterns"),
    });

    const res = await postMcp(
      app,
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "jant_posts_search",
          arguments: { q: "lanterns" },
        },
      },
      { "MCP-Protocol-Version": "2025-06-18" },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.isError).toBe(false);
    const visibilityById = new Map(
      (
        body.result.structuredContent.results as {
          id: string;
          visibility: string;
        }[]
      ).map((result) => [result.id, result.visibility]),
    );
    expect(visibilityById).toEqual(
      new Map([
        [root.id, "private"],
        [reply.id, "private"],
        [publicPost.id, "public"],
      ]),
    );
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
    expect((await services.media.listPage({ limit: 10 })).media).toHaveLength(
      1,
    );
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

describe("MCP post writes", () => {
  function callTool(
    app: ReturnType<typeof createTestApp>["app"],
    path: string,
    name: string,
    args: Record<string, unknown>,
  ) {
    return app
      .request(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "MCP-Protocol-Version": "2025-06-18",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      })
      .then(
        (res) =>
          res.json() as Promise<{
            result: { isError: boolean; structuredContent: { id: string } };
          }>,
      );
  }

  it("answers with what the matching HTTP endpoint returns", async () => {
    const { app, services } = createTestApp({ authenticated: true });
    app.route("/api/mcp", mcpApiRoutes);
    app.route("/api/posts", postsApiRoutes);
    const collection = await services.collections.create({
      title: "Ideas",
      slug: "ideas",
    });
    const post = await services.posts.create({
      format: "note",
      bodyMarkdown: "hello",
      collectionIds: [collection.id],
    });

    const viaMcp = await callTool(app, "/api/mcp", "jant_posts_get", {
      id: post.id,
    });
    const viaHttp = await (await app.request(`/api/posts/${post.id}`)).json();

    expect(viaMcp.result.structuredContent).toEqual(viaHttp);
    expect(viaHttp).toMatchObject({
      collectionIds: [collection.id],
      threadPosition: 1,
    });
  });

  it("reads bodies as Markdown where HTTP takes content=markdown", async () => {
    const { app, services } = createTestApp({ authenticated: true });
    app.route("/api/mcp", mcpApiRoutes);
    app.route("/api/posts", postsApiRoutes);
    const post = await services.posts.create({
      format: "note",
      bodyMarkdown: "Some **bold** text",
    });

    const viaMcp = await callTool(app, "/api/mcp", "jant_posts_get", {
      id: post.id,
      content: "markdown",
    });
    const viaHttp = await (
      await app.request(`/api/posts/${post.id}?content=markdown`)
    ).json();
    expect(viaMcp.result.structuredContent).toEqual(viaHttp);
    expect(viaHttp.bodyMarkdown).toBe("Some **bold** text");

    for (const [name, args] of [
      ["jant_posts_list", {}],
      ["jant_threads_list_posts", { id: post.id }],
    ] as const) {
      const listed = (await callTool(app, "/api/mcp", name, {
        ...args,
        content: "markdown",
      })) as unknown as {
        result: { structuredContent: { posts: { bodyMarkdown: string }[] } };
      };
      expect(listed.result.structuredContent.posts[0]?.bodyMarkdown, name).toBe(
        "Some **bold** text",
      );
    }
    for (const name of ["jant_threads_list", "jant_threads_get"]) {
      const result = (await callTool(app, "/api/mcp", name, {
        ...(name === "jant_threads_get" ? { id: post.id } : {}),
        content: "markdown",
      })) as unknown as {
        result: {
          structuredContent: {
            threads?: { root: { bodyMarkdown: string } }[];
            root?: { bodyMarkdown: string };
          };
        };
      };
      const content = result.result.structuredContent;
      const root = content.threads?.[0]?.root ?? content.root;
      expect(root?.bodyMarkdown, name).toBe("Some **bold** text");
    }
  });

  it("keeps every field POST and PUT /api/posts keep", async () => {
    // The MCP tools once mapped the body themselves and dropped `language`,
    // `translationOfId`, `pinnedAt`, and `featuredAt`.
    const { app, services } = createTestApp({ authenticated: true });
    app.route("/api/mcp", mcpApiRoutes);

    const source = await callTool(app, "/api/mcp", "jant_posts_create", {
      format: "note",
      bodyMarkdown: "中文",
      language: "zh-Hans",
    });
    const translation = await callTool(app, "/api/mcp", "jant_posts_create", {
      format: "note",
      bodyMarkdown: "English",
      language: "en",
      translationOfId: source.result.structuredContent.id,
      pinnedAt: 1706000000,
      featuredAt: 1706000100,
    });
    expect(translation.result.isError).toBe(false);

    const stored = await services.posts.getById(
      translation.result.structuredContent.id,
    );
    expect(stored).toMatchObject({
      language: "en",
      pinnedAt: 1706000000,
      featuredAt: 1706000100,
    });
    expect(
      (await services.posts.listTranslations(stored!.id)).map((p) => p.id),
    ).toEqual([source.result.structuredContent.id]);

    const updated = await callTool(app, "/api/mcp", "jant_posts_update", {
      id: stored!.id,
      language: "ja",
    });
    expect(updated.result.isError).toBe(false);
    expect((await services.posts.getById(stored!.id))?.language).toBe("ja");
  });

  it("runs the post-write hook after each post write, and only then", async () => {
    // The HTTP routes start a GitHub sync after writing a post; MCP writes
    // reach the same hook through the context.
    const { app } = createTestApp({ authenticated: true });
    const afterPostWrite = vi.fn(async () => {});
    app.post("/mcp-with-hook", async (c) => {
      const response = await handleMcpHttpRequest(
        {
          bodyText: await c.req.text(),
          protocolVersionHeader: c.req.header("MCP-Protocol-Version"),
        },
        {
          appConfig: c.var.appConfig,
          env: c.env,
          services: c.var.services,
          storage: c.var.storage,
          afterPostWrite,
        },
      );
      return new Response(response.body, {
        status: response.status,
        headers: response.headers,
      });
    });

    const created = await callTool(app, "/mcp-with-hook", "jant_posts_create", {
      format: "note",
      bodyMarkdown: "Hello",
    });
    const id = created.result.structuredContent.id;
    await callTool(app, "/mcp-with-hook", "jant_posts_get", { id });
    expect(afterPostWrite).toHaveBeenCalledTimes(1);

    await callTool(app, "/mcp-with-hook", "jant_posts_update", {
      id,
      bodyMarkdown: "Hello again",
    });
    await callTool(app, "/mcp-with-hook", "jant_posts_delete", { id });
    expect(afterPostWrite).toHaveBeenCalledTimes(3);
  });
});

describe("MCP tool errors", () => {
  it("answer in the HTTP error shape: { error, code }, with details for validation", async () => {
    // Tool errors came back in four shapes — `issues`, `details`, a bare
    // `error`, or `code` with `statusCode` — so a client couldn't branch on
    // one field.
    const { app } = createTestApp({ authenticated: true });
    app.route("/api/mcp", mcpApiRoutes);
    const call = async (name: string, args: Record<string, unknown>) => {
      const res = await postMcp(
        app,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        },
        { "MCP-Protocol-Version": "2025-06-18" },
      );
      const body = (await res.json()) as {
        result: {
          isError: boolean;
          structuredContent: Record<string, unknown>;
        };
      };
      expect(body.result.isError).toBe(true);
      return body.result.structuredContent;
    };

    expect(await call("jant_no_such_tool", {})).toMatchObject({
      code: "NOT_FOUND",
    });
    const invalid = await call("jant_posts_get", {});
    expect(invalid).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(invalid).toHaveProperty("details");
    expect(
      await call("jant_posts_get", { id: "pst_01jpyx3m7gw4w3h7m4bknq0v1d" }),
    ).toEqual({ error: "Post not found", code: "NOT_FOUND" });
    expect(await call("jant_posts_list", { cursor: "nope" })).toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});
