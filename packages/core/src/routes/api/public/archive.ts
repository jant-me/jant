import { Hono } from "hono";
import { z } from "zod";
import type { Bindings } from "../../../types.js";
import type { AppVariables } from "../../../types/app-context.js";
import { MEDIA_KINDS, PUBLIC_ARCHIVE_VISIBILITIES } from "../../../types.js";
import {
  ContentLanguageSchema,
  FormatSchema,
  parseValidated,
} from "../../../lib/schemas.js";
import { toPublicPost } from "./posts.js";
import { requirePublicApiEnabled } from "../../../middleware/public-content-access.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const publicArchiveApiRoutes = new Hono<Env>();

publicArchiveApiRoutes.use("*", requirePublicApiEnabled());

const MediaKindSchema = z.enum(MEDIA_KINDS);
const MEDIA_KIND_LIST = MEDIA_KINDS.join(", ");
const INVALID_MEDIA_MESSAGE =
  "Invalid media value. Allowed: any, none, or kinds: " + MEDIA_KIND_LIST;

/**
 * How each selectable visibility is spelled in a URL.
 *
 * `latest_hidden` is the stored value; `hidden` is the word every surface puts
 * in a query string. Keyed by the shared list rather than restating it, so a
 * fourth public visibility fails to compile here until it is given a spelling.
 */
const VISIBILITY_URL_SPELLING = {
  public: "public",
  featured: "featured",
  latest_hidden: "hidden",
} as const satisfies Record<
  (typeof PUBLIC_ARCHIVE_VISIBILITIES)[number],
  string
>;

type ArchiveVisibilityUrlValue =
  (typeof VISIBILITY_URL_SPELLING)[keyof typeof VISIBILITY_URL_SPELLING];

const VISIBILITY_BY_URL_VALUE = Object.fromEntries(
  Object.entries(VISIBILITY_URL_SPELLING).map(([stored, url]) => [url, stored]),
) as Record<
  ArchiveVisibilityUrlValue,
  (typeof PUBLIC_ARCHIVE_VISIBILITIES)[number]
>;

const VISIBILITY_URL_VALUE_LIST = Object.values(VISIBILITY_URL_SPELLING).join(
  ", ",
);
const INVALID_VISIBILITY_MESSAGE =
  "Invalid visibility value. Allowed: " + VISIBILITY_URL_VALUE_LIST;

const BoolFlagSchema = z.enum(["0", "1"]).transform((value) => value === "1");
const PresenceSchema = z
  .enum(["any", "none"])
  .transform((value) => value === "any");

const ListPublicArchiveQuerySchema = z.object({
  format: FormatSchema.optional(),
  /** Restrict to one content language. See `/api/public/posts`. */
  lang: ContentLanguageSchema.optional(),
  collection: z.string().optional(),
  year: z.coerce.number().int().min(1971).optional(),
  // Kinds list (image,video,...) or presence words: any = posts with any
  // attachment, none = posts without attachments.
  media: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (!value) return undefined;
      if (value === "any" || value === "none") return value;
      const parts = value
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      if (parts.length === 0) return undefined;
      const result = z.array(MediaKindSchema).safeParse(parts);
      if (!result.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: INVALID_MEDIA_MESSAGE,
        });
        return z.NEVER;
      }
      return result.data;
    }),
  title: PresenceSchema.optional(),
  replies: PresenceSchema.optional(),
  // The archive page's vocabulary, minus the one value this endpoint cannot
  // answer. `private` names a set no anonymous caller may see, so it is
  // rejected rather than dropped: silently widening the result to the whole
  // archive would answer a different question under the caller's own words.
  visibility: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (!value) return undefined;
      const stored =
        VISIBILITY_BY_URL_VALUE[value as ArchiveVisibilityUrlValue];
      if (!stored) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: INVALID_VISIBILITY_MESSAGE,
        });
        return z.NEVER;
      }
      return stored;
    }),
  // Deprecated: use media=any|none and title=any|none instead.
  hasMedia: BoolFlagSchema.optional(),
  hasTitle: BoolFlagSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  content: z.enum(["markdown"]).optional(),
});

publicArchiveApiRoutes.get("/", async (c) => {
  const {
    format,
    lang,
    collection,
    year,
    media,
    title,
    replies,
    visibility,
    hasMedia,
    hasTitle,
    cursor,
    limit,
    content,
  } = parseValidated(ListPublicArchiveQuerySchema, c.req.query());

  const mediaKinds = Array.isArray(media) ? media : undefined;
  const mediaPresence =
    media === "any" ? true : media === "none" ? false : undefined;

  let collectionIds: string[] | undefined;
  if (collection) {
    // Accept both "tech,art" and "tech+art", matching the page URL convention.
    const slugExpression = collection.replace(/,/g, "+");
    const selection =
      await c.var.services.collections.resolveSelection(slugExpression);
    if (!selection || selection.collections.length === 0) {
      return c.json({ posts: [], nextCursor: null });
    }
    collectionIds = selection.collections.map((col) => col.id);
  }

  const publishedAfter =
    year !== undefined ? Date.UTC(year, 0, 1) / 1000 : undefined;
  const publishedBefore =
    year !== undefined ? Date.UTC(year + 1, 0, 1) / 1000 : undefined;

  const posts = await c.var.services.posts.list({
    format,
    lang,
    collectionIds,
    status: "published",
    cursor: cursor ?? undefined,
    limit,
    excludePrivate: true,
    excludeLatestHidden: false,
    excludeReplies: true,
    publishedAfter,
    publishedBefore,
    mediaKinds,
    hasMedia: mediaPresence ?? hasMedia,
    hasTitle: title ?? hasTitle,
    hasReplies: replies,
    // `featured` is a virtual visibility — a flag rather than a stored value —
    // so it maps to a different field than the other two. Same split the page
    // makes in `visibilityFilterClause`.
    ...(visibility === "featured"
      ? { featured: true }
      : visibility
        ? { visibility }
        : {}),
    ignorePinnedSort: true,
  });

  const postIds = posts.map((post) => post.id);
  const [mediaMap, collectionsMap] = await Promise.all([
    c.var.services.media.getByPostIds(postIds),
    c.var.services.collections.getCollectionsByPostIds(postIds),
  ]);

  return c.json({
    posts: posts.map((post) =>
      toPublicPost(
        post,
        mediaMap.get(post.id) ?? [],
        collectionsMap.get(post.id) ?? [],
        c.var.appConfig,
        { content },
      ),
    ),
    nextCursor:
      posts.length === limit ? (posts[posts.length - 1]?.id ?? null) : null,
  });
});
