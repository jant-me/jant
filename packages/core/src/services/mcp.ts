import { z } from "zod";
import {
  CollectionDescriptionValueSchema,
  CollectionIdSchema,
  CollectionSortOrderSchema,
  ContentLanguageSchema,
  CreateCollectionSchema,
  CreatePostApiSchema,
  FormatSchema,
  MediaIdSchema,
  PostContentSchema,
  PostIdSchema,
  StatusSchema,
  UpdatePostApiSchema,
} from "../lib/schemas.js";
import { THREAD_SORTS, type Post } from "../types.js";
import type { AppConfig } from "../types/config.js";
import { requireStorage, type StorageDriver } from "../lib/storage.js";
import type { Services } from "./index.js";
import { CORE_VERSION } from "../lib/version.js";
import {
  buildEditableSettingsResponse,
  partitionEditableSettingUpdates,
} from "../lib/api-settings.js";
import {
  apiPostListOrder,
  loadApiPostDetail,
  loadApiPostResponse,
  loadApiPostResponses,
} from "../lib/api-posts.js";
import { toSearchApiResult } from "../lib/api-search.js";
import { loadApiThreadResponses } from "../lib/api-threads.js";
import {
  parseThreadSelection,
  THREAD_AUTHOR_VISIBILITIES,
} from "../lib/thread-query.js";
import {
  ExternalServiceError,
  NotFoundError,
  type DomainError,
  ValidationError,
} from "../lib/errors.js";
import {
  toApiCollection,
  toApiCollectionList,
} from "../lib/api-collections.js";
import { toApiMedia } from "../lib/api-media.js";
import {
  postWriteDeps,
  toCreatePostInput,
  toUpdatePostInput,
  assertUpdateFitsFormat,
} from "../lib/api-post-input.js";

export const MCP_PROTOCOL_VERSION = "2025-06-18";

type JsonRpcId = string | number | null;

type McpHttpContext = {
  appConfig: AppConfig;
  services: Services;
  storage: StorageDriver | null;
  /**
   * Runs after a tool creates, updates, or deletes a post — what the HTTP
   * post routes do after the same writes, such as starting a GitHub sync.
   */
  afterPostWrite?: () => Promise<void>;
};

type McpHttpRequest = {
  bodyText: string;
  protocolVersionHeader?: string;
};

type McpHttpResponse = {
  body: string | null;
  headers: Record<string, string>;
  status: number;
};

type JsonRpcRequest = {
  id?: JsonRpcId;
  jsonrpc?: string;
  method?: string;
  params?: unknown;
};

type McpToolContext = McpHttpContext;

type McpToolDefinition = {
  description: string;
  execute: (args: unknown, context: McpToolContext) => Promise<unknown>;
  inputSchema: Record<string, unknown>;
  name: string;
};

const ListPostsToolSchema = z.object({
  cursor: z.string().optional(),
  format: FormatSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(100),
  status: StatusSchema.optional(),
  content: PostContentSchema.optional().describe(
    "markdown returns bodyMarkdown in place of body, bodyHtml, and bodyText",
  ),
});

const GetPostToolSchema = z.object({
  id: PostIdSchema.describe("Post TypeID"),
  content: PostContentSchema.optional().describe(
    "markdown returns bodyMarkdown in place of body, bodyHtml, and bodyText",
  ),
});

const UpdateCollectionToolSchema = CreateCollectionSchema.partial().extend({
  description: z.union([CollectionDescriptionValueSchema, z.null()]).optional(),
  sortOrder: CollectionSortOrderSchema.optional(),
});

const GetCollectionToolSchema = z.object({
  id: CollectionIdSchema.describe("Collection TypeID"),
});

const ListCollectionsToolSchema = z.object({
  view: z.enum(["compose"]).optional(),
});

/** A tool that takes no input. */
const EmptyToolSchema = z.object({});

const UpdateSettingsToolSchema = z.record(z.string(), z.string());

const SearchPostsToolSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  // `q`, as `GET /api/search` names it.
  q: z.string().trim().min(1).max(200),
});

const ListMediaToolSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  cursor: z.string().optional(),
  mimePrefix: z.string().trim().min(1).optional(),
});

const GetMediaToolSchema = z.object({
  id: MediaIdSchema.describe("Media TypeID"),
});

const UpdateMediaAltToolSchema = z.object({
  id: MediaIdSchema.describe("Media TypeID"),
  alt: z
    .string()
    .max(500)
    .transform((value) => value.trim()),
});

const UploadMediaToolSchema = z.object({
  filename: z.string().trim().min(1),
  contentType: z.string().trim().min(1),
  contentBase64: z.string().min(1),
  alt: z.string().max(500).optional(),
  summary: z.string().max(500).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationSeconds: z.number().int().positive().optional(),
  blurhash: z.string().max(200).optional(),
  waveform: z.string().max(2000).optional(),
  chars: z.number().int().nonnegative().optional(),
  posterBase64: z.string().min(1).optional(),
});

const AddCollectionThreadToolSchema = z.object({
  collectionId: CollectionIdSchema.describe("Collection TypeID"),
  threadId: PostIdSchema.describe("TypeID of any post in the Thread"),
});

const RemoveCollectionThreadToolSchema = AddCollectionThreadToolSchema;

const ListThreadsToolSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  status: StatusSchema.optional(),
  sort: z.enum(THREAD_SORTS).optional(),
  fold: z.boolean().optional(),
  lang: ContentLanguageSchema.optional().describe("BCP 47 content language"),
  // The filter dimensions, spelled as the HTTP API and the archive spell
  // them. They reach the same registry parser a query string does.
  format: FormatSchema.optional(),
  collection: z
    .string()
    .optional()
    .describe("Collection slug, or several comma-separated"),
  year: z.number().int().optional().describe("Publication year (UTC)"),
  media: z
    .string()
    .optional()
    .describe(
      "any, none, or comma-separated kinds: image, video, audio, text, document",
    ),
  title: z.enum(["any", "none"]).optional(),
  replies: z.enum(["any", "none"]).optional(),
  visibility: z.enum(THREAD_AUTHOR_VISIBILITIES).optional(),
  content: PostContentSchema.optional().describe(
    "markdown returns bodyMarkdown in place of body, bodyHtml, and bodyText",
  ),
});

const LIST_THREADS_OWN_PARAMS = [
  "cursor",
  "limit",
  "status",
  "sort",
  "fold",
  "lang",
  "content",
] as const;

const GetThreadToolSchema = z.object({
  id: PostIdSchema.describe("TypeID of any post in the Thread"),
  fold: z.boolean().optional(),
  content: PostContentSchema.optional().describe(
    "markdown returns bodyMarkdown in place of body, bodyHtml, and bodyText",
  ),
});

const ListThreadPostsToolSchema = z.object({
  id: PostIdSchema.describe("TypeID of any post in the Thread"),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(100),
  status: StatusSchema.optional(),
  content: PostContentSchema.optional().describe(
    "markdown returns bodyMarkdown in place of body, bodyHtml, and bodyText",
  ),
});

/**
 * A tool's advertised input, generated from the schema its handler parses
 * with, so the two can't drift apart. `extra` adds properties the handler
 * reads before that schema, such as the ID an update names.
 *
 * @param schema - The schema the tool's handler parses its arguments with
 * @param extra - Required properties read ahead of it
 * @returns The JSON Schema `tools/list` advertises
 */
