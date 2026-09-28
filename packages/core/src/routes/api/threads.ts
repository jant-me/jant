/**
 * Threads API Routes
 *
 * The author's view of Threads: every status and visibility, Posts in the
 * editing view. The reader's view is `/api/public/threads`.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Bindings } from "../../types.js";
import { THREAD_SORTS } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import {
  ContentLanguageSchema,
  pageLimitSchema,
  PostContentSchema,
  StatusSchema,
  parseValidated,
} from "../../lib/schemas.js";
import { requireAuthApi } from "../../middleware/auth.js";
import { loadApiPostResponses } from "../../lib/api-posts.js";
import { loadApiThreadResponses } from "../../lib/api-threads.js";
import {
  parseThreadInclude,
  parseThreadSelection,
} from "../../lib/thread-query.js";
import { NotFoundError, parseIdParam } from "../../lib/errors.js";
import { ID_PREFIX } from "../../lib/ids.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const threadsApiRoutes = new Hono<Env>();

threadsApiRoutes.use("*", requireAuthApi());

/** The list's own parameters; everything else is a filter dimension. */
const ListThreadsQuerySchema = z.object({
  status: StatusSchema.optional(),
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
  status: StatusSchema.optional(),
  cursor: z.string().optional(),
  limit: pageLimitSchema(100, 100),
  content: PostContentSchema.optional(),
});

threadsApiRoutes.get("/", async (c) => {
  const query = parseValidated(ListThreadsQuerySchema, c.req.query());
  const { fold } = parseThreadInclude(query.include);
  const parsed = await parseThreadSelection((key) => c.req.query(key), {
    audience: "author",
    loadCollections: () => c.var.services.collections.list(),
  });
  if (parsed.kind === "empty") {
    return c.json({ threads: [], nextCursor: null });
  }

  const { threads, nextCursor } = await c.var.services.threads.listThreads(
    {
      audience: "author",
      status: query.status,
      selection: parsed.selection,
      lang: query.lang,
      sort: query.sort,
      fold,
    },
    { cursor: query.cursor, limit: query.limit },
  );

  return c.json({
    threads: await loadApiThreadResponses(c.var, threads, {
      content: query.content,
    }),
    nextCursor,
  });
});

threadsApiRoutes.get("/:id", async (c) => {
  const id = parseIdParam(c.req.param("id"), ID_PREFIX.post);
  const { include, content } = parseValidated(
    GetThreadQuerySchema,
    c.req.query(),
  );
  const root = await c.var.services.threads.findRoot({ id }, "author");
  if (!root) throw new NotFoundError("Thread");

  const summaries = await c.var.services.threads.summarize(
    [root],
    parseThreadInclude(include),
  );
  const [thread] = await loadApiThreadResponses(c.var, summaries, { content });
  if (!thread) throw new NotFoundError("Thread");
  return c.json(thread);
});

threadsApiRoutes.get("/:id/posts", async (c) => {
  const id = parseIdParam(c.req.param("id"), ID_PREFIX.post);
  const { status, cursor, limit, content } = parseValidated(
    ListThreadPostsQuerySchema,
    c.req.query(),
  );
  const root = await c.var.services.threads.findRoot({ id }, "author");
  if (!root) throw new NotFoundError("Thread");

  const { posts, nextCursor } = await c.var.services.threads.listPosts(
    root.id,
    { audience: "author", status },
    { cursor, limit },
  );
  return c.json({
    posts: await loadApiPostResponses(c.var, posts, { content }),
    nextCursor,
  });
});
