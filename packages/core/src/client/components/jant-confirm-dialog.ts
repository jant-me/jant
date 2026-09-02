/**
 * Shared confirm dialog.
 *
 * Mounted once at the document body level and opened through `showConfirmDialog()`
 * or the global `jantConfirm()` helper used by Datastar expressions.
 */

import { LitElement, html, nothing } from "lit";
import type {
  ConfirmDialogOptions,
  ConfirmDialogTone,
} from "../../lib/confirm.js";

interface ConfirmDialogRequest extends ConfirmDialogOptions {
  resolve: (value: boolean) => void;
}

const DEFAULT_TONE: ConfirmDialogTone = "default";

export class JantConfirmDialog extends LitElement {
  static properties = {
    _open: { state: true },
    _title: { state: true },
    _message: { state: true },
    _confirmLabel: { state: true },
    _cancelLabel: { state: true },
    _tone: { state: true },
  };

  declare _open: boolean;
  declare _title: string;
  declare _message: string;
  declare _confirmLabel: string;
  declare _cancelLabel: string;
  declare _tone: ConfirmDialogTone;

  #queue: ConfirmDialogRequest[] = [];
  #current: ConfirmDialogRequest | null = null;

  createRenderRoot() {
    this.innerHTML = "";
    return this;
  }

  constructor() {
    super();
    this._open = false;
    this._title = "";
    this._message = "";
    this._confirmLabel = "";
    this._cancelLabel = "";
    this._tone = DEFAULT_TONE;
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    const pending = this.#current;
    this.#current = null;
    pending?.resolve(false);

    for (const request of this.#queue.splice(0)) {
      request.resolve(false);
    }
  }

  async confirm(options: ConfirmDialogOptions): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
      this.#queue.push({
        ...options,
        tone: options.tone ?? DEFAULT_TONE,
        resolve,
      });

      if (!this.#current) {
        void this.#openNext();
      }
    });
  }

  async #openNext() {
    if (this.#current || this.#queue.length === 0) return;

    const next = this.#queue.shift();
    if (!next) return;

    this.#current = next;
    this._title = next.title ?? "";
    this._message = next.message;
    this._confirmLabel = next.confirmLabel;
    this._cancelLabel = next.cancelLabel;
    this._tone = next.tone ?? DEFAULT_TONE;
    this._open = true;

    await this.updateComplete;

    const dialog = this.querySelector<HTMLDialogElement>(".confirm-dialog");
    if (!dialog) return;

    if (!dialog.open) dialog.showModal();

    const panel = dialog.querySelector<HTMLElement>(".confirm-dialog-panel");
    panel?.focus();
  }

  #finish(confirmed: boolean) {
    const current = this.#current;
    if (!current) return;

    this.#current = null;

    const dialog = this.querySelector<HTMLDialogElement>(".confirm-dialog");
    if (dialog?.open) dialog.close();

    this._open = false;
    this._title = "";
    this._message = "";
    this._confirmLabel = "";
    this._cancelLabel = "";
    this._tone = DEFAULT_TONE;

    current.resolve(confirmed);
    queueMicrotask(() => void this.#openNext());
  }

  #handleCancel = (event: Event) => {
    event.preventDefault();
    this.#finish(false);
  };

  #handleBackdropClick = (event: Event) => {
    if (event.target === event.currentTarget) {
      this.#finish(false);
    }
  };

  #handleKeydown = (event: globalThis.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.#finish(false);
      return;
    }

    const target = event.target;
    const isFormControl =
      target instanceof HTMLButtonElement ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLAnchorElement;

    if (
      event.key === "Enter" &&
      !event.defaultPrevented &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      !isFormControl
    ) {
      event.preventDefault();
      this.#finish(true);
    }
  };

  #resolveCopy() {
    if (this._title) {
      return {
        title: this._title,
        message: this._message,
      };
    }

    const parts = this._message.match(/^(.+?[?？])\s+(.+)$/u);
    if (parts) {
      return {
        title: parts[1],
        message: parts[2],
      };
    }

    return {
      title: this._message,
      message: "",
    };
  }

  render() {
    if (!this._open) return nothing;

    const { title, message } = this.#resolveCopy();
    const confirmClass = this._tone === "danger" ? "btn-destructive" : "btn";

    return html`
      <dialog
        class="dialog confirm-dialog"
        @cancel=${this.#handleCancel}
        @click=${this.#handleBackdropClick}
        @keydown=${this.#handleKeydown}
      >
        <div
          class="confirm-dialog-panel"
          data-tone=${this._tone}
          tabindex="-1"
          role="document"
          aria-labelledby="confirm-dialog-title"
          aria-describedby=${
            message ? "confirm-dialog-message" : "confirm-dialog-title"
          }
        >
          <header class="confirm-dialog-header">
            <h2 id="confirm-dialog-title" class="confirm-dialog-title">
              ${title}
            </h2>
            ${
              message
                ? html`<p
                    id="confirm-dialog-message"
                    class="confirm-dialog-message"
                  >
                    ${message}
                  </p>`
                : nothing
            }
          </header>
          <footer class="confirm-dialog-actions">
            <button
              type="button"
              class="btn-outline"
              @click=${() => this.#finish(false)}
            >
              ${this._cancelLabel}
            </button>
            <button
              type="button"
              class=${confirmClass}
              @click=${() => this.#finish(true)}
            >
              ${this._confirmLabel}
            </button>
          </footer>
        </div>
      </dialog>
    `;
  }
}

if (!customElements.get("jant-confirm-dialog")) {
  customElements.define("jant-confirm-dialog", JantConfirmDialog);
}
