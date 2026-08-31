/**
 * General Settings Component
 *
 * Main container for the General settings page. Saveable groups track dirty
 * state independently, while checkbox-only sections save immediately.
 *
 * Light DOM only — BaseCoat and Tailwind classes apply directly.
 */

import { LitElement, html, nothing } from "lit";
import type { Editor } from "@tiptap/core";
import { MAX_SITE_NAME_LENGTH } from "../../types.js";
import type {
  SettingsInitialData,
  SettingsLabels,
  SettingsTimezone,
  SettingsAboutPageStatus,
} from "./settings-types.js";
import {
  COPY_FIELD_BUTTON_CLASS,
  COPY_FIELD_CLASS,
  COPY_FIELD_CONTROL_CLASS,
  COPY_FIELD_INPUT_CLASS,
} from "../../lib/copy-field.js";
import {
  createSettingsEditor,
  jsonToMarkdown,
} from "../tiptap/create-editor.js";

export class JantSettingsGeneral extends LitElement {
  static properties = {
    labels: { type: Object },
    timezones: { type: Array },
    siteNameFallback: { type: String, attribute: "sitename-fallback" },
    siteDescriptionFallback: {
      type: String,
      attribute: "sitedescription-fallback",
    },
    demoMode: { type: Boolean, attribute: "demo-mode" },
    discoverDocsUrl: { type: String, attribute: "discover-docs-url" },
    discoverStatus: { type: String, attribute: "discover-status" },
    feedsEnabled: { type: Boolean, attribute: "feeds-enabled" },
    mainFeedUrl: { type: String, attribute: "main-feed-url" },
    latestFeedUrl: { type: String, attribute: "latest-feed-url" },
    featuredFeedUrl: { type: String, attribute: "featured-feed-url" },
    archiveFeedUrl: { type: String, attribute: "archive-feed-url" },
    feedsDocsUrl: { type: String, attribute: "feeds-docs-url" },
    aboutPage: { type: Object, attribute: "about-page" },
    aboutEditUrl: { type: String, attribute: "about-edit-url" },
    aboutCreateUrl: {
      type: String,
      attribute: "about-create-url",
    },

    // Site group
    _siteName: { state: true },
    _siteDescription: { state: true },
    _siteFooter: { state: true },
    _origSite: { state: true },
    _siteDirty: { state: true },
    _siteLoading: { state: true },

    // Language, CJK & time group
    _timeZone: { state: true },
    _origLocale: { state: true },
    _localeDirty: { state: true },
    _localeLoading: { state: true },

    // Feed group
    _mainRssFeed: { state: true },
    _origMainRssFeed: { state: true },
    _feedLoading: { state: true },

    // Home auto-save
    _showJantBrandingOnHome: { state: true },
    _origShowJantBrandingOnHome: { state: true },
    _homeLoading: { state: true },

    // Search auto-save
    _noindex: { state: true },
    _origNoindex: { state: true },
    _searchLoading: { state: true },

    // Discover group
    _discover: { state: true },
    _origDiscover: { state: true },
    _discoverDirty: { state: true },
    _discoverLoading: { state: true },
  };

  declare labels: SettingsLabels;
  declare timezones: SettingsTimezone[];
  declare siteNameFallback: string;
  declare siteDescriptionFallback: string;
  declare demoMode: boolean;
  declare discoverDocsUrl: string;
  /**
   * JSON status block, already translated by the server.
   *
   * The sentences carry runtime numbers, so they are built where the values
   * are. This component only decides where they go.
   */
  declare discoverStatus: string;
  declare feedsEnabled: boolean;
  declare mainFeedUrl: string;
  declare latestFeedUrl: string;
  declare featuredFeedUrl: string;
  declare archiveFeedUrl: string;
  declare feedsDocsUrl: string;
  declare aboutPage: SettingsAboutPageStatus;
  declare aboutEditUrl: string;
  declare aboutCreateUrl: string;

