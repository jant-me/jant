/**
 * Post filter dimensions — one declaration per dimension, read by every surface.
 *
 * A "dimension" is one axis a reader can narrow posts along: format, year,
 * collection, media, title presence, reply presence, visibility. Each one needs
 * a query-string spelling, a parser, a serializer, a translation into
 * {@link PostFilters}, and a reader-facing name. Written separately, those live
 * in as many files as there are surfaces, and the same vocabulary ends up stored
 * several times over.
 *
 * That is not a theoretical risk here. Before this module the archive kept
 * **four** implementations of one vocabulary: the page's parser, the public
 * API's Zod schema, the chip bar's URL writer, and the feed's self-URL writer.
 * They had already drifted — `?collection=` accepted a list on the API and a
 * single slug on the page.
 *
 * The rule this module encodes: **a dimension is declared once.** Adding an
 * eighth one touches this file and the storage schema, never a surface.
 *
 * Naming is deliberately neutral. The vocabulary belongs to "filtering posts",
 * not to any one page, so both the archive and anything built on top of it can
 * depend on it without either looking like it depends on the other.
 */

import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import type { I18n } from "../i18n/i18n.js";
// Imported from `types/constants.js` rather than `types/props.js`: the props
// module reads this one for `PostFilterSelection`, and the vocabulary should not
// depend on the viewmodel that displays it.
import type {
  ArchiveVisibility,
  FilterMatchMode,
  Format,
  MediaKind,
} from "../types/constants.js";
import {
  EARLIEST_FILTERABLE_YEAR,
  FILTER_MATCH_MODES,
  FORMATS,
  LATEST_FILTERABLE_YEAR,
  MEDIA_KINDS,
  PUBLIC_ARCHIVE_VISIBILITIES,
} from "../types/constants.js";
import { ID_PREFIX, isTypeId } from "./ids.js";
import { startOfMonthIn } from "./time.js";
import type { PostFilters } from "../services/post.js";

type Translator = Pick<I18n, "_">;

// =============================================================================
// Values
// =============================================================================

/** Every dimension, in the order a reader-facing summary lists them. */
export const FILTER_DIMENSION_KEYS = [
  "collection",
  "format",
  "title",
  "year",
  "media",
  "replies",
  "visibility",
] as const;

export type FilterDimensionKey = (typeof FILTER_DIMENSION_KEYS)[number];

/**
 * What `media` selects, in the one folded vocabulary the URL, the storage
 * column, and the editing control all share.
 *
 * `any` and `none` ask about presence; a list of kinds asks for those kinds.
 * Splitting this into a presence flag plus a kind list would create states that
 * cannot mean anything — "no media, of kinds image and video" — so it stays one
 * value. Only {@link toPostFilters} fans it out, because `PostFilters` happens
 * to carry two fields.
 */
export type MediaSelection = "any" | "none" | readonly MediaKind[];

/**
 * Is this a {@link MediaSelection}, in either of its two shapes?
 *
 * A predicate rather than a schema, like every other storage check here: the
 * editing dialog compiles this registry into the browser bundle, and a
 * validation library is not something a page should download in order to read a
 * query string. The one schema an API boundary needs is assembled from these
 * predicates in `lib/schemas.ts`.
 */
export function isMediaSelection(value: unknown): value is MediaSelection {
  if (value === "any" || value === "none") return true;
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((kind) =>
      (MEDIA_KINDS as readonly string[]).includes(kind as string),
    )
  );
}

export { FILTER_MATCH_MODES, type FilterMatchMode };

/** Query-string parameter name for {@link FilterMatchMode}. */
export const FILTER_MATCH_PARAM = "match";

/** The value type each dimension carries once parsed. */
export interface FilterDimensionValues {
  /** Collection ids, OR'd together: a post in any one of them matches. */
  collection: readonly string[];
  /** Single format, or 2+ formats OR'd together. */
  format: Format | readonly Format[];
  /** `true` = has a title, `false` = has none. */
  title: boolean;
  /** Publication year (Gregorian), or 2+ years OR'd together. */
  year: number | readonly number[];
  media: MediaSelection;
  /** `true` = thread roots with replies, `false` = posts without any. */
  replies: boolean;
  /** Single visibility, or 2+ visibilities OR'd together. */
  visibility: ArchiveVisibility | readonly ArchiveVisibility[];
}

/**
 * One reader's selection: every dimension optional, at most one entry per key.
 *
 * Multiple values inside a single dimension (`format`, `collection`, `year`,
 * `media`, `visibility`) are always OR'd. Across dimensions, `match` chooses
 * whether a post must satisfy `"all"` (AND, the default when omitted) or
 * `"any"` (OR) of the active dimensions.
 */
export type PostFilterSelection = {
  readonly [K in FilterDimensionKey]?: FilterDimensionValues[K];
} & {
  readonly match?: FilterMatchMode;
};

function asList<T>(value: T | readonly T[]): readonly T[] {
  return Array.isArray(value) ? (value as readonly T[]) : [value as T];
}

function collapseSingle<T>(values: readonly T[]): T | readonly T[] {
  return values.length === 1 ? (values[0] as T) : values;
}

// =============================================================================
// Context
// =============================================================================

/** Collections, in the three lookups the `collection` dimension needs. */
export interface CollectionVocabulary {
  idBySlug: ReadonlyMap<string, string>;
  slugById: ReadonlyMap<string, string>;
  titleById: ReadonlyMap<string, string>;
}

/**
 * Build the collection lookups from whatever the caller already has loaded.
 *
 * @param collections - Every collection on the site
 * @returns Slug/id/title lookups for {@link DimensionContext}
 * @example
 * buildCollectionVocabulary(await services.collections.list());
 */
export function buildCollectionVocabulary(
  collections: readonly { id: string; slug: string; title: string }[],
): CollectionVocabulary {
  const idBySlug = new Map<string, string>();
  const slugById = new Map<string, string>();
  const titleById = new Map<string, string>();
  for (const collection of collections) {
    idBySlug.set(collection.slug, collection.id);
    slugById.set(collection.id, collection.slug);
    titleById.set(collection.id, collection.title);
  }
  return { idBySlug, slugById, titleById };
}

/** An empty vocabulary, for callers with no collection selection to resolve. */
export const EMPTY_COLLECTION_VOCABULARY: CollectionVocabulary = {
  idBySlug: new Map(),
  slugById: new Map(),
  titleById: new Map(),
};

