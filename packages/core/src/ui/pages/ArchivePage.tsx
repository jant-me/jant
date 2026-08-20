/**
 * Archive Page
 *
 * Tumblr-style grid/list with compact chip filter bar,
 * month-based grouping, and page-based pagination.
 */

import type { FC } from "hono/jsx";
import { msg } from "@lingui/core/macro";
import { useLingui } from "../../i18n/context.js";
import type {
  ArchivePageProps,
  ArchiveFilters,
  ArchiveLayout,
  ArchiveSort,
  ArchiveVisibility,
  Format,
  MediaKind,
} from "../../types.js";
import type { PostView } from "../../types/views.js";
import {
  ARCHIVE_VISIBILITIES,
  FORMATS,
  MEDIA_KINDS,
  PUBLIC_ARCHIVE_VISIBILITIES,
} from "../../types.js";
import type {
  DimensionContext,
  FilterDimensionValues,
  MediaSelection,
} from "../../lib/filter-dimensions.js";
import {
  buildCollectionVocabulary,
  FILTER_DIMENSIONS,
  serializePostFilterSelection,
} from "../../lib/filter-dimensions.js";
import { getFeaturedIconSvg } from "../../lib/featured-icons.js";
import { getIconSvg } from "../../lib/icons.js";
import { toPublicPath } from "../../lib/url.js";
import { toMediaKind } from "../../lib/upload.js";
import { PagePagination } from "../shared/Pagination.js";
import { TimelineFeedItem } from "../feed/TimelineFeed.js";
import { DecorativeQuoteMark } from "../shared/DecorativeQuoteMark.js";
import {
  ARCHIVE_ALL_POSTS_LABEL,
  getFormatLabelPlural as getSharedFormatLabelPlural,
  getMediaKindLabel as getSharedMediaKindLabel,
  getVisibilityLabel as getSharedVisibilityLabel,
  hasActiveArchiveFilter,
} from "../shared/archive-labels.js";

// =============================================================================
// URL Builder
// =============================================================================

/**
 * One chip's edit to the current view.
 *
 * Dimensions are named exactly as the shared registry names them, so a chip
 * cannot spell a filter the route is unable to read back. An explicit
 * `undefined` clears a dimension, the same way spreading it does.
 */
type FilterUpdates = Partial<FilterDimensionValues> & {
  layout?: ArchiveLayout;
  sort?: ArchiveSort;
  /** Drop every selection and return to the bare archive. */
  clear?: boolean;
};

/** Build an archive URL preserving existing filter params, overriding with updates. */
function buildFilterUrl(
  current: ArchiveFilters,
  updates: FilterUpdates,
  ctx: DimensionContext,
  basePath = "",
): string {
  if (updates.clear) return toPublicPath("/archive", basePath);

  const { layout, sort, clear: _clear, ...selectionUpdates } = updates;
  const params = serializePostFilterSelection(
    { ...current.selection, ...selectionUpdates },
    ctx,
  );

  // Both layouts are written out in full. An absent `layout` means "whatever
  // this site defaults to", so a link shared with a layout chosen keeps that
  // layout even if the site default changes later. Only `layout` is ever
  // emitted; the older `view` spelling is read-only now.
  const mergedLayout = "layout" in updates ? layout : current.layout;
  if (mergedLayout) params.set("layout", mergedLayout);
  const mergedSort = "sort" in updates ? sort : current.sort;
  if (mergedSort === "updated") params.set("sort", "updated");

  const qs = params.toString();
  return qs
    ? toPublicPath(`/archive?${qs}`, basePath)
    : toPublicPath("/archive", basePath);
}

// =============================================================================
// Format Labels
// =============================================================================

function getFormatLabel(format: string): string {
  const { i18n } = useLingui();
  const labels: Record<string, string> = {
    note: i18n._(
      msg({
        message: "Note",
        comment: "@context: Post format label - note",
      }),
    ),
    link: i18n._(
      msg({
        message: "Link",
        comment: "@context: Post format label - link",
      }),
    ),
    quote: i18n._(
      msg({
        message: "Quote",
        comment: "@context: Post format label - quote",
      }),
    ),
  };
  return labels[format] ?? format;
}

function getFormatLabelPlural(format: Format): string {
  const { i18n } = useLingui();
  return getSharedFormatLabelPlural(format, i18n);
}

/** Icon name mapping for post formats. */
const FORMAT_ICONS: Record<string, string> = {
  note: "notepad-text",
  link: "external-link",
  quote: "quote",
};

/** Icon name mapping for media kinds. */
const MEDIA_KIND_ICONS: Record<MediaKind, string> = {
  image: "image",
  video: "video",
  audio: "music",
  text: "file-text",
  document: "file",
};

function getMediaKindLabel(kind: MediaKind): string {
  const { i18n } = useLingui();
  return getSharedMediaKindLabel(kind, i18n);
}

/**
 * The kinds a media selection names, or none when it only asks about presence.
 *
 * `any`/`none` and a list of kinds are one value in the shared vocabulary; the
 * chip's multi-select only has something to highlight in the list case.
 */
