import { msg } from "@lingui/core/macro";
import type { I18n } from "../../i18n/i18n.js";
import type {
  DimensionContext,
  PostFilterSelection,
} from "../../lib/filter-dimensions.js";
import {
  describeFilterSelection,
  hasFilterSelection,
} from "../../lib/filter-dimensions.js";

type Translator = Pick<I18n, "_">;

export {
  getFormatLabelPlural,
  getMediaKindLabel,
  getVisibilityLabel,
} from "../../lib/filter-dimensions.js";

/**
 * The name of the unfiltered archive, shared by the page heading and the
 * document title so both resolve to one Lingui hash and can never drift into
 * two different words for the same surface.
 */
export const ARCHIVE_ALL_POSTS_LABEL = msg({
  message: "All posts",
  comment:
    "@context: Archive page heading and document title when no filter is active. Names the surface, not the current selection — the nav calls the same destination 'All'.",
});

/** Whether any filter dimension is active. `sort` and `layout` are not filters. */
export function hasActiveArchiveFilter(
  selection: PostFilterSelection,
): boolean {
  return hasFilterSelection(selection);
}

/**
 * The active filters reduced to the words a reader sees, most identifying
 * first.
 *
 * The words themselves come from the dimension registry, which owns the
 * vocabulary. What lives here is the archive's *composition* of them: the
 * ordering, and the one place a dimension absorbs another.
 *
 * This is the vocabulary only — every surface composes it differently, because
 * their constraints are opposite. A feed name lives for years in someone's
 * reader with no UI to inspect it, so it takes the whole list; a browser tab
 * truncates from the right, so it takes the first two and stops. The registry
 * order is what makes that truncation safe: a collection title identifies a view
 * far better than one of three format names, so it leads.
 *
 * @param selection - Active filter selection
 * @param i18n - Translator
 * @param ctx - Collection vocabulary, for naming a selected collection
 * @returns Labels in priority order; empty when nothing is filtered
 * @example
 * describeArchiveFilters({ format: "quote" }, i18n, {}); // ["Quotes"]
 */
export function describeArchiveFilters(
  selection: PostFilterSelection,
  i18n: Translator,
  ctx: DimensionContext = {},
): string[] {
  // Title presence absorbs the format it refines, mirroring the filter chip —
  // `Untitled` says everything `Notes, without title` would. The registry lists
  // `format` immediately before `title`, so dropping one leaves the other in
  // exactly the right place.
  const composed =
    selection.title !== undefined
      ? { ...selection, format: undefined }
      : selection;
  return describeFilterSelection(composed, i18n, ctx);
}

/** How many parts a browser tab can carry before it truncates to noise. */
const TITLE_PART_LIMIT = 2;

/**
 * Name for a filtered archive view where no surrounding UI explains it —
 * a browser tab, a bookmark, a shared link's preview.
 *
 * @param selection - Active filter selection
 * @param i18n - Translator
 * @param ctx - Collection vocabulary, for naming a selected collection
 * @returns Capped description, or the unfiltered name when nothing is filtered
 * @example
 * getArchiveViewTitle({ year: 2024 }, i18n, {}); // "2024"
 */
export function getArchiveViewTitle(
  selection: PostFilterSelection,
  i18n: Translator,
  ctx: DimensionContext = {},
): string {
  const parts = describeArchiveFilters(selection, i18n, ctx);
  if (parts.length === 0) return i18n._(ARCHIVE_ALL_POSTS_LABEL);
  return parts.slice(0, TITLE_PART_LIMIT).join(", ");
}