  // Site
  declare _siteName: string;
  declare _siteDescription: string;
  declare _siteFooter: string;
  declare _origSite: {
    siteName: string;
    siteDescription: string;
    siteFooter: string;
  };
  declare _siteDirty: boolean;
  declare _siteLoading: boolean;

  // Language, CJK & time
  /** Admin dashboard UI locale (one of the translated catalog locales). */
  declare _timeZone: string;
  declare _origLocale: {
    timeZone: string;
  };
  declare _localeDirty: boolean;
  declare _localeLoading: boolean;

  // Feed
  declare _mainRssFeed: string;
  declare _origMainRssFeed: string;
  declare _feedLoading: boolean;

  // Home
  declare _showJantBrandingOnHome: boolean;
  declare _origShowJantBrandingOnHome: boolean;
  declare _homeLoading: boolean;

  // Search
  declare _noindex: boolean;
  declare _origNoindex: boolean;
  declare _searchLoading: boolean;

  // Discover. "" means the owner has never used the control, which is not the
  // same as "off" — an untouched site still follows the default.
  declare _discover: string;
  declare _origDiscover: string;
  declare _discoverDirty: boolean;
  declare _discoverLoading: boolean;

  // TipTap editor instances
  private _descEditor: Editor | null = null;
  private _footerEditor: Editor | null = null;

  createRenderRoot() {
    this.innerHTML = "";
    return this;
  }

  constructor() {
    super();
    this.labels = {} as SettingsLabels;
    this.timezones = [];
    this.siteNameFallback = "";
    this.siteDescriptionFallback = "";
    this.demoMode = false;
    this.mainFeedUrl = "/feed";
    this.latestFeedUrl = "/latest/feed";
    this.featuredFeedUrl = "/featured/feed";
    this.archiveFeedUrl = "/archive/feed";
    this.feedsDocsUrl = "";
    this.aboutPage = {
      state: "missing",
      path: "/about",
    };
    this.aboutEditUrl = "/about?edit=1";
    this.aboutCreateUrl = "/settings/general/about-page";

    this._siteName = "";
    this._siteDescription = "";
    this._siteFooter = "";
    this._origSite = {
      siteName: "",
      siteDescription: "",
      siteFooter: "",
    };
    this._siteDirty = false;
    this._siteLoading = false;

    this._timeZone = "UTC";
    this._origLocale = { timeZone: "UTC" };

    this._localeDirty = false;
    this._localeLoading = false;

    this._mainRssFeed = "featured";
    this._origMainRssFeed = "featured";
    this._feedLoading = false;

    this._noindex = false;
    this._origNoindex = false;
    this._showJantBrandingOnHome = false;
    this._origShowJantBrandingOnHome = false;
    this._homeLoading = false;
    this._searchLoading = false;

    this.discoverDocsUrl = "";
    this.discoverStatus = "";
    this.feedsEnabled = false;
    this._discover = "";
    this._origDiscover = "";
    this._discoverDirty = false;
    this._discoverLoading = false;
  }

  connectedCallback() {
    super.connectedCallback();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._descEditor?.destroy();
    this._descEditor = null;
    this._footerEditor?.destroy();
    this._footerEditor = null;
  }

  /** Initialize form state from data attributes set by the bridge */
  initData(data: SettingsInitialData) {
    this._siteName = data.siteName;
    this._siteDescription = data.siteDescription;
    this._siteFooter = data.siteFooter;

    this._timeZone = data.timeZone;
    this._origLocale = { timeZone: data.timeZone };

    this._mainRssFeed = data.mainRssFeed;
    this._origMainRssFeed = data.mainRssFeed;

    this._showJantBrandingOnHome = data.showJantBrandingOnHome;
    this._origShowJantBrandingOnHome = data.showJantBrandingOnHome;

    this._noindex = data.noindex;
    this._origNoindex = data.noindex;

    this._discover = data.discover;
    this._origDiscover = data.discover;
    this._discoverDirty = false;

    // Defer editor init to after Lit renders the containers
    this.updateComplete.then(() => {
      this._initEditors();
      // Normalize origSite after editors round-trip the markdown
      this._origSite = {
        siteName: data.siteName,
        siteDescription: this._siteDescription,
        siteFooter: this._siteFooter,
      };
    });
  }

