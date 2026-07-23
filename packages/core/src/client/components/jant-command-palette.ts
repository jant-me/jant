/**
 * Command palette for quick navigation, commands, and search.
 *
 * Modes:
 *   - Navigate (default): filter preloaded posts, collections, system pages
 *   - Command (`>` prefix): run actions like New Post
 *   - Search (`?` prefix): redirects to /search?q=... on Enter
 *   - Path (`/` prefix): opens a local path, with search as the second option
 */

import { LitElement, html, nothing } from "lit";
import { classMap } from "lit/directives/class-map.js";
import { unsafeSVG } from "lit/directives/unsafe-svg.js";
import { NAVIGATION_SETTINGS_PATH } from "../../lib/settings-paths.js";
import { openNewCompose } from "../compose-launch.js";
import { publicPath } from "../runtime-paths.js";
import { getBestFieldSearchRank, normalizeSearch } from "../search-rank.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PaletteItem {
  title: string;
  path: string;
  type: "post" | "collection" | "system";
  status?: "draft" | "published";
}

interface CommandItem {
  label: string;
  icon: string;
  action: () => void;
}

interface DisplayItem {
  label: string;
  secondary?: string;
  icon: string;
  /** For search-mode items: the query to execute */
  searchQuery?: string;
  /** For path-mode items: the local path to open */
  pathTarget?: string;
  /** Keep cross-mode actions visible below the scrollable result list. */
  placement?: "results" | "footer";
  shortcut?: string;
}

// ---------------------------------------------------------------------------
// SVG icon paths (reuse existing Lucide-style icons from the codebase)
// ---------------------------------------------------------------------------

const ICON_ATTRS =
  'xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

const ICONS = {
  // notepad-text (post/note)
  post: `<svg ${ICON_ATTRS}><path d="M8 2v4"/><path d="M12 2v4"/><path d="M16 2v4"/><rect width="16" height="18" x="4" y="4" rx="2"/><path d="M8 10h6"/><path d="M8 14h8"/><path d="M8 18h5"/></svg>`,
  // clipboard/collection icon from PostFooter
  collection: `<svg ${ICON_ATTRS} viewBox="0 0 16 16" stroke-width="1.35"><rect x="3" y="5.05" width="10" height="8.15" rx="2.2"/><path d="M5.1 5.05V4.2a1.1 1.1 0 0 1 1.1-1.1h3.6a1.1 1.1 0 0 1 1.1 1.1v.85"/></svg>`,
  // settings gear from SettingsRootContent
  system: `<svg ${ICON_ATTRS}><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
  // zap/lightning for commands
  command: `<svg ${ICON_ATTRS}><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg>`,
  // corner-down-right for local path navigation
  path: `<svg ${ICON_ATTRS}><polyline points="15 10 20 15 15 20"/><path d="M4 4v7a4 4 0 0 0 4 4h12"/></svg>`,
  // search
  search: `<svg ${ICON_ATTRS}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
};

export function getPathCommandTarget(query: string): string {
  const stripped = query.trim().replace(/^[/／]+/, "");
  return stripped ? `/${stripped}` : "/";
}

export function getPathCommandSearchQuery(query: string): string {
  return query
    .trim()
    .replace(/^[/／]+/, "")
    .trim();
}

// ---------------------------------------------------------------------------
// History helpers
// ---------------------------------------------------------------------------

const HISTORY_MAX = 5;

function loadHistory(key: string): string[] {
  try {
    const raw = globalThis.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((s) => typeof s === "string" && s)
      : [];
  } catch {
    return [];
  }
}

function saveHistory(key: string, value: string) {
  const history = loadHistory(key).filter((v) => v !== value);
  history.unshift(value);
  globalThis.localStorage.setItem(
    key,
    JSON.stringify(history.slice(0, HISTORY_MAX)),
  );
}

/** Recently visited items in navigate mode (stored by path) */
const NAV_HISTORY_KEY = "jant:nav-history";
/** Recent search queries in ? mode */
const SEARCH_HISTORY_KEY = "jant:search-history";

// ---------------------------------------------------------------------------
// Static data
// ---------------------------------------------------------------------------

