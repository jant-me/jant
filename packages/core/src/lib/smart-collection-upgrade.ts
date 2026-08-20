/**
 * Turning an archive URL into a smart collection.
 *
 * Two surfaces offer this — a directory link pointing at `/archive?…`, and a
 * legacy stored archive path in Settings — and both go through here, because
 * both are making the same promise: *this page will keep answering what that
 * URL answers*. A promise like that cannot be made about a URL that was only
 * partly understood.
 *
 * So this parse is **strict**, unlike the one that renders the archive. A
 * renderer that cannot read a value drops it and still shows a page; a decision
 * that drops it silently commits to something different from what was asked
 * for. Same vocabulary, two policies — see `lib/filter-dimensions.ts`.
 */

import {
  parsePostFilterSelectionStrict,
  PostFilterSelectionSchema,
  type DimensionContext,
  type PostFilterSelection,
} from "./filter-dimensions.js";
import { ARCHIVE_LAYOUTS } from "../types/constants.js";
import type { ArchiveLayout, SmartCollectionSortOrder } from "../types.js";

/** What a smart collection would start out as, prefilled from an archive URL. */
export interface SmartCollectionUpgrade {
  selection: PostFilterSelection;
  sort: SmartCollectionSortOrder;
  layout: ArchiveLayout | null;
}

/**
 * Parameters that shape presentation rather than membership.
 *
 * Recognised rather than rejected: a stored `/archive?format=quote&layout=grid`
 * is perfectly understood, and refusing it over `layout` would be pedantry. The
 * legacy `view` spelling counts too — real stored URLs carry it.
 */
const PRESENTATION_PARAMS = ["sort", "layout", "view"] as const;

/** Everything after `?` in an archive path, or null when it is not one. */
function readArchiveQuery(url: string): URLSearchParams | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  // Accepts a stored path (`/archive?…`), a bare query (`?…` or `format=…`),
  // and an absolute URL on this site. Anything else is not an archive URL.
  let path = trimmed;
  let query = "";

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      path = parsed.pathname;
      query = parsed.search.slice(1);
    } catch {
      return null;
    }
  } else {
    const index = trimmed.indexOf("?");
    if (index >= 0) {
      path = trimmed.slice(0, index);
      query = trimmed.slice(index + 1);
    }
  }

  const normalized = path.replace(/^\/+/, "").replace(/\/+$/, "");
  // A bare query with no path is what a stored archive path carries.
  if (normalized !== "" && normalized !== "archive") return null;

  return new URLSearchParams(query);
}

/**
 * Read an archive URL into the smart collection it could become.
 *
 * @param url - An archive path, a bare query string, or an absolute URL
 * @param ctx - Collection vocabulary, so a `?collection=` slug can resolve
 * @returns The prefill, or `null` when the URL cannot be honored exactly
 *
 * @example
 * ```ts
 * parseArchiveUrlForUpgrade("/archive?format=quote", ctx);
 * // { selection: { format: "quote" }, sort: "newest", layout: null }
 *
 * parseArchiveUrlForUpgrade("/archive?visibility=private", ctx);
 * // null — a smart collection is a published page and can never name that set
 * ```
 */
export function parseArchiveUrlForUpgrade(
  url: string,
  ctx: DimensionContext = {},
): SmartCollectionUpgrade | null {
  const query = readArchiveQuery(url);
  if (!query) return null;

  const parsed = parsePostFilterSelectionStrict(
    (key) => query.get(key) ?? undefined,
    [...query.keys()],
    ctx,
    { allow: PRESENTATION_PARAMS },
  );
  if (!parsed.ok) return null;

  // The URL vocabulary is wider than what a smart collection may store —
  // `visibility=private` parses and then fails here, which is exactly how this
  // flow refuses it by name rather than by guessing.
  const stored = PostFilterSelectionSchema.safeParse(parsed.selection);
  if (!stored.success) return null;

  // The archive's `?sort=` names a *time axis* and always runs newest-first; a
  // smart collection's `sort` names an order. `updated` is the one value the
  // two vocabularies share a meaning for.
  const sort: SmartCollectionSortOrder =
    query.get("sort") === "updated" ? "updated" : "newest";

  const readLayout = (value: string | null): ArchiveLayout | null =>
    value !== null && (ARCHIVE_LAYOUTS as readonly string[]).includes(value)
      ? (value as ArchiveLayout)
      : null;
  const layout =
    readLayout(query.get("layout")) ?? readLayout(query.get("view"));

  return { selection: stored.data, sort, layout };
}
