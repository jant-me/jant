/**
 * Shared Zod schemas for validation (v2)
 *
 * These schemas ensure type-safe validation of user input
 * from forms, API requests, and other external sources.
 *
 * IMPORTANT: Types are defined in types.ts as the single source of truth.
 * This file only defines Zod validation schemas based on those types.
 */

import { z } from "zod";
import {
  ARCHIVE_LAYOUTS,
  FORMATS,
  STATUSES,
  VISIBILITIES,
  SORT_ORDERS,
  COLLECTION_SORT_ORDERS,
  SMART_COLLECTION_SORT_ORDERS,
  NAV_ITEM_TYPES,
  SYSTEM_NAV_KEY_VALUES,
  MAX_MEDIA_ATTACHMENTS,
  MAX_THREAD_POSTS,
  MAX_COLLECTION_SLUG_LENGTH,
  MAX_COLLECTION_TITLE_LENGTH,
  MAX_COLLECTION_DESCRIPTION_LENGTH,
  MAX_SITE_NAME_LENGTH,
  MAX_SITE_DESCRIPTION_LENGTH,
  MAX_SITE_FOOTER_LENGTH,
  TEXT_ATTACHMENT_CONTENT_FORMATS,
  CONFIG_FIELDS,
  type ConfigEditorDefinition,
  type ConfigKey,
} from "../types.js";
import {
  formatLanguageList,
  isLocale,
  isValidContentLanguage,
  normalizeContentLanguage,
  parseLanguageList,
} from "../i18n/locales.js";
import { ValidationError } from "./errors.js";
import { createTypeIdSchema, ID_PREFIX } from "./ids.js";
import { PostFilterSelectionSchema } from "./filter-dimensions.js";
import { normalizeSlug } from "./slug-format.js";
import { isReservedPath } from "./constants.js";
import { sanitizeUrl, normalizePath } from "./url.js";
import { isSupportedTimeZone, normalizeTimeZone } from "./timezones.js";

// =============================================================================
// Shared Transforms
// =============================================================================

/**
 * Strip C0 control characters (except HT, LF, CR) that can break rendering
 * or interfere with FTS5 highlight sentinels (STX/ETX).
 */
// eslint-disable-next-line no-control-regex -- intentionally matching C0 control characters
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * Normalize an email address for storage and lookup.
 *
 * @param email - Raw email input
 * @returns Trimmed, lowercased email
 * @example
 * ```ts
 * normalizeEmail("  User@Example.COM ");
 * // Returns: "user@example.com"
 * ```
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Trim, strip control characters, and collapse to undefined when empty. */
function sanitizeText(maxLength: number) {
  return z
    .string()
    .trim()
    .max(maxLength)
    .transform((s) => s.replace(CONTROL_CHAR_RE, "") || undefined);
}

/** Trim and strip control characters while preserving empty strings. */
function sanitizeSettingText(maxLength: number) {
  return z
    .string()
    .trim()
    .max(maxLength)
    .transform((s) => s.replace(CONTROL_CHAR_RE, ""));
}

/** Trim and strip control characters, preserving omitted fields and using null to clear values on update. */
function sanitizeNullableUpdateText(maxLength: number) {
  return z
    .union([
      z
        .string()
        .trim()
        .max(maxLength)
        .transform((s) => {
          const sanitized = s.replace(CONTROL_CHAR_RE, "");
          return sanitized === "" ? null : sanitized;
        }),
      z.null(),
    ])
    .optional();
}

/** Accept update-time URL clears as null while still validating non-empty URLs. */
function sanitizeNullableUpdateUrl() {
  return z
    .union([
      z
        .string()
        .trim()
        .url()
        .refine((val) => sanitizeUrl(val) !== "", {
          message: "URL must use http:, https:, or mailto: protocol",
        }),
      z
        .string()
        .trim()
        .length(0)
        .transform(() => null),
      z.null(),
    ])
    .optional();
}