/**
 * Which time column `year` narrows.
 *
 * - `published` — when the Thread root was published. The historical record,
 *   and the only honest axis for a stored selection: membership must not depend
 *   on how the page happens to be sorted today.
 * - `sort` — whichever column the query sorts by. The archive uses this so
 *   every month bucket shown under `year=N` really belongs to that year.
 */
export type YearAxis = "published" | "sort";

/** Everything a dimension needs that it cannot hold itself. */
export interface DimensionContext {
  /** Required whenever a selection names collections. */
  collections?: CollectionVocabulary;
  /** Defaults to `published`. */
  yearAxis?: YearAxis;
}

/** What turning a selection into `PostFilters` needs beyond the dimensions. */
export interface PostFilterContext extends DimensionContext {
  /** The site's time zone: a `year` is a calendar year on its wall clock. */
  timeZone: string;
}

// =============================================================================
// URL parsing
// =============================================================================

/** Reads one query parameter, or `undefined` when the URL omits it. */
export type ParamReader = (key: string) => string | undefined;

/**
 * What a query string said about one dimension.
 *
 * `cleared` and `absent` are separate outcomes because a URL can say "I looked
 * at this dimension and chose nothing" (`visibility=all`); they filter
 * identically but a strict caller must not treat the word as unknown.
 */
export type DimensionParse<V> =
  | { state: "absent" }
  | { state: "cleared" }
  | { state: "value"; value: V }
  | { state: "invalid"; message: string };

/** One rejected parameter, in the shape an API error or a refusal can use. */
export interface FilterParseIssue {
  param: string;
  message: string;
}

// =============================================================================
// Reading stored columns
// =============================================================================

/**
 * Read a stored boolean, whichever way the dialect spells one.
 *
 * SQLite keeps booleans as `0`/`1` integers and Postgres as real booleans, and
 * a value that arrives as neither is not a third state — it is a column this
 * dimension cannot read, which reads as "not selected".
 */
function readStoredBoolean(raw: unknown): boolean | null {
  if (typeof raw === "boolean") return raw;
  if (raw === 1 || raw === 0) return raw === 1;
  return null;
}

/** Read a stored {@link MediaSelection} back out of its folded column. */
function readStoredMediaSelection(raw: unknown): MediaSelection | null {
  if (typeof raw !== "string" || raw === "") return null;
  if (raw === "any" || raw === "none") return raw;
  const kinds = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part): part is MediaKind =>
      (MEDIA_KINDS as readonly string[]).includes(part),
    );
  return kinds.length > 0 ? kinds : null;
}

// =============================================================================
// Dimension declarations
// =============================================================================

interface DimensionUrl<V> {
  /** The canonical query-string name — the only one ever written. */
  param: string;
  /**
   * Older spellings still read but never written.
   *
   * Real query strings hold these: bookmarks, feed subscriptions, and stored
   * custom archive paths. A strict parser must recognise them too, or it will
   * call a URL it perfectly understands unparseable.
   */
  legacy?: readonly string[];
  parse(read: ParamReader, ctx: DimensionContext): DimensionParse<V>;
  /** The canonical value string, or `null` when the value cannot be spelled. */
  serialize(value: V, ctx: DimensionContext): string | null;
}

/**
 * How a stored selection keeps this dimension.
 *
 * A smart collection is a selection written down, so every dimension needs one
 * column, one validator for what may go in it, and the two conversions between
 * the column and the value. Declaring them here is what keeps a schema change
 * from needing an edit in the service, the API, and the editor as well.
 */
interface DimensionStorage<V> {
  /**
   * The Drizzle property this dimension occupies on `smart_collection`.
   *
   * Both dialect schemas name it identically; the SQL column is its snake_case
   * form. `null` in the column always means "not selected".
   */
  column: string;
  /**
   * May the column hold this value? Narrower than the URL vocabulary can parse:
   * `visibility=private` is a URL a reader may write and a value a smart
   * collection may never store.
   */
  isStorable(value: unknown): value is V;
  /** The column value for this dimension's value. */
  toColumn(value: V): string | number | boolean;
  /** Read a column back, or `null` when it is unset or unreadable. */
  fromColumn(raw: unknown): V | null;
}

/**
 * The control an editor renders for this dimension.
 *
 * Two rules make this small enough to stay small.
 *
 * First: there is no "unset" option in any of them. A condition row exists or it
 * does not, and that is already how "unset" is said. Offering it twice would be
 * two switches for one state.
 *
 * Second: **a control produces the same string the URL does.** Whatever the
 * reader picks is handed back through `url.parse` and written with
 * `url.serialize`, so a control never carries a parser of its own. That is what
 * keeps the union to rendering shapes — a hypothetical `rating` dimension is an
 * `enum` over `"1".."5"`, not a new kind — and it is why `media` gets one folded
 * vocabulary rather than a presence flag beside a kind list.
 */
export type DimensionControl =
  | {
      kind: "enum";
      options: readonly string[];
      labelOf(value: string): MessageDescriptor;
    }
  | { kind: "year" }
  | { kind: "collection" }
  /** any / none / a multi-select of kinds, over the one folded vocabulary. */
  | { kind: "media" }
  /** Two states. "Unset" is the row not being there. */
  | { kind: "presence"; yes: MessageDescriptor; no: MessageDescriptor };

interface Dimension<K extends FilterDimensionKey> {
  /** Stable identity, and the row key in an editing UI. */
  key: K;
  /** The dimension's own name, for a menu of dimensions. */
  label: MessageDescriptor;
  url: DimensionUrl<FilterDimensionValues[K]>;
  storage: DimensionStorage<FilterDimensionValues[K]>;
  control: DimensionControl;
  /** This value's slice of a `PostFilters`. */
  toPostFilter(
    value: FilterDimensionValues[K],
    ctx: PostFilterContext,
  ): Partial<PostFilters>;
  /**
   * How this value reads to a reader, on its own.
   *
   * Plain and non-absorbing: a surface that wants "Untitled" to stand in for
   * "Notes, without a title" composes that itself. Returns `null` when the
   * value cannot be named — an unresolvable collection id.
   */
  describe(
    value: FilterDimensionValues[K],
    i18n: Translator,
    ctx: DimensionContext,
  ): string | null;
}

// --- collection --------------------------------------------------------------

