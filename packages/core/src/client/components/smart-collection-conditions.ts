/**
 * Condition controls and model conversions for the smart collection dialog.
 *
 * Each control renders one dimension as tactile pills or a compact segmented
 * switch and emits a string in that dimension's **URL spelling** — the same
 * one a query string carries. The dialog never invents a second encoding
 * beside `lib/filter-dimensions.ts`.
 *
 * There is no "unset" state inside a row: a row exists with at least one
 * selected value, or the row is removed.
 */

import { html, nothing, type TemplateResult } from "lit";
import {
  EARLIEST_FILTERABLE_YEAR,
  FORMATS,
  LATEST_FILTERABLE_YEAR,
  MEDIA_KINDS,
} from "../../types/constants.js";
import {
  FILTER_DIMENSION_KEYS,
  FILTER_DIMENSIONS,
  FILTER_MATCH_PARAM,
  parsePostFilterSelection,
  serializePostFilterSelection,
  type FilterMatchMode,
  type PostFilterSelection,
} from "../../lib/filter-dimensions.js";
import type {
  SmartCollectionDialogLabels,
  SmartConditionRow,
  SmartConditionsModel,
} from "./smart-collection-dialog-types.js";

export type DimensionKey = (typeof FILTER_DIMENSION_KEYS)[number];

/** Order in which unused dimensions appear in the quick-add bar. */
export const QUICK_ADD_DIMENSION_ORDER: readonly DimensionKey[] = [
  "format",
  "collection",
  "year",
  "media",
  "visibility",
  "title",
  "replies",
];

/** Threshold past which collections switch from inline pills to a searchable popover. */
const INLINE_COLLECTION_LIMIT = 6;

const CHECK_ICON = html`<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2.25"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d="M20 6 9 17l-5-5" />
</svg>`;

const MINI_X_ICON = html`<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2.25"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d="M18 6 6 18" />
  <path d="m6 6 12 12" />
</svg>`;

export type Emit = (value: string) => void;

export interface ConditionRenderContext {
  labels: SmartCollectionDialogLabels;
  availableYears: readonly number[];
  yearInputOpen: boolean;
  onToggleYearInput: (open: boolean) => void;
  collectionMenuOpen: boolean;
  collectionFilter: string;
  onToggleCollectionMenu: (open: boolean) => void;
  onCollectionFilterInput: (query: string) => void;
}

interface DimensionControlSpec {
  defaultValue(ctx?: { availableYears?: readonly number[] }): string;
  render(
    value: string,
    emit: Emit,
    ctx: ConditionRenderContext,
  ): TemplateResult;
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Multi-select toggle pills over a fixed list of URL values.
 * Keeps at least one option selected while the row exists.
 */
function multiPillControl(
  dimension: DimensionKey,
  options: readonly string[],
): DimensionControlSpec["render"] {
  return (value, emit, { labels }) => {
    const selected = splitCsv(value);
    const selectedSet = new Set(selected);

    const toggle = (option: string) => {
      const next = new Set(selectedSet);
      if (next.has(option)) {
        if (next.size <= 1) return;
        next.delete(option);
      } else {
        next.add(option);
      }
      emit(options.filter((item) => next.has(item)).join(","));
    };

    return html`
      <div class="smart-condition-pills">
        ${options.map((option) => {
          const active = selectedSet.has(option);
          return html`
            <button
              type="button"
              class="smart-condition-pill"
              data-option=${option}
              aria-pressed=${String(active)}
              @click=${() => toggle(option)}
            >
              ${labels.values[`${dimension}.${option}`] ?? option}
            </button>
          `;
        })}
      </div>
    `;
  };
}

/** 2-way segmented switch for presence dimensions (`any` | `none`). */
function segmentedPresenceControl(
  dimension: DimensionKey,
): DimensionControlSpec["render"] {
  const options = ["any", "none"] as const;
  return (value, emit, { labels }) => html`
    <div class="smart-condition-seg" role="group">
      ${options.map((option) => {
        const active = value === option;
        return html`
          <button
            type="button"
            class="smart-condition-seg-btn"
            data-option=${option}
            aria-pressed=${String(active)}
            @click=${() => {
              if (!active) emit(option);
            }}
          >
            ${labels.values[`${dimension}.${option}`] ?? option}
          </button>
        `;
      })}
    </div>
  `;
}

/**
 * Media control: `[ With media | Without media ]` segmented switch plus
 * explicit `[ All kinds ]` and per-kind toggle pills when `With media` is active.
 */
const mediaControl: DimensionControlSpec["render"] = (
  value,
  emit,
  { labels },
) => {
  const isNone = value === "none";
  const kinds = value === "any" || isNone ? [] : splitCsv(value);
  const allSelected = !isNone && kinds.length === 0;

  const toggleKind = (kind: string) => {
    const next = kinds.includes(kind)
      ? kinds.filter((entry) => entry !== kind)
      : [...kinds, kind];
    const ordered = MEDIA_KINDS.filter((item) => next.includes(item));
    emit(ordered.length > 0 ? ordered.join(",") : "any");
  };

  return html`
    <div class="smart-condition-media">
      <div class="smart-condition-seg" role="group">
        <button
          type="button"
          class="smart-condition-seg-btn"
          data-option="any"
          aria-pressed=${String(!isNone)}
          @click=${() => {
            if (isNone) emit("any");
          }}
        >
          ${labels.values["media.any"] ?? "With media"}
        </button>
        <button
          type="button"
          class="smart-condition-seg-btn"
          data-option="none"
          aria-pressed=${String(isNone)}
          @click=${() => {
            if (!isNone) emit("none");
          }}
        >
          ${labels.values["media.none"] ?? "Without media"}
        </button>
      </div>
      ${
        isNone
          ? nothing
          : html`
              <div class="smart-condition-pills">
                <button
                  type="button"
                  class="smart-condition-pill"
                  data-option="all-kinds"
                  aria-pressed=${String(allSelected)}
                  @click=${() => emit("any")}
                >
                  ${labels.mediaAllKinds}
                </button>
                ${MEDIA_KINDS.map((kind) => {
                  const active = kinds.includes(kind);
                  return html`
                    <button
                      type="button"
                      class="smart-condition-pill"
                      data-option=${kind}
                      aria-pressed=${String(active)}
                      @click=${() => toggleKind(kind)}
                    >
                      ${labels.values[`media.${kind}`] ?? kind}
                    </button>
                  `;
                })}
              </div>
            `
      }
    </div>
  `;
};

function parseValidYearInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  if (
    !Number.isInteger(parsed) ||
    parsed < EARLIEST_FILTERABLE_YEAR ||
    parsed > LATEST_FILTERABLE_YEAR
  ) {
    return null;
  }
  return parsed;
}

