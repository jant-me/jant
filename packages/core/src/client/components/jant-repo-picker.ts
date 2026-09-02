/**
 * GitHub Sync Repository Picker
 *
 * Two-combobox repo picker for the GitHub Sync connect flow. Renders the
 * owner (installation) dropdown and the repo dropdown side by side, with
 * local filtering on the first page of repos and a switch to GitHub's
 * `/search/repositories` endpoint once the user's query exceeds what we
 * have locally.
 *
 * The component is the sole consumer of the `/settings/github-sync/app/*`
 * JSON endpoints added in Phase 2. All navigation and confirmation
 * happens client-side; the final Connect submit posts JSON to
 * `/settings/github-sync/app/connect` and follows the returned redirect.
 *
 * Light DOM (BaseCoat + Tailwind classes apply directly). Labels arrive
 * via a JSON attribute (see jant-repo-picker-types.ts for the shape).
 */

import { LitElement, html, nothing } from "lit";
import type { RepoPickerLabels } from "./jant-repo-picker-types.js";

interface Installation {
  installationId: string;
  account: {
    login: string;
    type: "User" | "Organization";
    avatarUrl: string;
  };
  addedAt: number;
}

interface RepoRow {
  fullName: string;
  name: string;
  private: boolean;
  defaultBranch: string;
}

interface ReposResponse {
  repos: RepoRow[];
  totalCount: number;
  hasMore: boolean;
  nextPage: number | null;
  mode: "list" | "search";
}

type Classification =
  | { kind: "empty" }
  | {
      kind: "owned";
      marker: { site_host: string; site_id: string; created_at: number };
    }
  | {
      kind: "owned-by-other-site";
      marker: { site_host: string; site_id: string; created_at: number };
    }
  | { kind: "foreign"; defaultBranch: string };

const SEARCH_DEBOUNCE_MS = 300;
/** How many chars before we stop filtering locally and hit GitHub search. */
const SEARCH_MIN_CHARS = 1;

export class JantRepoPicker extends LitElement {
  static properties = {
    labels: { type: Object },
    apiBase: { type: String, attribute: "api-base" },
    connectUrl: { type: String, attribute: "connect-url" },
    installUrl: { type: String, attribute: "install-url" },
    cancelUrl: { type: String, attribute: "cancel-url" },
    createRepoNameHint: { type: String, attribute: "create-repo-name-hint" },

    _installations: { state: true },
    _selectedOwner: { state: true },
    _ownerOpen: { state: true },

    _repos: { state: true },
    _totalCount: { state: true },
    _hasMore: { state: true },
    _nextPage: { state: true },
    _reposMode: { state: true },
    _repoOpen: { state: true },
    _repoSearch: { state: true },
    _loadingRepos: { state: true },

    _selectedRepo: { state: true },
    _classification: { state: true },
    _classifying: { state: true },
    _confirmText: { state: true },

    _connecting: { state: true },
    _error: { state: true },
  };

  declare labels: RepoPickerLabels;
  declare apiBase: string;
  declare connectUrl: string;
  declare installUrl: string;
  declare cancelUrl: string;
  declare createRepoNameHint: string;

  declare _installations: Installation[];
  declare _selectedOwner: Installation | null;
  declare _ownerOpen: boolean;

  declare _repos: RepoRow[];
  declare _totalCount: number;
  declare _hasMore: boolean;
  declare _nextPage: number | null;
  declare _reposMode: "list" | "search";
  declare _repoOpen: boolean;
  declare _repoSearch: string;
  declare _loadingRepos: boolean;

  declare _selectedRepo: RepoRow | null;
  declare _classification: Classification | null;
  declare _classifying: boolean;
  declare _confirmText: string;

  declare _connecting: boolean;
  declare _error: string | null;

  #searchTimer: ReturnType<typeof setTimeout> | null = null;
  #searchToken = 0;
  /** True while the user is on github.com/new — waiting for tab refocus. */
  #awaitingReturn = false;
  /** Repo name we prefilled on github.com/new; used to auto-select on return. */
  #expectedNewRepoName: string | null = null;

  createRenderRoot() {
    this.innerHTML = "";
    return this;
  }