/**
 * Separators accepted between collection slugs.
 *
 * A comma is what gets written. `+` is accepted because `/collections/{a+b}`
 * spells a selection that way in a path — but in a *query string* `+` is
 * form-encoding for a space, so by the time a value reaches here it has already
 * become one. Both are listed: the space is what actually arrives, and the `+`
 * covers a caller that percent-escaped it.
 */
const COLLECTION_SLUG_SEPARATORS = /[,+\s]+/;

function parseCollectionSlugs(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(COLLECTION_SLUG_SEPARATORS)) {
    const slug = part.trim();
    if (slug) seen.add(slug);
  }
  return [...seen];
}

/**
 * The collection slugs a query string names, before any of them is resolved.
 *
 * Split out so a caller can decide whether it needs to load the collection
 * vocabulary at all. The archive renders without one on every unfiltered
 * request, and paying for a lookup to discover that would cost a round trip on
 * the site's widest reader page.
 *
 * @param read - Query parameter reader
 * @returns Slugs in the order written, deduplicated; empty when none is named
 * @example
 * readCollectionSlugs((k) => (k === "collection" ? "tech,art" : undefined));
 * // ["tech", "art"]
 */
export function readCollectionSlugs(read: ParamReader): string[] {
  const raw = read(COLLECTION_DIMENSION.url.param);
  return raw ? parseCollectionSlugs(raw) : [];
}

const COLLECTION_DIMENSION: Dimension<"collection"> = {
  key: "collection",
  label: msg({
    message: "Collection",
    comment: "@context: Post filter dimension name - collection membership",
  }),
  url: {
    param: "collection",
    parse(read, ctx) {
      const raw = read("collection");
      if (!raw) return { state: "absent" };
      const slugs = parseCollectionSlugs(raw);
      if (slugs.length === 0) return { state: "absent" };

      const vocabulary = ctx.collections;
      const ids: string[] = [];
      for (const slug of slugs) {
        const id = vocabulary?.idBySlug.get(slug);
        // A slug that resolves to nothing is never dropped. Dropping it renders
        // the whole archive under a name the reader typed, with the heading and
        // the feed title both pretending the word was never there.
        if (!id) {
          return {
            state: "invalid",
            message: `No collection named "${slug}".`,
          };
        }
        ids.push(id);
      }
      return { state: "value", value: ids };
    },
    serialize(value, ctx) {
      const slugs = value
        .map((id) => ctx.collections?.slugById.get(id))
        .filter((slug): slug is string => Boolean(slug));
      return slugs.length > 0 ? slugs.join(",") : null;
    },
  },
  storage: {
    column: "collectionId",
    // Stored as one or more comma-joined collection IDs, matching the URL's
    // comma-joined slug spelling. Single-collection rows read and write as a
    // bare TypeID string, keeping pre-OR rows byte-identical.
    isStorable(value): value is readonly string[] {
      return (
        Array.isArray(value) &&
        value.length >= 1 &&
        value.every(
          (id) => typeof id === "string" && isTypeId(id, ID_PREFIX.collection),
        )
      );
    },
    toColumn(value) {
      return [...new Set(value)].join(",");
    },
    fromColumn(raw) {
      if (typeof raw !== "string" || !raw) return null;
      const ids = [
        ...new Set(
          raw
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean),
        ),
      ];
      return ids.length > 0 ? ids : null;
    },
  },
  control: { kind: "collection" },
  toPostFilter(value) {
    return { collectionIds: [...new Set(value)] };
  },
  describe(value, _i18n, ctx) {
    const titles = value
      .map((id) => ctx.collections?.titleById.get(id))
      .filter((title): title is string => Boolean(title));
    return titles.length > 0 ? titles.join(", ") : null;
  },
};

// --- format ------------------------------------------------------------------

const FORMAT_LABELS_PLURAL: Record<Format, MessageDescriptor> = {
  note: msg({
    message: "Notes",
    comment: "@context: Post format label plural - notes",
  }),
  link: msg({
    message: "Links",
    comment: "@context: Post format label plural - links",
  }),
  quote: msg({
    message: "Quotes",
    comment: "@context: Post format label plural - quotes",
  }),
};

function isFormatValue(value: unknown): value is Format {
  return (
    typeof value === "string" && (FORMATS as readonly string[]).includes(value)
  );
}

const FORMAT_DIMENSION: Dimension<"format"> = {
  key: "format",
  label: msg({
    message: "Format",
    comment: "@context: Post filter dimension name - note, link, or quote",
  }),
  url: {
    param: "format",
    parse(read) {
      const raw = read("format");
      if (!raw) return { state: "absent" };
      const parts = raw
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      if (parts.length === 0) return { state: "absent" };
      if (!parts.every(isFormatValue)) {
        return {
          state: "invalid",
          message: `Invalid format value. Allowed: ${FORMATS.join(", ")}`,
        };
      }
      const unique = [...new Set(parts)];
      return { state: "value", value: collapseSingle(unique) };
    },
    serialize(value) {
      const unique = [...new Set(asList(value))];
      return unique.length > 0 ? unique.join(",") : null;
    },
  },
  storage: {
    column: "format",
    isStorable(value): value is Format | readonly Format[] {
      return (
        isFormatValue(value) ||
        (Array.isArray(value) && value.length > 0 && value.every(isFormatValue))
      );
    },
    toColumn(value) {
      const selected = new Set(asList(value));
      return FORMATS.filter((format) => selected.has(format)).join(",");
    },
    fromColumn(raw) {
      if (typeof raw !== "string" || !raw) return null;
      const parts = raw
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      if (parts.length === 0 || !parts.every(isFormatValue)) return null;
      return collapseSingle([...new Set(parts)]);
    },
  },
  control: {
    kind: "enum",
    options: FORMATS,
    labelOf: (value) => FORMAT_LABELS_PLURAL[value as Format],
  },
  toPostFilter(value) {
    const unique = [...new Set(asList(value))];
    if (unique.length === 0) return {};
    if (unique.length === 1) return { format: unique[0] };
    return { formats: unique };
  },
  describe(value, i18n) {
    return asList(value)
      .map((format) => i18n._(FORMAT_LABELS_PLURAL[format]))
      .join(", ");
  },
};

/**
 * Plural name of a post format.
 *
 * @param format - Post format key
 * @param i18n - Translator
 * @returns Reader-facing plural, e.g. `Notes`
 * @example
 * getFormatLabelPlural("note", i18n); // "Notes"
 */
export function getFormatLabelPlural(format: Format, i18n: Translator): string {
  return i18n._(FORMAT_LABELS_PLURAL[format]);
}