  /** Called by bridge after a section save succeeds */
  sectionSaved(section: string) {
    if (section === "site") {
      this._origSite = {
        siteName: this._siteName,
        siteDescription: this._siteDescription,
        siteFooter: this._siteFooter,
      };
      this._siteDirty = false;
      this._siteLoading = false;
    } else if (section === "time") {
      this._origLocale = { timeZone: this._timeZone };
      this._localeDirty = false;
      this._localeLoading = false;
    } else if (section === "feeds") {
      this._origMainRssFeed = this._mainRssFeed;
      this._feedLoading = false;
    } else if (section === "home") {
      this._origShowJantBrandingOnHome = this._showJantBrandingOnHome;
      this._homeLoading = false;
    } else if (section === "search") {
      this._origNoindex = this._noindex;
      this._searchLoading = false;
    } else if (section === "discover") {
      this._origDiscover = this._discover;
      this._discoverDirty = false;
      this._discoverLoading = false;
    }
  }

  /** Called by bridge on save error */
  sectionError(section: string) {
    if (section === "site") {
      this._siteLoading = false;
    } else if (section === "time") {
      this._localeLoading = false;
    } else if (section === "feeds") {
      this._mainRssFeed = this._origMainRssFeed;
      this._feedLoading = false;
    } else if (section === "home") {
      this._showJantBrandingOnHome = this._origShowJantBrandingOnHome;
      this._homeLoading = false;
    } else if (section === "search") {
      this._noindex = this._origNoindex;
      this._searchLoading = false;
    } else if (section === "discover") {
      this._discover = this._origDiscover;
      this._discoverDirty = false;
      this._discoverLoading = false;
    }
  }

  // ── TipTap editor helpers ──────────────────────────────────────────

  private _initEditors() {
    this._initDescEditor();
    this._initFooterEditor();
  }

  private _initDescEditor() {
    const container = this.querySelector<HTMLElement>(
      "[data-settings-desc-editor]",
    );
    if (!container || this._descEditor) return;

    this._descEditor = createSettingsEditor({
      element: container,
      placeholder: this.siteDescriptionFallback,
      content: this._siteDescription || undefined,
      onUpdate: (markdown) => {
        this._siteDescription = markdown;
        this._syncSiteDirty();
      },
    });

    // Normalize initial markdown through the editor round-trip
    this._siteDescription = jsonToMarkdown(this._descEditor.getJSON());

    const pm = container.querySelector<HTMLElement>(".ProseMirror");
    if (pm) {
      pm.style.outline = "none";
      pm.style.minHeight = "3rem";
    }
  }

  private _initFooterEditor() {
    const container = this.querySelector<HTMLElement>(
      "[data-settings-footer-editor]",
    );
    if (!container || this._footerEditor) return;

    this._footerEditor = createSettingsEditor({
      element: container,
      content: this._siteFooter || undefined,
      onUpdate: (markdown) => {
        this._siteFooter = markdown;
        this._syncSiteDirty();
      },
    });

    // Normalize initial markdown through the editor round-trip
    this._siteFooter = jsonToMarkdown(this._footerEditor.getJSON());

    const pm = container.querySelector<HTMLElement>(".ProseMirror");
    if (pm) {
      pm.style.outline = "none";
      pm.style.minHeight = "6rem";
    }
  }

  // ── Site group helpers ────────────────────────────────────────────

  private _syncSiteDirty() {
    this._siteDirty =
      this._siteName !== this._origSite.siteName ||
      this._siteDescription !== this._origSite.siteDescription ||
      this._siteFooter !== this._origSite.siteFooter;
  }

