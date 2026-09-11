/**
 * Discover API Routes
 *
 * The one address a Discover directory calls besides the feeds it polls.
 * `GET /api/discover/posts` says, for each post ID it names, whether the post
 * is in this site's Latest feed and whether its Thread is in the featured
 * feed. The feed cannot say this about a post pushed past its length, and the
 * permalink cannot say it about a post hidden from Latest or unfeatured, which
 * is still a live page — so the directory asks instead of guessing.
 *
 * Specified in `docs/feeds.md`. A directory never builds the address: every
 * feed names it in `<jant:discover status="…">`.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { DISCOVER_STATUS_MAX_IDS } from "../../lib/discover.js";
import {
  featuredFeedSelection,
  getRssPublishedBefore,
  latestFeedSelection,
} from "../../lib/feed-policy.js";
import { createTypeIdSchema, ID_PREFIX } from "../../lib/ids.js";
import { ContentLanguageSchema, parseValidated } from "../../lib/schemas.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const discoverApiRoutes = new Hono<Env>();

const PostStatusQuerySchema = z.object({
  id: z
    .array(createTypeIdSchema(ID_PREFIX.post))
    .min(1, "Name at least one post with id=")
    .max(
      DISCOVER_STATUS_MAX_IDS,
      `Ask about at most ${DISCOVER_STATUS_MAX_IDS} posts at a time`,
    ),
  /** The language view the answer is about, as a language feed is scoped. */
  lang: ContentLanguageSchema.optional(),
});

/** Where one post stands in the feeds a directory reads. */
export interface DiscoverPostStatus {
  id: string;
  /** In the Latest feed. */
  latest: boolean;
  /** Its Thread is in the featured feed. */
  featured: boolean;
}

discoverApiRoutes.get("/posts", async (c) => {
  // It answers for a site that takes part, and follows the Discover setting
  // rather than `PUBLIC_API_ENABLED`: it says nothing the public feeds do not,
  // and a site that turned its JSON API off has not left Discover.
  if (c.var.appConfig.discover === "none") return c.notFound();

  const query = parseValidated(PostStatusQuerySchema, {
    id: c.req.queries("id") ?? [],
    lang: c.req.query("lang"),
  });
  const ids = [...new Set(query.id)];
  // The feeds hold a new post back for the RSS delay, and so does this: the
  // answer is about the feeds as a reader would fetch them now.
  const publishedBefore = getRssPublishedBefore(
    c.var.appConfig.rssPublishDelaySeconds,
  );

  const [latest, featured] = await Promise.all([
    c.var.services.posts.list({
      ...latestFeedSelection({ lang: query.lang, publishedBefore }),
      ids,
      limit: ids.length,
    }),
    c.var.services.posts.listFeaturedThreadRootIds({
      ...featuredFeedSelection({ lang: query.lang, publishedBefore }),
      threadIds: ids,
      limit: ids.length,
    }),
  ]);
  const inLatest = new Set(latest.map((post) => post.id));
  const inFeatured = new Set(featured);

  // Every ID asked about is answered, in the order asked. A post that is
  // deleted, private, a draft, a reply, or not this site's at all comes back
  // `false` on both: to a directory they all mean the same thing.
  return c.json({
    posts: ids.map((id): DiscoverPostStatus => ({
      id,
      latest: inLatest.has(id),
      featured: inFeatured.has(id),
    })),
  });
});