function toolInputSchema(
  schema: z.ZodType,
  extra: Record<string, z.ZodType> = {},
): Record<string, unknown> {
  const generated = z.toJSONSchema(schema, {
    io: "input",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  delete generated.$schema;
  if (Object.keys(extra).length === 0) return generated;

  const extraSchema = z.toJSONSchema(z.object(extra), {
    io: "input",
    unrepresentable: "any",
  }) as { properties: Record<string, unknown>; required?: string[] };
  return {
    ...generated,
    properties: {
      ...extraSchema.properties,
      ...(generated.properties as Record<string, unknown> | undefined),
    },
    required: [
      ...(extraSchema.required ?? []),
      ...((generated.required as string[] | undefined) ?? []),
    ],
  };
}

const mcpTools: McpToolDefinition[] = [
  {
    name: "jant_posts_list",
    description:
      "List posts, with optional format, status, cursor, and limit filters. Pass nextCursor back as cursor for the next page.",
    inputSchema: toolInputSchema(ListPostsToolSchema),
    async execute(args, context) {
      const input = ListPostsToolSchema.parse(args ?? {});
      const status = input.status ?? "published";
      const { posts, nextCursor } = await context.services.posts.listPage(
        { format: input.format, status, ...apiPostListOrder(status) },
        { cursor: input.cursor, limit: input.limit },
      );

      return {
        posts: await loadApiPostResponses(context, posts, {
          content: input.content,
        }),
        nextCursor,
      };
    },
  },
  {
    name: "jant_posts_get",
    description:
      "Get one post, including attachments and shared Thread collection IDs. Set content to markdown to read the body as Markdown.",
    inputSchema: toolInputSchema(GetPostToolSchema),
    async execute(args, context) {
      const input = GetPostToolSchema.parse(args ?? {});
      const post = await context.services.posts.getById(input.id);
      if (!post) {
        throw new NotFoundError("Post");
      }

      return loadApiPostDetail(context, post, { content: input.content });
    },
  },
  {
    name: "jant_threads_list",
    description:
      "List Threads (a root post and its replies), each with its post count. Takes the archive's filters; sort is activity (default), published, updated, oldest, or rating. Set fold to include the replies the homepage shows. Pass nextCursor back as cursor for the next page.",
    inputSchema: toolInputSchema(ListThreadsToolSchema),
    async execute(args, context) {
      const input = ListThreadsToolSchema.parse(args ?? {});
      const filterArgs = Object.fromEntries(
        Object.entries(input).filter(
          ([key, value]) =>
            value !== undefined &&
            !(LIST_THREADS_OWN_PARAMS as readonly string[]).includes(key),
        ),
      );
      const parsed = await parseThreadSelection(
        (key) => {
          const value = filterArgs[key];
          return value === undefined ? undefined : String(value);
        },
        {
          audience: "author",
          loadCollections: () => context.services.collections.list(),
        },
      );
      if (parsed.kind === "empty") {
        return { threads: [], nextCursor: null };
      }

      const { threads, nextCursor } =
        await context.services.threads.listThreads(
          {
            audience: "author",
            status: input.status,
            selection: parsed.selection,
            lang: input.lang,
            sort: input.sort,
            fold: input.fold,
          },
          { cursor: input.cursor, limit: input.limit },
        );
      return {
        threads: await loadApiThreadResponses(context, threads, {
          content: input.content,
        }),
        nextCursor,
      };
    },
  },
  {
    name: "jant_threads_get",
    description:
      "Get the Thread any post belongs to: its root and post count, and with fold the replies the homepage shows.",
    inputSchema: toolInputSchema(GetThreadToolSchema),
    async execute(args, context) {
      const input = GetThreadToolSchema.parse(args ?? {});
      const root = await context.services.threads.findRoot(
        { id: input.id },
        "author",
      );
      if (!root) {
        throw new NotFoundError("Thread");
      }
      const summaries = await context.services.threads.summarize([root], {
        fold: input.fold,
      });
      const [thread] = await loadApiThreadResponses(context, summaries, {
        content: input.content,
      });
      return thread;
    },
  },
  {
    name: "jant_threads_list_posts",
    description:
      "List the posts of the Thread any post belongs to, root first, in Thread order. Pass nextCursor back as cursor for the next page.",
    inputSchema: toolInputSchema(ListThreadPostsToolSchema),
    async execute(args, context) {
      const input = ListThreadPostsToolSchema.parse(args ?? {});
      const root = await context.services.threads.findRoot(
        { id: input.id },
        "author",
      );
      if (!root) {
        throw new NotFoundError("Thread");
      }
      const { posts, nextCursor } = await context.services.threads.listPosts(
        root.id,
        { audience: "author", status: input.status },
        { cursor: input.cursor, limit: input.limit },
      );
      return {
        posts: await loadApiPostResponses(context, posts, {
          content: input.content,
        }),
        nextCursor,
      };
    },
  },
  {
    name: "jant_posts_create",
    description:
      "Create a post. Supports the same JSON body as POST /api/posts.",
    inputSchema: toolInputSchema(CreatePostApiSchema),
    async execute(args, context) {
      const input = CreatePostApiSchema.parse(args ?? {});
      const deps = postWriteDeps(context);
      const post = await context.services.posts.createWithAttachments(
        toCreatePostInput(input),
        input.attachments,
        deps.attachments,
        deps.summary,
      );
      await context.afterPostWrite?.();

      return serializePost(post, context);
    },
  },
  {
    name: "jant_posts_update",
    description:
      "Update a post. Supports the same JSON body as PUT /api/posts/:id.",
    inputSchema: toolInputSchema(UpdatePostApiSchema, {
      id: PostIdSchema.describe("Post TypeID"),
    }),
    async execute(args, context) {
      const { id, ...fields } = z
        .object({
          id: PostIdSchema,
        })
        .passthrough()
        .parse(args ?? {});
      const input = UpdatePostApiSchema.parse(fields);
      const existing = await context.services.posts.getById(id);
      if (!existing) {
        throw new NotFoundError("Post");
      }
      assertUpdateFitsFormat(input, existing.format);
      const deps = postWriteDeps(context);
      const post = await context.services.posts.updateWithAttachments(
        id,
        toUpdatePostInput(input),
        input.attachments,
        deps.attachments,
        deps.summary,
      );
      if (!post) {
        throw new NotFoundError("Post");
      }
      await context.afterPostWrite?.();

      return serializePost(post, context);
    },
  },
  {
    name: "jant_posts_delete",
    description: "Delete a post and clean up any attached media.",
    inputSchema: toolInputSchema(GetPostToolSchema),
    async execute(args, context) {
      const input = GetPostToolSchema.parse(args ?? {});
      const success = await context.services.posts.delete(input.id, {
        media: context.services.media,
        storage: context.storage,
      });
      if (!success) {
        throw new NotFoundError("Post");
      }
      await context.afterPostWrite?.();

      return { success: true };
    },
  },
  {
    name: "jant_collections_list",
    description: "List collections and collection directory items.",
    inputSchema: toolInputSchema(ListCollectionsToolSchema),
    async execute(args, context) {
      const input = ListCollectionsToolSchema.parse(args ?? {});

      if (input.view === "compose") {
        const collections =
          await context.services.collections.listByRecentActivity();
        return {
          collections: collections.map(toApiCollection),
          directoryItems: [],
        };
      }

      // The same list `GET /api/collections` answers with.
      return toApiCollectionList(
        await context.services.collections.listDirectoryData({
          isAuthenticated: true,
        }),
      );
    },
  },
  {
    name: "jant_collections_get",
    description: "Get one collection by ID.",
    inputSchema: toolInputSchema(GetCollectionToolSchema),
    async execute(args, context) {
      const input = GetCollectionToolSchema.parse(args ?? {});
      const collection = await context.services.collections.getById(input.id);
      if (!collection) {
        throw new NotFoundError("Collection");
      }

      return toApiCollection(collection);
    },
  },
  {
    name: "jant_collections_create",
    description: "Create a collection.",
    inputSchema: toolInputSchema(CreateCollectionSchema),
    async execute(args, context) {
      const input = CreateCollectionSchema.parse(args ?? {});
      return toApiCollection(await context.services.collections.create(input));
    },
  },
  {
    name: "jant_collections_update",
    description: "Update a collection.",
    inputSchema: toolInputSchema(UpdateCollectionToolSchema, {
      id: CollectionIdSchema.describe("Collection TypeID"),
    }),
    async execute(args, context) {
      const parsed = z
        .object({
          id: CollectionIdSchema,
        })
        .passthrough()
        .parse(args ?? {});
      const collection = await context.services.collections.update(
        parsed.id,
        UpdateCollectionToolSchema.parse(parsed),
      );
      if (!collection) {
        throw new NotFoundError("Collection");
      }

      return toApiCollection(collection);
    },
  },
  {
    name: "jant_collections_delete",
    description: "Delete a collection.",
    inputSchema: toolInputSchema(GetCollectionToolSchema),
    async execute(args, context) {
      const input = GetCollectionToolSchema.parse(args ?? {});
      const success = await context.services.collections.delete(input.id);
      if (!success) {
        throw new NotFoundError("Collection");
      }

      return { success: true };
    },
  },
  {
    name: "jant_media_list",
    description:
      "List uploaded media, newest first, optionally filtered by MIME prefix. Pass nextCursor back as cursor for the next page.",
    inputSchema: toolInputSchema(ListMediaToolSchema),
    async execute(args, context) {
      const input = ListMediaToolSchema.parse(args ?? {});
      const page = await context.services.media.listPage({
        limit: input.limit,
        mimePrefix: input.mimePrefix,
        cursor: input.cursor,
      });

      return {
        media: page.media.map((item) =>
          serializeMedia(item, context.appConfig),
        ),
        nextCursor: page.nextCursor,
      };
    },
  },
  {
    name: "jant_media_get",
    description: "Get one media item by ID.",
    inputSchema: toolInputSchema(GetMediaToolSchema),
    async execute(args, context) {
      const input = GetMediaToolSchema.parse(args ?? {});
      const media = await context.services.media.getById(input.id);
      if (!media) {
        throw new NotFoundError("Media");
      }

      return serializeMedia(media, context.appConfig);
    },
  },
  {
    name: "jant_media_upload",
    description:
      "Upload one media file from base64 bytes and return the created media record.",
    inputSchema: toolInputSchema(UploadMediaToolSchema),
    async execute(args, context) {
      const input = UploadMediaToolSchema.parse(args ?? {});
      return uploadMediaFromBase64(input, context);
    },
  },
  {
    name: "jant_media_update",
    description: "Update a media item: its alt text.",
    inputSchema: toolInputSchema(UpdateMediaAltToolSchema),
    async execute(args, context) {
      const input = UpdateMediaAltToolSchema.parse(args ?? {});
      const media = await context.services.media.getById(input.id);
      if (!media) {
        throw new NotFoundError("Media");
      }

      await context.services.media.updateAlt(input.id, input.alt);
      const updatedMedia = await context.services.media.getById(input.id);
      if (!updatedMedia) {
        throw new NotFoundError("Media");
      }

      return serializeMedia(updatedMedia, context.appConfig);
    },
  },
  {
    name: "jant_media_delete",
    description: "Delete a media item and its stored object.",
    inputSchema: toolInputSchema(GetMediaToolSchema),
    async execute(args, context) {
      const input = GetMediaToolSchema.parse(args ?? {});
      const success = await context.services.media.delete(
        input.id,
        context.storage,
      );
      if (!success) {
        throw new NotFoundError("Media");
      }

      return { success: true };
    },
  },
  {
    name: "jant_attachments_get_content",
    description: "Get a text attachment's markdown content.",
    inputSchema: toolInputSchema(GetMediaToolSchema),
    async execute(args, context) {
      const input = GetMediaToolSchema.parse(args ?? {});
      const storage = requireStorage(context.storage);
      const content = await context.services.media.getTextAttachmentContent(
        input.id,
        storage,
      );
      if (!content) {
        throw new NotFoundError("Attachment");
      }

      return content;
    },
  },
  {
    name: "jant_collections_add_thread",
    description: "Add a thread to a collection.",
    inputSchema: toolInputSchema(AddCollectionThreadToolSchema),
    async execute(args, context) {
      const input = AddCollectionThreadToolSchema.parse(args ?? {});
      const collection = await context.services.collections.getById(
        input.collectionId,
      );

      if (!collection) {
        throw new NotFoundError("Collection");
      }

      await context.services.collections.addThread(
        input.collectionId,
        input.threadId,
      );
      return { success: true };
    },
  },
  {
    name: "jant_collections_remove_thread",
    description: "Remove a thread from a collection.",
    inputSchema: toolInputSchema(RemoveCollectionThreadToolSchema),
    async execute(args, context) {
      const input = RemoveCollectionThreadToolSchema.parse(args ?? {});
      const collection = await context.services.collections.getById(
        input.collectionId,
      );
      if (!collection) {
        throw new NotFoundError("Collection");
      }

      await context.services.collections.removeThread(
        input.collectionId,
        input.threadId,
      );
      return { success: true };
    },
  },
  {
    name: "jant_settings_get",
    description: "Get editable site settings.",
    inputSchema: toolInputSchema(EmptyToolSchema),
    async execute(_args, context) {
      const allSettings = await context.services.settings.getAll();
      return {
        settings: buildEditableSettingsResponse(
          allSettings,
          context.appConfig.demoMode,
        ),
      };
    },
  },
  {
    name: "jant_settings_update",
    description: "Update editable site settings.",
    inputSchema: toolInputSchema(UpdateSettingsToolSchema),
    async execute(args, context) {
      const updates = UpdateSettingsToolSchema.parse(args ?? {});
      const { filteredUpdates, rejectedKeys } = partitionEditableSettingUpdates(
        updates,
        context.appConfig.demoMode,
      );

      if (
        rejectedKeys.length > 0 &&
        Object.keys(filteredUpdates).length === 0
      ) {
        throw new ValidationError(
          context.appConfig.demoMode
            ? "Demo mode locks these settings"
            : "None of the provided keys are editable",
          { rejectedKeys },
        );
      }

      if (Object.keys(filteredUpdates).length > 0) {
        await context.services.settings.setMany(filteredUpdates as never);
      }

      const allSettings = await context.services.settings.getAll();
      return {
        ...(rejectedKeys.length > 0 && { rejectedKeys }),
        settings: buildEditableSettingsResponse(
          allSettings,
          context.appConfig.demoMode,
        ),
      };
    },
  },
  {
    name: "jant_posts_search",
    description:
      "Search published posts, including private ones. Each result carries its visibility.",
    inputSchema: toolInputSchema(SearchPostsToolSchema),
    async execute(args, context) {
      const input = SearchPostsToolSchema.parse(args ?? {});
      // The author's search, the same as `GET /api/search`: private posts
      // match, and each result says which visibility it has, so an agent can
      // tell before linking one.
      const results = await context.services.search.search(input.q, {
        limit: input.limit,
        status: ["published"],
        includePrivate: true,
      });

      return {
        count: results.length,
        query: input.q,
        results: results.map((result) =>
          toSearchApiResult(
            result.post,
            result.snippet,
            context.appConfig.sitePathPrefix,
          ),
        ),
      };
    },
  },
];

export async function handleMcpHttpRequest(
  request: McpHttpRequest,
  context: McpHttpContext,
): Promise<McpHttpResponse> {
  if (
    request.protocolVersionHeader &&
    request.protocolVersionHeader !== MCP_PROTOCOL_VERSION
  ) {
    return jsonRpcErrorResponse(
      null,
      -32600,
      `Unsupported MCP protocol version: ${request.protocolVersionHeader}`,
      400,
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(request.bodyText);
  } catch {
    return jsonRpcErrorResponse(null, -32700, "Parse error", 400);
  }

  if (Array.isArray(payload)) {
    return jsonRpcErrorResponse(
      null,
      -32600,
      "Batch requests are not supported.",
      400,
    );
  }

  const rpc = payload as JsonRpcRequest;
  if (!isValidJsonRpcRequest(rpc)) {
    return jsonRpcErrorResponse(null, -32600, "Invalid Request", 400);
  }

  if (rpc.method === "notifications/initialized") {
    return {
      status: 202,
      headers: defaultMcpHeaders(),
      body: null,
    };
  }

  switch (rpc.method) {
    case "initialize":
      return jsonRpcSuccessResponse(rpc.id ?? null, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
        serverInfo: {
          name: "jant",
          title: "Jant",
          version: CORE_VERSION,
        },
      });
    case "ping":
      return jsonRpcSuccessResponse(rpc.id ?? null, {});
    case "tools/list":
      return jsonRpcSuccessResponse(rpc.id ?? null, {
        tools: mcpTools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });
    case "tools/call":
      return handleToolCall(rpc.id ?? null, rpc.params, context);
    default:
      return jsonRpcErrorResponse(
        rpc.id ?? null,
        -32601,
        `Method not found: ${rpc.method}`,
        404,
      );
  }
}

async function handleToolCall(
  id: JsonRpcId,
  params: unknown,
  context: McpHttpContext,
): Promise<McpHttpResponse> {
  const parsedParams = z
    .object({
      name: z.string().min(1),
      arguments: z.record(z.string(), z.unknown()).optional(),
    })
    .safeParse(params ?? {});

  if (!parsedParams.success) {
    return jsonRpcErrorResponse(id, -32602, "Invalid params", 400, {
      issues: parsedParams.error.issues,
    });
  }

  const tool = mcpTools.find(
    (candidate) => candidate.name === parsedParams.data.name,
  );
  if (!tool) {
    return jsonRpcSuccessResponse(
      id,
      toolErrorResult({
        error: `Unknown tool: ${parsedParams.data.name}. List the tools with tools/list.`,
        code: "NOT_FOUND",
      }),
    );
  }

  try {
    const result = await tool.execute(
      parsedParams.data.arguments ?? {},
      context,
    );
    return jsonRpcSuccessResponse(id, {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
      structuredContent: result,
      isError: false,
    });
  } catch (error) {
    return jsonRpcSuccessResponse(id, toToolErrorResult(error));
  }
}

function defaultMcpHeaders(): Record<string, string> {
  return {
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
  };
}

function isValidJsonRpcRequest(
  value: JsonRpcRequest,
): value is JsonRpcRequest & {
  jsonrpc: "2.0";
  method: string;
} {
  return (
    !!value &&
    typeof value === "object" &&
    value.jsonrpc === "2.0" &&
    typeof value.method === "string" &&
    value.method.length > 0
  );
}

function jsonRpcSuccessResponse(
  id: JsonRpcId,
  result: Record<string, unknown>,
): McpHttpResponse {
  return {
    status: 200,
    headers: defaultMcpHeaders(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      result,
    }),
  };
}

function jsonRpcErrorResponse(
  id: JsonRpcId,
  code: number,
  message: string,
  status: number,
  data?: unknown,
): McpHttpResponse {
  return {
    status,
    headers: defaultMcpHeaders(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: {
        code,
        message,
        ...(data === undefined ? {} : { data }),
      },
    }),
  };
}

