/**
 * What `POST` and `PUT /api/posts` and the MCP post tools hand the post service.
 *
 * The HTTP routes and MCP accept one request body — `jant_posts_create` says it
 * "supports the same JSON body as POST /api/posts" — so they share one mapping
 * from that body to the service's input. When each kept its own copy, the MCP
 * one fell behind: it dropped `language`, `translationOfId`, `pinnedAt`,
 * `featuredAt`, and `collectionEntries`, which the schema had just accepted.
 */

import type { z } from "zod";
import type { Services } from "../services/index.js";
import type { PostAttachmentDeps, SummaryConfig } from "../services/post.js";
import type { StorageDriver } from "./storage.js";
import type { AppConfig } from "../types/config.js";
import type { CreatePost, UpdatePost } from "../types.js";
import {
  postFormatIssues,
  type CreatePostApiSchema,
  type UpdatePostApiSchema,
} from "./schemas.js";
import { ValidationError } from "./errors.js";

type CreatePostApiBody = z.infer<typeof CreatePostApiSchema>;
type UpdatePostApiBody = z.infer<typeof UpdatePostApiSchema>;

/**
 * The service input for a validated create body.
 *
 * A quote's source travels as `sourceName` and `sourceUrl` in the API and as
 * `title` and `url` in storage.
 *
 * @param body - A body `CreatePostApiSchema` accepted
 * @returns The post service's create input
 * @example
 * posts.createWithAttachments(toCreatePostInput(body), body.attachments, deps);
 */
export function toCreatePostInput(body: CreatePostApiBody): CreatePost {
  const isQuote = body.format === "quote";
  return {
    format: body.format,
    title: isQuote ? body.sourceName : body.title,
    body: body.body,
    bodyMarkdown: body.bodyMarkdown,
    slug: body.slug || undefined,
    path: body.path || undefined,
    status: body.status,
    visibility: body.visibility,
    pinned: body.pinned,
    featured: body.featured,
    pinnedAt: body.pinnedAt,
    featuredAt: body.featuredAt,
    url: (isQuote ? body.sourceUrl : body.url) || undefined,
    quoteText: body.quoteText,
    rating: body.rating || undefined,
    collectionIds: body.collectionIds,
    collectionEntries: body.collectionEntries,
    replyToId: body.replyToId,
    quietReply: body.quietReply,
    language: body.language,
    translationOfId: body.translationOfId,
    publishedAt: body.publishedAt,
    createdAt: body.createdAt,
    updatedAt: body.updatedAt,
  };
}

/**
 * The service input for a validated update body.
 *
 * A field the body leaves out stays as it is. `sourceName` and `sourceUrl`,
 * when present, win over `title` and `url`, including when they clear them.
 *
 * @param body - A body `UpdatePostApiSchema` accepted
 * @returns The post service's update input
 * @example
 * posts.updateWithAttachments(id, toUpdatePostInput(body), body.attachments, deps);
 */
export function toUpdatePostInput(body: UpdatePostApiBody): UpdatePost {
  return {
    format: body.format,
    title: Object.hasOwn(body, "sourceName") ? body.sourceName : body.title,
    body: body.body,
    bodyMarkdown: body.bodyMarkdown,
    slug: body.slug,
    status: body.status,
    visibility: body.visibility,
    pinned: body.pinned,
    featured: body.featured,
    pinnedAt: body.pinnedAt,
    featuredAt: body.featuredAt,
    url: Object.hasOwn(body, "sourceUrl") ? body.sourceUrl : body.url,
    quoteText: body.quoteText,
    rating: body.rating,
    collectionIds: body.collectionIds,
    collectionEntries: body.collectionEntries,
    publishedAt: body.publishedAt,
    language: body.language,
  };
}

/**
 * What writing a post's attachments and summary needs from the request.
 *
 * @param deps - Services, the storage driver, and app config
 * @returns The attachment dependencies and the summary limits
 * @example
 * const { attachments, summary } = postWriteDeps(c.var);
 * posts.createWithAttachments(input, body.attachments, attachments, summary);
 */
export function postWriteDeps(deps: {
  services: Pick<Services, "media">;
  storage: StorageDriver | null;
  appConfig: AppConfig;
}): { attachments: PostAttachmentDeps; summary: SummaryConfig } {
  return {
    attachments: {
      media: deps.services.media,
      storage: deps.storage,
      storageDriver: deps.appConfig.storageDriver,
      maxFileSizeMB: deps.appConfig.uploadMaxFileSize,
    },
    summary: {
      maxParagraphs: deps.appConfig.summaryMaxParagraphs,
      maxChars: deps.appConfig.summaryMaxChars,
    },
  };
}

/**
 * Refuse an update that sends a field the post's format doesn't allow.
 *
 * Create checks this in the schema, where the format is in the body. An update
 * may leave the format out, so the check needs the post's current one: a
 * `sourceName` sent to a note would otherwise land in its title.
 *
 * @param body - A body `UpdatePostApiSchema` accepted
 * @param currentFormat - The post's format before the update
 * @throws {ValidationError} On the first field the format doesn't allow
 * @example
 * assertUpdateFitsFormat(body, existing.format);
 */
export function assertUpdateFitsFormat(
  body: UpdatePostApiBody,
  currentFormat: string,
): void {
  const [issue] = postFormatIssues(body.format ?? currentFormat, body, {
    complete: false,
  });
  if (issue) {
    throw new ValidationError(issue.message, {
      fieldErrors: { [issue.path]: [issue.message] },
      formErrors: [],
    });
  }
}
