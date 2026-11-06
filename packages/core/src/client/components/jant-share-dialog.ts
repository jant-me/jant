/**
 * Share Dialog
 *
 * "Share as image" from the post menu: lays out the post's share card,
 * paints it as a PNG (`share-capture.ts`), and offers the image to download,
 * hand to the system share sheet, or copy. On a phone the image itself is
 * the save button — press and hold.
 *
 * The card is on screen before the picture is: once it is laid out, the
 * dialog shows it faded, as a print still developing, and the finished PNG
 * takes its place at full strength. The two are the same pixels, so the
 * swap shows only as the card coming up to strength.
 *
 * Light DOM only — BaseCoat and the author stylesheet apply directly.
 */

import { LitElement, html, nothing, svg } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import {
  prepareShareCard,
  type PreparedShareCard,
  type ShareImage,
} from "../share-capture.js";
import { showToast } from "../toast.js";

type ShareStatus = "loading" | "developing" | "ready" | "error";

function pngFile(blob: Blob, fileName: string): File {
  return new File([blob], fileName, { type: "image/png" });
}

/** Whether the system share sheet takes a PNG as a file. */
function canShareImage(): boolean {
  try {
    return (
      navigator.canShare?.({ files: [pngFile(new Blob(), "post.png")] }) ??
      false
    );
  } catch {
    return false;
  }
}

function canCopyImage(): boolean {
  return (
    globalThis.isSecureContext &&
    typeof globalThis.ClipboardItem === "function" &&
    typeof navigator.clipboard?.write === "function"
  );
}

/** A Lucide icon for a button, in the post menu's stroke. */
function icon(paths: ReturnType<typeof svg>) {
  return html`<svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    ${paths}
  </svg>`;
}

const ICON_SHARE = svg`<path d="M12 2v13" /><path d="m16 6-4-4-4 4" /><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />`;
const ICON_COPY = svg`<rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />`;
const ICON_DOWNLOAD = svg`<path d="M12 15V3" /><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" />`;
const ICON_CLOSE = svg`<path d="M18 6 6 18" /><path d="m6 6 12 12" />`;

/** Resolves once the image at `url` is decoded and can show at once. */
async function decoded(url: string): Promise<void> {
  const image = new Image();
  image.src = url;
  await image.decode();
}

export class JantShareDialog extends LitElement {
  static properties = {
    _open: { state: true },
    _status: { state: true },
    _card: { state: true },
    _imageUrl: { state: true },
  };

  declare _open: boolean;
  declare _status: ShareStatus;
  /** The laid-out card, shown while its picture is painted. */
  declare _card: { html: string; width: number; height: number } | null;
  declare _imageUrl: string;

  #image: ShareImage | null = null;
  #prepared: PreparedShareCard | null = null;
  #loadCard: () => Promise<string> = () => Promise.reject(new Error());
  #returnFocus: HTMLElement | null = null;
  /** Bumped per generation, so a capture that finishes late is dropped. */
  #generation = 0;

  constructor() {
    super();
    this._open = false;
    this._status = "loading";
    this._card = null;
    this._imageUrl = "";
  }

  createRenderRoot() {
    return this;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("resize", this.#fitCard);
    this.#reset();
  }

  updated() {
    this.#fitCard();
  }

  /**
   * Open the dialog and start painting the post.
   *
   * @param loadCard - Fetches the card's markup; called again by "Try again"
   * @param returnFocus - Element to focus again on close
   */
  async open(
    loadCard: () => Promise<string>,
    returnFocus: HTMLElement | null,
  ): Promise<void> {
    this.#loadCard = loadCard;
    this.#returnFocus = returnFocus;
    this._open = true;
    document.body.style.overflow = "hidden";
    window.addEventListener("resize", this.#fitCard);
    await this.updateComplete;
    this.querySelector<HTMLDialogElement>(".share-dialog")?.showModal();
    this.querySelector<HTMLElement>(".share-dialog-panel")?.focus();
    await this.#generate();
  }

  async #generate(): Promise<void> {
    const generation = ++this.#generation;
    const current = () => generation === this.#generation && this._open;
    this.#reset();
    this._status = "loading";
    try {
      const prepared = await prepareShareCard(await this.#loadCard());
      if (!current()) {
        prepared.dispose();
        return;
      }
      this.#prepared = prepared;
      this._card = {
        html: prepared.html,
        width: prepared.width,
        height: prepared.height,
      };
      this._status = "developing";

      const image = await prepared.capture();
      this.#prepared = null;
      if (!current()) return;
      const url = URL.createObjectURL(image.blob);
      // Swapped in only once it can paint, so the card never blinks out.
      await decoded(url).catch(() => {});
      if (!current()) {
        URL.revokeObjectURL(url);
        return;
      }
      this.#image = image;
      this._imageUrl = url;
      this._status = "ready";
    } catch {
      if (!current()) return;
      this.#reset();
      this._status = "error";
    }
  }

  /** Drop the card and the image, and anything still laid out off screen. */
  #reset(): void {
    this.#prepared?.dispose();
    this.#prepared = null;
    if (this._imageUrl) URL.revokeObjectURL(this._imageUrl);
    this._imageUrl = "";
    this._card = null;
    this.#image = null;
  }

  /** Scale the laid-out card, 540 px wide, to the preview's width. */
  #fitCard = () => {
    const print = this.querySelector<HTMLElement>(".share-dialog-print");
    const card = print?.querySelector<HTMLElement>(".share-dialog-card");
    if (!print || !card || !this._card) return;
    card.style.transform = `scale(${print.clientWidth / this._card.width})`;
  };