/** Preserve omitted ratings and normalize explicit clears to null on update. */
function createNullableUpdateRatingSchema() {
  return z
    .union([
      z.coerce.number().int().min(0).max(5),
      z.literal("").transform(() => null),
      z.null(),
    ])
    .optional()
    .transform((value) => (value === 0 ? null : value));
}

/**
 * Post format enum schema
 * Based on FORMATS from types.ts
 */
export const FormatSchema = z.enum(FORMATS);

/**
 * Post status enum schema
 * Based on STATUSES from types.ts
 */
export const StatusSchema = z.enum(STATUSES);

/**
 * Post/general sort order enum schema
 */
export const SortOrderSchema = z.enum(SORT_ORDERS);

/**
 * Collection sort order enum schema
 */
export const CollectionSortOrderSchema = z.enum(COLLECTION_SORT_ORDERS);

/**
 * Navigation item type enum schema
 */
export const NavItemTypeSchema = z.enum(NAV_ITEM_TYPES);
export const SystemNavKeySchema = z.enum(SYSTEM_NAV_KEY_VALUES);

/**
 * Redirect type enum schema
 * Form input validation for redirect type (stored as number in DB)
 */
export const RedirectTypeSchema = z.enum(["301", "302"]);

/**
 * Custom URL target type enum schema.
 *
 * Every kind a stored path can be, including `archive` — which is read and
 * listed but no longer created. See {@link CreatableCustomUrlTargetTypeSchema}.
 */
export const CustomUrlTargetTypeSchema = z.enum([
  "post",
  "collection",
  "redirect",
  "archive",
]);

/**
 * The target kinds a new custom URL may take.
 *
 * `archive` is absent: hand-typing `format=note&title=none` into a text field
 * is the problem smart collections exist to replace, and a form that stopped
 * offering it while the endpoint still accepted it would not have stopped
 * offering it. Existing archive paths keep working indefinitely.
 */
export const CreatableCustomUrlTargetTypeSchema = z.enum([
  "post",
  "collection",
  "redirect",
]);

/**
 * Rating schema (1-5 integer)
 */
export const RatingSchema = z.coerce
  .number()
  .int()
  .min(0)
  .max(5)
  .optional()
  .or(z.literal("").transform(() => undefined))
  .transform((v) => (v === 0 ? undefined : v));

/**
 * Any syntactically valid BCP 47 tag, normalized to canonical case.
 *
 * Deliberately open: Jant ships dashboard catalogs for a handful of locales but
 * content can be written in any language.
 */
export const ContentLanguageSchema = z
  .string()
  .trim()
  .refine(isValidContentLanguage, {
    message: "Enter a valid BCP 47 language tag (e.g. en, zh-Hans, ja).",
  })
  .transform(normalizeContentLanguage);

const PostIdSchema = createTypeIdSchema(ID_PREFIX.post);
const MediaIdSchema = createTypeIdSchema(ID_PREFIX.media);
const CollectionIdSchema = createTypeIdSchema(ID_PREFIX.collection);
const SmartCollectionIdSchema = createTypeIdSchema(ID_PREFIX.smartCollection);
const CollectionDirectoryItemIdSchema = createTypeIdSchema(
  ID_PREFIX.collectionDirectoryItem,
);
const NavItemIdSchema = createTypeIdSchema(ID_PREFIX.navItem);
const PathIdSchema = createTypeIdSchema(ID_PREFIX.path);

/**
 * Base post fields (shared between create and update schemas)
 */