  private _saveSite() {
    if (this._siteLoading || !this._siteDirty) return;
    this._siteLoading = true;
    this.dispatchEvent(
      new CustomEvent("jant:settings-save", {
        bubbles: true,
        detail: {
          endpoint: "/settings/general",
          data: {
            siteName: this._siteName,
            siteDescription: this._siteDescription,
            siteFooter: this._siteFooter,
          },
          section: "site",
        },
      }),
    );
  }

  // ── Time group helpers ────────────────────────────────────────────

  private _syncLocaleDirty() {
    this._localeDirty = this._timeZone !== this._origLocale.timeZone;
  }

  private _saveLocale() {
    if (this._localeLoading || !this._localeDirty) return;
    this._localeLoading = true;
    this.dispatchEvent(
      new CustomEvent("jant:settings-save", {
        bubbles: true,
        detail: {
          endpoint: "/settings/general/time",
          data: { timeZone: this._timeZone },
          section: "time",
        },
      }),
    );
  }

  // ── Feed auto-save helpers ────────────────────────────────────────

  private _saveMainRssFeed(value: string) {
    if (this._feedLoading || value === this._mainRssFeed) return;
    this._mainRssFeed = value;
    this._feedLoading = true;
    this.dispatchEvent(
      new CustomEvent("jant:settings-save", {
        bubbles: true,
        detail: {
          endpoint: "/settings/general/feeds",
          data: {
            mainRssFeed: value,
          },
          section: "feeds",
        },
      }),
    );
  }

  // ── Home auto-save helpers ────────────────────────────────────────

  private _saveHomeToggle(nextValue: boolean) {
    if (this._homeLoading) return;
    this._showJantBrandingOnHome = nextValue;
    this._homeLoading = true;
    this.dispatchEvent(
      new CustomEvent("jant:settings-save", {
        bubbles: true,
        detail: {
          endpoint: "/settings/general/home",
          data: {
            showJantBrandingOnHome: nextValue,
          },
          section: "home",
        },
      }),
    );
  }

  // ── Search auto-save helpers ──────────────────────────────────────

  private _saveSearchToggle(nextAllowIndexing: boolean) {
    if (this.demoMode || this._searchLoading) return;
    this._noindex = !nextAllowIndexing;
    this._searchLoading = true;
    this.dispatchEvent(
      new CustomEvent("jant:settings-save", {
        bubbles: true,
        detail: {
          endpoint: "/settings/general/search",
          data: {
            allowIndexing: nextAllowIndexing,
          },
          section: "search",
        },
      }),
    );
  }

  // ── Discover helpers ──────────────────────────────────────────────

  private _onDiscoverToggle(enabled: boolean) {
    // Turning it back on returns to the default rather than to whatever was
    // chosen before being switched off; the sub-choice below says which.
    this._discover = enabled
      ? this._origDiscover === "featured"
        ? "featured"
        : "latest"
      : "off";
    this._discoverDirty = true;
  }

  private _onDiscoverMode(mode: "latest" | "featured") {
    this._discover = mode;
    this._discoverDirty = true;
  }

  private _saveDiscover() {
    if (this._discoverLoading) return;
    // Sent even when the value is unchanged from the default, because saying
    // "yes, list me" out loud is the act this control exists for.
    const value = this._discover === "" ? "latest" : this._discover;
    this._discover = value;
    this._discoverLoading = true;
    this.dispatchEvent(
      new CustomEvent("jant:settings-save", {
        bubbles: true,
        detail: {
          endpoint: "/settings/general/discover",
          data: { discover: value },
          section: "discover",
        },
      }),
    );
  }

  /** Submit on Enter from non-textarea fields */
  private _onKeydown(
    e: globalThis.KeyboardEvent,
    save: () => void,
    dirty: boolean,
    loading: boolean,
  ) {
    // Pressing Enter to commit an IME candidate must not also submit the form.
    if (e.isComposing || e.keyCode === 229) return;
    if (
      e.key === "Enter" &&
      !loading &&
      dirty &&
      !(e.target instanceof HTMLTextAreaElement)
    ) {
      e.preventDefault();
      save();
    }
  }