/**
 * Year control: multi-select pills seeded from the site's published years (and
 * current year), plus an inline `+ Year` numeric input for arbitrary years.
 */
const yearControl: DimensionControlSpec["render"] = (value, emit, ctx) => {
  const { labels, availableYears, yearInputOpen, onToggleYearInput } = ctx;
  const selectedYears = splitCsv(value)
    .map((part) => parseValidYearInput(part))
    .filter((yr): yr is number => yr !== null);
  const selectedSet = new Set(selectedYears);
  const currentYear = new Date().getUTCFullYear();
  const baseYears = availableYears.length > 0 ? availableYears : [currentYear];
  const candidateYears = [
    ...new Set([...baseYears, currentYear, ...selectedYears]),
  ].sort((a, b) => b - a);

  const emitYears = (years: Iterable<number>) => {
    const sorted = [...new Set(years)].sort((a, b) => b - a);
    if (sorted.length > 0) emit(sorted.map(String).join(","));
  };

  const toggleYear = (yr: number) => {
    const next = new Set(selectedSet);
    if (next.has(yr)) {
      if (next.size <= 1) return;
      next.delete(yr);
    } else {
      next.add(yr);
    }
    emitYears(next);
  };

  const commitInput = (input: HTMLInputElement) => {
    const parsed = parseValidYearInput(input.value);
    if (parsed !== null) {
      emitYears([...selectedSet, parsed]);
    }
    onToggleYearInput(false);
  };

  return html`
    <div class="smart-condition-pills">
      ${candidateYears.map((yr) => {
        const active = selectedSet.has(yr);
        return html`
          <button
            type="button"
            class="smart-condition-pill smart-condition-pill-num"
            data-option=${String(yr)}
            aria-pressed=${String(active)}
            @click=${() => toggleYear(yr)}
          >
            ${yr}
          </button>
        `;
      })}
      ${
        yearInputOpen
          ? html`
              <input
                class="input smart-condition-year-input"
                type="number"
                data-year-input
                min=${String(EARLIEST_FILTERABLE_YEAR)}
                max=${String(LATEST_FILTERABLE_YEAR)}
                step="1"
                placeholder=${labels.yearPlaceholder}
                @keydown=${(event: KeyboardEvent) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.stopPropagation();
                    commitInput(event.currentTarget as HTMLInputElement);
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    onToggleYearInput(false);
                  }
                }}
                @blur=${(event: Event) =>
                  commitInput(event.currentTarget as HTMLInputElement)}
              />
            `
          : html`
              <button
                type="button"
                class="smart-condition-pill-dashed"
                data-year-add
                @click=${() => onToggleYearInput(true)}
              >
                ${labels.addYear}
              </button>
            `
      }
    </div>
  `;
};