const PostFieldsSchema = z.object({
  format: FormatSchema,
  slug: z
    .string()
    .min(1)
    .transform(normalizeSlug)
    .pipe(
      z
        .string()
        .min(1)
        .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/),
    )
    .optional()
    .or(z.literal("").transform(() => undefined)),
  path: z
    .string()
    .min(1)
    .transform(normalizePath)
    .pipe(z.string().min(1))
    .optional()
    .or(z.literal("").transform(() => undefined)),
  title: sanitizeText(300)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  sourceName: sanitizeText(300)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  body: z.string().optional(),
  bodyMarkdown: z.string().optional(),
  status: StatusSchema.optional(),
  visibility: z.enum(VISIBILITIES).optional(),
  // Admin UI sends boolean flags; the Hugo importer and API clients can
  // instead send explicit ISO-8601 or Unix-second timestamps via
  // `pinnedAt` / `featuredAt`. The refine below at the API-body level
  // collapses whichever form is present into a single internal field.
  pinned: z
    .union([z.boolean(), z.literal("on").transform(() => true)])
    .optional(),
  featured: z.boolean().optional(),
  pinnedAt: z
    .union([
      z.iso
        .datetime()
        .transform((iso) => Math.floor(new Date(iso).getTime() / 1000)),
      z.number().int().positive(),
      z.null(),
    ])
    .optional(),
  featuredAt: z
    .union([
      z.iso
        .datetime()
        .transform((iso) => Math.floor(new Date(iso).getTime() / 1000)),
      z.number().int().positive(),
      z.null(),
    ])
    .optional(),
  url: z
    .url()
    .refine((val) => sanitizeUrl(val) !== "", {
      message: "URL must use http:, https:, or mailto: protocol",
    })
    .optional()
    .or(z.literal("")),
  sourceUrl: z
    .url()
    .refine((val) => sanitizeUrl(val) !== "", {
      message: "URL must use http:, https:, or mailto: protocol",
    })
    .optional()
    .or(z.literal("")),
  quoteText: z.string().optional(),
  rating: RatingSchema,
  collectionIds: z
    .array(CollectionIdSchema)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  collectionEntries: z
    .array(
      z.object({
        collectionId: CollectionIdSchema,
        createdAt: z.number().int().positive().optional(),
        position: z.number().int().nonnegative().optional(),
        pinnedAt: z.union([z.number().int().positive(), z.null()]).optional(),
      }),
    )
    .optional(),
  replyToId: PostIdSchema.optional(),
  quietReply: z.boolean().optional(),
  // Content language. The post service normalizes and enforces the
  // thread-uniform rule; this only rejects tags that are not BCP 47 at all.
  language: ContentLanguageSchema.optional().or(
    z.literal("").transform(() => undefined),
  ),
  translationOfId: PostIdSchema.optional(),
  publishedAt: z.number().int().positive().optional(),
  mediaIds: z.array(MediaIdSchema).max(MAX_MEDIA_ATTACHMENTS).optional(),
  mediaAlts: z.record(MediaIdSchema, z.string()).optional(),
});

const ApiMediaAttachmentInputSchema = z
  .object({
    type: z.literal("media"),
    mediaId: MediaIdSchema,
    alt: z
      .string()
      .max(500)
      .transform((s) => s.replace(CONTROL_CHAR_RE, "").trim())
      .optional()
      .or(z.literal("").transform(() => "")),
  })
  .strict();

const ApiTextAttachmentInputSchema = z
  .object({
    type: z.literal("text"),
    contentFormat: z.enum(TEXT_ATTACHMENT_CONTENT_FORMATS),
    content: z.string().refine((value) => value.trim().length > 0, {
      message: "Text attachments need content.",
    }),
    summary: sanitizeText(300)
      .optional()
      .or(z.literal("").transform(() => undefined)),
  })
  .strict();

export const PostAttachmentInputSchema = z.discriminatedUnion("type", [
  ApiMediaAttachmentInputSchema,
  ApiTextAttachmentInputSchema,
]);

const ApiPostFieldsSchema = PostFieldsSchema.omit({
  mediaIds: true,
  mediaAlts: true,
})
  .extend({
    attachments: z
      .array(PostAttachmentInputSchema)
      .max(MAX_MEDIA_ATTACHMENTS, {
        message: `Posts allow at most ${MAX_MEDIA_ATTACHMENTS} attachments`,
      })
      .optional(),
  })
  .strict();

/** Mutual exclusivity: body and bodyMarkdown cannot both be provided */
function refineBodyExclusivity<
  T extends { body?: string | null; bodyMarkdown?: string | null },