  #close(): void {
    this.#generation++;
    this.querySelector<HTMLDialogElement>(".share-dialog")?.close();
    document.body.style.overflow = "";
    window.removeEventListener("resize", this.#fitCard);
    this._open = false;
    this.#reset();
    const target = this.#returnFocus;
    this.#returnFocus = null;
    queueMicrotask(() => {
      if (target?.isConnected) target.focus();
    });
  }

  #download(): void {
    if (!this.#image || !this._imageUrl) return;
    const link = document.createElement("a");
    link.href = this._imageUrl;
    link.download = this.#image.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async #share(): Promise<void> {
    if (!this.#image) return;
    try {
      await navigator.share({
        files: [pngFile(this.#image.blob, this.#image.fileName)],
      });
    } catch (error) {
      if (
        error instanceof globalThis.DOMException &&
        error.name === "AbortError"
      ) {
        return;
      }
      showToast("Could not share the image. Download it instead.", "error");
    }
  }

  async #copy(): Promise<void> {
    if (!this.#image) return;
    try {
      await navigator.clipboard.write([
        new globalThis.ClipboardItem({ "image/png": this.#image.blob }),
      ]);
      showToast("Image copied.");
    } catch {
      showToast("Could not copy the image. Download it instead.", "error");
    }
  }

  #handleKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.#close();
    }
  };

  #renderPrint() {
    const card = this._card;
    const content =
      this._status === "ready"
        ? html`<img
            class="share-dialog-image"
            src=${this._imageUrl}
            alt="This post as an image"
          />`
        : card
          ? html`<div class="share-dialog-card" inert>
              ${unsafeHTML(card.html)}
            </div>`
          : html`<div class="share-dialog-blank"></div>`;
    return html`
      <div
        class="share-dialog-print"
        data-status=${this._status}
        style=${card ? `aspect-ratio: ${card.width} / ${card.height}` : ""}
      >
        ${content}
      </div>
    `;
  }

  #renderPreview() {
    if (this._status !== "error") return this.#renderPrint();
    return html`
      <p class="share-dialog-status">
        Could not create the image. Check your connection and try again.
      </p>
      <button
        type="button"
        class="btn-outline"
        @click=${() => void this.#generate()}
      >
        Try again
      </button>
    `;
  }

  #renderNote() {
    switch (this._status) {
      case "loading":
      case "developing":
        return "Creating the image…";
      case "ready":
        return html`<span class="share-dialog-hint"
          >Press and hold the image to save it.</span
        >`;
      case "error":
        return nothing;
    }
  }

  /**
   * On a phone the actions sit two to a row and the dialog closes from the
   * bottom one, in reach of a thumb; the corner close is for wider screens.
   */
  #renderActions() {
    if (this._status === "error") return nothing;
    const ready = this._status === "ready";
    return html`
      <footer class="share-dialog-actions">
        ${
          canShareImage()
            ? html`<button
                type="button"
                class="btn-outline"
                ?disabled=${!ready}
                @click=${() => void this.#share()}
              >
                ${icon(ICON_SHARE)} Share…
              </button>`
            : nothing
        }
        ${
          canCopyImage()
            ? html`<button
                type="button"
                class="btn-outline"
                ?disabled=${!ready}
                @click=${() => void this.#copy()}
              >
                ${icon(ICON_COPY)} Copy image
              </button>`
            : nothing
        }
        <button
          type="button"
          class="btn-outline share-dialog-close"
          @click=${() => this.#close()}
        >
          ${icon(ICON_CLOSE)} Close
        </button>
        <button
          type="button"
          class="btn"
          ?disabled=${!ready}
          @click=${() => this.#download()}
        >
          ${icon(ICON_DOWNLOAD)} Download
        </button>
      </footer>
    `;
  }

  render() {
    if (!this._open) return nothing;
    return html`
      <dialog
        class="dialog share-dialog"
        @cancel=${(event: Event) => {
          event.preventDefault();
          this.#close();
        }}
        @keydown=${this.#handleKeydown}
        @click=${(event: Event) => {
          if ((event.target as HTMLElement).tagName === "DIALOG") this.#close();
        }}
      >
        <div
          class="share-dialog-panel"
          tabindex="-1"
          role="document"
          aria-labelledby="share-dialog-title"
        >
          <header>
            <h2 id="share-dialog-title">Share as image</h2>
          </header>
          <section class="share-dialog-preview" data-status=${this._status}>
            ${this.#renderPreview()}
          </section>
          <p class="share-dialog-note" aria-live="polite">
            ${this.#renderNote()}
          </p>
          ${this.#renderActions()}
          <button
            type="button"
            aria-label="Close"
            @click=${() => this.#close()}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </dialog>
    `;
  }
}

customElements.define("jant-share-dialog", JantShareDialog);