/**
 * Collection control: inline multi-select pills when the site has up to 6
 * collections; selected pills plus a searchable multi-select popover above 6.
 */
const collectionControl: DimensionControlSpec["render"] = (
  value,
  emit,
  ctx,
) => {
  const {
    labels,
    collectionMenuOpen,
    collectionFilter,
    onToggleCollectionMenu,
    onCollectionFilterInput,
  } = ctx;
  const options = listCollectionOptions(labels);
  const selected = splitCsv(value);
  const selectedSet = new Set(selected);

  const toggleSlug = (slug: string) => {
    const next = new Set(selectedSet);
    if (next.has(slug)) {
      if (next.size <= 1) return;
      next.delete(slug);
    } else {
      next.add(slug);
    }
    const ordered = options.map(([s]) => s).filter((s) => next.has(s));
    const extras = [...next].filter((s) => !ordered.includes(s));
    emit([...ordered, ...extras].join(","));
  };

  if (options.length <= INLINE_COLLECTION_LIMIT) {
    return html`
      <div class="smart-condition-pills">
        ${options.map(([slug, label]) => {
          const active = selectedSet.has(slug);
          return html`
            <button
              type="button"
              class="smart-condition-pill"
              data-option=${slug}
              aria-pressed=${String(active)}
              @click=${() => toggleSlug(slug)}
            >
              ${label}
            </button>
          `;
        })}
      </div>
    `;
  }

  const normalizedQuery = collectionFilter.trim().toLowerCase();
  const filtered = normalizedQuery
    ? options.filter(
        ([slug, label]) =>
          label.toLowerCase().includes(normalizedQuery) ||
          slug.toLowerCase().includes(normalizedQuery),
      )
    : options;

  return html`
    <div
      class="smart-condition-collection-picker"
      @click=${(event: Event) => event.stopPropagation()}
    >
      <div class="smart-condition-pills">
        ${selected.map((slug) => {
          const title = labels.values[`collection.${slug}`] ?? slug;
          const canRemove = selected.length > 1;
          return html`
            <span class="smart-condition-selected-tag" data-selected=${slug}>
              <span>${title}</span>
              ${
                canRemove
                  ? html`
                      <button
                        type="button"
                        class="smart-condition-selected-tag-remove"
                        aria-label=${title}
                        @click=${() => toggleSlug(slug)}
                      >
                        ${MINI_X_ICON}
                      </button>
                    `
                  : nothing
              }
            </span>
          `;
        })}
        <button
          type="button"
          class="smart-condition-pill-dashed"
          data-collection-trigger
          aria-expanded=${String(collectionMenuOpen)}
          @click=${() => onToggleCollectionMenu(!collectionMenuOpen)}
        >
          ${labels.chooseCollection}
        </button>
      </div>
      ${
        collectionMenuOpen
          ? html`
              <div class="smart-condition-popover" data-collection-popover>
                <input
                  type="text"
                  class="input smart-condition-popover-search"
                  data-collection-search
                  placeholder=${labels.filterCollectionsPlaceholder}
                  .value=${collectionFilter}
                  @input=${(event: Event) =>
                    onCollectionFilterInput(
                      (event.target as HTMLInputElement).value,
                    )}
                  @keydown=${(event: KeyboardEvent) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.stopPropagation();
                      if (filtered[0]) toggleSlug(filtered[0][0]);
                    }
                  }}
                />
                <div class="smart-condition-popover-list" role="listbox">
                  ${
                    filtered.length === 0
                      ? html`<p class="smart-condition-popover-empty">
                          ${labels.noMatchingCollections}
                        </p>`
                      : filtered.map(([slug, label]) => {
                          const active = selectedSet.has(slug);
                          return html`
                            <button
                              type="button"
                              class="smart-condition-popover-item"
                              role="option"
                              data-option=${slug}
                              aria-selected=${String(active)}
                              @click=${() => toggleSlug(slug)}
                            >
                              <span class="smart-condition-popover-check">
                                ${active ? CHECK_ICON : nothing}
                              </span>
                              <span class="smart-condition-popover-label"
                                >${label}</span
                              >
                            </button>
                          `;
                        })
                  }
                </div>
              </div>
            `
          : nothing
      }
    </div>
  `;
};

