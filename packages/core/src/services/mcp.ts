import { z } from "zod";
import {
  CollectionDescriptionValueSchema,
  CollectionIdSchema,
  CollectionSortOrderSchema,
  CreateCollectionSchema,
  CreatePostApiSchema,
  FormatSchema,
  MediaIdSchema,
  PostIdSchema,
  StatusSchema,
  UpdatePostApiSchema,
} from "../lib/schemas.js";
import {
  COLLECTION_SORT_ORDERS,
  FORMATS,
  STATUSES,
  VISIBILITIES,
} from "../types.js";
import type { AppConfig } from "../types/config.js";
import type { StorageDriver } from "../lib/storage.js";
import type { Services } from "./index.js";
import { CORE_VERSION } from "../lib/version.js";
import {
  buildEditableSettingsResponse,
  partitionEditableSettingUpdates,
} from "../lib/api-settings.js";
import { toApiAttachment, toApiPost } from "../lib/api-posts.js";
import { toSearchApiResult } from "../lib/api-search.js";
import {
  ConfigurationError,
  ExternalServiceError,
  NotFoundError,
  type DomainError,
  ValidationError,
} from "../lib/errors.js";
import { toApiMedia } from "../lib/api-media.js";

export const MCP_PROTOCOL_VERSION = "2025-06-18";

type JsonRpcId = string | number | null;

type McpHttpContext = {
  appConfig: AppConfig;
  services: Services;
  storage: StorageDriver | null;
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
});

const GetPostToolSchema = z.object({
  id: PostIdSchema,
});

const UpdateCollectionToolSchema = CreateCollectionSchema.partial().extend({
  description: z.union([CollectionDescriptionValueSchema, z.null()]).optional(),
  sortOrder: CollectionSortOrderSchema.optional(),
});

const GetCollectionToolSchema = z.object({
  id: CollectionIdSchema,
});

const UpdateSettingsToolSchema = z.record(z.string(), z.string());

const SearchPostsToolSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  query: z.string().trim().min(1).max(200),
});

const ListMediaToolSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  mimePrefix: z.string().trim().min(1).optional(),
});

const GetMediaToolSchema = z.object({
  id: MediaIdSchema,
});

const UpdateMediaAltToolSchema = z.object({
  id: MediaIdSchema,
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
  collectionId: CollectionIdSchema,
  threadId: PostIdSchema,
});

const RemoveCollectionThreadToolSchema = AddCollectionThreadToolSchema;

