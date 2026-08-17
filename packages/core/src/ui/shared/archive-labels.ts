import { msg } from "@lingui/core/macro";
import type { I18n } from "../../i18n/i18n.js";
import type { Format, MediaKind } from "../../types.js";
import type { ArchiveVisibility } from "../../types/props.js";

type Translator = Pick<I18n, "_">;

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

/** The filter state a view describes, in the shape both callers can produce. */
export interface ArchiveFilterDescription {
  collectionTitle?: string;
  format?: Format;
  year?: number;
  mediaKinds?: MediaKind[];
  hasMedia?: boolean;
  hasTitle?: boolean;
  /** true = threads (roots with replies), false = single posts (no replies) */
  hasReplies?: boolean;
  visibility?: ArchiveVisibility;
}

/**
 * Plural name of a post format.
 *
 * @param format - Post format key
 * @param i18n - Translator
 * @returns Reader-facing plural, e.g. `Notes`
 * @example
 * getFormatLabelPlural("note", i18n); // "Notes"
 */
export function getFormatLabelPlural(format: string, i18n: Translator): string {
  const labels: Record<string, string> = {
    note: i18n._(
      msg({
        message: "Notes",
        comment: "@context: Post format label plural - notes",
      }),
    ),
    link: i18n._(
      msg({
        message: "Links",
        comment: "@context: Post format label plural - links",
      }),
    ),
    quote: i18n._(
      msg({
        message: "Quotes",
        comment: "@context: Post format label plural - quotes",
      }),
    ),
  };
  return labels[format] ?? format + "s";
}

/**
 * Name of a media kind.
 *
 * @param kind - Media kind key
 * @param i18n - Translator
 * @returns Reader-facing label, e.g. `Images`
 * @example
 * getMediaKindLabel("image", i18n); // "Images"
 */
export function getMediaKindLabel(kind: MediaKind, i18n: Translator): string {
  const labels: Record<MediaKind, string> = {
    image: i18n._(
      msg({
        message: "Images",
        comment: "@context: Archive media filter - images",
      }),
    ),
    video: i18n._(
      msg({
        message: "Video",
        comment: "@context: Archive media filter - video",
      }),
    ),
    audio: i18n._(
      msg({
        message: "Audio",
        comment: "@context: Archive media filter - audio",
      }),
    ),
    text: i18n._(
      msg({
        message: "Text attachment",
        comment: "@context: Archive media filter - text file attachments",
      }),
    ),
    document: i18n._(
      msg({
        message: "Files",
        comment: "@context: Archive media filter - files/documents",
      }),
    ),
  };
  return labels[kind] ?? kind;
}

/**
 * Name of a visibility filter value.
 *
 * @param visibility - Visibility filter value
 * @param i18n - Translator
 * @returns Reader-facing label, e.g. `Hidden from Latest`
 * @example
 * getVisibilityLabel("private", i18n); // "Private"
 */
export function getVisibilityLabel(
  visibility: ArchiveVisibility,
  i18n: Translator,
): string {
  const labels: Record<ArchiveVisibility, string> = {
    public: i18n._(
      msg({
        message: "Public",
        comment: "@context: Archive visibility filter - public posts",
      }),
    ),
    latest_hidden: i18n._(
      msg({
        message: "Hidden from Latest",
        comment:
          "@context: Archive visibility filter for posts hidden from Latest",
      }),
    ),
    private: i18n._(
      msg({
        message: "Private",
        comment: "@context: Archive visibility filter - private posts",
      }),
    ),
    featured: i18n._(
      msg({
        message: "Featured",
        comment: "@context: Archive visibility filter - featured posts",
      }),
    ),
  };
  return labels[visibility];
}

/** Whether any filter dimension is active. `sort` and `view` are not filters. */
export function hasActiveArchiveFilter(
  filters: ArchiveFilterDescription,
): boolean {
  return (
    filters.collectionTitle !== undefined ||
    filters.format !== undefined ||
    filters.year !== undefined ||
    (filters.mediaKinds !== undefined && filters.mediaKinds.length > 0) ||
    filters.hasMedia !== undefined ||
    filters.hasTitle !== undefined ||
    filters.hasReplies !== undefined ||
    filters.visibility !== undefined
  );
}