/**
 * A failed tool call, in the shape an HTTP error has: `{ error, code }`, plus
 * `details` for a validation error. The text content repeats the message.
 */
function toolErrorResult(body: {
  error: string;
  code: string;
  details?: unknown;
}): Record<string, unknown> {
  return {
    content: [{ type: "text", text: body.error }],
    structuredContent: body,
    isError: true,
  };
}

function toToolErrorResult(error: unknown): Record<string, unknown> {
  if (error instanceof z.ZodError) {
    return toolErrorResult({
      error: error.issues[0]?.message ?? "Invalid tool arguments.",
      code: "VALIDATION_ERROR",
      details: error.flatten(),
    });
  }

  if (isDomainError(error)) {
    return toolErrorResult({
      error: error.message,
      code: error.code,
      ...(error instanceof ValidationError && error.details
        ? { details: error.details }
        : {}),
    });
  }

  // eslint-disable-next-line no-console -- Server error logging is intentional
  console.error("[Jant] MCP tool failed:", error);
  return toolErrorResult({
    error:
      "The server hit an error it didn't expect. Try again; the server log has the details.",
    code: "INTERNAL_ERROR",
  });
}

function isDomainError(error: unknown): error is DomainError {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    "message" in error &&
    "statusCode" in error
  );
}