  // ── Render helpers ────────────────────────────────────────────────

  private _renderSaveAction(
    loading: boolean,
    dirty: boolean,
    onSave: () => void,
  ) {
    return html`
      <div class="flex mt-4">
        <button
          type="button"
          class="btn"
          ?disabled=${loading || !dirty}
          @click=${onSave}
        >
          ${
            loading
              ? html`<svg
                  class="animate-spin size-4"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  role="status"
                >
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>`
              : nothing
          }
          ${this.labels.save}
        </button>
      </div>
    `;
  }

  private _renderSectionTitle(title: string) {
    return html`<h3 class="text-sm font-semibold tracking-[0.01em]">
      ${title}
    </h3>`;
  }

  private _renderMainRssFeedOption(
    value: string,
    title: string,
    description: string,
  ) {
    const checked = this._mainRssFeed === value;
    return html`
      <label
        class=${`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${
          checked ? "border-primary" : "border-border"
        }`}
      >
        <input
          type="radio"
          name="main-rss-feed"
          value=${value}
          class="mt-1"
          .checked=${checked}
          ?disabled=${this._feedLoading}
          @change=${() => this._saveMainRssFeed(value)}
        />
        <div>
          <div class="font-medium">${title}</div>
          <div class="text-sm text-muted-foreground">${description}</div>
        </div>
      </label>
    `;
  }

  /**
   * One feed address with a copy button.
   *
   * The same field `ui/shared/CopyField.tsx` renders on the public subscribe
   * page, driven by the same `client/copy-field.ts` enhancer — hence the shared
   * classes. lit-html cannot interpolate attribute names, so the enhancer's
   * hooks are spelled out; `jant-settings-general.test.ts` asserts they match.
   * Unlike the public page the button is not rendered hidden: settings is
   * behind auth, where the client bundle is always present.
   */
  private _renderFeedUrl(label: string, value: string, description?: string) {
    return html`
      <div class=${COPY_FIELD_CLASS} data-copy-field-root>
        <p class="text-sm font-medium">${label}</p>
        ${
          description
            ? html`<p class="text-sm text-muted-foreground">${description}</p>`
            : ""
        }
        <div class=${COPY_FIELD_CONTROL_CLASS}>
          <input
            type="text"
            class=${COPY_FIELD_INPUT_CLASS}
            .value=${value}
            readonly
            aria-label=${label}
            data-copy-field-value
          />
          <button
            type="button"
            class=${COPY_FIELD_BUTTON_CLASS}
            data-copy-field=${this.labels.feedUrlCopied}
            data-copy-field-failed=${this.labels.copyFailed}
          >
            ${this.labels.copy}
          </button>
        </div>
      </div>
    `;
  }

  private _renderAboutPageRow() {
    const status = this.aboutPage;

    return html`
      <div class="mt-2 text-sm text-muted-foreground" data-about-page-row>
        ${this.labels.aboutPagePrompt}
        ${
          status.state === "ready"
            ? html`
                <a
                  class="font-medium text-foreground underline-offset-4 hover:underline"
                  href=${this.aboutEditUrl}
                >
                  ${this.labels.editAboutPage}
                </a>
              `
            : status.state === "missing"
              ? html`
                  <form
                    class="inline"
                    method="post"
                    action=${this.aboutCreateUrl}
                  >
                    <button
                      type="submit"
                      class="inline cursor-pointer border-0 bg-transparent p-0 font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      ${this.labels.createAboutPage}
                    </button>
                  </form>
                `
              : html`
                  <span class="text-destructive"
                    >${this.labels.aboutPageConflict}</span
                  >
                `
        }
      </div>
    `;
  }

