/**
 * Condition controls for the smart collection dialog.
 *
 * Each control renders one dimension and produces a string in that dimension's
 * **URL spelling** — the same one a query string carries. That is the whole
 * trick: the dialog never encodes a value itself, so it cannot invent a second
 * vocabulary beside the registry's, and adding a dimension that reuses an
 * existing control shape adds nothing here at all.
 *
 * There is no "unset" option in any control. A row exists or it does not, and
 * that is already how "unset" is said; a second way to say it would be two
 * switches for one state.
 */

import { html, type TemplateResult } from "lit";
import {
  FILTER_DIMENSION_KEYS,
  FILTER_DIMENSIONS,
  parsePostFilterSelection,
  serializePostFilterSelection,
  type PostFilterSelection,
} from "../../lib/filter-dimensions.js";
import { FORMATS, MEDIA_KINDS } from "../../types/constants.js";
import type {
  SmartCollectionDialogLabels,
  SmartConditionRow,
} from "./smart-collection-dialog-types.js";

export type DimensionKey = (typeof FILTER_DIMENSION_KEYS)[number];

type Emit = (value: string) => void;

interface DimensionControl {
  /** The value a freshly added row starts on. */
  defaultValue: string;
  render(
    value: string,
    emit: Emit,
    labels: SmartCollectionDialogLabels,
  ): TemplateResult;
}

/** A plain `<select>` over a fixed list of URL values. */
function selectControl(
  dimension: DimensionKey,
  values: readonly string[],
): DimensionControl["render"] {
  return (value, emit, labels) => html`
    <select
      class="select smart-condition-select"
      .value=${value}
      @change=${(event: Event) =>
        emit((event.target as HTMLSelectElement).value)}
    >
      ${values.map(
        (option) => html`
          <option value=${option} ?selected=${option === value}>
            ${labels.values[`${dimension}.${option}`] ?? option}
          </option>
        `,
      )}
    </select>
  `;
}

/** `any` / `none`, the two states a presence dimension has. */
function presenceControl(dimension: DimensionKey): DimensionControl["render"] {
  return selectControl(dimension, ["any", "none"]);
}

/**
 * The media control, over the one folded vocabulary.
 *
 * `any`, `none`, or a set of kinds — one value, because a presence flag beside
 * a kind list would allow "no media, of kinds image and video", which means
 * nothing. Ticking a kind while `any` or `none` is selected replaces it.
 */
const mediaControl: DimensionControl["render"] = (value, emit, labels) => {
  const kinds = value === "any" || value === "none" ? [] : value.split(",");

  const toggleKind = (kind: string, checked: boolean) => {
    const next = checked
      ? [...kinds, kind]
      : kinds.filter((entry) => entry !== kind);
    // An empty set is not a third meaning — it falls back to "has media".
    emit(next.length > 0 ? next.join(",") : "any");
  };

  return html`
    <div class="smart-condition-media">
      <select
        class="select smart-condition-select"
        .value=${value === "none" ? "none" : "any"}
        @change=${(event: Event) =>
          emit((event.target as HTMLSelectElement).value)}
      >
        <option value="any" ?selected=${value !== "none"}>
          ${labels.values["media.any"] ?? "any"}
        </option>
        <option value="none" ?selected=${value === "none"}>
          ${labels.values["media.none"] ?? "none"}
        </option>
      </select>
      ${value === "none"
        ? null
        : html`
            <div class="smart-condition-media-kinds">
              ${MEDIA_KINDS.map(
                (kind) => html`
                  <label class="smart-condition-kind">
                    <input
                      class="input"
                      type="checkbox"
                      .checked=${kinds.includes(kind)}
                      @change=${(event: Event) =>
                        toggleKind(
                          kind,
                          (event.target as HTMLInputElement).checked,
                        )}
                    />
                    <span>${labels.values[`media.${kind}`] ?? kind}</span>
                  </label>
                `,
              )}
            </div>
          `}
    </div>
  `;
};

/** A year, typed. Bounded below by the first year a Unix timestamp can name. */
const yearControl: DimensionControl["render"] = (value, emit) => html`
  <input
    class="input smart-condition-year"
    type="number"
    min="1971"
    step="1"
    .value=${value}
    @input=${(event: Event) => emit((event.target as HTMLInputElement).value)}
  />
`;