  constructor() {
    super();
    this.labels = {} as RepoPickerLabels;
    this.apiBase = "";
    this.connectUrl = "";
    this.installUrl = "";
    this.cancelUrl = "";
    this.createRepoNameHint = "";

    this._installations = [];
    this._selectedOwner = null;
    this._ownerOpen = false;

    this._repos = [];
    this._totalCount = 0;
    this._hasMore = false;
    this._nextPage = null;
    this._reposMode = "list";
    this._repoOpen = false;
    this._repoSearch = "";
    this._loadingRepos = false;

    this._selectedRepo = null;
    this._classification = null;
    this._classifying = false;
    this._confirmText = "";

    this._connecting = false;
    this._error = null;
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("click", this.#handleOutsideClick);
    document.addEventListener("keydown", this.#handleEscape);
    window.addEventListener("focus", this.#handleWindowFocus);
    void this.#loadInstallations();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("click", this.#handleOutsideClick);
    document.removeEventListener("keydown", this.#handleEscape);
    window.removeEventListener("focus", this.#handleWindowFocus);
    if (this.#searchTimer) clearTimeout(this.#searchTimer);
  }

  // -------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------

  async #loadInstallations() {
    try {
      const res = await fetch(`${this.apiBase}/installations`, {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        installations: Installation[];
      };
      this._installations = data.installations;
      // Auto-select when there is exactly one option — common case for
      // users who've only authorized on their primary account.
      const only =
        data.installations.length === 1 ? data.installations[0] : null;
      if (only) {
        this.#selectOwner(only);
      }
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    }
  }

  async #loadRepos(installationId: string, opts: { q?: string } = {}) {
    const token = ++this.#searchToken;
    this._loadingRepos = true;
    try {
      const params = new URLSearchParams({ installationId });
      if (opts.q) params.set("q", opts.q);
      const res = await fetch(`${this.apiBase}/repos?${params.toString()}`, {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });
      // Ignore stale responses (user typed another key while we were
      // fetching). The newer request will take over.
      if (token !== this.#searchToken) return;
      if (res.status === 410) {
        // Installation was uninstalled on GitHub — drop it from UI.
        this._installations = this._installations.filter(
          (i) => i.installationId !== installationId,
        );
        this._selectedOwner = null;
        this._repos = [];
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as ReposResponse;
      this._repos = data.repos;
      this._totalCount = data.totalCount;
      this._hasMore = data.hasMore;
      this._nextPage = data.nextPage;
      this._reposMode = data.mode;
    } catch (err) {
      if (token === this.#searchToken) {
        this._error = err instanceof Error ? err.message : String(err);
      }
    } finally {
      if (token === this.#searchToken) {
        this._loadingRepos = false;
      }
    }
  }

  async #classify(installationId: string, repo: string) {
    this._classifying = true;
    this._classification = null;
    this._confirmText = "";
    try {
      const res = await fetch(`${this.apiBase}/classify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({ installationId, repo }),
      });
      const data = (await res.json()) as {
        classification?: Classification;
        error?: string;
      };
      if (!res.ok || !data.classification) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      this._classification = data.classification;
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._classifying = false;
    }
  }

  async #connect() {
    if (!this._selectedOwner || !this._selectedRepo || !this._classification) {
      return;
    }
    this._connecting = true;
    this._error = null;
    try {
      const needsConfirm =
        this._classification.kind === "foreign" ||
        this._classification.kind === "owned-by-other-site";
      const res = await fetch(this.connectUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          installationId: this._selectedOwner.installationId,
          repo: this._selectedRepo.fullName,
          confirmForeign: needsConfirm,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        redirect?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      window.location.href = data.redirect ?? this.cancelUrl;
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
      this._connecting = false;
    }
  }

  /**
   * Open github.com/new in a new tab with the owner and repo name
   * prefilled. The user creates the repo on GitHub (which handles
   * private/public, description, license, etc. far better than we
   * could inline), then returns to this tab — the `focus` listener
   * picks up the return and refreshes the repo list below.
   */
  #openCreateOnGitHub() {
    const owner = this._selectedOwner;
    if (!owner) return;
    const name = this.createRepoNameHint || "";
    const url = new URL("https://github.com/new");
    if (name) url.searchParams.set("name", name);
    url.searchParams.set("owner", owner.account.login);
    url.searchParams.set("visibility", "private");
    this.#awaitingReturn = true;
    this.#expectedNewRepoName = name || null;
    window.open(url.toString(), "_blank", "noopener,noreferrer");
    this._repoOpen = false;
  }

  /**
   * Manual refresh. Kept even when auto-refresh works, because some
   * browsers fire `focus` unreliably (e.g. mobile PWAs) and users may
   * have created the repo out-of-band on GitHub's site earlier.
   */
  #refreshRepos() {
    if (!this._selectedOwner) return;
    const q = this._repoSearch.trim();
    void this.#loadRepos(this._selectedOwner.installationId, q ? { q } : {});
  }

  // -------------------------------------------------------------------
  // Interaction handlers
  // -------------------------------------------------------------------

  #selectOwner(installation: Installation) {
    if (this._selectedOwner?.installationId === installation.installationId) {
      this._ownerOpen = false;
      return;
    }
    this._selectedOwner = installation;
    this._ownerOpen = false;
    this._selectedRepo = null;
    this._classification = null;
    this._confirmText = "";
    this._repoSearch = "";
    void this.#loadRepos(installation.installationId);
  }

  #selectRepo(repo: RepoRow) {
    this._selectedRepo = repo;
    this._repoOpen = false;
    this._repoSearch = "";
    if (this._selectedOwner) {
      void this.#classify(this._selectedOwner.installationId, repo.fullName);
    }
  }

  #onRepoSearchInput(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    this._repoSearch = value;
    if (this.#searchTimer) clearTimeout(this.#searchTimer);
    if (!this._selectedOwner) return;
    const trimmed = value.trim();

    // Below the min-char threshold, keep the already-loaded first page
    // and filter locally. Past it, debounce into a server-side search.
    if (trimmed.length < SEARCH_MIN_CHARS) {
      if (this._reposMode === "search") {
        void this.#loadRepos(this._selectedOwner.installationId);
      }
      return;
    }
    this.#searchTimer = setTimeout(() => {
      if (!this._selectedOwner) return;
      void this.#loadRepos(this._selectedOwner.installationId, { q: trimmed });
    }, SEARCH_DEBOUNCE_MS);
  }

  #filteredRepos(): RepoRow[] {
    const q = this._repoSearch.trim().toLowerCase();
    if (!q || this._reposMode === "search") return this._repos;
    return this._repos.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.fullName.toLowerCase().includes(q),
    );
  }

  #handleOutsideClick = (e: MouseEvent) => {
    if (!this._ownerOpen && !this._repoOpen) return;
    const target = e.target as Node;
    const ownerWrap = this.querySelector(".repo-picker-owner");
    const repoWrap = this.querySelector(".repo-picker-repo");
    if (ownerWrap && !ownerWrap.contains(target)) this._ownerOpen = false;
    if (repoWrap && !repoWrap.contains(target)) this._repoOpen = false;
  };

  #handleEscape = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    // Let IME consume Escape during composition (e.g. dismissing the CJK
    // candidate popup in the owner/repo search inputs).
    if (e.isComposing || e.keyCode === 229) return;
    if (this._ownerOpen || this._repoOpen) {
      this._ownerOpen = false;
      this._repoOpen = false;
    }
  };

  /**
   * Detect the user's return from github.com/new. When `#awaitingReturn`
   * is set (only true while we're actively awaiting a create-repo trip),
   * reload the repo list and, if a repo matching the name we prefilled
   * now exists, auto-select it so the user sees an immediate result.
   */
  #handleWindowFocus = () => {
    if (!this.#awaitingReturn) return;
    const owner = this._selectedOwner;
    if (!owner) {
      this.#awaitingReturn = false;
      return;
    }
    const expected = this.#expectedNewRepoName;
    this.#awaitingReturn = false;
    this.#expectedNewRepoName = null;
    void (async () => {
      // Clear search so the just-created repo (which may not match the
      // active filter) is visible in the freshly loaded list.
      this._repoSearch = "";
      await this.#loadRepos(owner.installationId);
      if (expected) {
        const match = this._repos.find((r) => r.name === expected);
        if (match) this.#selectRepo(match);
      }
    })();
  };

  #toggleOwner() {
    this._ownerOpen = !this._ownerOpen;
    this._repoOpen = false;
  }

  #toggleRepo() {
    if (!this._selectedOwner) return;
    this._repoOpen = !this._repoOpen;
    this._ownerOpen = false;
    if (this._repoOpen) {
      queueMicrotask(() => {
        const input = this.querySelector<HTMLInputElement>(
          ".repo-picker-repo-search",
        );
        input?.focus();
      });
    }
  }

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------

  render() {
    return html`
      <div class="flex flex-col gap-6 max-w-lg">
        <div>
          <h2 class="text-lg font-medium mb-1">${this.labels.pageTitle}</h2>
          <p class="text-sm text-muted-foreground">
            ${this.labels.pageSubtitle}
          </p>
        </div>

        ${this.#renderOwner()} ${this.#renderRepo()}
        ${this.#renderClassification()} ${this.#renderActions()}
        ${
          this._error
            ? html`<div class="alert-destructive text-sm" role="alert">
                <section><p>${this._error}</p></section>
              </div>`
            : nothing
        }
      </div>
    `;
  }

  #renderOwner() {
    const selected = this._selectedOwner;
    return html`
      <div class="field repo-picker-owner relative">
        <label class="label">${this.labels.ownerLabel}</label>
        <button
          type="button"
          class="btn-outline w-full justify-between font-normal"
          @click=${() => this.#toggleOwner()}
          aria-haspopup="listbox"
          aria-expanded=${this._ownerOpen}
        >
          <span class="flex items-center gap-2 truncate">
            ${
              selected
                ? html`
                    ${
                      selected.account.avatarUrl
                        ? html`<img
                            src=${selected.account.avatarUrl}
                            alt=""
                            class="w-5 h-5 rounded-full"
                            loading="lazy"
                          />`
                        : nothing
                    }
                    <span class="truncate">${selected.account.login}</span>
                  `
                : html`<span class="text-muted-foreground"
                    >${
                      this._installations.length === 0
                        ? this.labels.ownerEmpty
                        : this.labels.ownerPlaceholder
                    }</span
                  >`
            }
          </span>
          <span class="text-muted-foreground">▾</span>
        </button>
        ${this._ownerOpen ? this.#renderOwnerMenu() : nothing}
      </div>
    `;
  }

  #renderOwnerMenu() {
    return html`
      <div
        class="absolute z-10 mt-1 w-full rounded-md border bg-background shadow-lg"
        role="listbox"
      >
        <ul class="max-h-64 overflow-y-auto py-1">
          ${this._installations.map(
            (inst) => html`
              <li>
                <button
                  type="button"
                  class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  @click=${() => this.#selectOwner(inst)}
                  role="option"
                  aria-selected=${
                    this._selectedOwner?.installationId === inst.installationId
                  }
                >
                  ${
                    inst.account.avatarUrl
                      ? html`<img
                          src=${inst.account.avatarUrl}
                          alt=""
                          class="w-5 h-5 rounded-full"
                          loading="lazy"
                        />`
                      : nothing
                  }
                  <span class="truncate">${inst.account.login}</span>
                  <span class="ml-auto text-xs text-muted-foreground">
                    ${inst.account.type === "Organization" ? "Org" : ""}
                  </span>
                </button>
              </li>
            `,
          )}
          ${
            this.installUrl
              ? html`
                  <li class="border-t mt-1 pt-1">
                    <a
                      href=${this.installUrl}
                      class="block px-3 py-2 text-sm text-primary hover:bg-muted"
                    >
                      ${this.labels.installAnother}
                    </a>
                  </li>
                `
              : nothing
          }
        </ul>
      </div>
    `;
  }

  #renderRepo() {
    const selected = this._selectedRepo;
    const disabled = !this._selectedOwner;
    return html`
      <div class="field repo-picker-repo relative">
        <label class="label">${this.labels.repositoryLabel}</label>
        <button
          type="button"
          class="btn-outline w-full justify-between font-normal"
          @click=${() => this.#toggleRepo()}
          aria-haspopup="listbox"
          aria-expanded=${this._repoOpen}
          ?disabled=${disabled}
        >
          <span class="truncate">
            ${
              selected
                ? html`<span>${selected.name}</span> ${
                      selected.private
                        ? html`<span class="text-xs text-muted-foreground ml-1"
                            >${this.labels.privateBadge}</span
                          >`
                        : nothing
                    }`
                : html`<span class="text-muted-foreground"
                    >${
                      disabled
                        ? this.labels.repoPlaceholderNoOwner
                        : this.labels.repoPlaceholder
                    }</span
                  >`
            }
          </span>
          <span class="text-muted-foreground">▾</span>
        </button>
        ${this._repoOpen ? this.#renderRepoMenu() : nothing}
      </div>
    `;
  }

  #renderRepoMenu() {
    const items = this.#filteredRepos();
    return html`
      <div
        class="absolute z-10 mt-1 w-full rounded-md border bg-background shadow-lg"
      >
        <div class="p-2 border-b flex items-center gap-2">
          <input
            type="text"
            class="input repo-picker-repo-search flex-1"
            placeholder=${this.labels.repoSearchPlaceholder}
            .value=${this._repoSearch}
            @input=${(e: Event) => this.#onRepoSearchInput(e)}
          />
          <button
            type="button"
            class="btn-icon-ghost"
            title=${this.labels.refreshRepos}
            aria-label=${this.labels.refreshRepos}
            @click=${() => this.#refreshRepos()}
            ?disabled=${this._loadingRepos}
          >
            <!-- Simple refresh glyph; matches BaseCoat icon button sizing -->
            <span aria-hidden="true">⟳</span>
          </button>
        </div>
        ${
          this._hasMore && this._reposMode === "list"
            ? html`<p class="px-3 pt-2 text-xs text-muted-foreground">
                ${this.labels.repoShowingOf
                  .replace("{shown}", String(this._repos.length))
                  .replace("{total}", String(this._totalCount))}
                — ${this.labels.repoSearchHint}
              </p>`
            : nothing
        }
        <ul class="max-h-64 overflow-y-auto py-1" role="listbox">
          ${
            this._loadingRepos
              ? html`<li class="px-3 py-2 text-sm text-muted-foreground">
                  ${this.labels.repoLoading}
                </li>`
              : items.length === 0
                ? html`<li class="px-3 py-2 text-sm text-muted-foreground">
                    ${this.labels.repoEmpty}
                  </li>`
                : items.map(
                    (r) => html`
                      <li>
                        <button
                          type="button"
                          class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                          @click=${() => this.#selectRepo(r)}
                          role="option"
                          aria-selected=${
                            this._selectedRepo?.fullName === r.fullName
                          }
                        >
                          <span class="truncate">${r.name}</span>
                          ${
                            r.private
                              ? html`<span
                                  class="ml-auto text-xs text-muted-foreground"
                                  >${this.labels.privateBadge}</span
                                >`
                              : nothing
                          }
                        </button>
                      </li>
                    `,
                  )
          }
        </ul>
        <div class="border-t p-2">
          <button
            type="button"
            class="flex w-full items-start gap-2 px-2 py-2 text-left text-sm text-primary hover:bg-muted rounded-md"
            @click=${() => this.#openCreateOnGitHub()}
          >
            <span class="flex flex-col">
              <span class="font-medium">${this.labels.createOnGitHub} →</span>
              ${
                this.createRepoNameHint
                  ? html`<span class="text-xs text-muted-foreground">
                      ${this.labels.createOnGitHubHint.replace(
                        "{name}",
                        this.createRepoNameHint,
                      )}
                    </span>`
                  : nothing
              }
            </span>
          </button>
        </div>
      </div>
    `;
  }

  #renderClassification() {
    if (this._classifying) {
      return html`<p class="text-sm text-muted-foreground">
        ${this.labels.classifyLoading}
      </p>`;
    }
    if (!this._classification || !this._selectedRepo) return nothing;
    const c = this._classification;
    if (c.kind === "empty") {
      return html`<p class="text-sm text-muted-foreground">
        ${this.labels.classificationEmpty}
      </p>`;
    }
    if (c.kind === "owned") {
      return html`<p class="text-sm text-muted-foreground">
        ${this.labels.classificationOwned}
      </p>`;
    }
    if (c.kind === "owned-by-other-site") {
      return html`<div class="alert-destructive text-sm" role="alert">
        <section>
          <p>
            ${this.labels.classificationOwnedByOther.replace(
              "{host}",
              c.marker.site_host,
            )}
          </p>
        </section>
      </div>`;
    }
    // foreign — show confirm input
    const full = this._selectedRepo.fullName;
    return html`
      <div class="alert flex flex-col gap-3 text-sm">
        <div>
          <strong class="block mb-1">${this.labels.confirmHeading}</strong>
          <span>${this.labels.confirmBody.replace("{repo}", full)}</span>
        </div>
        <div class="field">
          <label class="label text-xs">
            ${this.labels.confirmInputLabel.replace("{repo}", full)}
          </label>
          <input
            type="text"
            class="input w-full"
            placeholder=${this.labels.confirmInputPlaceholder}
            .value=${this._confirmText}
            @input=${(e: Event) => {
              this._confirmText = (e.target as HTMLInputElement).value;
            }}
            autocomplete="off"
            spellcheck="false"
          />
        </div>
      </div>
    `;
  }

  #canConnect(): boolean {
    if (
      !this._selectedRepo ||
      !this._classification ||
      this._classifying ||
      this._connecting
    ) {
      return false;
    }
    const c = this._classification;
    if (c.kind === "owned-by-other-site") return false;
    if (c.kind === "foreign") {
      return this._confirmText.trim() === this._selectedRepo.fullName;
    }
    return true;
  }

  #renderActions() {
    return html`
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="btn"
          ?disabled=${!this.#canConnect()}
          @click=${() => this.#connect()}
        >
          ${this._connecting ? this.labels.connecting : this.labels.connect}
        </button>
        <a href=${this.cancelUrl} class="btn-ghost">${this.labels.cancel}</a>
      </div>
    `;
  }
}

customElements.define("jant-repo-picker", JantRepoPicker);