function decodeBase64Bytes(value: string, label: string): Uint8Array {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    throw new ValidationError(`${label} must be valid base64.`);
  }
}

function toExactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

async function uploadMediaFromBase64(
  input: z.infer<typeof UploadMediaToolSchema>,
  context: McpToolContext,
) {
  const storage = requireStorage(context.storage);
  const fileBytes = decodeBase64Bytes(input.contentBase64, "contentBase64");
  const init = await context.services.uploads.initiate(
    {
      originalName: input.filename,
      contentType: input.contentType,
      size: fileBytes.byteLength,
    },
    {
      storage,
      storageDriver: context.appConfig.storageDriver,
      maxFileSizeMB: context.appConfig.uploadMaxFileSize,
    },
  );

  let parts:
    | Array<{
        etag: string;
        partNumber: number;
      }>
    | undefined;

  switch (init.transport.kind) {
    case "relay":
      await context.services.uploads.uploadRelayBody(init.id, fileBytes, {
        storage,
      });
      break;
    case "multipartRelay": {
      parts = [];
      for (
        let offset = 0, partNumber = 1;
        offset < fileBytes.byteLength;
        offset += init.transport.partSize, partNumber += 1
      ) {
        const chunk = fileBytes.subarray(
          offset,
          offset + init.transport.partSize,
        );
        parts.push(
          await context.services.uploads.uploadRelayPart(
            init.id,
            partNumber,
            toExactArrayBuffer(chunk),
            { storage },
          ),
        );
      }
      break;
    }
    case "put": {
      const response = await fetch(init.transport.url, {
        method: init.transport.method,
        headers: init.transport.headers,
        body: fileBytes,
      });
      if (!response.ok) {
        throw new ExternalServiceError(
          `Direct upload failed with HTTP ${response.status}.`,
        );
      }
      break;
    }
    default:
      throw new ValidationError("Unsupported upload transport.");
  }

  if (input.posterBase64) {
    await context.services.uploads.uploadPoster(
      init.id,
      decodeBase64Bytes(input.posterBase64, "posterBase64"),
      { storage },
    );
  }

  const complete = await context.services.uploads.complete(
    init.id,
    {
      width: input.width,
      height: input.height,
      durationSeconds: input.durationSeconds,
      blurhash: input.blurhash,
      waveform: input.waveform,
      summary: input.summary,
      chars: input.chars,
      parts,
    },
    {
      storage,
      storageDriver: context.appConfig.storageDriver,
    },
  );

  if (input.alt !== undefined) {
    await context.services.media.updateAlt(complete.id, input.alt.trim());
  }

  const media = await context.services.media.getById(complete.id);
  if (!media) {
    throw new NotFoundError("Media");
  }

  return serializeMedia(media, context.appConfig);
}

// MCP tools answer what their HTTP endpoints do: create and update leave out
// `collectionIds`, as a list does; only a single read carries it.
function serializePost(post: Post, context: McpToolContext) {
  return loadApiPostResponse(context, post);
}

function serializeMedia(
  media: Awaited<ReturnType<Services["media"]["getById"]>> extends infer T
    ? Exclude<T, null>
    : never,
  appConfig: AppConfig,
) {
  return toApiMedia(media, appConfig);
}