// --- title -------------------------------------------------------------------

const TITLE_PRESENT_LABEL = msg({
  message: "Titled",
  comment: "@context: Archive filter - notes that have a title",
});
const TITLE_ABSENT_LABEL = msg({
  message: "Untitled",
  comment: "@context: Archive filter - notes without a title",
});

/**
 * Read a pre-rename `hasX=1|0` presence flag.
 *
 * Stored custom archive paths, bookmarks, and feed subscriptions still carry
 * these, so every parser has to recognise them; nothing writes them any more.
 */
function parseLegacyPresence(
  read: ParamReader,
  legacyParam: string,
): DimensionParse<boolean> {
  const legacy = read(legacyParam);
  if (legacy === undefined) return { state: "absent" };
  if (legacy === "1") return { state: "value", value: true };
  if (legacy === "0") return { state: "value", value: false };
  return {
    state: "invalid",
    message: `Invalid ${legacyParam} value. Allowed: 0, 1`,
  };
}

/**
 * Read a two-state presence parameter, with its pre-rename spelling.
 *
 * `any`/`none` is the current vocabulary; `1`/`0` under a `hasX` name is the
 * legacy one.
 */
function parsePresence(
  read: ParamReader,
  param: string,
  legacyParam: string,
): DimensionParse<boolean> {
  const raw = read(param);
  if (raw !== undefined && raw !== "") {
    if (raw === "any") return { state: "value", value: true };
    if (raw === "none") return { state: "value", value: false };
    return {
      state: "invalid",
      message: `Invalid ${param} value. Allowed: any, none`,
    };
  }
  return parseLegacyPresence(read, legacyParam);
}

const TITLE_DIMENSION: Dimension<"title"> = {
  key: "title",
  label: msg({
    message: "Title",
    comment: "@context: Post filter dimension name - whether a post is titled",
  }),
  url: {
    param: "title",
    legacy: ["hasTitle"],
    parse(read) {
      return parsePresence(read, "title", "hasTitle");
    },
    serialize(value) {
      return value ? "any" : "none";
    },
  },
  storage: {
    column: "hasTitle",
    isStorable(value): value is boolean {
      return typeof value === "boolean";
    },
    toColumn(value) {
      return value;
    },
    fromColumn: readStoredBoolean,
  },
  control: {
    kind: "presence",
    yes: TITLE_PRESENT_LABEL,
    no: TITLE_ABSENT_LABEL,
  },
  toPostFilter(value) {
    return { hasTitle: value };
  },
  describe(value, i18n) {
    return i18n._(value ? TITLE_PRESENT_LABEL : TITLE_ABSENT_LABEL);
  },
};

// --- year --------------------------------------------------------------------

function isFilterableYear(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= EARLIEST_FILTERABLE_YEAR &&
    value <= LATEST_FILTERABLE_YEAR
  );
}

function parseSingleYearToken(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const year = Number.parseInt(raw, 10);
  return isFilterableYear(year) ? year : null;
}

/** Merge contiguous calendar years (e.g. 2024, 2025) into `[start, endExclusive)` spans. */
function coalesceYearSpans(
  years: readonly number[],
): Array<{ start: number; endExclusive: number }> {
  const sorted = [...new Set(years)].sort((a, b) => a - b);
  const spans: Array<{ start: number; endExclusive: number }> = [];
  for (const year of sorted) {
    const last = spans[spans.length - 1];
    if (last && last.endExclusive === year) {
      last.endExclusive = year + 1;
    } else {
      spans.push({ start: year, endExclusive: year + 1 });
    }
  }
  return spans;
}

const YEAR_DIMENSION: Dimension<"year"> = {
  key: "year",
  label: msg({
    message: "Year",
    comment: "@context: Post filter dimension name - year of publication",
  }),
  url: {
    param: "year",
    parse(read) {
      const raw = read("year");
      if (!raw) return { state: "absent" };
      const parts = raw
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      if (parts.length === 0) return { state: "absent" };
      const years: number[] = [];
      for (const part of parts) {
        // Bounded at both ends, and the ceiling is the load-bearing one:
        // `toPostFilter` turns a year into `Date.UTC`-based bounds, which go `NaN`
        // past year 275760. A NaN bound is a comparison every row fails, so the
        // page would render empty with nothing to say why.
        const year = parseSingleYearToken(part);
        if (year === null) {
          return {
            state: "invalid",
            message: `Invalid year value. Allowed: ${EARLIEST_FILTERABLE_YEAR} to ${LATEST_FILTERABLE_YEAR}`,
          };
        }
        years.push(year);
      }
      const unique = [...new Set(years)];
      return { state: "value", value: collapseSingle(unique) };
    },
    serialize(value) {
      const unique = [...new Set(asList(value))];
      return unique.length > 0 ? unique.map(String).join(",") : null;
    },
  },
  storage: {
    column: "year",
    isStorable(value): value is number | readonly number[] {
      return (
        isFilterableYear(value) ||
        (Array.isArray(value) &&
          value.length > 0 &&
          value.every(isFilterableYear))
      );
    },
    toColumn(value) {
      return [...new Set(asList(value))]
        .sort((a, b) => a - b)
        .map(String)
        .join(",");
    },
    fromColumn(raw) {
      if (isFilterableYear(raw)) return raw;
      if (typeof raw !== "string" || !raw) return null;
      const parts = raw
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      if (parts.length === 0) return null;
      const years: number[] = [];
      for (const part of parts) {
        const year = parseSingleYearToken(part);
        if (year === null) return null;
        years.push(year);
      }
      return collapseSingle([...new Set(years)]);
    },
  },
  control: { kind: "year" },
  toPostFilter(value, ctx) {
    const spans = coalesceYearSpans(asList(value));
    const [onlySpan, ...restSpans] = spans;
    if (!onlySpan) return {};
    if (restSpans.length === 0) {
      const after = startOfMonthIn(onlySpan.start, 1, ctx.timeZone);
      const before = startOfMonthIn(onlySpan.endExclusive, 1, ctx.timeZone);
      // `PostFilters` has no year field: a year is a pair of timestamp bounds on
      // whichever column the caller is treating as the timeline.
      return ctx.yearAxis === "sort"
        ? { axisAfter: after, axisBefore: before }
        : { publishedAfter: after, publishedBefore: before };
    }
    const axis =
      ctx.yearAxis === "sort" ? ("sort" as const) : ("published" as const);
    return {
      timeRanges: spans.map((span) => ({
        after: startOfMonthIn(span.start, 1, ctx.timeZone),
        before: startOfMonthIn(span.endExclusive, 1, ctx.timeZone),
        axis,
      })),
    };
  },
  describe(value) {
    return asList(value).map(String).join(", ");
  },
};

