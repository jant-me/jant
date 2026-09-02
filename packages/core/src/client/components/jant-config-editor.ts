/**
 * Searchable, inline editor for explicitly approved runtime settings.
 */

import { LitElement, html, nothing } from "lit";
import { getBestFieldSearchRank, normalizeSearch } from "../search-rank.js";
import {
  getJsonString,
  isJsonObject,
  readErrorMessage,
  readJsonObject,
} from "../json.js";

type ConfigEditorValueType = "boolean" | "string" | "number" | "enum";

interface ConfigEditorItem {
  key: string;
  mode: "edit" | "link";
  type: ConfigEditorValueType;
  value: string;
  fallbackValue: string;
  modified: boolean;
  locked: boolean;
  description: string;
  maxLength?: number;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  optionLabels?: Record<string, string>;
  settingsPath?: string;
  display?: "value" | "configured";
  resettable?: boolean;
  fallbackKey?: string;
}

interface ConfigEditorLabels {
  search: string;
  modifiedOnly: string;
  modified: string;
  locked: string;
  reset: string;
  saving: string;
  saved: string;
  saveError: string;
  noMatches: string;
  countTemplate: string;
  openSetting: string;
  configured: string;
  notConfigured: string;
}

type RowStatus =
  | { state: "saving" }
  | { state: "saved" }
  | { state: "error"; message: string };

const DEFAULT_LABELS: ConfigEditorLabels = {
  search: "Search settings",
  modifiedOnly: "Show only modified",
  modified: "Modified",
  locked: "Locked",
  reset: "Reset to default",
  saving: "Saving…",
  saved: "Saved",
  saveError: "This setting wasn't saved. Check the value and try again.",
  noMatches:
    "Nothing matches this search. Try a different name or description.",
  countTemplate: "{count} settings shown",
  openSetting: "Open setting",
  configured: "Configured",
  notConfigured: "Not configured",
};

function parseStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isJsonObject(value)) return undefined;
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") return undefined;
    result[key] = entry;
  }
  return result;
}

function parseItem(value: unknown): ConfigEditorItem | null {
  if (!isJsonObject(value)) return null;
  const key = getJsonString(value, "key");
  const mode = getJsonString(value, "mode");
  const type = getJsonString(value, "type");
  const currentValue = getJsonString(value, "value");
  const fallbackValue = getJsonString(value, "fallbackValue");
  const description = getJsonString(value, "description");
  const settingsPath = getJsonString(value, "settingsPath");
  const display = getJsonString(value, "display");
  const fallbackKey = getJsonString(value, "fallbackKey");

  if (
    !key ||
    (mode !== "edit" && mode !== "link") ||
    (type !== "boolean" &&
      type !== "string" &&
      type !== "number" &&
      type !== "enum") ||
    currentValue === undefined ||
    fallbackValue === undefined ||
    description === undefined ||
    typeof value.modified !== "boolean" ||
    typeof value.locked !== "boolean"
  ) {
    return null;
  }
  if (
    mode === "link" &&
    (!settingsPath || (display !== "value" && display !== "configured"))
  ) {
    return null;
  }

  const options = Array.isArray(value.options)
    ? value.options.filter(
        (option): option is string => typeof option === "string",
      )
    : undefined;
  if (
    mode === "edit" &&
    type === "enum" &&
    (!options || options.length === 0)
  ) {
    return null;
  }
  const optionLabels = parseStringRecord(value.optionLabels);

  return {
    key,
    mode,
    type,
    value: currentValue,
    fallbackValue,
    modified: value.modified,
    locked: value.locked,
    description,
    ...(typeof value.maxLength === "number" && {
      maxLength: value.maxLength,
    }),
    ...(typeof value.min === "number" && { min: value.min }),
    ...(typeof value.max === "number" && { max: value.max }),
    ...(typeof value.step === "number" && { step: value.step }),
    ...(options && { options }),
    ...(optionLabels && { optionLabels }),
    ...(settingsPath && { settingsPath }),
    ...(display === "value" || display === "configured" ? { display } : {}),
    ...(value.resettable === true && { resettable: true }),
    ...(fallbackKey && { fallbackKey }),
  };
}

function parseItems(value: string): ConfigEditorItem[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isJsonObject(parsed) || !Array.isArray(parsed.fields)) return [];
    return parsed.fields
      .map(parseItem)
      .filter((item): item is ConfigEditorItem => item !== null);
  } catch {
    return [];
  }
}

function parseLabels(value: string): ConfigEditorLabels {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isJsonObject(parsed)) return DEFAULT_LABELS;
    const labels = { ...DEFAULT_LABELS };
    for (const key of Object.keys(labels) as Array<keyof ConfigEditorLabels>) {
      const entry = parsed[key];
      if (typeof entry === "string" && entry) labels[key] = entry;
    }
    return labels;
  } catch {
    return DEFAULT_LABELS;
  }
}