>(schema: z.ZodType<T>) {
  return schema.refine((data) => !(data.body && data.bodyMarkdown), {
    message: "Provide either body or bodyMarkdown, not both",
    path: ["bodyMarkdown"],
  });
}

function hasNonEmptyText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function refineCreatePostFormatShape<
  T extends {
    format: string;
    title?: string;
    sourceName?: string;
    url?: string;
    sourceUrl?: string;
    quoteText?: string;
  },
>(schema: z.ZodType<T>) {
  return schema.superRefine((data, ctx) => {
    const hasUrl = hasNonEmptyText(data.url);
    const hasSourceUrl = hasNonEmptyText(data.sourceUrl);
    const hasQuoteText = hasNonEmptyText(data.quoteText);
    const hasTitle = hasNonEmptyText(data.title);
    const hasSourceName = hasNonEmptyText(data.sourceName);

    if (data.format === "note") {
      if (hasUrl) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["url"],
          message: "Notes can't include a URL.",
        });
      }
      if (hasQuoteText) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["quoteText"],
          message: "Notes can't include quoted text.",
        });
      }
      if (hasSourceName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sourceName"],
          message: "Notes can't include a source name.",
        });
      }
      if (hasSourceUrl) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sourceUrl"],
          message: "Notes can't include a source URL.",
        });
      }
    }

    if (data.format === "link") {
      if (!hasTitle) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["title"],
          message: "Link posts need a title.",
        });
      }
      if (!hasUrl) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["url"],
          message: "Link posts need a URL.",
        });
      }
      if (hasQuoteText) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["quoteText"],
          message: "Link posts can't include quoted text.",
        });
      }
      if (hasSourceName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sourceName"],
          message: "Link posts can't include a source name.",
        });
      }
      if (hasSourceUrl) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sourceUrl"],
          message: "Link posts can't include a source URL.",
        });
      }
    }

    if (data.format === "quote" && !hasQuoteText) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quoteText"],
        message: "Quote posts need quoted text.",
      });
    }

    if (data.format === "quote" && hasTitle) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["title"],
        message: "Quote posts use sourceName instead of title.",
      });
    }

    if (data.format === "quote" && hasUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: "Quote posts use sourceUrl instead of url.",
      });
    }
  });
}

/** Mutual exclusivity: slug and path cannot both be provided */
function refineSlugPathExclusivity<T extends { slug?: string; path?: string }>(
  schema: z.ZodType<T>,
) {
  return schema.refine((data) => !(data.slug && data.path), {
    message: "Provide either slug or path, not both",
    path: ["path"],
  });
}

/**
 * API request body schema for creating a post
 */
export const CreatePostSchema = refineSlugPathExclusivity(
  refineCreatePostFormatShape(refineBodyExclusivity(PostFieldsSchema)),
);

export const CreatePostApiSchema = refineSlugPathExclusivity(
  refineCreatePostFormatShape(refineBodyExclusivity(ApiPostFieldsSchema)),
);

/**
 * API request body schema for creating a thread (multiple chained posts atomically).
 * posts[0] is the root; subsequent posts are sequential replies.
 */
export const CreateThreadApiSchema = z.object({
  posts: z
    .array(CreatePostApiSchema)
    .min(2, "A thread needs at least 2 posts.")
    .max(
      MAX_THREAD_POSTS,
      `Threads can include up to ${MAX_THREAD_POSTS} posts.`,
    ),
  /** When re-editing a thread draft, the root post ID of the old thread to replace */
  replaceThreadId: createTypeIdSchema(ID_PREFIX.post).optional(),
});

/**
 * API request body schema for updating a post
 */
const UpdatePostFieldsSchema = PostFieldsSchema.partial().extend({
  title: sanitizeNullableUpdateText(300),
  sourceName: sanitizeNullableUpdateText(300),
  body: z.string().nullable().optional(),
  bodyMarkdown: z.string().nullable().optional(),
  url: sanitizeNullableUpdateUrl(),
  sourceUrl: sanitizeNullableUpdateUrl(),
  quoteText: z.string().nullable().optional(),
  rating: createNullableUpdateRatingSchema(),
});