// --- media -------------------------------------------------------------------

const MEDIA_KIND_LABELS: Record<MediaKind, MessageDescriptor> = {
  image: msg({
    message: "Images",
    comment: "@context: Archive media filter - images",
  }),
  video: msg({
    message: "Video",
    comment: "@context: Archive media filter - video",
  }),
  audio: msg({
    message: "Audio",
    comment: "@context: Archive media filter - audio",
  }),
  text: msg({
    message: "Text attachment",
    comment: "@context: Archive media filter - text file attachments",
  }),
  document: msg({
    message: "Files",
    comment: "@context: Archive media filter - files/documents",
  }),
};

const MEDIA_ANY_LABEL = msg({
  message: "With media",
  comment: "@context: Archive filter - posts carrying any media attachment",
});
const MEDIA_NONE_LABEL = msg({
  message: "Without media",
  comment: "@context: Archive filter - posts with no media attachment",
});

const MEDIA_DIMENSION: Dimension<"media"> = {
  key: "media",
  label: msg({
    message: "Media",
    comment: "@context: Post filter dimension name - attached media",
  }),
  url: {
    param: "media",
    legacy: ["hasMedia"],
    parse(read) {
      const raw = read("media");
      if (raw === undefined || raw === "") {
        const legacy = parseLegacyPresence(read, "hasMedia");
        return legacy.state === "value"
          ? { state: "value", value: legacy.value ? "any" : "none" }
          : legacy;
      }
      if (raw === "any" || raw === "none") {
        return { state: "value", value: raw };
      }
      const parts = raw
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      const kinds = parts.filter((part): part is MediaKind =>
        (MEDIA_KINDS as readonly string[]).includes(part),
      );
      if (parts.length === 0 || kinds.length !== parts.length) {
        return {
          state: "invalid",
          message: `Invalid media value. Allowed: any, none, or kinds: ${MEDIA_KINDS.join(", ")}`,
        };
      }
      return { state: "value", value: kinds };
    },
    serialize(value) {
      if (typeof value === "string") return value;
      // A kind list that names no kind selects nothing. Parsing never produces
      // one, but a hand-built selection can, and `media=` is not a spelling any
      // parser should have to make sense of.
      return value.length > 0 ? value.join(",") : null;
    },
  },
  storage: {
    column: "media",
    isStorable: isMediaSelection,
    // The column holds the same folded string the URL does, so what is stored
    // and what is shared are one vocabulary rather than two.
    toColumn(value) {
      return typeof value === "string" ? value : value.join(",");
    },
    fromColumn: readStoredMediaSelection,
  },
  control: { kind: "media" },
  toPostFilter(value) {
    // The one dimension whose single value spans two `PostFilters` fields.
    if (value === "any") return { hasMedia: true };
    if (value === "none") return { hasMedia: false };
    return value.length > 0 ? { mediaKinds: [...value] } : {};
  },
  describe(value, i18n) {
    if (value === "any") return i18n._(MEDIA_ANY_LABEL);
    if (value === "none") return i18n._(MEDIA_NONE_LABEL);
    // A single kind names itself; several are better summarised than listed.
    if (value.length === 1) {
      return i18n._(MEDIA_KIND_LABELS[value[0] as MediaKind]);
    }
    return value.length > 0 ? i18n._(MEDIA_ANY_LABEL) : null;
  },
};

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
  return i18n._(MEDIA_KIND_LABELS[kind]);
}

// --- replies -----------------------------------------------------------------

const REPLIES_PRESENT_LABEL = msg({
  message: "Threads",
  comment: "@context: Archive thread filter - thread roots with replies",
});
const REPLIES_ABSENT_LABEL = msg({
  message: "Single posts",
  comment: "@context: Archive thread filter - posts without replies",
});

const REPLIES_DIMENSION: Dimension<"replies"> = {
  key: "replies",
  label: msg({
    message: "Replies",
    comment:
      "@context: Post filter dimension name - whether a thread has replies",
  }),
  url: {
    param: "replies",
    legacy: ["hasReplies"],
    parse(read) {
      return parsePresence(read, "replies", "hasReplies");
    },
    serialize(value) {
      return value ? "any" : "none";
    },
  },
  storage: {
    column: "hasReplies",
    isStorable(value): value is boolean {
      return typeof value === "boolean";
    },
    toColumn(value) {
      return value;
    },
    fromColumn: readStoredBoolean,
  },
  control: {
    kind: "presence",
    yes: REPLIES_PRESENT_LABEL,
    no: REPLIES_ABSENT_LABEL,
  },
  toPostFilter(value) {
    return { hasReplies: value };
  },
  describe(value, i18n) {
    return i18n._(value ? REPLIES_PRESENT_LABEL : REPLIES_ABSENT_LABEL);
  },
};

// --- visibility --------------------------------------------------------------

/**
 * How each visibility is spelled in a URL.
 *
 * `latest_hidden` is the stored value; `hidden` is the word every surface puts
 * in a query string. Keyed by the shared list rather than restating it, so a
 * fifth visibility fails to compile here until it is given a spelling.
 */
const VISIBILITY_URL_SPELLING = {
  public: "public",
  featured: "featured",
  latest_hidden: "hidden",
  unlisted: "unlisted",
  private: "private",
} as const satisfies Record<ArchiveVisibility, string>;

/** Every visibility a dimension value may hold, for reading a column back. */
const ARCHIVE_VISIBILITY_VALUES = Object.keys(
  VISIBILITY_URL_SPELLING,
) as ArchiveVisibility[];

const VISIBILITY_BY_URL_VALUE = new Map<string, ArchiveVisibility>(
  Object.entries(VISIBILITY_URL_SPELLING).map(([stored, url]) => [
    url,
    stored as ArchiveVisibility,
  ]),
);

/**
 * Pre-rename spellings of a visibility value.
 *
 * `latest_hidden` is the stored spelling, which stored custom archive paths and
 * old bookmarks still carry. `all` predates the discovery that it means exactly
 * what an absent parameter means — it is read as "chose nothing" and never
 * written again.
 */
const LEGACY_VISIBILITY_VALUES = new Map<
  string,
  { state: "value"; value: ArchiveVisibility } | { state: "cleared" }