export class JantConfigEditor extends LitElement {
  static properties = {
    endpoint: { type: String },
    initialData: { type: String, attribute: "initial-data" },
    labelsJson: { type: String, attribute: "labels" },
    _items: { state: true },
    _labels: { state: true },
    _query: { state: true },
    _modifiedOnly: { state: true },
    _drafts: { state: true },
    _pending: { state: true },
    _statuses: { state: true },
  };

  declare endpoint: string;
  declare initialData: string;
  declare labelsJson: string;
  declare _items: ConfigEditorItem[];
  declare _labels: ConfigEditorLabels;
  declare _query: string;
  declare _modifiedOnly: boolean;
  declare _drafts: Record<string, string>;
  declare _pending: Record<string, boolean>;
  declare _statuses: Record<string, RowStatus | undefined>;

  private readonly _statusTimeouts = new Map<string, number>();

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this.endpoint = "/api/settings";
    this.initialData = "";
    this.labelsJson = "";
    this._items = [];
    this._labels = DEFAULT_LABELS;
    this._query = "";
    this._modifiedOnly = false;
    this._drafts = {};
    this._pending = {};
    this._statuses = {};
  }

  connectedCallback() {
    super.connectedCallback();
    // Keep the server-rendered list useful without JavaScript, then remove it
    // once the interactive light-DOM editor is ready to take over.
    this.querySelector(":scope > .config-editor-fallback")?.remove();
    const initialData = this.getAttribute("initial-data") ?? this.initialData;
    const labels = this.getAttribute("labels") ?? this.labelsJson;
    this._items = parseItems(initialData);
    this._labels = parseLabels(labels);
    this._drafts = Object.fromEntries(
      this._items.map((item) => [item.key, item.value]),
    );
  }

  disconnectedCallback() {
    for (const timeout of this._statusTimeouts.values()) {
      window.clearTimeout(timeout);
    }
    this._statusTimeouts.clear();
    super.disconnectedCallback();
  }

  private _filteredItems(): ConfigEditorItem[] {
    const query = normalizeSearch(this._query);
    return this._items
      .map((item, index) => ({
        item,
        index,
        rank: query
          ? getBestFieldSearchRank(
              [item.key, item.description, item.type, item.value],
              query,
            )
          : 0,
      }))
      .filter(
        (entry) =>
          entry.rank !== null && (!this._modifiedOnly || entry.item.modified),
      )
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || a.index - b.index)
      .map(({ item }) => item);
  }

  private _setDraft(key: string, value: string) {
    this._drafts = { ...this._drafts, [key]: value };
    if (this._statuses[key]) {
      this._setStatus(key, undefined);
    }
  }

  private _setPending(key: string, pending: boolean) {
    this._pending = { ...this._pending, [key]: pending };
  }

  private _setStatus(key: string, status: RowStatus | undefined) {
    const currentTimeout = this._statusTimeouts.get(key);
    if (currentTimeout !== undefined) {
      window.clearTimeout(currentTimeout);
      this._statusTimeouts.delete(key);
    }
    this._statuses = { ...this._statuses, [key]: status };
    if (status?.state === "saved") {
      const timeout = window.setTimeout(() => {
        if (this._statuses[key]?.state === "saved") {
          this._statuses = { ...this._statuses, [key]: undefined };
        }
        this._statusTimeouts.delete(key);
      }, 2000);
      this._statusTimeouts.set(key, timeout);
    }
  }

  private _replaceItem(
    key: string,
    update: (item: ConfigEditorItem) => ConfigEditorItem,
  ) {
    this._items = this._items.map((item) =>
      item.key === key ? update(item) : item,
    );
  }

  private _commitValue(key: string, value: string, modified: boolean) {
    const drafts = { ...this._drafts, [key]: value };
    this._items = this._items.map((item) => {
      if (item.key === key) return { ...item, value, modified };
      if (item.fallbackKey !== key) return item;

      if (item.modified) {
        return { ...item, fallbackValue: value };
      }

      drafts[item.key] = value;
      return { ...item, value, fallbackValue: value };
    });
    this._drafts = drafts;
  }

  private async _save(item: ConfigEditorItem, value: string) {
    if (item.locked || this._pending[item.key]) return;

    const optimistic = item.type === "boolean" || item.type === "enum";
    const previousValue = item.value;
    if (optimistic) {
      this._replaceItem(item.key, (current) => ({ ...current, value }));
    }
    this._setPending(item.key, true);
    this._setStatus(item.key, { state: "saving" });

    try {
      const response = await fetch(this.endpoint, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ [item.key]: value }),
      });
      if (!response.ok) {
        throw new Error(
          await readErrorMessage(response, this._labels.saveError),
        );
      }

      const body = await readJsonObject(response);
      const settings = body.settings;
      const savedValue = getJsonString(settings, item.key) ?? value;
      this._commitValue(item.key, savedValue, true);
      this._setStatus(item.key, { state: "saved" });
    } catch (error) {
      if (optimistic) {
        this._replaceItem(item.key, (current) => ({
          ...current,
          value: previousValue,
        }));
      }
      this._setStatus(item.key, {
        state: "error",
        message:
          error instanceof Error ? error.message : this._labels.saveError,
      });
    } finally {
      this._setPending(item.key, false);
    }
  }

  private async _reset(item: ConfigEditorItem) {
    if (
      !item.modified ||
      item.locked ||
      (item.mode === "link" && !item.resettable) ||
      this._pending[item.key]
    )
      return;

    this._setPending(item.key, true);
    this._setStatus(item.key, { state: "saving" });

    try {
      const response = await fetch(
        `${this.endpoint}/${encodeURIComponent(item.key)}`,
        {
          method: "DELETE",
          headers: { Accept: "application/json" },
        },
      );
      if (!response.ok) {
        throw new Error(
          await readErrorMessage(response, this._labels.saveError),
        );
      }

      const body = await readJsonObject(response);
      const resetSetting = isJsonObject(body.setting)
        ? body.setting
        : undefined;
      const resetValue =
        getJsonString(resetSetting, "value") ??
        getJsonString(body.settings, item.key) ??
        item.fallbackValue;
      this._commitValue(item.key, resetValue, false);
      this._setStatus(item.key, { state: "saved" });
    } catch (error) {
      this._setStatus(item.key, {
        state: "error",
        message:
          error instanceof Error ? error.message : this._labels.saveError,
      });
    } finally {
      this._setPending(item.key, false);
    }
  }

  private _renderStatus(item: ConfigEditorItem) {
    const status = this._statuses[item.key];
    if (!status) return nothing;
    if (status.state === "saving") {
      return html`<span class="config-editor-status" role="status"
        >${this._labels.saving}</span
      >`;
    }
    if (status.state === "saved") {
      return html`<span
        class="config-editor-status config-editor-status-saved"
        role="status"
        >${this._labels.saved}</span
      >`;
    }
    return html`<span
      class="config-editor-status config-editor-status-error"
      role="alert"
      >${status.message}</span
    >`;
  }

  private _renderControl(item: ConfigEditorItem) {
    const id = `config-editor-${item.key.toLowerCase().replaceAll("_", "-")}`;
    const pending = Boolean(this._pending[item.key]);
    const disabled = pending || item.locked;

    if (item.type === "boolean") {
      return html`<input
        id=${id}
        name=${item.key}
        type="checkbox"
        role="switch"
        class="input"
        aria-describedby=${`${id}-description`}
        .checked=${item.value === "true"}
        ?disabled=${disabled}
        @change=${(event: Event) =>
          void this._save(
            item,
            String((event.target as HTMLInputElement).checked),
          )}
      />`;
    }

    if (item.type === "enum") {
      return html`<select
        id=${id}
        name=${item.key}
        class="select config-editor-select"
        aria-describedby=${`${id}-description`}
        .value=${item.value}
        ?disabled=${disabled}
        @change=${(event: Event) =>
          void this._save(item, (event.target as HTMLSelectElement).value)}
      >
        ${(item.options ?? []).map(
          (option) =>
            html`<option value=${option} ?selected=${option === item.value}>
              ${item.optionLabels?.[option] ?? option}
            </option>`,
        )}
      </select>`;
    }

    const draft = this._drafts[item.key] ?? item.value;
    const changed = draft !== item.value;
    return html`<input
      id=${id}
      name=${item.key}
      class="input config-editor-value-input"
      type=${item.type === "number" ? "number" : "text"}
      autocomplete="off"
      spellcheck="false"
      aria-describedby=${`${id}-description`}
      .value=${draft}
      maxlength=${item.maxLength ?? nothing}
      min=${item.min ?? nothing}
      max=${item.max ?? nothing}
      step=${item.step ?? nothing}
      ?disabled=${disabled}
      @input=${(event: Event) =>
        this._setDraft(item.key, (event.target as HTMLInputElement).value)}
      @blur=${(event: Event) => {
        const value = (event.target as HTMLInputElement).value;
        if (value !== item.value) void this._save(item, value);
      }}
      @keydown=${(event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          this._setDraft(item.key, item.value);
        } else if (event.key === "Enter" && !event.isComposing && changed) {
          event.preventDefault();
          void this._save(item, draft);
        }
      }}
    />`;
  }

  private _renderLinkedSetting(item: ConfigEditorItem) {
    const value =
      item.display === "configured"
        ? item.value === "true"
          ? this._labels.configured
          : this._labels.notConfigured
        : item.value;

    return html`
      <a
        class="config-editor-open-control"
        href=${item.settingsPath ?? "/settings"}
        aria-describedby=${`config-editor-${item.key.toLowerCase().replaceAll("_", "-")}-description`}
      >
        <span class="config-editor-linked-value" translate="no">${value}</span>
        <span class="config-editor-open-action">
          ${this._labels.openSetting}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M5 12h14" />
            <path d="m13 6 6 6-6 6" />
          </svg>
        </span>
      </a>
    `;
  }

  private _canReset(item: ConfigEditorItem) {
    return (
      item.modified &&
      !item.locked &&
      (item.mode === "edit" || item.resettable === true)
    );
  }

  private _renderRow(item: ConfigEditorItem) {
    const id = `config-editor-${item.key.toLowerCase().replaceAll("_", "-")}`;
    const controlRowClass = [
      "config-editor-control-row",
      item.mode === "edit" && item.type === "enum"
        ? "config-editor-control-row-select"
        : "",
      item.mode === "edit" && item.type === "number"
        ? "config-editor-control-row-number"
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    return html`
      <li
        class="config-editor-row"
        data-modified=${String(item.modified)}
        aria-busy=${String(Boolean(this._pending[item.key]))}
      >
        <div class="config-editor-copy">
          <div class="config-editor-heading">
            ${
              item.mode === "edit"
                ? html`<label for=${id}
                    ><code class="config-editor-key" translate="no"
                      >${item.key}</code
                    ></label
                  >`
                : html`<code class="config-editor-key" translate="no"
                    >${item.key}</code
                  >`
            }
            ${
              item.modified
                ? html`<span class="config-editor-state config-editor-modified"
                    >${this._labels.modified}</span
                  >`
                : nothing
            }
            ${
              item.locked
                ? html`<span class="config-editor-state config-editor-locked"
                    >${this._labels.locked}</span
                  >`
                : nothing
            }
          </div>
          <p class="config-editor-description" id=${`${id}-description`}>
            ${item.description}
          </p>
        </div>
        <div class="config-editor-value-column">
          <div class=${controlRowClass}>
            ${
              item.mode === "link"
                ? this._renderLinkedSetting(item)
                : this._renderControl(item)
            }
            ${
              this._canReset(item)
                ? html`<button
                    type="button"
                    class="config-editor-reset"
                    aria-label=${this._labels.reset}
                    title=${this._labels.reset}
                    ?disabled=${Boolean(this._pending[item.key])}
                    @click=${() => void this._reset(item)}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                      <path d="M3 3v5h5" />
                    </svg>
                  </button>`
                : nothing
            }
          </div>
          ${this._renderStatus(item)}
        </div>
      </li>
    `;
  }

  render() {
    const items = this._filteredItems();
    const count = this._labels.countTemplate.replace(
      "{count}",
      String(items.length),
    );

    return html`
      <div class="config-editor-toolbar">
        <div class="config-editor-search">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8"></circle>
            <path d="m21 21-4.3-4.3"></path>
          </svg>
          <input
            type="search"
            name="config-search"
            class="input config-editor-search-input"
            autocomplete="off"
            spellcheck="false"
            placeholder=${this._labels.search}
            aria-label=${this._labels.search}
            .value=${this._query}
            @input=${(event: Event) => {
              this._query = (event.target as HTMLInputElement).value;
            }}
            @keydown=${(event: KeyboardEvent) => {
              if (event.key === "Escape" && this._query) {
                event.preventDefault();
                this._query = "";
              }
            }}
          />
        </div>
      </div>
      <div class="config-editor-toolbar-meta">
        <p class="config-editor-count" aria-live="polite">${count}</p>
        <label class="config-editor-modified-filter">
          <input
            type="checkbox"
            name="modified-only"
            class="input"
            .checked=${this._modifiedOnly}
            @change=${(event: Event) => {
              this._modifiedOnly = (event.target as HTMLInputElement).checked;
            }}
          />
          <span>${this._labels.modifiedOnly}</span>
        </label>
      </div>
      ${
        items.length > 0
          ? html`<ul class="config-editor-list">
              ${items.map((item) => this._renderRow(item))}
            </ul>`
          : html`<div class="config-editor-empty" role="status">
              <p>${this._labels.noMatches}</p>
            </div>`
      }
    `;
  }
}

if (!customElements.get("jant-config-editor")) {
  customElements.define("jant-config-editor", JantConfigEditor);
}