const UpdatePostApiFieldsSchema = ApiPostFieldsSchema.partial().extend({
  title: sanitizeNullableUpdateText(300),
  sourceName: sanitizeNullableUpdateText(300),
  body: z.string().nullable().optional(),
  bodyMarkdown: z.string().nullable().optional(),
  url: sanitizeNullableUpdateUrl(),
  sourceUrl: sanitizeNullableUpdateUrl(),
  quoteText: z.string().nullable().optional(),
  rating: createNullableUpdateRatingSchema(),
});

export const UpdatePostSchema = refineSlugPathExclusivity(
  refineBodyExclusivity(UpdatePostFieldsSchema),
);

export const UpdatePostApiSchema = refineSlugPathExclusivity(
  refineBodyExclusivity(UpdatePostApiFieldsSchema),
);

/**
 * API request body schema for creating a navigation item
 */
export const CreateNavItemSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("link"),
    label: sanitizeText(100).pipe(z.string().min(1)),
    url: z
      .string()
      .min(1)
      .refine((val) => sanitizeUrl(val) !== "", {
        message: "URL must use http:, https:, or mailto: protocol",
      }),
    placement: z.enum(["header", "more"]).optional(),
  }),
  z.object({
    type: z.literal("system"),
    systemKey: SystemNavKeySchema,
    placement: z.enum(["header", "more"]).optional(),
  }),
  z.object({
    type: z.literal("collection"),
    collectionId: z.string().min(1),
    label: sanitizeText(100).pipe(z.string().min(1)).optional(),
    placement: z.enum(["header", "more"]).optional(),
  }),
  // Placed exactly like a collection — the label follows the target's title
  // and the URL follows its address; only which column holds the key differs.
  z.object({
    type: z.literal("smart_collection"),
    smartCollectionId: SmartCollectionIdSchema,
    label: sanitizeText(100).pipe(z.string().min(1)).optional(),
    placement: z.enum(["header", "more"]).optional(),
  }),
  z.object({
    type: z.literal("page"),
    postId: PostIdSchema,
    label: sanitizeText(100).pipe(z.string().min(1)).optional(),
    placement: z.enum(["header", "more"]).optional(),
  }),
]);

/**
 * API request body schema for updating a navigation item
 */
export const UpdateNavItemSchema = z.object({
  label: sanitizeSettingText(100).optional(),
  url: z
    .string()
    .min(1)
    .refine((val) => sanitizeUrl(val) !== "", {
      message: "URL must use http:, https:, or mailto: protocol",
    })
    .optional(),
  placement: z.enum(["header", "more"]).optional(),
});

export const CollectionDirectoryLabelSchema = z.string().trim().max(60);
export const CollectionDirectoryLinkLabelSchema = sanitizeText(60).pipe(
  z.string().min(1),
);
export const CollectionDirectoryLinkUrlSchema = z
  .string()
  .min(1)
  .refine((val) => sanitizeUrl(val) !== "", {
    message: "URL must use http:, https:, or mailto: protocol",
  });

export const CollectionDescriptionValueSchema = sanitizeText(
  MAX_COLLECTION_DESCRIPTION_LENGTH,
);

export const CreateCollectionDirectoryItemSchema = z.discriminatedUnion(
  "type",
  [
    z.object({
      type: z.literal("divider"),
      label: CollectionDirectoryLabelSchema.nullable().optional(),
    }),
    z.object({
      type: z.literal("link"),
      label: CollectionDirectoryLinkLabelSchema,
      url: CollectionDirectoryLinkUrlSchema,
      description: CollectionDescriptionValueSchema.nullable().optional(),
    }),
  ],
);

/**
 * A row in the collections directory, as the drag surface names it.
 *
 * A placed row is named by its directory row id. A collection or smart
 * collection that has never been placed is named by its own id, because that is
 * all the directory has to render — moving one is what gives it a row.
 */
