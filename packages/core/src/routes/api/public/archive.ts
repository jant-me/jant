import { Hono } from "hono";
import { z } from "zod";
import type { Bindings } from "../../../types.js";
import type { AppVariables } from "../../../types/app-context.js";
import { PUBLIC_ARCHIVE_VISIBILITIES } from "../../../types.js";
import { ContentLanguageSchema, parseValidated } from "../../../lib/schemas.js";
import type { DimensionContext } from "../../../lib/filter-dimensions.js";
import {
  buildCollectionVocabulary,
  EMPTY_COLLECTION_VOCABULARY,
  parsePostFilterSelectionStrict,
  readCollectionSlugs,
  toPostFilters,
} from "../../../lib/filter-dimensions.js";
import { ValidationError } from "../../../lib/errors.js";
import { loadPublicPostResponses } from "../../../lib/api-public-posts.js";
import { requirePublicApiEnabled } from "../../../middleware/public-content-access.js";
import {
  deprecated,
  THREAD_LIST_DEPRECATED_AT,
} from "../../../middleware/deprecation.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const publicArchiveApiRoutes = new Hono<Env>();

publicArchiveApiRoutes.use("*", requirePublicApiEnabled());

/**
 * The endpoint's own parameters — everything that is not a filter dimension.
 *
 * The dimensions themselves are read by the shared registry, so this endpoint
 * cannot drift from the page it mirrors. They are listed here only so the strict
 * parser can tell them apart from a parameter nobody understands.
 */
const ListPublicArchiveQuerySchema = z.object({
  /** Restrict to one content language. See `/api/public/posts`. */
  lang: ContentLanguageSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  content: z.enum(["markdown"]).optional(),
});

const ENDPOINT_PARAMS = ["lang", "cursor", "limit", "content"] as const;

const INVALID_VISIBILITY_MESSAGE =
  "Invalid visibility value. Allowed: " +
  PUBLIC_ARCHIVE_VISIBILITIES.map((value) =>
    value === "latest_hidden" ? "hidden" : value,
  ).join(", ");

/**
 * Deprecated in 0.9 for `GET /api/public/threads?visibility=any&sort=published`,
 * which takes the same filters. Answers as it always has until 1.0.1 removes it.
 */
publicArchiveApiRoutes.get(
  "/",
  deprecated(
    THREAD_LIST_DEPRECATED_AT,
    "/api/public/threads?visibility=any&sort=published",
  ),
  async (c) => {
    const { lang, cursor, limit, content } = parseValidated(
      ListPublicArchiveQuerySchema,
      c.req.query(),
    );

    const read = (key: string): string | undefined => c.req.query(key);

    // Resolving a collection slug costs a round trip, so it is paid for only when
    // the caller named one.
    const slugs = readCollectionSlugs(read);
    const ctx: DimensionContext = {
      collections:
        slugs.length > 0
          ? buildCollectionVocabulary(await c.var.services.collections.list())
          : EMPTY_COLLECTION_VOCABULARY,
    };

    const parsed = parsePostFilterSelectionStrict(
      read,
      Object.keys(c.req.query()),
      ctx,
      { allow: ENDPOINT_PARAMS },
    );

    // A collection slug that names nothing is answered as an empty result rather
    // than a rejection: the caller's words were understood, and this site simply
    // holds no such collection.
    if (
      !parsed.ok &&
      parsed.issues.every((issue) => issue.param === "collection")
    ) {
      return c.json({ posts: [], nextCursor: null });
    }
    if (!parsed.ok) {
      const first = parsed.issues[0];
      throw new ValidationError(first?.message ?? "Validation failed");
    }

    // `private` names a set no anonymous caller may see. Rejected rather than
    // dropped: silently widening the result to the whole archive would answer a
    // different question under the caller's own words.
    const visibility = parsed.selection.visibility;
    if (
      visibility !== undefined &&
      !(PUBLIC_ARCHIVE_VISIBILITIES as readonly string[]).includes(visibility)
    ) {
      throw new ValidationError(INVALID_VISIBILITY_MESSAGE);
    }

    const { posts, nextCursor } = await c.var.services.posts.listPage(
      {
        lang,
        status: "published",
        excludePrivate: true,
        excludeLatestHidden: false,
        excludeReplies: true,
        // Newest-published-first, the page's default order. Named explicitly:
        // left unset, a published list sorts by activity, and a reply would
        // lift an old root to the top. The year filter reads the same column,
        // and so does the cursor.
        ...toPostFilters(parsed.selection, { yearAxis: "published" }),
        sortBy: "published",
        ignorePinnedSort: true,
      },
      { cursor, limit },
    );

    return c.json({
      posts: await loadPublicPostResponses(c.var, posts, { content }),
      nextCursor,
    });
  },
);