export function listCollectionOptions(
  labels: SmartCollectionDialogLabels,
): ReadonlyArray<readonly [string, string]> {
  if (orderedCollectionSlugs.length > 0) {
    return orderedCollectionSlugs.map(
      (slug) =>
        [
          slug,
          labels.values[`collection.${slug}`] ??
            vocabulary.titleById.get(vocabulary.idBySlug.get(slug) ?? "") ??
            slug,
        ] as const,
    );
  }
  return Object.entries(labels.values ?? {})
    .filter(([key]) => key.startsWith("collection."))
    .map(([key, label]) => [key.slice("collection.".length), label] as const);
}

/** One control per dimension. */
export const DIMENSION_CONTROLS: Record<DimensionKey, DimensionControlSpec> = {
  collection: {
    defaultValue: () => orderedCollectionSlugs[0] ?? "",
    render: collectionControl,
  },
  format: {
    defaultValue: () => FORMATS[0],
    render: multiPillControl("format", FORMATS),
  },
  title: {
    defaultValue: () => "any",
    render: segmentedPresenceControl("title"),
  },
  year: {
    defaultValue: (ctx) =>
      String(ctx?.availableYears?.[0] ?? new Date().getUTCFullYear()),
    render: yearControl,
  },
  media: {
    defaultValue: () => "any",
    render: mediaControl,
  },
  replies: {
    defaultValue: () => "any",
    render: segmentedPresenceControl("replies"),
  },
  visibility: {
    defaultValue: () => "public",
    // `private` and `unlisted` are absent on purpose: a smart collection is a
    // published page, so it can never name a set only its author can list.
    render: multiPillControl("visibility", ["public", "featured", "hidden"]),
  },
};

/** The empty selection — no conditions, which means every post. */
export function emptySelection(): PostFilterSelection {
  return {};
}

/**
 * Read a stored selection into `{ match, rows }`.
 *
 * Goes through the registry's serializer so every row holds the same URL
 * spelling the controls produce.
 */
export function selectionToModel(
  selection: Record<string, unknown>,
): SmartConditionsModel {
  const params = serializePostFilterSelection(
    selection as PostFilterSelection,
    { collections: collectionVocabulary() },
  );

  const match: FilterMatchMode =
    params.get(FILTER_MATCH_PARAM) === "any" ? "any" : "all";
  const rows: SmartConditionRow[] = [];
  for (const key of FILTER_DIMENSION_KEYS) {
    const value = params.get(FILTER_DIMENSIONS[key].url.param);
    if (value !== null) rows.push({ key, value });
  }
  return { match, rows };
}

/**
 * Read a stored selection into condition rows.
 *
 * @param selection - A stored selection, as the API returns it
 * @returns One row per set dimension, in registry order
 */
export function selectionToRows(
  selection: Record<string, unknown>,
): SmartConditionRow[] {
  return selectionToModel(selection).rows;
}

/**
 * Turn condition rows and match mode back into a selection the API accepts.
 *
 * @param rows - The dialog's condition rows
 * @param match - How active dimensions combine (`all` | `any`)
 * @returns The selection, with any unreadable row dropped
 */
export function rowsToSelection(
  rows: readonly SmartConditionRow[],
  match: FilterMatchMode = "all",
): PostFilterSelection {
  const params = new URLSearchParams();
  if (match === "any") {
    params.set(FILTER_MATCH_PARAM, "any");
  }
  for (const row of rows) {
    if (!row.value) continue;
    const dimension = FILTER_DIMENSIONS[row.key];
    if (dimension) params.set(dimension.url.param, row.value);
  }

  const { selection } = parsePostFilterSelection(
    (key) => params.get(key) ?? undefined,
    { collections: collectionVocabulary() },
  );
  return selection;
}

let vocabulary = {
  idBySlug: new Map<string, string>(),
  slugById: new Map<string, string>(),
  titleById: new Map<string, string>(),
};
let orderedCollectionSlugs: string[] = [];

export function setCollectionVocabulary(
  collections: readonly { id: string; slug: string; title: string }[],
): void {
  const idBySlug = new Map<string, string>();
  const slugById = new Map<string, string>();
  const titleById = new Map<string, string>();
  const slugs: string[] = [];
  for (const collection of collections) {
    idBySlug.set(collection.slug, collection.id);
    slugById.set(collection.id, collection.slug);
    titleById.set(collection.id, collection.title);
    slugs.push(collection.slug);
  }
  vocabulary = { idBySlug, slugById, titleById };
  orderedCollectionSlugs = slugs;
}

/** The current lookups. Exported so the upgrade check can resolve a slug. */
export function collectionVocabulary() {
  return vocabulary;
}