export const CollectionDirectoryRowIdSchema = z.union([
  CollectionDirectoryItemIdSchema,
  CollectionIdSchema,
  SmartCollectionIdSchema,
]);

export const UpdateCollectionDirectoryItemSchema = z.object({
  label: z.union([CollectionDirectoryLabelSchema, z.null()]).optional(),
  url: CollectionDirectoryLinkUrlSchema.optional(),
  description: CollectionDescriptionValueSchema.nullable().optional(),
});

export {
  CollectionDirectoryItemIdSchema,
  CollectionIdSchema,
  MediaIdSchema,
  NavItemIdSchema,
  PathIdSchema,
  PostIdSchema,
  SmartCollectionIdSchema,
};

/**
 * API request body schema for creating a collection
 */
export const CollectionSlugSchema = z
  .string()
  .min(1)
  .max(MAX_COLLECTION_SLUG_LENGTH, {
    message: `Keep this link under ${MAX_COLLECTION_SLUG_LENGTH} characters.`,
  })
  .refine((value) => !value.includes("+"), {
    message: "Use lowercase letters, numbers, and hyphens only.",
  })
  .transform(normalizeSlug)
  .pipe(
    z
      .string()
      .min(1)
      .max(MAX_COLLECTION_SLUG_LENGTH, {
        message: `Keep this link under ${MAX_COLLECTION_SLUG_LENGTH} characters.`,
      })
      .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/)
      .refine((value) => !isReservedPath(value), {
        message: "This link is reserved. Choose something else.",
      }),
  );

export const CollectionTitleSchema = sanitizeText(
  MAX_COLLECTION_TITLE_LENGTH,
).pipe(z.string().min(1));

export const CreateCollectionSchema = z.object({
  slug: CollectionSlugSchema,
  title: CollectionTitleSchema,
  description: CollectionDescriptionValueSchema.optional(),
  sortOrder: CollectionSortOrderSchema.optional(),
});

/**
 * API request body schema for updating a collection
 */
export const UpdateCollectionSchema = CreateCollectionSchema.partial();

/**
 * API request body schema for creating a smart collection.
 *
 * The conditions come from the dimension registry rather than being restated
 * here, so a new dimension is accepted the moment it is declared and a stored
 * vocabulary narrower than the URL one (`visibility` never being `private`)
 * is narrow at every entry point at once.
 */
export const CreateSmartCollectionSchema = z.object({
  slug: CollectionSlugSchema,
  title: CollectionTitleSchema,
  description: CollectionDescriptionValueSchema.nullable().optional(),
  // Omitted means no conditions, which is the honest spelling of "every post".
  selection: PostFilterSelectionSchema.optional(),
  sort: z.enum(SMART_COLLECTION_SORT_ORDERS).optional(),
  layout: z.enum(ARCHIVE_LAYOUTS).nullable().optional(),
});

export const UpdateSmartCollectionSchema =
  CreateSmartCollectionSchema.partial();

/** The body of a preview request: the conditions, and nothing else. */
export const SmartCollectionPreviewSchema = z.object({
  selection: PostFilterSelectionSchema.optional(),
});

export const SiteNameSettingSchema = sanitizeSettingText(MAX_SITE_NAME_LENGTH);
export const SiteDescriptionSettingSchema = sanitizeSettingText(
  MAX_SITE_DESCRIPTION_LENGTH,
);
export const SiteFooterSettingSchema = sanitizeSettingText(
  MAX_SITE_FOOTER_LENGTH,
);

export const UpdateSiteSettingsSchema = z.object({
  siteName: SiteNameSettingSchema,
  siteDescription: SiteDescriptionSettingSchema,
  siteFooter: SiteFooterSettingSchema,
});

const EDITABLE_SETTING_VALUE_SCHEMAS: Partial<
  Record<ConfigKey, z.ZodSchema<string>>
> = {
  SITE_NAME: SiteNameSettingSchema,
  SITE_DESCRIPTION: SiteDescriptionSettingSchema,
  SITE_FOOTER: SiteFooterSettingSchema,
};

