/**
 * Shared Zod schemas for validation
 *
 * These schemas ensure type-safe validation of user input
 * from forms, API requests, and other external sources.
 */

import { z } from "zod";

/**
 * Post type enum schema
 */
export const PostTypeSchema = z.enum(["note", "article", "link", "quote", "image", "page"]);
export type PostType = z.infer<typeof PostTypeSchema>;

/**
 * Visibility enum schema
 */
export const VisibilitySchema = z.enum(["featured", "quiet", "unlisted", "draft"]);
export type Visibility = z.infer<typeof VisibilitySchema>;

/**
 * Redirect type enum schema
 */
export const RedirectTypeSchema = z.enum(["301", "302"]);
export type RedirectType = z.infer<typeof RedirectTypeSchema>;

/**
 * API request body schema for creating a post
 */
export const CreatePostSchema = z.object({
  type: PostTypeSchema,
  title: z.string().optional(),
  content: z.string(),
  visibility: VisibilitySchema,
  sourceUrl: z.string().url().optional().or(z.literal("")),
  sourceName: z.string().optional(),
  path: z.string().regex(/^[a-z0-9-]*$/).optional().or(z.literal("")),
  replyToId: z.string().optional(), // Sqid format
  publishedAt: z.number().int().positive().optional(),
});

/**
 * API request body schema for updating a post
 */
export const UpdatePostSchema = CreatePostSchema.partial();

/**
 * Form data helper: safely parse a FormData value with a schema
 *
 * @example
 * ```ts
 * const type = parseFormData(formData, "type", PostTypeSchema);
 * // type is PostType, throws if invalid
 * ```
 */
export function parseFormData<T>(
  formData: FormData,
  key: string,
  schema: z.ZodSchema<T>
): T {
  const value = formData.get(key);
  if (value === null) {
    throw new Error(`Missing required field: ${key}`);
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
  schema: z.ZodSchema<T>
): T | undefined {
  const value = formData.get(key);
  if (value === null || value === "") {
    return undefined;
  }
  return schema.parse(value);
}