/**
 * The active filters reduced to the words a reader sees, most identifying
 * first.
 *
 * This is the vocabulary only — every surface composes it differently, because
 * their constraints are opposite. A feed name lives for years in someone's
 * reader with no UI to inspect it, so it takes the whole list; a browser tab
 * truncates from the right, so it takes the first two and stops. The order here
 * is what makes that truncation safe: a collection title identifies a view far
 * better than one of three format names, so it leads.
 *
 * Title presence absorbs the format it refines, mirroring the filter chip —
 * `Untitled` says everything `Notes, without title` would.
 *
 * @param filters - Active filter state
 * @param i18n - Translator
 * @returns Labels in priority order; empty when nothing is filtered
 * @example
 * describeArchiveFilters({ collectionTitle: "Books", format: "quote" }, i18n);
 * // ["Books", "Quotes"]
 */
export function describeArchiveFilters(
  filters: ArchiveFilterDescription,
  i18n: Translator,
): string[] {
  const parts: string[] = [];

  if (filters.collectionTitle) {
    parts.push(filters.collectionTitle);
  }

  if (filters.hasTitle === true) {
    parts.push(
      i18n._(
        msg({
          message: "Titled",
          comment: "@context: Archive filter - notes that have a title",
        }),
      ),
    );
  } else if (filters.hasTitle === false) {
    parts.push(
      i18n._(
        msg({
          message: "Untitled",
          comment: "@context: Archive filter - notes without a title",
        }),
      ),
    );
  } else if (filters.format) {
    parts.push(getFormatLabelPlural(filters.format, i18n));
  }

  if (filters.year !== undefined) {
    parts.push(String(filters.year));
  }

  const kinds = filters.mediaKinds ?? [];
  if (kinds.length === 1) {
    // A single kind names itself; several are better summarised than listed.
    parts.push(getMediaKindLabel(kinds[0] as MediaKind, i18n));
  } else if (kinds.length > 1 || filters.hasMedia === true) {
    parts.push(
      i18n._(
        msg({
          message: "With media",
          comment:
            "@context: Archive filter - posts carrying any media attachment",
        }),
      ),
    );
  } else if (filters.hasMedia === false) {
    parts.push(
      i18n._(
        msg({
          message: "Without media",
          comment: "@context: Archive filter - posts with no media attachment",
        }),
      ),
    );
  }

  if (filters.hasReplies === true) {
    parts.push(
      i18n._(
        msg({
          message: "Threads",
          comment:
            "@context: Archive thread filter - thread roots with replies",
        }),
      ),
    );
  } else if (filters.hasReplies === false) {
    parts.push(
      i18n._(
        msg({
          message: "Single posts",
          comment: "@context: Archive thread filter - posts without replies",
        }),
      ),
    );
  }

  if (filters.visibility) {
    parts.push(getVisibilityLabel(filters.visibility, i18n));
  }

  return parts;
}

/** How many parts a browser tab can carry before it truncates to noise. */
const TITLE_PART_LIMIT = 2;

/**
 * Name for a filtered archive view where no surrounding UI explains it —
 * a browser tab, a bookmark, a shared link's preview.
 *
 * @param filters - Active filter state
 * @param i18n - Translator
 * @returns Capped description, or the unfiltered name when nothing is filtered
 * @example
 * getArchiveViewTitle({ collectionTitle: "Books", year: 2024 }, i18n);
 * // "Books, 2024"
 */
export function getArchiveViewTitle(
  filters: ArchiveFilterDescription,
  i18n: Translator,
): string {
  const parts = describeArchiveFilters(filters, i18n);
  if (parts.length === 0) return i18n._(ARCHIVE_ALL_POSTS_LABEL);
  return parts.slice(0, TITLE_PART_LIMIT).join(", ");
}