const mcpTools: McpToolDefinition[] = [
  {
    name: "jant_posts_list",
    description:
      "List posts, with optional format, status, cursor, and limit filters.",
    inputSchema: {
      type: "object",
      properties: {
        cursor: { type: "string" },
        format: { type: "string", enum: [...FORMATS] },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 100 },
        status: { type: "string", enum: [...STATUSES] },
      },
      additionalProperties: false,
    },
    async execute(args, context) {
      const input = ListPostsToolSchema.parse(args ?? {});
      const posts = await context.services.posts.list({
        cursor: input.cursor ?? undefined,
        format: input.format,
        limit: input.limit,
        status: input.status ?? "published",
      });

      return {
        posts: await serializePosts(posts, context),
        nextCursor:
          posts.length === input.limit
            ? (posts[posts.length - 1]?.id ?? null)
            : null,
      };
    },
  },
  {
    name: "jant_posts_get",
    description:
      "Get one post, including attachments and shared Thread collection IDs.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Post TypeID" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    async execute(args, context) {
      const input = GetPostToolSchema.parse(args ?? {});
      const post = await context.services.posts.getById(input.id);
      if (!post) {
        throw new NotFoundError("Post");
      }

      return serializePost(post, context);
    },
  },
  {
    name: "jant_posts_get_content",
    description: "Get one post body as markdown.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Post TypeID" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    async execute(args, context) {
      const input = GetPostToolSchema.parse(args ?? {});
      const content = await context.services.posts.getBodyContent(input.id);
      if (!content) {
        throw new NotFoundError("Post");
      }

      return content;
    },
  },
  {
    name: "jant_posts_create",
    description:
      "Create a post. Supports the same JSON body as POST /api/posts.",
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", enum: [...FORMATS] },
        title: { type: "string" },
        sourceName: { type: "string" },
        body: { type: "string" },
        bodyMarkdown: { type: "string" },
        slug: { type: "string" },
        path: { type: "string" },
        status: { type: "string", enum: [...STATUSES] },
        visibility: { type: "string", enum: [...VISIBILITIES] },
        pinned: { type: "boolean" },
        featured: { type: "boolean" },
        url: { type: "string" },
        sourceUrl: { type: "string" },
        quoteText: { type: "string" },
        rating: { type: "integer" },
        collectionIds: {
          type: "array",
          items: { type: "string" },
        },
        replyToId: { type: "string" },
        quietReply: { type: "boolean" },
        publishedAt: { type: "integer" },
        attachments: {
          type: "array",
          items: { type: "object" },
        },
      },
      required: ["format"],
      additionalProperties: true,
    },
    async execute(args, context) {
      const input = CreatePostApiSchema.parse(args ?? {});
      const post = await context.services.posts.createWithAttachments(
        {
          format: input.format,
          title: input.format === "quote" ? input.sourceName : input.title,
          body: input.body,
          bodyMarkdown: input.bodyMarkdown,
          slug: input.slug || undefined,
          path: input.path || undefined,
          status: input.status,
          visibility: input.visibility,
          pinned: input.pinned,
          featured: input.featured,
          url:
            input.format === "quote"
              ? input.sourceUrl || undefined
              : input.url || undefined,
          quoteText: input.quoteText,
          rating: input.rating || undefined,
          collectionIds: input.collectionIds,
          replyToId: input.replyToId,
          quietReply: input.quietReply,
          publishedAt: input.publishedAt,
        },
        input.attachments,
        {
          media: context.services.media,
          storage: context.storage,
          storageDriver: context.appConfig.storageDriver,
          maxFileSizeMB: context.appConfig.uploadMaxFileSize,
        },
        {
          maxParagraphs: context.appConfig.summaryMaxParagraphs,
          maxChars: context.appConfig.summaryMaxChars,
        },
      );

      return serializePost(post, context);
    },
  },
  {
    name: "jant_posts_update",
    description:
      "Update a post. Supports the same JSON body as PUT /api/posts/:id.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Post TypeID" },
        format: { type: "string", enum: [...FORMATS] },
        title: { type: "string" },
        sourceName: { type: "string" },
        body: { type: "string" },
        bodyMarkdown: { type: "string" },
        slug: { type: "string" },
        status: { type: "string", enum: [...STATUSES] },
        visibility: { type: "string", enum: [...VISIBILITIES] },
        pinned: { type: "boolean" },
        featured: { type: "boolean" },
        url: { type: "string" },
        sourceUrl: { type: "string" },
        quoteText: { type: "string" },
        rating: { type: "integer" },
        collectionIds: {
          type: "array",
          items: { type: "string" },
        },
        publishedAt: { type: "integer" },
        attachments: {
          type: "array",
          items: { type: "object" },
        },
      },
      required: ["id"],
      additionalProperties: true,
    },
    async execute(args, context) {
      const parsed = z
        .object({
          id: PostIdSchema,
        })
        .passthrough()
        .parse(args ?? {});
      const input = UpdatePostApiSchema.parse(parsed);
      const title = Object.prototype.hasOwnProperty.call(input, "sourceName")
        ? input.sourceName
        : input.title;
      const url = Object.prototype.hasOwnProperty.call(input, "sourceUrl")
        ? input.sourceUrl
        : input.url;

      const post = await context.services.posts.updateWithAttachments(
        parsed.id,
        {
          format: input.format,
          title,
          body: input.body,
          bodyMarkdown: input.bodyMarkdown,
          slug: input.slug,
          status: input.status,
          visibility: input.visibility,
          pinned: input.pinned,
          featured: input.featured,
          url,
          quoteText: input.quoteText,
          rating: input.rating,
          collectionIds: input.collectionIds,
          publishedAt: input.publishedAt,
        },
        input.attachments,
        {
          media: context.services.media,
          storage: context.storage,
          storageDriver: context.appConfig.storageDriver,
          maxFileSizeMB: context.appConfig.uploadMaxFileSize,
        },
        {
          maxParagraphs: context.appConfig.summaryMaxParagraphs,
          maxChars: context.appConfig.summaryMaxChars,
        },
      );

      if (!post) {
        throw new NotFoundError("Post");
      }

      return serializePost(post, context);
    },
  },
  {
    name: "jant_posts_delete",
    description: "Delete a post and clean up any attached media.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Post TypeID" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    async execute(args, context) {
      const input = GetPostToolSchema.parse(args ?? {});
      const success = await context.services.posts.delete(input.id, {
        media: context.services.media,
        storage: context.storage,
      });
      if (!success) {
        throw new NotFoundError("Post");
      }

      return { success: true };
    },
  },
  {
    name: "jant_collections_list",
    description: "List collections and collection directory items.",
    inputSchema: {
      type: "object",
      properties: {
        view: {
          type: "string",
          enum: ["compose"],
        },
      },
      additionalProperties: false,
    },
    async execute(args, context) {
      const input = z
        .object({
          view: z.enum(["compose"]).optional(),
        })
        .parse(args ?? {});

      if (input.view === "compose") {
        return {
          collections:
            await context.services.collections.listByRecentActivity(),
          directoryItems: [],
        };
      }

      return context.services.collections.listDirectoryData();
    },
  },
  {
    name: "jant_collections_get",
    description: "Get one collection by ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Collection TypeID" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    async execute(args, context) {
      const input = GetCollectionToolSchema.parse(args ?? {});
      const collection = await context.services.collections.getById(input.id);
      if (!collection) {
        throw new NotFoundError("Collection");
      }

      return collection;
    },
  },
  {
    name: "jant_collections_create",
    description: "Create a collection.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        sortOrder: {
          type: "string",
          enum: [...COLLECTION_SORT_ORDERS],
        },
      },
      required: ["slug", "title"],
      additionalProperties: false,
    },
    async execute(args, context) {
      const input = CreateCollectionSchema.parse(args ?? {});
      return context.services.collections.create(input);
    },
  },
  {
    name: "jant_collections_update",
    description: "Update a collection.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Collection TypeID" },
        slug: { type: "string" },
        title: { type: "string" },
        description: {
          anyOf: [{ type: "string" }, { type: "null" }],
        },
        sortOrder: {
          type: "string",
          enum: [...COLLECTION_SORT_ORDERS],
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
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

      return collection;
    },
  },
  {
    name: "jant_collections_delete",
    description: "Delete a collection.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Collection TypeID" },
      },
      required: ["id"],
      additionalProperties: false,
    },
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
    description: "List uploaded media, optionally filtered by MIME prefix.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
        mimePrefix: { type: "string" },
      },
      additionalProperties: false,
    },
    async execute(args, context) {
      const input = ListMediaToolSchema.parse(args ?? {});
      const media = await context.services.media.list({
        limit: input.limit,
        mimePrefix: input.mimePrefix,
      });

      return {
        media: media.map((item) => serializeMedia(item, context.appConfig)),
      };
    },
  },
  {
    name: "jant_media_get",
    description: "Get one media item by ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Media TypeID" },
      },
      required: ["id"],
      additionalProperties: false,
    },
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
    inputSchema: {
      type: "object",
      properties: {
        filename: { type: "string" },
        contentType: { type: "string" },
        contentBase64: { type: "string" },
        alt: { type: "string" },
        summary: { type: "string" },
        width: { type: "integer", minimum: 1 },
        height: { type: "integer", minimum: 1 },
        durationSeconds: { type: "integer", minimum: 1 },
        blurhash: { type: "string" },
        waveform: { type: "string" },
        chars: { type: "integer", minimum: 0 },
        posterBase64: { type: "string" },
      },
      required: ["filename", "contentType", "contentBase64"],
      additionalProperties: false,
    },
    async execute(args, context) {
      const input = UploadMediaToolSchema.parse(args ?? {});
      return uploadMediaFromBase64(input, context);
    },
  },
  {
    name: "jant_media_update_alt",
    description: "Update a media item's alt text.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Media TypeID" },
        alt: { type: "string" },
      },
      required: ["id", "alt"],
      additionalProperties: false,
    },
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
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Media TypeID" },
      },
      required: ["id"],
      additionalProperties: false,
    },
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
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Media TypeID" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    async execute(args, context) {
      const input = GetMediaToolSchema.parse(args ?? {});
      const storage = requireStorage(context);
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
    inputSchema: {
      type: "object",
      properties: {
        collectionId: { type: "string", description: "Collection TypeID" },
        threadId: {
          type: "string",
          description: "Root or child Post TypeID in the Thread",
        },
      },
      required: ["collectionId", "threadId"],
      additionalProperties: false,
    },
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
    inputSchema: {
      type: "object",
      properties: {
        collectionId: { type: "string", description: "Collection TypeID" },
        threadId: {
          type: "string",
          description: "Root or child Post TypeID in the Thread",
        },
      },
      required: ["collectionId", "threadId"],
      additionalProperties: false,
    },
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
    inputSchema: {
      type: "object",
      additionalProperties: false,
    },
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
    inputSchema: {
      type: "object",
      additionalProperties: {
        type: "string",
      },
    },
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
        rejectedKeys,
        settings: buildEditableSettingsResponse(
          allSettings,
          context.appConfig.demoMode,
        ),
      };
    },
  },
  {
    name: "jant_search_posts",
    description: "Search published posts.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: 200 },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    async execute(args, context) {
      const input = SearchPostsToolSchema.parse(args ?? {});
      const results = await context.services.search.search(input.query, {
        limit: input.limit,
        status: ["published"],
      });

      return {
        count: results.length,
        query: input.query,
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
    return jsonRpcSuccessResponse(id, {
      content: [
        {
          type: "text",
          text: `Unknown tool: ${parsedParams.data.name}`,
        },
      ],
      structuredContent: {
        error: `Unknown tool: ${parsedParams.data.name}`,
      },
      isError: true,
    });
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

function toToolErrorResult(error: unknown): Record<string, unknown> {
  if (error instanceof z.ZodError) {
    return {
      content: [
        {
          type: "text",
          text: "Invalid tool arguments.",
        },
      ],
      structuredContent: {
        error: "Invalid tool arguments.",
        issues: error.issues,
      },
      isError: true,
    };
  }

  if (error instanceof ValidationError) {
    return {
      content: [
        {
          type: "text",
          text: error.message,
        },
      ],
      structuredContent: {
        error: error.message,
        details: error.details,
      },
      isError: true,
    };
  }

  if (error instanceof NotFoundError) {
    return {
      content: [
        {
          type: "text",
          text: error.message,
        },
      ],
      structuredContent: {
        error: error.message,
      },
      isError: true,
    };
  }

  if (isDomainError(error)) {
    return {
      content: [
        {
          type: "text",
          text: error.message,
        },
      ],
      structuredContent: {
        code: error.code,
        error: error.message,
        statusCode: error.statusCode,
      },
      isError: true,
    };
  }

  return {
    content: [
      {
        type: "text",
        text: "Tool execution failed.",
      },
    ],
    structuredContent: {
      error: "Tool execution failed.",
    },
    isError: true,
  };
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

function requireStorage(context: McpToolContext): StorageDriver {
  if (!context.storage) {
    throw new ConfigurationError(
      "File storage isn't set up. Check your server config.",
    );
  }

  return context.storage;
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
  const storage = requireStorage(context);
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

async function serializePosts(
  posts: Awaited<ReturnType<Services["posts"]["list"]>>,
  context: McpToolContext,
) {
  if (posts.length === 0) {
    return [];
  }

  const postIds = posts.map((post) => post.id);
  const [mediaMap, collectionMap] = await Promise.all([
    context.services.media.getByPostIds(postIds),
    context.services.collections.getCollectionsByPostIds(postIds),
  ]);

  return posts.map((post) =>
    toApiPost(post, {
      attachments: serializeAttachments(
        mediaMap.get(post.id) ?? [],
        context.appConfig,
      ),
      collectionIds: (collectionMap.get(post.id) ?? []).map(
        (collection) => collection.id,
      ),
    }),
  );
}

async function serializePost(
  post: Parameters<typeof toApiPost>[0],
  context: McpToolContext,
) {
  const [mediaList, threadCollections] = await Promise.all([
    context.services.media.getByPostId(post.id),
    context.services.collections.getCollectionsByPostId(post.id),
  ]);

  return toApiPost(post, {
    attachments: serializeAttachments(mediaList, context.appConfig),
    collectionIds: threadCollections.map((collection) => collection.id),
  });
}

function serializeMedia(
  media: Awaited<ReturnType<Services["media"]["getById"]>> extends infer T
    ? Exclude<T, null>
    : never,
  appConfig: AppConfig,
) {
  return toApiMedia(media, appConfig);
}

function serializeAttachments(
  mediaList: Awaited<ReturnType<Services["media"]["getByPostId"]>>,
  appConfig: AppConfig,
) {
  return mediaList.map((media) =>
    toApiAttachment(
      media,
      appConfig.r2PublicUrl,
      appConfig.imageTransformUrl,
      appConfig.s3PublicUrl,
      appConfig.localPublicUrl,
      appConfig.sitePathPrefix,
    ),
  );
}
