/**
 * Turning an archive URL into a smart collection.
 *
 * One surface offers this: a directory link pointing at `/archive?…`. It makes
 * a promise — *this page will keep answering what that URL answers* — and a
 * promise like that cannot be made about a URL that was only partly understood.
 *
 * So this parse is **strict**, unlike the one that renders the archive. A
 * renderer that cannot read a value drops it and still shows a page; a decision
 * that drops it silently commits to something different from what was asked
 * for. Same vocabulary, two policies — see `lib/filter-dimensions.ts`.
 *
 * A stored `kind='archive'` path in Settings is deliberately not offered the
 * same button. That row *is* the registration of its own address, so the smart
 * collection it would become can never be saved at the URL the offer is about —
 * the address is taken by the very row being upgraded. Freeing it first —
 * delete the custom URL, then build the collection at that slug — is the honest
 * order, and both halves already exist. The row prints its `/archive?…` query,
 * which is the one thing the conversion knew that the author might not.
 */

import {
  parsePostFilterSelectionStrict,
  readStorableSelection,
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
function readArchiveQuery(
  url: string,
  origin: string | undefined,
): URLSearchParams | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  // Accepts a relative archive path (`/archive?…`) and an absolute URL on this
  // site. Anything else is not an archive URL.
  let path = trimmed;
  let query = "";

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      // A directory link is whatever the author typed, so an absolute URL here
      // can name someone else's site. `https://elsewhere.example/archive?…` is
      // a page this site cannot answer for, and offering to "keep answering
      // what that URL answers" about it would be a promise made to a stranger.
      // A caller that cannot say which origin is its own gets no absolute form
      // at all, rather than a guess.
      if (!origin || parsed.origin !== origin) return null;
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

  // A link's URL is read against the page it sits on, so a query with no path
  // in front of it (`?format=note`) names whatever page that is — not the
  // archive.
  const normalized = path.replace(/^\/+/, "").replace(/\/+$/, "");
  if (normalized !== "archive") return null;

  return new URLSearchParams(query);
}

/**
 * Read an archive URL into the smart collection it could become.
 *
 * @param url - An archive path, relative or absolute
 * @param ctx - Collection vocabulary, so a `?collection=` slug can resolve
 * @param opts.origin - This site's origin, for callers that hold URLs an author
 *   typed. An absolute URL is read only when it matches; omit it and only
 *   relative forms are accepted.
 * @returns The prefill, or `null` when the URL cannot be honored exactly
 *
 * @example
 * ```ts
 * parseArchiveUrlForUpgrade("/archive?format=quote", ctx);
 * // { selection: { format: "quote" }, sort: "newest", layout: null }
 *
 * parseArchiveUrlForUpgrade("/archive?visibility=private", ctx);
 * // null — a smart collection is a published page and can never name that set
 *
 * parseArchiveUrlForUpgrade("https://elsewhere.example/archive?format=note", ctx, {
 *   origin: "https://mine.example",
 * });
 * // null — another site's archive is not this site's to gather
 * ```
 */
export function parseArchiveUrlForUpgrade(
  url: string,
  ctx: DimensionContext = {},
  opts: { origin?: string } = {},
): SmartCollectionUpgrade | null {
  const query = readArchiveQuery(url, opts.origin);
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
  const stored = readStorableSelection(parsed.selection);
  if (stored === null) return null;

  // The archive's `?sort=` names a *time axis* — `published` or `updated` —
  // and always runs newest-first. A smart collection has one newest-first
  // order and it reads Thread activity, which is near enough to either axis
  // that offering the reader a choice here would be a distinction without a
  // difference. So the prefill always opens on `newest`.
  const sort: SmartCollectionSortOrder = "newest";

  const readLayout = (value: string | null): ArchiveLayout | null =>
    value !== null && (ARCHIVE_LAYOUTS as readonly string[]).includes(value)
      ? (value as ArchiveLayout)
      : null;
  const layout =
    readLayout(query.get("layout")) ?? readLayout(query.get("view"));

  return { selection: stored, sort, layout };
}