/**
 * Normalize a raw string according to a Config Editor control definition.
 *
 * @param definition - Typed editor metadata from the config registry
 * @param value - Raw string received at the HTTP/service boundary
 * @returns Canonical string suitable for the settings key-value store
 * @example
 * ```ts
 * normalizeConfigEditorDefinitionValue({ type: "boolean" }, "true");
 * // "true"
 * ```
 */
export function normalizeConfigEditorDefinitionValue(
  definition: ConfigEditorDefinition,
  value: string,
): string {
  switch (definition.type) {
    case "boolean": {
      const normalized = value.trim().toLowerCase();
      if (normalized !== "true" && normalized !== "false") {
        throw new ValidationError("Choose true or false.");
      }
      return normalized;
    }
    case "string": {
      const normalized = value.trim();
      if (
        definition.maxLength !== undefined &&
        normalized.length > definition.maxLength
      ) {
        throw new ValidationError(
          `Keep this value at ${definition.maxLength} characters or fewer.`,
        );
      }
      return normalized;
    }
    case "number": {
      const normalized = value.trim();
      const parsed = Number(normalized);
      if (!normalized || !Number.isFinite(parsed)) {
        throw new ValidationError("Enter a valid number.");
      }
      if (definition.min !== undefined && parsed < definition.min) {
        throw new ValidationError(
          `Enter a number greater than or equal to ${definition.min}.`,
        );
      }
      if (definition.max !== undefined && parsed > definition.max) {
        throw new ValidationError(
          `Enter a number less than or equal to ${definition.max}.`,
        );
      }
      if (definition.step !== undefined && definition.step > 0) {
        const steps = parsed / definition.step;
        const tolerance = Number.EPSILON * Math.max(1, Math.abs(steps)) * 4;
        if (Math.abs(steps - Math.round(steps)) > tolerance) {
          throw new ValidationError(
            `Enter a number in steps of ${definition.step}.`,
          );
        }
      }
      return String(parsed);
    }
    case "enum": {
      if (definition.options && !definition.options.includes(value)) {
        throw new ValidationError("Choose one of the available options.");
      }
      return value;
    }
  }
}

export function normalizeEditableSettingValue(
  key: ConfigKey,
  value: string,
): string {
  const field = CONFIG_FIELDS[key];
  if (!("editor" in field)) {
    return value;
  }

  const schema = EDITABLE_SETTING_VALUE_SCHEMAS[key];
  let normalized = schema
    ? parseValidated(schema, value)
    : normalizeConfigEditorDefinitionValue(field.editor, value);

  switch (key) {
    case "SITE_NAME":
      if (!normalized) {
        throw new ValidationError(
          "Site name can't be empty. Enter a name or reset this setting.",
        );
      }
      break;
    case "SITE_LANGUAGE":
      if (!isValidContentLanguage(normalized)) {
        throw new ValidationError(
          "Enter a valid BCP 47 language tag, such as en, fi, or zh-Hans.",
        );
      }
      normalized = normalizeContentLanguage(normalized);
      break;
    case "DASHBOARD_LANGUAGE":
      if (normalized && !isLocale(normalized)) {
        throw new ValidationError(
          "Choose a dashboard language Jant is translated into.",
        );
      }
      break;
    case "MULTILINGUAL_ENABLED":
      if (normalized !== "true" && normalized !== "false") {
        throw new ValidationError("Multilingual content is on or off.");
      }
      break;
    case "ADDITIONAL_LANGUAGES":
      // Re-serialized from the parsed form so a hand-written value cannot
      // store blanks, duplicates, or non-canonical casing.
      normalized = formatLanguageList(parseLanguageList(normalized));
      break;
    case "TIME_ZONE":
      if (!isSupportedTimeZone(normalized)) {
        throw new ValidationError("Choose a valid time zone.");
      }
      normalized = normalizeTimeZone(normalized);
      break;
  }

  return normalized;
}

