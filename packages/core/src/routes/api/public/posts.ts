import { Hono } from "hono";
import { z } from "zod";
import type { Bindings, Post } from "../../../types.js";
import type { AppVariables } from "../../../types/app-context.js";
import { parseValidated, PostContentSchema } from "../../../lib/schemas.js";
import { NotFoundError } from "../../../lib/errors.js";
import { loadPublicPostResponses } from "../../../lib/api-public-posts.js";
import { requirePublicApiEnabled } from "../../../middleware/public-content-access.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

/**
 * One published Post by its slug. Lists of Posts are Threads now:
 * `GET /api/public/threads` replaced the list this path used to answer, and
 * 0.10.0 removed it.
 */
export const publicPostsApiRoutes = new Hono<Env>();

publicPostsApiRoutes.use("*", requirePublicApiEnabled());

const PublicPostContentQuerySchema = z.object({
  content: PostContentSchema.optional(),
});

function isPublicDetailVisible(post: Post | null): post is Post {
  return (
    post !== null &&
    post.status === "published" &&
    post.visibility !== "private"
  );
}

publicPostsApiRoutes.get("/:slug", async (c) => {
  const { content } = parseValidated(
    PublicPostContentQuerySchema,
    c.req.query(),
  );
  const slug = c.req.param("slug");
  const post = await c.var.services.posts.getBySlug(slug);

  if (!isPublicDetailVisible(post)) {
    throw new NotFoundError("Post");
  }

  const [response] = await loadPublicPostResponses(c.var, [post], { content });
  return c.json(response);
});
