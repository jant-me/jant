/**
 * Slug Generation
 *
 * Generates URL slugs for posts with conflict resolution.
 * Handles three cases: user-provided slug, title-based slug, and random-only slug.
 */

import { slugify } from "./slugify.js";
import { generateRandomId } from "./nanoid.js";
import { isReservedPath } from "./constants.js";
import { ValidationError, ConflictError } from "./errors.js";

const MAX_RETRIES = 10;

export interface SlugOptions {
  /** User-provided slug (takes priority) */
  slug?: string;
  /** Post title (used for slug generation if no explicit slug) */
  title?: string;
  /** Length of random IDs */
  idLength: number;
  /**
   * URL form of the post's language (lowercased BCP 47 tag, e.g. `zh-hant`),
   * set only for posts written in a non-primary language. Used as the first
   * fallback when a title-based slug collides, so the transliterations of a
   * translated pair land on `shu-ping` and `shu-ping-en` rather than a random
   * suffix. Omitted for primary-language posts: the bare namespace belongs to
   * them, and a language suffix among same-language posts distinguishes nothing.
   */
  languageSuffix?: string;
  /**
   * URL prefixes currently served by language views. A slug matching one would
   * be shadowed by that view and never resolve, so it is treated as reserved
   * for as long as the language is configured.
   */
  reservedPrefixes?: readonly string[];
  /** Callback to check if a slug is available (checks post slugs + path_registry paths) */
  isAvailable: (slug: string) => Promise<boolean>;
}

/**
 * Generates a post slug with conflict resolution.
 *
 * Resolution order:
 * 1. User-provided slug → validate format, check reserved, check availability
 * 2. Title exists → slugify(title), then -{languageSuffix}, then -{randomId}
 * 3. No title → pure random ID
 *
 * @param opts - Slug generation options
 * @returns A unique, valid slug
 *
 * @example
 * ```ts
 * // User-provided
 * await generatePostSlug({ slug: "my-post", idLength: 5, isAvailable: check });
 *
 * // Title-based
 * await generatePostSlug({ title: "Hello World", idLength: 5, isAvailable: check });
 *
 * // Title-based in a secondary language, colliding with an existing slug
 * await generatePostSlug({
 *   title: "書評",
 *   languageSuffix: "en",
 *   idLength: 5,
 *   isAvailable: check,
 * }); // => "shu-ping-en"
 *
 * // Random
 * await generatePostSlug({ idLength: 5, isAvailable: check });
 * ```
 */
export async function generatePostSlug(opts: SlugOptions): Promise<string> {
  const {
    slug,
    title,
    idLength,
    languageSuffix,
    reservedPrefixes = [],
    isAvailable,
  } = opts;
  const isReserved = (candidate: string) =>
    isReservedPath(candidate, reservedPrefixes);

  // Case 1: User-provided slug
  if (slug) {
    if (isReserved(slug)) {
      throw new ValidationError(
        `Slug "${slug}" is reserved and cannot be used`,
      );
    }
    const available = await isAvailable(slug);
    if (!available) {
      throw new ConflictError(`Slug "${slug}" is already in use`);
    }
    return slug;
  }

  // Case 2: Title-based slug
  if (title) {
    const base = slugify(title);
    if (base && !isReserved(base)) {
      const available = await isAvailable(base);
      if (available) return base;

      // A readable language suffix beats a random one, and it is exactly the
      // collision a translated pair produces.
      if (languageSuffix) {
        const languageCandidate = `${base}-${languageSuffix}`;
        if (
          !isReserved(languageCandidate) &&
          (await isAvailable(languageCandidate))
        ) {
          return languageCandidate;
        }
      }
    }

    // Append random suffix on conflict or reserved base
    for (let i = 0; i < MAX_RETRIES; i++) {
      const candidate = `${base || generateRandomId(idLength)}-${generateRandomId(idLength)}`;
      if (!isReserved(candidate) && (await isAvailable(candidate))) {
        return candidate;
      }
    }
    throw new ConflictError(
      "Could not generate a unique slug after multiple attempts",
    );
  }

  // Case 3: Pure random
  for (let i = 0; i < MAX_RETRIES; i++) {
    const candidate = generateRandomId(idLength);
    if (!isReserved(candidate) && (await isAvailable(candidate))) {
      return candidate;
    }
  }
  throw new ConflictError(
    "Could not generate a unique slug after multiple attempts",
  );
}