  private _renderGeneralForm() {
    return html`
      <div class="flex flex-col gap-8">
        <div>
          <h2 class="text-lg font-semibold">${this.labels.general}</h2>
        </div>

        <section
          class="flex flex-col gap-4"
          @keydown=${(e: globalThis.KeyboardEvent) =>
            this._onKeydown(
              e,
              () => this._saveSite(),
              this._siteDirty,
              this._siteLoading,
            )}
        >
          ${this._renderSectionTitle(this.labels.site)}
          <div class="field">
            <label class="label">${this.labels.siteName}</label>
            <input
              type="text"
              class="input"
              maxlength=${MAX_SITE_NAME_LENGTH}
              .value=${this._siteName}
              placeholder=${this.siteNameFallback}
              @input=${(e: Event) => {
                this._siteName = (e.target as HTMLInputElement).value;
                this._syncSiteDirty();
              }}
            />
          </div>

          <div class="field">
            <label class="label">${this.labels.aboutBlog}</label>
            <div class="settings-tiptap-editor" data-settings-desc-editor></div>
            <p class="text-sm text-muted-foreground mt-1">
              ${this.labels.aboutBlogHelp}
            </p>
            ${this._renderAboutPageRow()}
          </div>

          <div class="field">
            <label class="label">${this.labels.siteFooter}</label>
            <div
              class="settings-tiptap-editor"
              data-settings-footer-editor
            ></div>
            <p class="text-sm text-muted-foreground mt-1">
              ${this.labels.footerHelp}
            </p>
          </div>

          ${this._renderSaveAction(this._siteLoading, this._siteDirty, () =>
            this._saveSite(),
          )}
        </section>

        <section
          class="flex flex-col gap-4 border-t pt-8"
          @keydown=${(e: globalThis.KeyboardEvent) =>
            this._onKeydown(
              e,
              () => this._saveLocale(),
              this._localeDirty,
              this._localeLoading,
            )}
        >
          ${this._renderSectionTitle(this.labels.timeSection)}
          <div class="field">
            <label class="label">${this.labels.timeZone}</label>
            <select
              class="select"
              @change=${(e: Event) => {
                this._timeZone = (e.target as HTMLSelectElement).value;
                this._syncLocaleDirty();
              }}
            >
              ${this.timezones.map(
                (tz) => html`
                  <option
                    value=${tz.value}
                    ?selected=${this._timeZone === tz.value}
                  >
                    ${tz.label}
                  </option>
                `,
              )}
            </select>
          </div>

          ${this._renderSaveAction(this._localeLoading, this._localeDirty, () =>
            this._saveLocale(),
          )}
        </section>

        <section class="flex flex-col gap-4 border-t pt-8">
          ${this._renderSectionTitle(this.labels.feeds)}
          <div class="field">
            <p class="label">${this.labels.mainRssFeed}</p>
            <p class="text-sm text-muted-foreground mt-1">
              ${this.labels.mainRssFeedHelp}
            </p>
            <div class="mt-3 flex flex-col gap-2">
              ${this._renderMainRssFeedOption(
                "featured",
                this.labels.featuredFeedOption,
                this.labels.featuredFeedOptionDescription,
              )}
              ${this._renderMainRssFeedOption(
                "latest",
                this.labels.latestFeedOption,
                this.labels.latestFeedOptionDescription,
              )}
            </div>
            <p class="text-sm text-muted-foreground mt-2">
              ${this.labels.mainRssFeedWarning}
            </p>
          </div>

          <div class="rounded-xl border border-border/70 bg-muted/30 p-4">
            <div class="flex flex-col gap-4">
              <div class="flex flex-col gap-1">
                <p class="text-sm font-medium">
                  ${this.labels.availableFeedUrls}
                </p>
                <p class="text-sm text-muted-foreground">
                  ${this.labels.availableFeedUrlsHelp}
                  ${
                    this.feedsDocsUrl
                      ? html`
                          <a
                            href=${this.feedsDocsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            class="underline hover:text-foreground transition-colors"
                            >${this.labels.feedsDocs}</a
                          >
                        `
                      : ""
                  }
                </p>
              </div>

              ${this._renderFeedUrl(this.labels.mainFeedUrl, this.mainFeedUrl)}
              ${this._renderFeedUrl(
                this.labels.latestFeedUrl,
                this.latestFeedUrl,
              )}
              ${this._renderFeedUrl(
                this.labels.featuredFeedUrl,
                this.featuredFeedUrl,
              )}
              ${this._renderFeedUrl(
                this.labels.archiveFeedUrl,
                this.archiveFeedUrl,
                this.labels.archiveFeedUrlHelp,
              )}
            </div>
          </div>
        </section>

        <section class="flex flex-col gap-4 border-t pt-8 pb-6">
          ${this._renderSectionTitle(this.labels.home)}
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              class="checkbox"
              .checked=${this._showJantBrandingOnHome}
              ?disabled=${this._homeLoading}
              @change=${(e: Event) =>
                this._saveHomeToggle((e.target as HTMLInputElement).checked)}
            />
            <span>${this.labels.showJantBrandingOnHome}</span>
          </label>
        </section>
      </div>
    `;
  }

  private _renderSearchForm() {
    return html`
      <section class="flex flex-col gap-6 border-t pt-8">
        ${this._renderSectionTitle(this.labels.search)}
        <div class="flex flex-col gap-2">
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              class="checkbox"
              .checked=${!this._noindex}
              ?disabled=${this.demoMode || this._searchLoading}
              @change=${(e: Event) =>
                this._saveSearchToggle((e.target as HTMLInputElement).checked)}
            />
            <span>${this.labels.allowIndexing}</span>
          </label>
          ${
            this.demoMode
              ? html`<p class="text-sm text-muted-foreground">
                  ${this.labels.demoSeoLocked}
                </p>`
              : nothing
          }
        </div>
        ${this._renderDiscoverForm()}
      </section>
    `;
  }

  /**
   * Jant Discover.
   *
   * Unlike the indexing checkbox next to it, this group saves on its own
   * button rather than on change. Two reasons, and both are the point: the
   * checkbox and the mode are one decision, and a site that is happy with the
   * default has to be able to confirm it — that confirmation is what tells the
   * directory the site exists, and there is no way to express it by toggling
   * something that is already on.
   */
  private _renderDiscoverForm() {
    // "" means never chosen, and the default is to take part.
    const enabled = this._discover === "" ? true : this._discover !== "off";
    const mode = this._discover === "featured" ? "featured" : "latest";
    const locked = this.demoMode || !this.feedsEnabled;

    return html`
      <div class="flex flex-col gap-3">
        <p class="text-sm text-muted-foreground">
          ${this.labels.discoverIntro}
          <a
            class="link"
            href=${this.discoverDocsUrl}
            target="_blank"
            rel="noopener noreferrer"
            >${this.labels.discoverDocs}</a
          >
        </p>
        <label class="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            class="checkbox"
            .checked=${enabled && !locked}
            ?disabled=${locked || this._discoverLoading}
            @change=${(e: Event) =>
              this._onDiscoverToggle((e.target as HTMLInputElement).checked)}
          />
          <span>${this.labels.discoverEnabled}</span>
        </label>
        ${
          locked
            ? html`<p class="text-sm text-muted-foreground">
                ${
                  this.demoMode
                    ? this.labels.discoverDemoLocked
                    : this.labels.discoverFeedsOffLocked
                }
              </p>`
            : nothing
        }
        ${
          enabled && !locked
            ? html`
                <div class="flex flex-col gap-2 pl-6">
                  ${this._renderDiscoverMode("latest", mode)}
                  ${this._renderDiscoverMode("featured", mode)}
                </div>
                <p class="text-sm text-muted-foreground">
                  ${this.labels.discoverAnnounce}
                </p>
              `
            : nothing
        }
        ${
          locked
            ? nothing
            : html`
                <div>
                  <button
                    type="button"
                    class="btn"
                    ?disabled=${
                      this._discoverLoading ||
                      (!this._discoverDirty && this._origDiscover !== "")
                    }
                    @click=${() => this._saveDiscover()}
                  >
                    ${this.labels.save}
                  </button>
                </div>
              `
        }
        ${locked ? nothing : this._renderDiscoverStatus()}
      </div>
    `;
  }

  /**
   * What the site can say about its own standing.
   *
   * Deliberately all local evidence: the directory takes no status queries, so
   * nothing here was fetched and nothing here can say whether a person has
   * moderated the site. The retry and the manual form appear only when the
   * announcement failed — beside a working one they would read as a normal
   * route in rather than the recovery they are.
   */
  private _renderDiscoverStatus() {
    const status = this._parsedDiscoverStatus();
    if (!status || status.lines.length === 0) return nothing;

    return html`
      <div class="flex flex-col gap-1 border-t pt-3">
        <p class="text-sm font-medium">${this.labels.discoverStatusHeading}</p>
        ${status.lines.map(
          (line) => html`<p class="text-sm text-muted-foreground">${line}</p>`,
        )}
        ${
          status.showRetry
            ? html`
                <div class="flex flex-wrap items-center gap-3 mt-1">
                  <button
                    type="button"
                    class="btn btn-outline"
                    ?disabled=${this._discoverLoading}
                    @click=${() => this._retryAnnounce()}
                  >
                    ${this.labels.discoverAnnounceRetry}
                  </button>
                  ${
                    status.submitUrl
                      ? html`<a
                          class="link text-sm"
                          href=${status.submitUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          >${this.labels.discoverAnnounceManual}</a
                        >`
                      : nothing
                  }
                </div>
              `
            : nothing
        }
      </div>
    `;
  }

  private _parsedDiscoverStatus(): {
    lines: string[];
    showRetry: boolean;
    submitUrl: string | null;
  } | null {
    if (!this.discoverStatus) return null;
    try {
      const parsed: unknown = JSON.parse(this.discoverStatus);
      if (typeof parsed !== "object" || parsed === null) return null;
      const value = parsed as Record<string, unknown>;
      const lines = Array.isArray(value["lines"])
        ? value["lines"].filter(
            (line): line is string => typeof line === "string",
          )
        : [];
      return {
        lines,
        showRetry: value["showRetry"] === true,
        submitUrl:
          typeof value["submitUrl"] === "string" ? value["submitUrl"] : null,
      };
    } catch {
      // A settings page that renders without its status block is far better
      // than one that does not render.
      return null;
    }
  }

  private _retryAnnounce() {
    if (this._discoverLoading) return;
    this._discoverLoading = true;
    this.dispatchEvent(
      new CustomEvent("jant:settings-save", {
        bubbles: true,
        detail: {
          endpoint: "/settings/general/discover/announce",
          data: {},
          section: "discover",
        },
      }),
    );
  }

  private _renderDiscoverMode(value: "latest" | "featured", current: string) {
    const label =
      value === "latest"
        ? this.labels.discoverLatest
        : this.labels.discoverFeatured;
    const hint =
      value === "latest"
        ? this.labels.discoverLatestHint
        : this.labels.discoverFeaturedHint;

    return html`
      <label class="flex items-start gap-2 cursor-pointer">
        <input
          type="radio"
          class="mt-1"
          name="discover-mode"
          .checked=${current === value}
          ?disabled=${this._discoverLoading}
          @change=${() => this._onDiscoverMode(value)}
        />
        <span class="flex flex-col">
          <span>${label}</span>
          <span class="text-sm text-muted-foreground">${hint}</span>
        </span>
      </label>
    `;
  }

  render() {
    return html`
      <div class="flex flex-col">
        ${this._renderGeneralForm()} ${this._renderSearchForm()}
      </div>
    `;
  }
}

customElements.define("jant-settings-general", JantSettingsGeneral);
