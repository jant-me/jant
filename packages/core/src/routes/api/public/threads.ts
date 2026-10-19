/**
 * Public Threads API Routes
 *
 * The reader's view of Threads: what the site shows anyone, in the reading
 * view. A list left unfiltered is the homepage's — Threads hidden from Latest
 * left out, newest activity first, pins on top — and takes the archive's
 * filters to narrow or widen it.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Bindings } from "../../../types.js";
import { THREAD_SORTS } from "../../../types.js";
import type { AppVariables } from "../../../types/app-context.js";
import {
  ContentLanguageSchema,
  pageLimitSchema,
  PostContentSchema,
} from "../../../lib/schemas.js";
import { NotFoundError } from "../../../lib/errors.js";
import { loadPublicPostResponses } from "../../../lib/api-public-posts.js";
import { loadPublicThreadResponses } from "../../../lib/api-threads.js";
import {
  parseThreadInclude,
  parseThreadSelection,
  queryReader,
  threadSelectionQueryShape,
} from "../../../lib/thread-query.js";
import { requirePublicApiEnabled } from "../../../middleware/public-content-access.js";
import { validate } from "../../../middleware/validate.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const publicThreadsApiRoutes = new Hono<Env>();

publicThreadsApiRoutes.use("*", requirePublicApiEnabled());

/** The list's own parameters, and the filter dimensions. */
const ListThreadsQuerySchema = z.object({
  ...threadSelectionQueryShape,
  lang: ContentLanguageSchema.optional(),
  sort: z.enum(THREAD_SORTS).optional(),
  include: z.string().optional(),
  cursor: z.string().optional(),
  limit: pageLimitSchema(100, 20),
  content: PostContentSchema.optional(),
});

const GetThreadQuerySchema = z.object({
  include: z.string().optional(),
  content: PostContentSchema.optional(),
});

const ListThreadPostsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: pageLimitSchema(100, 100),
  content: PostContentSchema.optional(),
});

publicThreadsApiRoutes.get(
  "/",
  validate("query", ListThreadsQuerySchema),
  async (c) => {
    const query = c.req.valid("query");
    const { fold } = parseThreadInclude(query.include);
    const parsed = await parseThreadSelection(queryReader(query), {
      audience: "reader",
      loadCollections: () => c.var.services.collections.list(),
    });
    if (parsed.kind === "empty") {
      return c.json({ threads: [], nextCursor: null });
    }

    const { threads, nextCursor } = await c.var.services.threads.listThreads(
      {
        audience: "reader",
        selection: parsed.selection,
        includeHidden: parsed.includeHidden,
        lang: query.lang,
        sort: query.sort,
        fold,
        timeZone: c.var.appConfig.timeZone,
      },
      { cursor: query.cursor, limit: query.limit },
    );

    return c.json({
      threads: await loadPublicThreadResponses(c.var, threads, {
        content: query.content,
      }),
      nextCursor,
    });
  },
);

publicThreadsApiRoutes.get(
  "/:slug",
  validate("query", GetThreadQuerySchema),
  async (c) => {
    const { include, content } = c.req.valid("query");
    const root = await c.var.services.threads.findRoot(
      { slug: c.req.param("slug") },
      "reader",
    );
    if (!root) throw new NotFoundError("Thread");

    const summaries = await c.var.services.threads.summarize(
      [root],
      parseThreadInclude(include),
    );
    const [thread] = await loadPublicThreadResponses(c.var, summaries, {
      content,
    });
    if (!thread) throw new NotFoundError("Thread");
    return c.json(thread);
  },
);

publicThreadsApiRoutes.get(
  "/:slug/posts",
  validate("query", ListThreadPostsQuerySchema),
  async (c) => {
    const { cursor, limit, content } = c.req.valid("query");
    const root = await c.var.services.threads.findRoot(
      { slug: c.req.param("slug") },
      "reader",
    );
    if (!root) throw new NotFoundError("Thread");

    const { posts, nextCursor } = await c.var.services.threads.listPosts(
      root.id,
      { audience: "reader" },
      { cursor, limit },
    );
    return c.json({
      posts: await loadPublicPostResponses(c.var, posts, { content }),
      nextCursor,
    });
  },
);