/**
 * API request body schema for creating a custom URL
 */
export const CreateCustomUrlSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(512)
    .regex(
      /^\/?[a-z0-9][a-z0-9\-/.]*$/,
      "Path must contain only lowercase alphanumeric characters, hyphens, slashes, and dots",
    )
    .transform((p) => (p.startsWith("/") ? p : `/${p}`)),
  targetType: CreatableCustomUrlTargetTypeSchema,
  targetId: z.string().optional(),
  toPath: z.string().optional(),
  redirectType: RedirectTypeSchema.optional(),
});

// =============================================================================
// Auth Schemas
// =============================================================================

/**
 * Setup form validation schema
 */
export const SetupSchema = z.object({
  siteName: z.string().min(1, "Site name is required"),
  email: z
    .string()
    .transform(normalizeEmail)
    .pipe(z.string().email("Invalid email address")),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128),
  // Prefilled from Accept-Language and confirmed by the author. Optional so an
  // older client or a scripted setup still succeeds; the route falls back to
  // the same detection the form used.
  contentLanguage: ContentLanguageSchema.optional().or(
    z.literal("").transform(() => undefined),
  ),
});

/**
 * Setup on a site whose shell already exists.
 *
 * A control plane created the site and its owner, so the only thing left to
 * settle is the language its author writes in — the one fact no header, host,
 * or billing record can supply.
 */
export const SetupLanguageSchema = z.object({
  contentLanguage: ContentLanguageSchema,
});

/**
 * Sign-in form validation schema
 */
export const SigninSchema = z.object({
  email: z
    .string()
    .transform(normalizeEmail)
    .pipe(z.string().email("Invalid email address")),
  password: z.string().min(1, "Password is required").max(128),
});

/**
 * Password reset form validation schema
 */
export const ResetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(128),
    confirmPassword: z.string().min(1),
    token: z.string().min(1),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

// =============================================================================
// Slug Normalization
// =============================================================================

export { normalizeSlug } from "./slug-format.js";

// =============================================================================
// Form Data Helpers
// =============================================================================

/**
 * Form data helper: safely parse a FormData value with a schema
 *
 * @example
 * ```ts
 * const format = parseFormData(formData, "format", FormatSchema);
 * // format is Format, throws if invalid
 * ```
 */
export function parseFormData<T>(
  formData: FormData,
  key: string,
  schema: z.ZodSchema<T>,
): T {
  const value = formData.get(key);
  if (value === null) {
    throw new ValidationError(`Missing required field: ${key}`);
  }
  return schema.parse(value);
}

/**
 * Form data helper: safely parse optional FormData value with a schema
 *
 * @example
 * ```ts
 * const slug = parseFormDataOptional(formData, "slug", z.string());
 * // slug is string | undefined
 * ```
 */
export function parseFormDataOptional<T>(
  formData: FormData,
  key: string,
  schema: z.ZodSchema<T>,
): T | undefined {
  const value = formData.get(key);
  if (value === null || value === "") {
    return undefined;
  }
  return schema.parse(value);
}

/**
 * Validates attachment count for a post.
 * All formats allow 0-20 attachments.
 *
 * @param attachments - Array of attachments to attach
 * @returns null if valid, error string if invalid
 */
export function validateAttachmentCount(attachments: unknown[]): string | null {
  if (attachments.length > MAX_MEDIA_ATTACHMENTS) {
    return `Posts allow at most ${MAX_MEDIA_ATTACHMENTS} attachments`;
  }
  return null;
}

/**
 * Parse and validate data against a Zod schema, throwing ValidationError on failure.
 *
 * @param schema - Zod schema to validate against
 * @param data - Data to validate
 * @returns Validated data
 * @example
 * ```ts
 * const body = parseValidated(CreatePostSchema, await c.req.json());
 * ```
 */
export function parseValidated<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const firstMessage = result.error.issues[0]?.message ?? "Validation failed";
    throw new ValidationError(firstMessage, result.error.flatten());
  }
  return result.data;
}