const SYSTEM_PAGES: PaletteItem[] = [
  { title: "Home", path: "/", type: "system" },
  { title: "Featured", path: "/featured", type: "system" },
  { title: "Latest", path: "/latest", type: "system" },
  { title: "Archive", path: "/archive", type: "system" },
  { title: "Collections", path: "/collections", type: "system" },
  { title: "Settings", path: "/settings", type: "system" },
  { title: "General", path: "/settings/general", type: "system" },
  { title: "Navigation", path: NAVIGATION_SETTINGS_PATH, type: "system" },
  {
    title: "Appearance",
    path: "/settings/appearance/color-theme",
    type: "system",
  },
  { title: "Custom URLs", path: "/settings/custom-urls", type: "system" },
  { title: "API Tokens", path: "/settings/api-tokens", type: "system" },
  { title: "Sessions", path: "/settings/sessions", type: "system" },
  { title: "Account", path: "/settings/account", type: "system" },
];

const COMMANDS: CommandItem[] = [
  {
    label: "New Post",
    icon: ICONS.command,
    action: () => void openNewCompose(),
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export class JantCommandPalette extends LitElement {
  static properties = {
    _open: { state: true },
    _query: { state: true },
    _selectedIndex: { state: true },
    _loading: { state: true },
  };

  declare _open: boolean;
  declare _query: string;
  declare _selectedIndex: number;
  declare _loading: boolean;

  #itemsCache: PaletteItem[] | null = null;

  createRenderRoot() {
    this.innerHTML = "";
    return this;
  }

  constructor() {
    super();
    this._open = false;
    this._query = "";
    this._selectedIndex = 0;
    this._loading = false;
  }

  connectedCallback() {
    super.connectedCallback();
    void this.#prefetch();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  async #prefetch() {
    if (this.#itemsCache) return;
    try {
      const res = await fetch("/api/palette");
      if (res.ok) {
        const data = (await res.json()) as { items: PaletteItem[] };
        this.#itemsCache = data.items;
      } else {
        this.#itemsCache = [];
      }
    } catch {
      this.#itemsCache = [];
    }
  }

  async open() {
    if (this._open) return;

    // Ensure data is loaded (normally already prefetched)
    if (!this.#itemsCache) {
      this._loading = true;
      await this.#prefetch();
      this._loading = false;
    }

    this._open = true;
    this._query = "";
    this._selectedIndex = 0;

    await this.updateComplete;

    const dialog = this.querySelector<HTMLDialogElement>(".command-palette");
    if (dialog && !dialog.open) dialog.showModal();

    const input = this.querySelector<HTMLInputElement>(
      ".command-palette-input",
    );
    input?.focus();
  }

  close() {
    const dialog = this.querySelector<HTMLDialogElement>(".command-palette");
    if (dialog?.open) dialog.close();

    this._open = false;
    this._query = "";
    this._selectedIndex = 0;
  }

  // -----------------------------------------------------------------------
  // Mode detection
  // -----------------------------------------------------------------------

  get #mode(): "navigate" | "command" | "search" | "path" {
    // Accept both halfwidth and fullwidth prefixes so CJK
    // users don't have to toggle their IME to enter command/search mode.
    const first = this._query.charAt(0);
    if (first === ">" || first === "＞") return "command";
    if (first === "?" || first === "？") return "search";
    if (first === "/" || first === "／") return "path";
    return "navigate";
  }

  // -----------------------------------------------------------------------
  // Filtered results
  // -----------------------------------------------------------------------

  get #navigateItems(): PaletteItem[] {
    const q = normalizeSearch(this._query);
    const allItems = [...(this.#itemsCache ?? []), ...SYSTEM_PAGES];

    if (!q) {
      // No query — show recent items first, then the rest
      const recent = loadHistory(NAV_HISTORY_KEY);
      if (recent.length === 0) return allItems;
      const recentSet = new Set(recent);
      const recentItems: PaletteItem[] = [];
      const rest: PaletteItem[] = [];
      for (const item of allItems) {
        if (recentSet.has(item.path)) {
          recentItems.push(item);
        } else {
          rest.push(item);
        }
      }
      // Sort recent items by history order (most recent first)
      recentItems.sort(
        (a, b) => recent.indexOf(a.path) - recent.indexOf(b.path),
      );
      return [...recentItems, ...rest];
    }

    return allItems
      .map((item, index) => {
        const rank = getBestFieldSearchRank([item.title, item.path], q);
        return { item, index, rank };
      })
      .filter(
        (entry): entry is { item: PaletteItem; index: number; rank: number } =>
          entry.rank !== null,
      )
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .map((entry) => entry.item);
  }

  get #commandItems(): CommandItem[] {
    const q = normalizeSearch(this._query.slice(1));
    return COMMANDS.filter((c) => !q || c.label.toLowerCase().includes(q));
  }

  get #displayItems(): DisplayItem[] {
    const mode = this.#mode;

    if (mode === "command") {
      return this.#commandItems.map((c) => ({
        label: c.label,
        icon: c.icon,
      }));
    }

    if (mode === "search") {
      const q = this._query.slice(1).trim();
      if (!q) {
        // Show recent searches
        return loadHistory(SEARCH_HISTORY_KEY).map((h) => ({
          label: h,
          icon: ICONS.search,
          searchQuery: h,
        }));
      }
      return [
        {
          label: `Search for "${q}"`,
          icon: ICONS.search,
          searchQuery: q,
        },
      ];
    }

    if (mode === "path") {
      const target = getPathCommandTarget(this._query);
      const searchQuery = getPathCommandSearchQuery(this._query);
      const items: DisplayItem[] = [
        {
          label: `Go to ${target}`,
          icon: ICONS.path,
          pathTarget: target,
        },
      ];

      if (searchQuery) {
        items.push({
          label: `Search for "${searchQuery}"`,
          icon: ICONS.search,
          searchQuery,
        });
      }

      return items;
    }

    // Navigate mode — show all items when no query (autocomplete)
    // Rank direct destinations and let the scrollable result list handle
    // overflow without hiding valid matches.
    const q = normalizeSearch(this._query);
    const navItems: DisplayItem[] = this.#navigateItems.map((item) => ({
      label: item.title,
      secondary: item.status === "draft" ? `Draft · ${item.path}` : item.path,
      icon: ICONS[item.type],
    }));

    // Full-text search is a persistent action, not another navigation result.
    // Keep it outside the scrollable list while retaining it as the final
    // keyboard option.
    if (q) {
      navItems.push({
        label: `Search all content for "${this._query.trim()}"`,
        icon: ICONS.search,
        searchQuery: this._query.trim(),
        placement: "footer",
        ...(navItems.length > 0 ? { shortcut: "⌘/Ctrl ↵" } : {}),
      });
    }

    return navItems;
  }

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  #executeSearch(query: string) {
    saveHistory(SEARCH_HISTORY_KEY, query);
    this.close();
    window.location.href = publicPath(`/search?q=${encodeURIComponent(query)}`);
  }

  #executeItem(index: number) {
    const mode = this.#mode;

    if (mode === "command") {
      const cmd = this.#commandItems[index];
      if (cmd) {
        this.close();
        cmd.action();
      }
      return;
    }

    if (mode === "search") {
      const displayItem = this.#displayItems[index];
      const q = displayItem?.searchQuery;
      if (q) {
        this.#executeSearch(q);
      }
      return;
    }

    if (mode === "path") {
      const displayItem = this.#displayItems[index];
      if (displayItem?.pathTarget) {
        saveHistory(NAV_HISTORY_KEY, displayItem.pathTarget);
        this.close();
        window.location.href = publicPath(displayItem.pathTarget);
        return;
      }

      if (displayItem?.searchQuery) {
        this.#executeSearch(displayItem.searchQuery);
      }
      return;
    }

    // Navigate mode — check if the selected item is a search fallback
    const displayItem = this.#displayItems[index];
    if (displayItem?.searchQuery) {
      this.#executeSearch(displayItem.searchQuery);
      return;
    }

    const item = this.#navigateItems[index];
    if (item) {
      saveHistory(NAV_HISTORY_KEY, item.path);
      this.close();
      if (item.type === "system") {
        window.location.href = publicPath(item.path);
      } else if (item.type === "collection") {
        window.location.href = publicPath(`/collections/${item.path}`);
      } else {
        window.location.href = publicPath(
          item.status === "draft"
            ? `/preview/${item.path}?edit=1`
            : `/${item.path}`,
        );
      }
    }
  }

  // -----------------------------------------------------------------------
  // Event handlers
  // -----------------------------------------------------------------------

  #handleInput = (event: Event) => {
    const input = event.target as HTMLInputElement;
    this._query = input.value;
    this._selectedIndex = 0;
  };

  #handleKeydown = (event: globalThis.KeyboardEvent) => {
    // Let IME consume keys during composition — Enter commits the candidate,
    // Escape dismisses the candidate popup, arrows pick candidates.
    if (event.isComposing || event.keyCode === 229) return;

    const items = this.#displayItems;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      this._selectedIndex =
        items.length > 0 ? (this._selectedIndex + 1) % items.length : 0;
      this.#scrollSelectedIntoView();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      this._selectedIndex =
        items.length > 0
          ? (this._selectedIndex - 1 + items.length) % items.length
          : 0;
      this.#scrollSelectedIntoView();
      return;
    }

    if (
      event.key === "Enter" &&
      (event.metaKey || event.ctrlKey) &&
      this.#mode === "navigate"
    ) {
      const query = this._query.trim();
      if (query) {
        event.preventDefault();
        this.#executeSearch(query);
        return;
      }
    }

    if (event.key === "Enter") {
      event.preventDefault();
      this.#executeItem(this._selectedIndex);
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      return;
    }

    // Handle Escape explicitly — CJK IMEs can swallow the native dialog
    // `cancel` event even when not actively composing, requiring two presses.
    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
      return;
    }
  };

  #handleCancel = (event: Event) => {
    event.preventDefault();
    this.close();
  };

  #handleBackdropClick = (event: Event) => {
    if (event.target === event.currentTarget) {
      this.close();
    }
  };

  #handleItemClick(index: number) {
    return () => this.#executeItem(index);
  }

  #scrollSelectedIntoView() {
    requestAnimationFrame(() => {
      const selected = this.querySelector(".command-palette-result-selected");
      selected?.scrollIntoView({ block: "nearest" });
    });
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  #renderItem(item: DisplayItem, index: number, footer = false) {
    return html`
      <div
        id="command-palette-item-${index}"
        class=${classMap({
          "command-palette-result": true,
          "command-palette-result-selected": index === this._selectedIndex,
          "command-palette-search-action": footer,
        })}
        role="option"
        aria-selected=${index === this._selectedIndex}
        @click=${this.#handleItemClick(index)}
      >
        <span class="command-palette-result-icon">${unsafeSVG(item.icon)}</span>
        <span class="command-palette-result-body">
          <span class="command-palette-result-title">${item.label}</span>
          ${item.secondary
            ? html`<span class="command-palette-result-path"
                >${item.secondary}</span
              >`
            : nothing}
        </span>
        ${item.shortcut
          ? html`<kbd
              class="command-palette-result-shortcut"
              aria-label="Command or Control plus Enter"
              >${item.shortcut}</kbd
            >`
          : nothing}
      </div>
    `;
  }

  render() {
    if (!this._open) return nothing;

    const items = this.#displayItems;
    const resultItems = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.placement !== "footer");
    const footerItems = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.placement === "footer");

    return html`
      <dialog
        class="command-palette"
        @cancel=${this.#handleCancel}
        @click=${this.#handleBackdropClick}
        @keydown=${this.#handleKeydown}
      >
        <div
          class="command-palette-panel"
          @click=${(e: Event) => e.stopPropagation()}
        >
          <div class="command-palette-input-wrapper">
            <span class="command-palette-search-icon"
              >${unsafeSVG(ICONS.search)}</span
            >
            <input
              type="text"
              class="command-palette-input"
              .value=${this._query}
              @input=${this.#handleInput}
              placeholder="Type to navigate, > for commands, ? to search..."
              role="combobox"
              aria-expanded="true"
              aria-controls="command-palette-results"
              aria-activedescendant=${items.length > 0
                ? `command-palette-item-${this._selectedIndex}`
                : ""}
              autocomplete="off"
              spellcheck="false"
            />
            ${this._loading
              ? html`<span class="command-palette-spinner"></span>`
              : nothing}
          </div>

          ${items.length > 0
            ? html`
                <div
                  id="command-palette-results"
                  class="command-palette-results-container"
                  role="listbox"
                >
                  ${resultItems.length > 0
                    ? html`<div class="command-palette-results">
                        ${resultItems.map(({ item, index }) =>
                          this.#renderItem(item, index),
                        )}
                      </div>`
                    : nothing}
                  ${footerItems.map(({ item, index }) =>
                    this.#renderItem(item, index, true),
                  )}
                </div>
              `
            : this._query.trim() && !this._loading
              ? html`<div class="command-palette-empty">No results</div>`
              : nothing}
        </div>
      </dialog>
    `;
  }
}

if (!customElements.get("jant-command-palette")) {
  customElements.define("jant-command-palette", JantCommandPalette);
}