/**
 * A collection, chosen from the ones this site has.
 *
 * The options are filled in by the dialog host, which knows the site's
 * collections; the control only spells the chosen slug.
 */
const collectionControl: DimensionControl["render"] = (value, emit, labels) => {
  const options = Object.entries(labels.values)
    .filter(([key]) => key.startsWith("collection."))
    .map(([key, label]) => [key.slice("collection.".length), label] as const);

  return html`
    <select
      class="select smart-condition-select"
      .value=${value}
      @change=${(event: Event) =>
        emit((event.target as HTMLSelectElement).value)}
    >
      ${options.map(
        ([slug, label]) => html`
          <option value=${slug} ?selected=${slug === value}>${label}</option>
        `,
      )}
    </select>
  `;
};

/** One control per dimension. Adding a dimension that reuses a shape adds none. */
export const DIMENSION_CONTROLS: Record<DimensionKey, DimensionControl> = {
  collection: { defaultValue: "", render: collectionControl },
  format: {
    defaultValue: FORMATS[0],
    render: selectControl("format", FORMATS),
  },
  title: { defaultValue: "any", render: presenceControl("title") },
  year: {
    defaultValue: String(new Date().getUTCFullYear()),
    render: yearControl,
  },
  media: { defaultValue: "any", render: mediaControl },
  replies: { defaultValue: "any", render: presenceControl("replies") },
  visibility: {
    defaultValue: "public",
    // `private` is absent on purpose: a smart collection is a published page,
    // so it can never name the one set only its author can see.
    render: selectControl("visibility", ["public", "featured", "hidden"]),
  },
};

/** The empty selection — no conditions, which means every post. */
export function emptySelection(): PostFilterSelection {
  return {};
}

/**
 * Read a stored selection into condition rows.
 *
 * Goes through the registry's serializer so every row holds the same URL
 * spelling the controls produce.
 *
 * @param selection - A stored selection, as the API returns it
 * @returns One row per set dimension, in registry order
 * @example
 * selectionToRows({ format: "quote" }); // [{ key: "format", value: "quote" }]
 */
export function selectionToRows(
  selection: Record<string, unknown>,
): SmartConditionRow[] {
  const params = serializePostFilterSelection(
    selection as PostFilterSelection,
    { collections: collectionVocabulary() },
  );

  const rows: SmartConditionRow[] = [];
  for (const key of FILTER_DIMENSION_KEYS) {
    const value = params.get(FILTER_DIMENSIONS[key].url.param);
    if (value !== null) rows.push({ key, value });
  }
  return rows;
}

/**
 * Turn condition rows back into a selection the API accepts.
 *
 * Runs the rows through the registry's own parser rather than mapping them by
 * hand — the values are already in the URL spelling, so this is exactly the
 * read the archive performs.
 *
 * @param rows - The dialog's condition rows
 * @returns The selection, with any unreadable row dropped
 * @example
 * rowsToSelection([{ key: "format", value: "quote" }]); // { format: "quote" }
 */
export function rowsToSelection(
  rows: readonly SmartConditionRow[],
): PostFilterSelection {
  const params = new URLSearchParams();
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

/**
 * The site's collections, as slug↔id lookups.
 *
 * Filled in by the dialog host before the dialog opens. Kept module-level
 * because both conversions above need it and neither is called from a place
 * that has it to hand.
 */
let vocabulary = {
  idBySlug: new Map<string, string>(),
  slugById: new Map<string, string>(),
  titleById: new Map<string, string>(),
};

export function setCollectionVocabulary(
  collections: readonly { id: string; slug: string; title: string }[],
): void {
  const idBySlug = new Map<string, string>();
  const slugById = new Map<string, string>();
  const titleById = new Map<string, string>();
  for (const collection of collections) {
    idBySlug.set(collection.slug, collection.id);
    slugById.set(collection.id, collection.slug);
    titleById.set(collection.id, collection.title);
  }
  vocabulary = { idBySlug, slugById, titleById };
}

/** The current lookups. Exported so the upgrade check can resolve a slug. */
export function collectionVocabulary() {
  return vocabulary;
}