function selectedMediaKinds(
  selection: MediaSelection | undefined,
): readonly MediaKind[] {
  return selection === undefined || selection === "any" || selection === "none"
    ? []
    : selection;
}

// =============================================================================
// Shared Icon Helpers
// =============================================================================

/** Inline SVG icon with specified size class. */
const Icon: FC<{ name: string; class?: string }> = ({
  name,
  class: cls = "[&>svg]:size-4",
}) => {
  const svg = getIconSvg(name);
  if (!svg) return null;
  return (
    <span
      class={`shrink-0 inline-flex ${cls}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};

/** Chevron indicator for chip triggers. */
const ChipChevron: FC = () => (
  <Icon name="chevron-down" class="[&>svg]:size-3 opacity-40" />
);

const ChipClearLink: FC<{ href: string; label: string }> = ({
  href,
  label,
}) => (
  <a
    href={href}
    class="archive-chip-clear btn-sm-icon-ghost rounded-full"
    aria-label={label}
    title={label}
  >
    <Icon name="x" class="[&>svg]:size-3" />
  </a>
);

// =============================================================================
// Chip Select Components
// =============================================================================

interface ChipSelectOption {
  label: string;
  value: string;
  icon?: string;
  iconHtml?: string;
  indent?: boolean;
}

/**
 * Compact chip-style dropdown.
 *
 * Default state: icon + chevron (no text).
 * Active state (iconOnly): active icon + ✕ clear button (no text).
 * Active state (with label): icon + selected label + ✕ clear button.
 */
const ChipSelect: FC<{
  id: string;
  icon: string;
  options: ChipSelectOption[];
  currentValue: string;
  clearUrl: string;
  activeLabel?: string;
  activeIconHtml?: string;
  activeIcon?: string;
  iconOnly?: boolean;
}> = ({
  id,
  icon,
  options,
  currentValue,
  clearUrl,
  activeLabel,
  activeIconHtml,
  activeIcon,
  iconOnly,
}) => {
  const { i18n } = useLingui();
  const isActive = !!activeLabel;
  const clearLabel = i18n._(
    msg({
      message: "Clear filter",
      comment:
        "@context: Archive filter button label to clear the active filter",
    }),
  );

  return (
    <div
      id={id}
      class="archive-chip-select archive-chip-dropdown select"
      data-select-initialized
    >
      <button
        type="button"
        class={`archive-chip${isActive ? " archive-chip-active" : ""}`}
        id={`${id}-trigger`}
        aria-haspopup="listbox"
        aria-expanded="false"
        aria-controls={`${id}-listbox`}
      >
        {isActive && activeIconHtml ? (
          <span
            class="shrink-0 inline-flex [&>svg]:size-4"
            dangerouslySetInnerHTML={{ __html: activeIconHtml }}
          />
        ) : isActive && activeIcon ? (
          <Icon name={activeIcon} class="[&>svg]:size-4" />
        ) : (
          <Icon name={icon} class="[&>svg]:size-4 text-muted-foreground" />
        )}
        {isActive && activeLabel && (
          <span
            class={`archive-chip-label${iconOnly ? " archive-chip-label-collapsible" : ""}`}
          >
            {activeLabel}
          </span>
        )}
        {!isActive && <ChipChevron />}
      </button>
      {isActive && <ChipClearLink href={clearUrl} label={clearLabel} />}
      <div id={`${id}-popover`} data-popover aria-hidden="true">
        <div
          role="listbox"
          id={`${id}-listbox`}
          aria-orientation="vertical"
          aria-labelledby={`${id}-trigger`}
        >
          {options.map((opt) => (
            <div
              key={opt.value}
              role="option"
              data-value={opt.value}
              aria-selected={opt.value === currentValue ? "true" : undefined}
              class={opt.indent ? "pl-4" : undefined}
            >
              {opt.iconHtml ? (
                <span class="flex items-center gap-2">
                  <span
                    class="shrink-0 inline-flex [&>svg]:size-4"
                    dangerouslySetInnerHTML={{ __html: opt.iconHtml }}
                  />
                  {opt.label}
                </span>
              ) : opt.icon ? (
                <span class="flex items-center gap-2">
                  <Icon
                    name={opt.icon}
                    class="[&>svg]:size-4 text-muted-foreground"
                  />
                  {opt.label}
                </span>
              ) : (
                opt.label
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/**
 * Chip-style multi-select for media kinds.
 *
 * "Text only" at the top navigates immediately (mutually exclusive with kinds).
 * Media kind options are multi-toggle; navigation happens on popover close.
 * Shows count when multiple kinds are selected.
 */
const ChipMediaSelect: FC<{
  id: string;
  icon: string;
  filters: ArchiveFilters;
  ctx: DimensionContext;
  activeLabel?: string;
  clearUrl: string;
  basePath?: string;
}> = ({ id, icon, filters: f, ctx, activeLabel, clearUrl, basePath = "" }) => {
  const { i18n } = useLingui();
  const isActive = !!activeLabel;
  const activeKinds = selectedMediaKinds(f.selection.media);

  const singleKind = activeKinds.length === 1 ? activeKinds[0] : undefined;
  const activeMediaIcon = isActive
    ? f.selection.media === "none"
      ? "text"
      : singleKind
        ? MEDIA_KIND_ICONS[singleKind]
        : icon
    : undefined;

  const textOnlyUrl = buildFilterUrl(f, { media: "none" }, ctx, basePath);
  const clearLabel = i18n._(
    msg({
      message: "Clear filter",
      comment:
        "@context: Archive filter button label to clear the active filter",
    }),
  );

  return (
    <div
      id={id}
      class="archive-chip-select archive-chip-dropdown archive-chip-media select"
      data-select-initialized
      data-filter-key={FILTER_DIMENSIONS.media.url.param}
    >
      <button
        type="button"
        class={`archive-chip${isActive ? " archive-chip-active" : ""}`}
        id={`${id}-trigger`}
        aria-haspopup="listbox"
        aria-expanded="false"
        aria-controls={`${id}-listbox`}
      >
        {isActive && activeMediaIcon ? (
          <Icon name={activeMediaIcon} class="[&>svg]:size-4" />
        ) : (
          <Icon name={icon} class="[&>svg]:size-4 text-muted-foreground" />
        )}
        {isActive && activeKinds.length > 1 && (
          <span class="archive-chip-label">{activeLabel}</span>
        )}
        {!isActive && <ChipChevron />}
      </button>
      {isActive && <ChipClearLink href={clearUrl} label={clearLabel} />}
      <div id={`${id}-popover`} data-popover aria-hidden="true">
        <div
          role="listbox"
          id={`${id}-listbox`}
          aria-orientation="vertical"
          aria-labelledby={`${id}-trigger`}
          aria-multiselectable="true"
        >
          <div
            role="option"
            data-value={textOnlyUrl}
            data-navigate="true"
            aria-selected={f.selection.media === "none" ? "true" : undefined}
          >
            <span class="flex items-center gap-2">
              <Icon name="text" class="[&>svg]:size-4 text-muted-foreground" />
              {i18n._(
                msg({
                  message: "Text",
                  comment:
                    "@context: Archive media filter - posts without any media attachments",
                }),
              )}
            </span>
          </div>
          {MEDIA_KINDS.map((kind) => {
            const label = getMediaKindLabel(kind);
            const kindIcon = MEDIA_KIND_ICONS[kind];
            return (
              <div
                key={kind}
                role="option"
                data-value={kind}
                data-label={label}
                aria-selected={activeKinds.includes(kind) ? "true" : undefined}
              >
                <span class="flex items-center gap-2">
                  <Icon
                    name={kindIcon}
                    class="[&>svg]:size-4 text-muted-foreground"
                  />
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// View Toggle
// =============================================================================

/**
 * One option in a toolbar toggle. `label` is used for both the hover tooltip
 * and the accessible name — an icon-only control has to explain itself to
 * both audiences, and one string keeps them from drifting apart.
 */
const ToggleOption: FC<{
  href: string;
  icon: string;
  label: string;
  active: boolean;
}> = ({ href, icon, label, active }) => (
  <a
    href={href}
    class={`archive-view-btn${active ? " archive-view-btn-active" : ""}`}
    role="radio"
    aria-checked={active ? "true" : "false"}
    aria-label={label}
    title={label}
  >
    <Icon name={icon} class="[&>svg]:size-4" />
  </a>
);

const LayoutToggle: FC<{
  filters: ArchiveFilters;
  ctx: DimensionContext;
  defaultLayout: ArchiveLayout;
  basePath?: string;
}> = ({ filters, ctx, defaultLayout, basePath = "" }) => {
  const { i18n } = useLingui();
  const currentLayout: ArchiveLayout = filters.layout ?? defaultLayout;

  return (
    <div
      class="archive-view-toggle"
      role="radiogroup"
      aria-label={i18n._(
        msg({
          message: "Layout",
          comment: "@context: Archive grid/list toggle group label",
        }),
      )}
    >
      <ToggleOption
        href={buildFilterUrl(filters, { layout: "grid" }, ctx, basePath)}
        icon="layout-grid"
        active={currentLayout === "grid"}
        label={i18n._(
          msg({
            message: "Show as a grid of tiles",
            comment: "@context: Archive view option - grid",
          }),
        )}
      />
      <ToggleOption
        href={buildFilterUrl(filters, { layout: "list" }, ctx, basePath)}
        icon="list"
        active={currentLayout === "list"}
        label={i18n._(
          msg({
            message: "Show as a list with full posts",
            comment: "@context: Archive view option - list",
          }),
        )}
      />
    </div>
  );
};

/**
 * Time-axis toggle. Sits next to the view toggle because it changes how the
 * page is arranged, not which threads it contains — unlike the filter chips.
 */
const SortToggle: FC<{
  filters: ArchiveFilters;
  ctx: DimensionContext;
  basePath?: string;
}> = ({ filters, ctx, basePath = "" }) => {
  const { i18n } = useLingui();
  const sortsByActivity = filters.sort === "updated";

  return (
    <div
      class="archive-view-toggle"
      role="radiogroup"
      aria-label={i18n._(
        msg({
          message: "Sort order",
          comment: "@context: Archive sort toggle group label",
        }),
      )}
    >
      <ToggleOption
        href={buildFilterUrl(filters, { sort: undefined }, ctx, basePath)}
        icon="clock"
        active={!sortsByActivity}
        label={i18n._(
          msg({
            message: "Sort by when each thread was published",
            comment: "@context: Archive sort option - newest published first",
          }),
        )}
      />
      <ToggleOption
        href={buildFilterUrl(filters, { sort: "updated" }, ctx, basePath)}
        icon="history"
        active={sortsByActivity}
        label={i18n._(
          msg({
            message: "Sort by when each thread was last added to",
            comment:
              "@context: Archive sort option - threads that recently gained a post first",
          }),
        )}
      />
    </div>
  );
};

// =============================================================================
// Filter Bar
// =============================================================================

function getVisibilityLabel(v: ArchiveVisibility): string {
  const { i18n } = useLingui();
  return getSharedVisibilityLabel(v, i18n);
}

const VISIBILITY_ICONS: Record<ArchiveVisibility, string> = {
  public: "globe",
  latest_hidden: "eye-off",
  private: "lock",
  featured: "star",
};

const FEATURED_VISIBILITY_ICON_HTML = getFeaturedIconSvg({
  className: "icon-fine",
});

/** Chip icon for each filter dimension. */
const FILTER_ICONS = {
  year: "calendar",
  collection: "monitor",
  format: "shapes",
  media: "video",
  thread: "git-branch",
  visibility: "scan-eye",
} as const;

/** Icons for the thread filter options. */
const THREAD_ICONS = {
  threads: "list-tree",
  single: "git-commit-horizontal",
} as const;

const FilterBar: FC<{
  filters: ArchiveFilters;
  defaultLayout: ArchiveLayout;
  availableYears: number[];
  availableCollections: { id: string; slug: string; title: string }[];
  isAuthenticated: boolean;
  basePath?: string;
}> = ({
  filters,
  defaultLayout,
  availableYears,
  availableCollections,
  isAuthenticated,
  basePath = "",
}) => {
  const { i18n } = useLingui();
  // Every link on this bar is this page with one dimension edited, so the bar
  // spells them with the same serializer the route parses with.
  const ctx: DimensionContext = {
    collections: buildCollectionVocabulary(availableCollections),
  };
  const currentUrl = buildFilterUrl(filters, {}, ctx, basePath);
  const selection = filters.selection;

  // --- Year options ---------------------------------------------------------

  const yearOptions: ChipSelectOption[] = [
    {
      label: i18n._(
        msg({
          message: "All years",
          comment: "@context: Archive filter - year dropdown default",
        }),
      ),
      icon: FILTER_ICONS.year,
      value: buildFilterUrl(filters, { year: undefined }, ctx, basePath),
    },
    ...availableYears.map((year) => ({
      label: String(year),
      value: buildFilterUrl(filters, { year }, ctx, basePath),
    })),
  ];

  // --- Collection options ---------------------------------------------------

  // The chip picks one collection at a time. A URL may name several — the
  // vocabulary supports it and the page renders it — but a dropdown that
  // replaces the selection is the honest control for a single click.
  const selectedCollectionIds = selection.collection ?? [];
  const selectedCollectionTitles = selectedCollectionIds
    .map((id) => ctx.collections?.titleById.get(id))
    .filter((title): title is string => Boolean(title));

  const collectionOptions: ChipSelectOption[] = [
    {
      label: i18n._(
        msg({
          message: "All collections",
          comment: "@context: Archive filter - collection dropdown default",
        }),
      ),
      icon: FILTER_ICONS.collection,
      value: buildFilterUrl(filters, { collection: undefined }, ctx, basePath),
    },
    ...availableCollections.map((col) => ({
      label: col.title,
      value: buildFilterUrl(filters, { collection: [col.id] }, ctx, basePath),
    })),
  ];

  // --- Format options (Notes split into All / Titled / Untitled) -----------

  const formatActiveLabel = selection.format
    ? selection.title === true
      ? i18n._(
          msg({
            message: "Titled",
            comment: "@context: Archive filter - notes that have a title",
          }),
        )
      : selection.title === false
        ? i18n._(
            msg({
              message: "Untitled",
              comment: "@context: Archive filter - notes without a title",
            }),
          )
        : getFormatLabelPlural(selection.format)
    : undefined;

  const formatActiveIcon = selection.format
    ? selection.title === true
      ? "type"
      : selection.title === false
        ? "text"
        : FORMAT_ICONS[selection.format]
    : undefined;

  const formatOptions: ChipSelectOption[] = [
    {
      label: i18n._(
        msg({
          message: "All formats",
          comment: "@context: Archive filter - all formats select option",
        }),
      ),
      icon: FILTER_ICONS.format,
      value: buildFilterUrl(
        filters,
        { format: undefined, title: undefined },
        ctx,
        basePath,
      ),
    },
    {
      label: getFormatLabelPlural("note"),
      icon: FORMAT_ICONS.note,
      value: buildFilterUrl(
        filters,
        { format: "note", title: undefined },
        ctx,
        basePath,
      ),
    },
    {
      label: i18n._(
        msg({
          message: "Titled",
          comment: "@context: Archive filter - notes that have a title",
        }),
      ),
      icon: "type",
      indent: true,
      value: buildFilterUrl(
        filters,
        { format: "note", title: true },
        ctx,
        basePath,
      ),
    },
    {
      label: i18n._(
        msg({
          message: "Untitled",
          comment: "@context: Archive filter - notes without a title",
        }),
      ),
      icon: "text",
      indent: true,
      value: buildFilterUrl(
        filters,
        { format: "note", title: false },
        ctx,
        basePath,
      ),
    },
    ...FORMATS.filter((f) => f !== "note").map((f) => ({
      label: getFormatLabelPlural(f),
      icon: FORMAT_ICONS[f],
      value: buildFilterUrl(
        filters,
        { format: f, title: undefined },
        ctx,
        basePath,
      ),
    })),
  ];

  // --- Visibility options ------------------------------------------------------

  // A signed-out reader gets the same dimension minus `private`: the archive
  // already shows them Hidden-from-Latest posts, so those two values name sets
  // they can actually reach. `private` names one they cannot, and the route
  // redirects rather than quietly widening it.
  const selectableVisibilities = isAuthenticated
    ? ARCHIVE_VISIBILITIES
    : PUBLIC_ARCHIVE_VISIBILITIES;

  // "All visibility" is the absence of the parameter, not a value of it. The
  // page once emitted `?visibility=all` here, which read back as exactly the
  // same thing — a second spelling of "nothing selected" that only the parser
  // knew about. It is still read, for URLs already written; it is not written.
  const allVisibilityUrl = buildFilterUrl(
    filters,
    { visibility: undefined },
    ctx,
    basePath,
  );

  const visibilityOptions: ChipSelectOption[] = [
    {
      label: i18n._(
        msg({
          message: "All visibility",
          comment: "@context: Archive filter - all visibility select option",
        }),
      ),
      icon: FILTER_ICONS.visibility,
      value: allVisibilityUrl,
    },
    ...selectableVisibilities.map((v) => ({
      label: getVisibilityLabel(v),
      ...(v === "featured"
        ? { iconHtml: FEATURED_VISIBILITY_ICON_HTML }
        : { icon: VISIBILITY_ICONS[v] }),
      value: buildFilterUrl(filters, { visibility: v }, ctx, basePath),
    })),
  ];

  // --- Thread options ---------------------------------------------------------

  const threadClearUrl = buildFilterUrl(
    filters,
    { replies: undefined },
    ctx,
    basePath,
  );

  const threadsLabel = i18n._(
    msg({
      message: "Threads",
      comment: "@context: Archive thread filter - thread roots with replies",
    }),
  );
  const singlePostsLabel = i18n._(
    msg({
      message: "Single posts",
      comment: "@context: Archive thread filter - posts without replies",
    }),
  );

  const threadOptions: ChipSelectOption[] = [
    {
      label: i18n._(
        msg({
          message: "All posts",
          comment: "@context: Archive thread filter - threads and single posts",
        }),
      ),
      icon: FILTER_ICONS.thread,
      value: threadClearUrl,
    },
    {
      label: threadsLabel,
      icon: THREAD_ICONS.threads,
      value: buildFilterUrl(filters, { replies: true }, ctx, basePath),
    },
    {
      label: singlePostsLabel,
      icon: THREAD_ICONS.single,
      value: buildFilterUrl(filters, { replies: false }, ctx, basePath),
    },
  ];

  const threadActiveLabel =
    selection.replies === true
      ? threadsLabel
      : selection.replies === false
        ? singlePostsLabel
        : undefined;
  const threadActiveIcon =
    selection.replies === true
      ? THREAD_ICONS.threads
      : selection.replies === false
        ? THREAD_ICONS.single
        : undefined;

  const activeKinds = selectedMediaKinds(selection.media);
  const mediaActiveLabel =
    selection.media === "none"
      ? i18n._(
          msg({
            message: "Text",
            comment:
              "@context: Archive media filter - posts without any media attachments",
          }),
        )
      : activeKinds.length === 1
        ? // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- length check guarantees element exists
          getMediaKindLabel(activeKinds[0]!)
        : activeKinds.length > 1
          ? String(activeKinds.length)
          : selection.media === "any"
            ? i18n._(
                msg({
                  message: "With media",
                  comment:
                    "@context: Archive filter - posts carrying any media attachment",
                }),
              )
            : undefined;
  const mediaClearUrl = buildFilterUrl(
    filters,
    { media: undefined },
    ctx,
    basePath,
  );

  return (
    <div class="archive-filters">
      <div class="archive-filters-chips">
        {availableYears.length > 0 && (
          <ChipSelect
            id="af-year"
            icon={FILTER_ICONS.year}
            options={yearOptions}
            currentValue={currentUrl}
            clearUrl={buildFilterUrl(
              filters,
              { year: undefined },
              ctx,
              basePath,
            )}
            activeLabel={selection.year ? String(selection.year) : undefined}
          />
        )}
        {availableCollections.length > 0 && (
          <ChipSelect
            id="af-collection"
            icon={FILTER_ICONS.collection}
            options={collectionOptions}
            currentValue={currentUrl}
            clearUrl={buildFilterUrl(
              filters,
              { collection: undefined },
              ctx,
              basePath,
            )}
            activeLabel={
              selectedCollectionTitles.length > 0
                ? selectedCollectionTitles.join(", ")
                : undefined
            }
            iconOnly
          />
        )}
        <ChipSelect
          id="af-format"
          icon={FILTER_ICONS.format}
          options={formatOptions}
          currentValue={currentUrl}
          clearUrl={buildFilterUrl(
            filters,
            { format: undefined, title: undefined },
            ctx,
            basePath,
          )}
          activeLabel={formatActiveLabel}
          activeIcon={formatActiveIcon}
          iconOnly
        />

        <ChipSelect
          id="af-thread"
          icon={FILTER_ICONS.thread}
          options={threadOptions}
          currentValue={currentUrl}
          clearUrl={threadClearUrl}
          activeLabel={threadActiveLabel}
          activeIcon={threadActiveIcon}
          iconOnly
        />

        <ChipMediaSelect
          id="af-media"
          icon={FILTER_ICONS.media}
          filters={filters}
          ctx={ctx}
          activeLabel={mediaActiveLabel}
          clearUrl={mediaClearUrl}
          basePath={basePath}
        />

        <ChipSelect
          id="af-visibility"
          icon={FILTER_ICONS.visibility}
          options={visibilityOptions}
          currentValue={currentUrl}
          clearUrl={allVisibilityUrl}
          activeLabel={
            selection.visibility
              ? getVisibilityLabel(selection.visibility)
              : undefined
          }
          activeIcon={
            selection.visibility && selection.visibility !== "featured"
              ? VISIBILITY_ICONS[selection.visibility]
              : undefined
          }
          activeIconHtml={
            selection.visibility === "featured"
              ? FEATURED_VISIBILITY_ICON_HTML
              : undefined
          }
          iconOnly
        />
      </div>

      <div class="archive-toolbar-toggles">
        <SortToggle filters={filters} ctx={ctx} basePath={basePath} />
        <LayoutToggle
          filters={filters}
          ctx={ctx}
          defaultLayout={defaultLayout}
          basePath={basePath}
        />
      </div>
    </div>
  );
};

// =============================================================================
// Archive Tile (Grid View)
// =============================================================================

/**
 * Determine tile variant based on post content and media.
 */
function getTileVariant(post: PostView): "text" | "image" | "mixed" | "quote" {
  const firstMedia = post.media[0];
  const firstKind = firstMedia ? toMediaKind(firstMedia.mimeType) : undefined;
  const hasImage = post.media.some((m) => m.mimeType.startsWith("image/"));

  const hasVisualBg =
    firstKind === "video" && firstMedia
      ? !!(firstMedia.posterUrl || firstMedia.thumbnailUrl)
      : hasImage;

  if (post.format === "quote") {
    return hasVisualBg ? "mixed" : "quote";
  }
  if (hasVisualBg && (post.title || post.summary || post.excerpt)) {
    return "mixed";
  }
  if (hasVisualBg) return "image";
  return "text";
}

/**
 * Resolve the background image URL for a tile.
 */
function getTileBgImage(
  post: PostView,
): { url: string; alt: string } | undefined {
  const firstMedia = post.media[0];
  if (firstMedia) {
    const firstKind = toMediaKind(firstMedia.mimeType);
    if (firstKind === "video") {
      const src = firstMedia.posterUrl ?? firstMedia.thumbnailUrl;
      if (src) return { url: src, alt: firstMedia.altText ?? "" };
    }
  }
  const firstImage = post.media.find((m) => m.mimeType.startsWith("image/"));
  if (firstImage)
    return { url: firstImage.thumbnailUrl, alt: firstImage.altText ?? "" };
  return undefined;
}

/**
 * Resolve a media-kind badge icon for the tile corner.
 */
function getTileBadge(
  post: PostView,
): { icon: string; position: "center" | "corner" } | undefined {
  const firstMedia = post.media[0];
  if (!firstMedia) return undefined;
  const kind = toMediaKind(firstMedia.mimeType);

  if (kind === "video") return { icon: "play", position: "center" };
  if (kind === "audio")
    return { icon: MEDIA_KIND_ICONS.audio, position: "corner" };
  if (kind === "text")
    return { icon: MEDIA_KIND_ICONS.text, position: "corner" };
  if (kind === "document")
    return { icon: MEDIA_KIND_ICONS.document, position: "corner" };
  return undefined;
}

function getTileText(post: PostView): { title?: string; summary: string } {
  const fallbackSummary = post.summary?.trim() || post.excerpt?.trim() || "";

  if (post.format === "quote" && post.quoteText)
    return { title: post.title || undefined, summary: post.quoteText };
  // When a post has a title, the title is already the primary text; showing
  // the URL beneath it is pure duplication (the domain is already visible
  // via the link-card chrome). Skip the URL fallback here.
  if (post.title) return { title: post.title, summary: fallbackSummary };
  if (fallbackSummary) return { summary: fallbackSummary };
  if (post.url) return { summary: post.url };
  return { summary: getFormatLabel(post.format) };
}

function getArchiveDateParts(
  isoDate: string,
  timeZone = "UTC",
): { shortDate: string } {
  const date = new Date(isoDate);

  return {
    shortDate: date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone,
    }),
  };
}

const ArchiveMonthHeader: FC<{
  label: string;
  count?: number;
  class: string;
}> = ({ label, count, class: cls }) => {
  const { i18n } = useLingui();
  const countUnit =
    count === undefined
      ? null
      : count === 1
        ? i18n._(
            msg({
              message: "thread",
              comment:
                "@context: Archive month header count unit for a single thread",
            }),
          )
        : i18n._(
            msg({
              message: "threads",
              comment:
                "@context: Archive month header count unit for multiple threads",
            }),
          );

  return (
    <div class={cls}>
      <span class="archive-month-header-copy">
        <span class="archive-month-header-label">{label}</span>
        {count !== undefined && countUnit && (
          <span class="archive-month-header-count">
            <span class="archive-month-header-count-number">{count}</span>{" "}
            {countUnit}
          </span>
        )}
      </span>
    </div>
  );
};

const ArchiveTile: FC<{ post: PostView; timeZone?: string }> = ({
  post,
  timeZone = "UTC",
}) => {
  const { i18n } = useLingui();
  const variant = getTileVariant(post);
  const bgImage = getTileBgImage(post);
  const badge = getTileBadge(post);
  const { title, summary } = getTileText(post);
  const { shortDate } = getArchiveDateParts(post.publishedAt, timeZone);
  const publishedLabel = i18n._(
    msg({
      message: "Published on {date} at {time}",
      comment:
        "@context: Tooltip text for the archive tile published timestamp",
    }),
    {
      date: post.publishedAtFormatted,
      time: post.publishedAtTime,
    },
  );
  const replyCount = post.replyCount ?? 0;
  const replyCountUnit =
    replyCount === 1
      ? i18n._(
          msg({
            message: "Reply",
            comment: "@context: Archive tile label for a single thread reply",
          }),
        )
      : i18n._(
          msg({
            message: "Replies",
            comment: "@context: Archive tile label for multiple thread replies",
          }),
        );
  const replyCountLabel = `${replyCount} ${replyCountUnit}`;
  const hasBg = variant === "image" || variant === "mixed";
  const showBgTitle = hasBg && !!title;
  const showTitledSummary =
    !hasBg &&
    !!title &&
    !!summary &&
    (post.format === "note" ||
      post.format === "link" ||
      post.format === "quote");
  const showSummary =
    !!summary && ((hasBg && !title) || (!title && !hasBg) || showTitledSummary);
  const cornerBadge = badge?.position === "corner" ? badge : undefined;
  const hasCopy = !!title || showSummary;
  const hasContent = hasCopy || !!cornerBadge;

  return (
    <a
      href={post.permalink}
      target="_blank"
      rel="noopener noreferrer"
      class={`archive-tile archive-tile-${variant}`}
      data-post
      data-format={post.format}
    >
      <div class="archive-tile-top-meta">
        <time
          class="archive-tile-date"
          datetime={post.publishedAt}
          title={publishedLabel}
          aria-label={post.publishedAtFormatted}
        >
          {shortDate}
        </time>
        {replyCount > 0 && (
          <span class="archive-tile-reply-inline" aria-label={replyCountLabel}>
            {replyCountLabel}
          </span>
        )}
      </div>

      {bgImage && hasBg && (
        <img
          class="archive-tile-bg"
          src={bgImage.url}
          alt={bgImage.alt}
          loading="lazy"
        />
      )}

      {hasContent && (
        <div class="archive-tile-content">
          {variant === "quote" && (
            <DecorativeQuoteMark
              class="archive-tile-quote-mark"
              direction="close"
            />
          )}
          {hasCopy && (
            <div class="archive-tile-copy">
              {post.format === "quote" ? (
                <>
                  {showSummary && (
                    <span class="archive-tile-summary">{summary}</span>
                  )}
                  {title && (
                    <span class="archive-tile-quote-source">{title}</span>
                  )}
                </>
              ) : (
                <>
                  {title && (
                    <span class="archive-tile-title">
                      {post.format === "link" && (
                        <span
                          class="archive-tile-link-indicator"
                          dangerouslySetInnerHTML={{
                            __html: getIconSvg("external-link") ?? "",
                          }}
                        />
                      )}
                      {title}
                    </span>
                  )}
                  {showSummary && !showBgTitle && (
                    <span class="archive-tile-summary">{summary}</span>
                  )}
                </>
              )}
            </div>
          )}
          {cornerBadge && (
            <span
              class="archive-tile-badge-row"
              dangerouslySetInnerHTML={{
                __html: getIconSvg(cornerBadge.icon) ?? "",
              }}
            />
          )}
        </div>
      )}

      {badge?.position === "center" && (
        <span class="archive-tile-badge archive-tile-badge-center">
          <span
            dangerouslySetInnerHTML={{ __html: getIconSvg(badge.icon) ?? "" }}
          />
        </span>
      )}
    </a>
  );
};

// =============================================================================
// Main Component
// =============================================================================

export const ArchivePage: FC<ArchivePageProps> = ({
  groups,
  items,
  defaultLayout = "list",
  totalCount,
  baselineCount,
  currentPage,
  totalPages,
  filters,
  availableYears,
  availableCollections,
  isAuthenticated,
  basePath = "",
  timeZone = "UTC",
  feedHref,
}) => {
  const { i18n } = useLingui();
  const currentLayout: ArchiveLayout = filters.layout ?? defaultLayout;
  const sortsByActivity = filters.sort === "updated";
  const dimensionCtx: DimensionContext = {
    collections: buildCollectionVocabulary(availableCollections),
  };
  const paginationBaseUrl = buildFilterUrl(filters, {}, dimensionCtx, basePath);
  const totalCountUnit =
    totalCount === 1
      ? i18n._(
          msg({
            message: "thread",
            comment:
              "@context: Archive page summary unit for a single matching thread",
          }),
        )
      : i18n._(
          msg({
            message: "threads",
            comment:
              "@context: Archive page summary unit for multiple matching threads",
          }),
        );

  // A reader who arrives on a pre-filtered URL never applied the filter and has
  // no way to know how much it removed. Naming the seven dimensions back at
  // them is what the chip bar already does; what it cannot say is how much is
  // left, so the count carries its own baseline instead.
  const showsSubset =
    hasActiveArchiveFilter(filters.selection) &&
    baselineCount !== undefined &&
    baselineCount > totalCount;

  const countRemainder = showsSubset
    ? i18n._(
        msg({
          message: "of {total} {unit}",
          comment:
            "@context: Archive page count when a filter narrows the view, following the matching count — reads as '42 of 1,240 threads'",
        }),
        { total: baselineCount, unit: totalCountUnit },
      )
    : totalCountUnit;

  const countSummary = `${totalCount} ${countRemainder}`;

  return (
    <div class="py-6" data-page="archive">
      <header class="archive-page-header page-intro">
        <div class="page-intro-title-row">
          <h1 class="page-intro-title">{i18n._(ARCHIVE_ALL_POSTS_LABEL)}</h1>
        </div>
        <p class="page-intro-meta archive-page-meta" aria-label={countSummary}>
          <span class="archive-page-summary-count">{totalCount}</span>{" "}
          {countRemainder}
          {sortsByActivity && (
            <>
              {" · "}
              {i18n._(
                msg({
                  message: "newest changes first",
                  comment:
                    "@context: Archive page meta note explaining the active sort order",
                }),
              )}
            </>
          )}
          {feedHref && (
            <>
              {" "}
              <a
                href={toPublicPath(feedHref, basePath)}
                class="feed-link"
                title={i18n._(
                  msg({
                    message: "RSS feed for this view",
                    comment:
                      "@context: Tooltip for the RSS feed button on the archive page",
                  }),
                )}
                rel="noopener noreferrer"
              >
                <span
                  dangerouslySetInnerHTML={{
                    __html: getIconSvg("rss") ?? "",
                  }}
                />
              </a>
            </>
          )}
        </p>

        <FilterBar
          filters={filters}
          defaultLayout={defaultLayout}
          availableYears={availableYears}
          availableCollections={availableCollections}
          isAuthenticated={isAuthenticated}
          basePath={basePath}
        />
      </header>

      <main>
        {groups.length === 0 && (!items || items.length === 0) ? (
          <p class="text-muted-foreground py-8 text-center">
            {i18n._(
              msg({
                message:
                  "No threads match these filters. Try adjusting your selection or clear all filters.",
                comment: "@context: Archive empty state with filters applied",
              }),
            )}
          </p>
        ) : currentLayout === "grid" ? (
          <div class="archive-grid-wrapper">
            <div class="archive-grid">
              {groups.map((group, groupIndex) => (
                <div key={`grid-${group.year}-${group.month}`} class="contents">
                  <ArchiveMonthHeader
                    class={`archive-month-header${groupIndex > 0 ? " archive-month-header-spaced" : ""}`}
                    // Not translated, on purpose: `group.label` is built with
                    // a hardcoded en-US month name, so a translated wrapper
                    // would only produce "更新于 August 2026". Both halves
                    // become translatable together, or neither does.
                    label={
                      sortsByActivity ? `Updated ${group.label}` : group.label
                    }
                    count={group.totalCount}
                  />
                  {group.posts.map((post) => (
                    <ArchiveTile
                      key={post.id}
                      post={post}
                      timeZone={timeZone}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div data-feed>
            <div class="archive-list-items">
              {(items ?? []).map((item, itemIndex) => (
                <TimelineFeedItem
                  key={item.post.id}
                  item={item}
                  showDivider={itemIndex > 0}
                />
              ))}
            </div>
          </div>
        )}
      </main>

      <PagePagination
        baseUrl={paginationBaseUrl}
        currentPage={currentPage}
        totalPages={totalPages}
      />
    </div>
  );
};