>([
  ["latest_hidden", { state: "value", value: "latest_hidden" }],
  ["all", { state: "cleared" }],
]);

const VISIBILITY_LABELS: Record<ArchiveVisibility, MessageDescriptor> = {
  public: msg({
    message: "Public",
    comment: "@context: Archive visibility filter - public posts",
  }),
  latest_hidden: msg({
    message: "Hidden from Latest",
    comment: "@context: Archive visibility filter for posts hidden from Latest",
  }),
  unlisted: msg({
    message: "Unlisted",
    comment:
      "@context: Archive visibility filter - posts that open for anyone with the link but are listed nowhere",
  }),
  private: msg({
    message: "Private",
    comment: "@context: Archive visibility filter - private posts",
  }),
  featured: msg({
    message: "Featured",
    comment: "@context: Archive visibility filter - featured posts",
  }),
};

function isPublicArchiveVisibility(value: unknown): value is ArchiveVisibility {
  return (
    typeof value === "string" &&
    (PUBLIC_ARCHIVE_VISIBILITIES as readonly string[]).includes(value)
  );
}

function isArchiveVisibilityValue(value: unknown): value is ArchiveVisibility {
  return (
    typeof value === "string" &&
    (ARCHIVE_VISIBILITY_VALUES as readonly string[]).includes(value)
  );
}

const VISIBILITY_DIMENSION: Dimension<"visibility"> = {
  key: "visibility",
  label: msg({
    message: "Visibility",
    comment: "@context: Post filter dimension name - who can see a post",
  }),
  url: {
    param: "visibility",
    parse(read) {
      const raw = read("visibility");
      if (!raw) return { state: "absent" };
      const trimmed = raw.trim();
      if (!trimmed) return { state: "absent" };
      if (trimmed === "all") return { state: "cleared" };

      const parts = trimmed
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      if (parts.length === 0) return { state: "absent" };

      const values: ArchiveVisibility[] = [];
      for (const part of parts) {
        const legacy = LEGACY_VISIBILITY_VALUES.get(part);
        if (legacy) {
          if (legacy.state === "cleared") {
            return {
              state: "invalid",
              message: `Invalid visibility value. Allowed: ${[
                ...VISIBILITY_BY_URL_VALUE.keys(),
              ].join(", ")}`,
            };
          }
          values.push(legacy.value);
          continue;
        }
        const stored = VISIBILITY_BY_URL_VALUE.get(part);
        if (!stored) {
          return {
            state: "invalid",
            message: `Invalid visibility value. Allowed: ${[
              ...VISIBILITY_BY_URL_VALUE.keys(),
            ].join(", ")}`,
          };
        }
        values.push(stored);
      }
      const unique = [...new Set(values)];
      return { state: "value", value: collapseSingle(unique) };
    },
    serialize(value) {
      const unique = [...new Set(asList(value))];
      return unique.length > 0
        ? unique.map((v) => VISIBILITY_URL_SPELLING[v]).join(",")
        : null;
    },
  },
  storage: {
    column: "visibility",
    // Narrower than the URL vocabulary on purpose: a smart collection is a
    // published page, so it can never name a set only its author can list.
    // `unlisted` and `private` parse here and fail validation, which is
    // exactly what lets the "turn this link into a smart collection" flow
    // refuse them by name.
    isStorable(
      value,
    ): value is ArchiveVisibility | readonly ArchiveVisibility[] {
      return (
        isPublicArchiveVisibility(value) ||
        (Array.isArray(value) &&
          value.length > 0 &&
          value.every(isPublicArchiveVisibility))
      );
    },
    toColumn(value) {
      const selected = new Set(asList(value));
      return PUBLIC_ARCHIVE_VISIBILITIES.filter((v) => selected.has(v)).join(
        ",",
      );
    },
    fromColumn(raw) {
      if (typeof raw !== "string" || !raw) return null;
      const parts = raw
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      if (parts.length === 0 || !parts.every(isArchiveVisibilityValue)) {
        return null;
      }
      return collapseSingle([...new Set(parts)]);
    },
  },
  control: {
    kind: "enum",
    options: PUBLIC_ARCHIVE_VISIBILITIES,
    labelOf: (value) => VISIBILITY_LABELS[value as ArchiveVisibility],
  },
  toPostFilter(value) {
    // `featured` is a virtual visibility — a separate flag rather than a stored
    // value — so a single featured selection lands in `featured`, while a
    // multi-value union lands in `archiveVisibilities`.
    const unique = [...new Set(asList(value))];
    const [single, ...more] = unique;
    if (!single) return {};
    if (more.length === 0) {
      return single === "featured"
        ? { featured: true }
        : { visibility: single };
    }
    return { archiveVisibilities: unique };
  },
  describe(value, i18n) {
    return asList(value)
      .map((visibility) => i18n._(VISIBILITY_LABELS[visibility]))
      .join(", ");
  },
};

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
  return i18n._(VISIBILITY_LABELS[visibility]);
}

// =============================================================================
// The registry
// =============================================================================

/** Every dimension, keyed. The one place each is declared. */
export const FILTER_DIMENSIONS = {
  collection: COLLECTION_DIMENSION,
  format: FORMAT_DIMENSION,
  title: TITLE_DIMENSION,
  year: YEAR_DIMENSION,
  media: MEDIA_DIMENSION,
  replies: REPLIES_DIMENSION,
  visibility: VISIBILITY_DIMENSION,
} as const satisfies { [K in FilterDimensionKey]: Dimension<K> };

/**
 * Every query parameter any dimension or match mode reads, current and legacy
 * spellings both.
 *
 * A strict parser uses this to tell "a parameter I do not know" from "a
 * parameter I know and chose not to act on".
 */
export const FILTER_DIMENSION_PARAMS: readonly string[] = [
  FILTER_MATCH_PARAM,
  ...FILTER_DIMENSION_KEYS.flatMap((key) => [
    FILTER_DIMENSIONS[key].url.param,
    ...(FILTER_DIMENSIONS[key].url.legacy ?? []),
  ]),
];

/**
 * Normalize a selection to its canonical representation:
 * deduplicated multi-value lists, single-element arrays collapsed to scalars
 * on `format`, `year`, and `visibility`, and default `match: "all"` omitted.
 *
 * @param selection - Selection from an API request or caller
 * @returns Canonical selection
 * @example
 * normalizePostFilterSelection({ match: "all", format: ["quote"] });
 * // { format: "quote" }
 */
