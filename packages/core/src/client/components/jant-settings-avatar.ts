/**
 * Settings Avatar Section
 *
 * Handles avatar preview, upload button, remove button,
 * and "display in header" toggle with dirty tracking.
 *
 * Upload is handled by the existing avatar-upload.ts script
 * via `[data-avatar-upload]` event delegation (Light DOM).
 * Remove dispatches `jant:avatar-remove` for the bridge.
 *
 * Light DOM only — BaseCoat and Tailwind classes apply directly.
 */

import { LitElement, html, nothing } from "lit";
import type { SettingsLabels } from "./settings-types.js";
import { showConfirmDialog } from "../confirm.js";
import { publicPath } from "../runtime-paths.js";

export class JantSettingsAvatar extends LitElement {
  static properties = {
    avatarUrl: { type: String, attribute: "avatar-url" },
    showInHeader: { type: Boolean, attribute: "show-in-header" },
    labels: { type: Object },
    _showInHeader: { state: true },
    _origShowInHeader: { state: true },
    _dirty: { state: true },
    _loading: { state: true },
    _removeLoading: { state: true },
  };

  declare avatarUrl: string;
  declare showInHeader: boolean;
  declare labels: SettingsLabels;
  declare _showInHeader: boolean;
  declare _origShowInHeader: boolean;
  declare _dirty: boolean;
  declare _loading: boolean;
  declare _removeLoading: boolean;

  createRenderRoot() {
    this.innerHTML = "";
    return this;
  }

  constructor() {
    super();
    this.avatarUrl = "";
    this.showInHeader = false;
    this.labels = {} as SettingsLabels;
    this._showInHeader = false;
    this._origShowInHeader = false;
    this._dirty = false;
    this._loading = false;
    this._removeLoading = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this._showInHeader = this.showInHeader;
    this._origShowInHeader = this.showInHeader;
  }

  /** Called by bridge after successful display save */
  saved() {
    this._origShowInHeader = this._showInHeader;
    this._dirty = false;
    this._loading = false;
  }

  /** Called by bridge on save error */
  saveError() {
    this._loading = false;
  }

  /** Called by bridge on avatar remove error */
  removeError() {
    this._removeLoading = false;
  }

  private _toggleDisplay() {
    this._showInHeader = !this._showInHeader;
    this._dirty = this._showInHeader !== this._origShowInHeader;
  }

  private _cancelDisplay() {
    this._showInHeader = this._origShowInHeader;
    this._dirty = false;
  }

  private _saveDisplay() {
    if (this._loading || !this._dirty) return;
    this._loading = true;
    this.dispatchEvent(
      new CustomEvent("jant:settings-save", {
        bubbles: true,
        detail: {
          endpoint: "/settings/avatar/display",
          data: { showHeaderAvatar: this._showInHeader ? "true" : "" },
          section: "avatar-display",
        },
      }),
    );
  }

  private async _removeAvatar() {
    const confirmed = await showConfirmDialog({
      message: this.labels.confirmRemoveAvatar,
      confirmLabel: this.labels.remove,
      cancelLabel: this.labels.cancel,
      tone: "danger",
    });
    if (!confirmed) return;

    if (this._removeLoading) return;
    this._removeLoading = true;
    this.dispatchEvent(
      new CustomEvent("jant:avatar-remove", {
        bubbles: true,
        detail: { endpoint: "/settings/avatar/remove" },
      }),
    );
  }

  private _renderPreview() {
    const previewClasses =
      "rounded-full size-16 overflow-hidden border border-border/70 bg-muted/40 flex items-center justify-center shrink-0";

    if (this.avatarUrl) {
      return html`
        <div class=${previewClasses}>
          <img
            src=${this.avatarUrl}
            alt=""
            class="w-full h-full object-cover"
          />
        </div>
      `;
    }
    return html`
      <div class="${previewClasses} text-muted-foreground">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
          <circle cx="9" cy="9" r="2" />
          <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
        </svg>
      </div>
    `;
  }

  render() {
    return html`
      <div>
        <h2 class="text-lg font-semibold mb-4">${this.labels.blogAvatar}</h2>
        <div class="flex flex-col gap-4">
          <div class="flex items-center gap-4">
            ${this._renderPreview()}
            <div class="flex flex-col gap-2">
              <form
                action=${publicPath("/settings/avatar")}
                method="post"
                enctype="multipart/form-data"
                class="inline"
              >
                <label class="btn text-sm cursor-pointer">
                  ${this.labels.uploadAvatar}
                  <input
                    type="file"
                    name="file"
                    accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
                    class="hidden"
                    data-avatar-upload
                    data-text-processing=${this.labels.processing}
                    data-text-uploading=${this.labels.uploading}
                    data-text-error=${this.labels.uploadError}
                  />
                </label>
              </form>
              ${
                this.avatarUrl
                  ? html`
                      <button
                        type="button"
                        class="btn-outline text-sm"
                        ?disabled=${this._removeLoading}
                        @click=${() => void this._removeAvatar()}
                      >
                        ${this.labels.remove}
                      </button>
                    `
                  : nothing
              }
            </div>
          </div>
          <p class="text-sm text-muted-foreground">${this.labels.avatarHelp}</p>
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              class="checkbox"
              .checked=${this._showInHeader}
              @change=${this._toggleDisplay}
            />
            <span>${this.labels.displayInHeader}</span>
          </label>
          <div class="flex gap-2 mt-4">
            <button
              type="button"
              class="btn"
              ?disabled=${this._loading || !this._dirty}
              @click=${this._saveDisplay}
            >
              ${
                this._loading
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
            <button
              type="button"
              class="btn-outline"
              ?disabled=${this._loading || !this._dirty}
              @click=${this._cancelDisplay}
            >
              ${this.labels.cancel}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define("jant-settings-avatar", JantSettingsAvatar);
