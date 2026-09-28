/**
 * Thread list queries
 *
 * Reads the filter dimensions a Thread list takes — the archive's, from the
 * same registry — out of an HTTP query string or MCP arguments, so the public
 * API, the author API, and MCP accept one vocabulary.
 *
 * One word differs from the archive page. A Thread list left unfiltered shows
 * what the homepage shows, so it needs a word for "every visibility a reader
 * may see": `visibility=any`. The registry's `visibility=all` is an old
 * spelling of leaving the parameter out, which here would mean the homepage's
 * set — the opposite of what the word says — so a Thread list refuses it.
 */

import type { ThreadAudience } from "../services/thread.js";
import type { Collection } from "../types.js";
import { ValidationError } from "./errors.js";
import {
  buildCollectionVocabulary,
  EMPTY_COLLECTION_VOCABULARY,
  parsePostFilterSelectionStrict,
  readCollectionSlugs,
  type ParamReader,
  type PostFilterSelection,
} from "./filter-dimensions.js";

/** What a Thread list's filter parameters asked for. */
export type ThreadSelectionParse =
  | {
      kind: "selection";
      selection: PostFilterSelection;
      /** `visibility=any`: include what the homepage hides. */
      includeHidden: boolean;
    }
  /** A named collection doesn't exist, so nothing can match. */
  | { kind: "empty" };

const READER_VISIBILITIES = ["public", "featured", "hidden", "any"] as const;
const AUTHOR_VISIBILITIES = [...READER_VISIBILITIES, "private"] as const;
/** Spellings the registry reads that stay valid here. */
const LEGACY_VISIBILITIES = ["latest_hidden"] as const;

function allowedVisibilities(audience: ThreadAudience): readonly string[] {
  return audience === "reader" ? READER_VISIBILITIES : AUTHOR_VISIBILITIES;
}

/**
 * Read a Thread list's filter dimensions.
 *
 * A parameter that names no dimension is ignored, as the API ignores any
 * request field it doesn't know. A dimension with a value it can't read is
 * refused.
 *
 * @param read - Reads one parameter; `undefined` when absent
 * @param options.audience - A reader may not name `private`
 * @param options.loadCollections - Loads the collection vocabulary, called only
 *   when a collection is named
 * @returns The selection, or `empty` when a named collection doesn't exist
 * @throws {ValidationError} On an unreadable value
 * @example
 * const parsed = await parseThreadSelection(read, {
 *   audience: "reader",
 *   loadCollections: () => services.collections.list(),
 * });
 */
export async function parseThreadSelection(
  read: ParamReader,
  options: {
    audience: ThreadAudience;
    loadCollections: () => Promise<Collection[]>;
  },
): Promise<ThreadSelectionParse> {
  const visibility = read("visibility");
  if (visibility !== undefined) {
    const allowed = allowedVisibilities(options.audience);
    if (visibility === "all") {
      throw new ValidationError(
        "visibility=all isn't accepted here. Leave visibility out for what the homepage lists, or pass visibility=any for everything.",
      );
    }
    if (
      !allowed.includes(visibility) &&
      !(LEGACY_VISIBILITIES as readonly string[]).includes(visibility)
    ) {
      throw new ValidationError(
        `Invalid visibility value. Allowed: ${allowed.join(", ")}`,
      );
    }
  }

  const includeHidden = visibility === "any";
  // `any` isn't a registry value: it widens the audience's default rather
  // than filtering, so the registry reads the query as if it were absent.
  const readDimension: ParamReader = (key) =>
    key === "visibility" && includeHidden ? undefined : read(key);

  // Resolving a slug costs a round trip, paid only when one is named.
  const collections =
    readCollectionSlugs(readDimension).length > 0
      ? buildCollectionVocabulary(await options.loadCollections())
      : EMPTY_COLLECTION_VOCABULARY;
  const parsed = parsePostFilterSelectionStrict(readDimension, [], {
    collections,
  });

  if (parsed.ok) {
    return { kind: "selection", selection: parsed.selection, includeHidden };
  }
  // A collection that doesn't exist is answered with nothing rather than a
  // rejection: the caller's words were understood, and the site simply holds
  // no such collection.
  if (parsed.issues.every((issue) => issue.param === "collection")) {
    return { kind: "empty" };
  }
  throw new ValidationError(parsed.issues[0]?.message ?? "Validation failed");
}

/**
 * Read `include`: a comma-separated list of extras to attach to each Thread.
 *
 * @param raw - The parameter's value, or `undefined`
 * @returns Whether the fold was asked for
 * @throws {ValidationError} On a value this endpoint doesn't offer
 * @example
 * parseThreadInclude("fold"); // { fold: true }
 */
export function parseThreadInclude(raw: string | undefined): { fold: boolean } {
  if (raw === undefined || raw === "") return { fold: false };
  const values = raw.split(",").map((value) => value.trim());
  for (const value of values) {
    if (value !== "fold") {
      throw new ValidationError(
        `Invalid include value "${value}". Allowed: fold`,
      );
    }
  }
  return { fold: values.includes("fold") };
}