export function normalizePostFilterSelection(
  selection: PostFilterSelection,
): PostFilterSelection {
  const normalized: Record<string, unknown> = {};
  if (selection.match === "any") {
    normalized.match = "any";
  }
  for (const key of FILTER_DIMENSION_KEYS) {
    const value = selection[key];
    if (value === undefined) continue;
    const { storage } = FILTER_DIMENSIONS[key];
    const roundTripped = storage.fromColumn(storeDimension(key, value));
    if (roundTripped !== null) {
      normalized[key] = roundTripped;
    }
  }
  return normalized as PostFilterSelection;
}

// =============================================================================
// Storing a whole selection
// =============================================================================

/**
 * The column values a selection writes, every dimension and `matchMode` named.
 *
 * Dimensions with no value are written as `null`, not omitted: removing a
 * condition has to clear its column, and an object that simply left it out
 * would leave the old condition in place.
 *
 * @param selection - The selection to store
 * @returns Column values keyed by Drizzle property name
 * @example
 * selectionToColumns({ format: "note" });
 * // { matchMode: "all", collectionId: null, format: "note", hasTitle: null, ... }
 */
export function selectionToColumns(
  selection: PostFilterSelection,
): Record<string, string | number | boolean | null> {
  const columns: Record<string, string | number | boolean | null> = {
    matchMode: selection.match === "any" ? "any" : "all",
  };
  for (const key of FILTER_DIMENSION_KEYS) {
    const { storage } = FILTER_DIMENSIONS[key];
    const value = selection[key];
    columns[storage.column] =
      value === undefined ? null : storeDimension(key, value);
  }
  return columns;
}

function storeDimension<K extends FilterDimensionKey>(
  key: K,
  value: FilterDimensionValues[K],
): string | number | boolean {
  const toColumn = FILTER_DIMENSIONS[key].storage.toColumn as unknown as (
    value: FilterDimensionValues[K],
  ) => string | number | boolean;
  return toColumn(value);
}

/**
 * Read a stored row back into a selection.
 *
 * A column this dimension cannot read is treated as unset. That is the honest
 * reading: the alternative is a smart collection that refuses to render because
 * one condition is malformed, which turns a bad column into a broken page.
 *
 * @param row - A `smart_collection` row, in either dialect's shape
 * @returns The selection the row stores
 * @example
 * selectionFromRow({ format: "note", hasTitle: 0 });
 * // { format: "note", title: false }
 */
export function selectionFromRow(
  row: Record<string, unknown>,
): PostFilterSelection {
  const selection: Record<string, unknown> = {};
  if (row.matchMode === "any") {
    selection.match = "any";
  }
  for (const key of FILTER_DIMENSION_KEYS) {
    const { storage } = FILTER_DIMENSIONS[key];
    const raw = row[storage.column];
    if (raw === null || raw === undefined) continue;
    const value = storage.fromColumn(raw);
    if (value !== null) selection[key] = value;
  }
  return selection as PostFilterSelection;
}

// =============================================================================
// Parsing a whole selection
// =============================================================================

/** A lenient parse: what was selected, and what could not be read. */
export interface FilterSelectionParse {
  selection: PostFilterSelection;
  /**
   * Dimensions whose value was unreadable, keyed by canonical parameter name.
   * They are absent from `selection`.
   */
  issues: FilterParseIssue[];
}

/**
 * Read every dimension out of a query string, dropping what cannot be read.
 *
 * The lenient half of the pair. A page still has to render when a URL carries a
 * value it does not recognise, so an unreadable dimension is simply not
 * selected — but it is *reported*, because some surfaces owe the reader an
 * answer rather than a quietly wider one. Callers that must refuse outright use
 * {@link parsePostFilterSelectionStrict}: one vocabulary, two policies, never
 * two vocabularies.
 *
 * @param read - Query parameter reader
 * @param ctx - Collection vocabulary and year axis
 * @returns The selection, plus any dimension that could not be read
 * @example
 * parsePostFilterSelection((k) => (k === "format" ? "quote" : undefined), {});
 * // { selection: { format: "quote" }, issues: [] }
 */
export function parsePostFilterSelection(
  read: ParamReader,
  ctx: DimensionContext,
): FilterSelectionParse {
  const selection: Record<string, unknown> = {};
  const issues: FilterParseIssue[] = [];

  const rawMatch = read(FILTER_MATCH_PARAM)?.trim();
  if (rawMatch !== undefined && rawMatch !== "") {
    if (rawMatch === "any") {
      selection.match = "any";
    } else if (rawMatch !== "all") {
      issues.push({
        param: FILTER_MATCH_PARAM,
        message: `Invalid match value. Allowed: ${FILTER_MATCH_MODES.join(", ")}`,
      });
    }
  }

  for (const key of FILTER_DIMENSION_KEYS) {
    const dimension = FILTER_DIMENSIONS[key];
    const parsed = dimension.url.parse(read, ctx);
    if (parsed.state === "value") selection[key] = parsed.value;
    else if (parsed.state === "invalid") {
      issues.push({ param: dimension.url.param, message: parsed.message });
    }
  }
  return { selection: selection as PostFilterSelection, issues };
}

/** What a strict parse produced, or why it refused. */
export type StrictFilterParse =
  | { ok: true; selection: PostFilterSelection }
  | { ok: false; issues: FilterParseIssue[] };

/**
 * Read every dimension out of a query string, refusing anything unreadable.
 *
 * For decisions, not rendering: whether a URL can become a persistent object,
 * or whether an API caller's words can be answered. A renderer that cannot read
 * a value drops it and still shows a page; a decision that drops it silently
 * answers a different question than the one asked.
 *
 * @param read - Query parameter reader
 * @param present - Every parameter name actually in the query string
 * @param ctx - Collection vocabulary and year axis
 * @param opts.allow - Parameter names that belong to the caller, not to a
 *   dimension (`limit`, `cursor`, `sort`, …). Anything else present is unknown.
 * @returns The selection, or the issues that stopped it
 * @example
 * parsePostFilterSelectionStrict(read, ["format"], ctx, { allow: [] });
 * // { ok: true, selection: { format: "quote" } }
 */
export function parsePostFilterSelectionStrict(
  read: ParamReader,
  present: readonly string[],
  ctx: DimensionContext,
  opts: { allow?: readonly string[] } = {},
): StrictFilterParse {
  const known = new Set([...FILTER_DIMENSION_PARAMS, ...(opts.allow ?? [])]);
  const unknown: FilterParseIssue[] = [];

  for (const param of present) {
    if (!known.has(param)) {
      unknown.push({ param, message: `Unknown parameter "${param}".` });
    }
  }

  const { selection, issues } = parsePostFilterSelection(read, ctx);
  const all = [...unknown, ...issues];
  if (all.length > 0) return { ok: false, issues: all };
  return { ok: true, selection };
}

// =============================================================================
// Serializing a whole selection
// =============================================================================

/**
 * Write a selection back into query parameters, in the canonical spelling.
 *
 * Legacy spellings are read but never written, so a URL this produces round
 * trips through {@link parsePostFilterSelectionStrict} unchanged.
 *
 * @param selection - The selection to spell
 * @param ctx - Collection vocabulary
 * @param into - Params to write into; a fresh set when omitted
 * @returns The params, for chaining
 * @example
 * serializePostFilterSelection({ format: "quote" }, {}).toString();
 * // "format=quote"
 */
export function serializePostFilterSelection(
  selection: PostFilterSelection,
  ctx: DimensionContext,
  into: URLSearchParams = new URLSearchParams(),
): URLSearchParams {
  if (selection.match === "any") {
    into.set(FILTER_MATCH_PARAM, "any");
  }
  for (const key of FILTER_DIMENSION_KEYS) {
    const value = selection[key];
    if (value === undefined) continue;
    const dimension = FILTER_DIMENSIONS[key];
    // Each branch narrows `value` to its own dimension's type; the registry's
    // per-key typing cannot survive the loop, so the call is made per key.
    const spelled = spellDimension(key, value, ctx);
    if (spelled !== null) into.set(dimension.url.param, spelled);
  }
  return into;
}

/**
 * Why the three helpers below each carry one cast.
 *
 * The registry is precisely typed per key — `satisfies { [K in Key]: Dimension<K> }`
 * checks every declaration against its own value type. What a `for` loop over
 * the keys cannot carry is the *pairing*: at the call site TypeScript sees a
 * union of dimensions and a union of values, and has no way to know that the
 * one drawn from `FILTER_DIMENSIONS[key]` belongs with the one drawn from
 * `selection[key]`. They do, by construction — both are indexed by the same
 * `key`. One cast per operation is the cost of iterating; the alternative is a
 * seven-arm switch in each of three functions, which is exactly the repetition
 * this module exists to remove.
 */
function spellDimension<K extends FilterDimensionKey>(
  key: K,
  value: FilterDimensionValues[K],
  ctx: DimensionContext,
): string | null {
  const serialize = FILTER_DIMENSIONS[key].url.serialize as unknown as (
    value: FilterDimensionValues[K],
    ctx: DimensionContext,
  ) => string | null;
  return serialize(value, ctx);
}

// =============================================================================
// Translating a selection
// =============================================================================

/**
 * Turn a selection into the `PostFilters` fields it implies.
 *
 * Nothing else: the caller still owns status, reply exclusion, the reader's
 * visibility floor, sorting, and paging. This is the selection's contribution
 * and no more, so the same selection means the same thing on a page, in a feed,
 * and inside an aggregate count.
 *
 * @param selection - Dimensions the reader chose
 * @param ctx - Collection vocabulary, year axis, and the site's time zone
 * @returns The matching `PostFilters` slice
 * @example
 * toPostFilters({ format: "quote", media: "any" }, { timeZone: "UTC" });
 * // { format: "quote", hasMedia: true }
 */
export function toPostFilters(
  selection: PostFilterSelection,
  ctx: PostFilterContext,
): Partial<PostFilters> {
  const activeKeys = FILTER_DIMENSION_KEYS.filter(
    (key) => selection[key] !== undefined,
  );
  if (selection.match === "any" && activeKeys.length >= 2) {
    const branches = activeKeys
      .map((key) => {
        const value = selection[key];
        return value !== undefined ? filterFor(key, value, ctx) : {};
      })
      .filter((slice) => Object.keys(slice).length > 0) as PostFilters[];
    if (branches.length >= 2) {
      return { anyOf: branches };
    }
    return branches[0] ?? {};
  }

  let filters: Partial<PostFilters> = {};
  for (const key of activeKeys) {
    const value = selection[key];
    if (value === undefined) continue;
    filters = { ...filters, ...filterFor(key, value, ctx) };
  }
  return filters;
}

function filterFor<K extends FilterDimensionKey>(
  key: K,
  value: FilterDimensionValues[K],
  ctx: PostFilterContext,
): Partial<PostFilters> {
  const toFilter = FILTER_DIMENSIONS[key].toPostFilter as unknown as (
    value: FilterDimensionValues[K],
    ctx: PostFilterContext,
  ) => Partial<PostFilters>;
  return toFilter(value, ctx);
}

/** Whether a selection narrows anything at all. */
export function hasFilterSelection(selection: PostFilterSelection): boolean {
  return FILTER_DIMENSION_KEYS.some((key) => selection[key] !== undefined);
}

/**
 * How each selected dimension reads, one string per dimension.
 *
 * Plain readings in registry order, with no cross-dimension absorption — a
 * surface that wants "Untitled" to stand in for "Notes, without a title"
 * composes that itself, because whether it can afford to depends on how much
 * room it has.
 *
 * @param selection - Dimensions the reader chose
 * @param i18n - Translator
 * @param ctx - Collection vocabulary
 * @returns One label per selected dimension, unnameable ones omitted
 * @example
 * describeFilterSelection({ format: "quote", year: 2024 }, i18n, {});
 * // ["Quotes", "2024"]
 */
export function describeFilterSelection(
  selection: PostFilterSelection,
  i18n: Translator,
  ctx: DimensionContext,
): string[] {
  const parts: string[] = [];
  for (const key of FILTER_DIMENSION_KEYS) {
    const value = selection[key];
    if (value === undefined) continue;
    const part = describeDimension(key, value, i18n, ctx);
    if (part) parts.push(part);
  }
  return parts;
}

function describeDimension<K extends FilterDimensionKey>(
  key: K,
  value: FilterDimensionValues[K],
  i18n: Translator,
  ctx: DimensionContext,
): string | null {
  const describe = FILTER_DIMENSIONS[key].describe as unknown as (
    value: FilterDimensionValues[K],
    i18n: Translator,
    ctx: DimensionContext,
  ) => string | null;
  return describe(value, i18n, ctx);
}
