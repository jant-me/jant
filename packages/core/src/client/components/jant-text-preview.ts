/**
 * Text Preview Dialog
 *
 * Displays attached text content (TipTap-authored) in a modal dialog.
 * Intercepts clicks on [data-text-preview-url] buttons, fetches the
 * pre-rendered HTML from the storage proxy, and renders it in a native
 * <dialog>.
 *
 * Light DOM only — BaseCoat and Tailwind classes apply directly.
 */

import { LitElement, html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { showToast } from "../toast.js";

export class JantTextPreview extends LitElement {
  static properties = {
    _open: { state: true },
    _html: { state: true },
    _loading: { state: true },
    _copied: { state: true },
    _linkCopied: { state: true },
  };

  declare _open: boolean;
  declare _html: string;
  declare _loading: boolean;
  declare _copied: boolean;
  declare _linkCopied: boolean;
  /** Raw text for the copy button (markdown / plain text source) */
  #rawText = "";
  /** Shareable URL for this text attachment */
  #shareHref = "";
  #focusReturnTarget: HTMLElement | null = null;
  /** When auto-opened via deep link, the post URL to restore on close */
  #postHref: string | null = null;
  /** When auto-opened via deep link, the post page title to restore on close */
  #postTitle: string | null = null;

  createRenderRoot() {
    this.innerHTML = "";
    return this;
  }

  constructor() {
    super();
    this._open = false;
    this._html = "";
    this._loading = false;
    this._copied = false;
    this._linkCopied = false;
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("click", this.#handleDocumentClick);
    this.#checkAutoOpen();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("click", this.#handleDocumentClick);
  }

  /**
   * Check for a server-rendered auto-open payload and open the dialog
   * immediately with the pre-rendered content (no API fetch needed).
   *
   * The SSR response includes a visible `<dialog open>` with the content
   * (class `text-preview-dialog--ssr`) so the user sees the overlay before
   * JS loads. This method reads its HTML, opens the Lit-managed dialog,
   * then removes the SSR one.
   */
  async #checkAutoOpen() {
    const ssrDialog = document.querySelector<HTMLDialogElement>(
      ".text-preview-dialog--ssr",
    );
    const script = document.getElementById("text-preview-autoopen");
    if (!ssrDialog && !script) return;

    try {
      const meta = JSON.parse(script?.textContent || "{}") as {
        shareHref?: string;
        postHref?: string;
        postTitle?: string;
        mediaId?: string;
      };
      script?.remove();

      // Read content from SSR dialog (avoids duplicating HTML in the script)
      const ssrBody =
        ssrDialog?.querySelector<HTMLElement>(".text-preview-body");
      const contentHtml = ssrBody?.innerHTML || "";
      const contentText = ssrBody?.innerText || "";

      this.#shareHref = meta.shareHref
        ? `${globalThis.location.origin}${meta.shareHref}`
        : "";
      this.#postHref = meta.postHref || null;
      this.#postTitle = meta.postTitle || null;
      this._html = contentHtml;
      // Plain-text fallback for the Copy button — good enough if the
      // lazy markdown fetch below fails. Gets overwritten with proper
      // markdown as soon as the API responds.
      this.#rawText = contentText;
      this._open = true;

      document.body.style.overflow = "hidden";

      await this.updateComplete;
      this.requestUpdate(); // re-evaluate #rawText-dependent disabled state

      this.querySelector<HTMLDialogElement>(
        ".text-preview-dialog",
      )?.showModal();
      this.querySelector<HTMLElement>(".text-preview-content")?.focus();

      // Remove SSR dialog now that the Lit-managed modal is showing
      ssrDialog?.remove();

      // Upgrade `#rawText` from plain text to the real markdown source
      // so Copy-as-markdown works on deep-link opens too. Fire-and-forget:
      // if it fails we keep the plain-text fallback.
      if (meta.mediaId) {
        void this.#loadMarkdownSource(meta.mediaId);
      }
    } catch {
      // Malformed payload — clean up SSR dialog
      ssrDialog?.remove();
    }
  }

  async #loadMarkdownSource(mediaId: string): Promise<void> {
    try {
      const res = await fetch(`/api/media/${mediaId}/content`);
      if (!res.ok) return;
      const contentType = res.headers.get("Content-Type") || "";
      if (!contentType.includes("application/json")) return;
      const payload = (await res.json()) as { markdown?: string };
      if (payload.markdown) {
        this.#rawText = payload.markdown;
        this.requestUpdate();
      }
    } catch {
      // Non-fatal — the plain-text fallback is already in place.
    }
  }

  #handleDocumentClick = (e: Event) => {
    const target = e.target as HTMLElement;
    const btn = target.closest<HTMLButtonElement>("[data-text-preview-id]");
    if (!btn) return;

    e.preventDefault();
    const mediaId = btn.dataset.textPreviewId;
    if (mediaId)
      this.#openPreview(mediaId, btn.dataset.textPreviewHref ?? "", btn);
  };

  async #openPreview(mediaId: string, shareHref: string, trigger: HTMLElement) {
    this.#focusReturnTarget = trigger;
    this.#shareHref = shareHref
      ? `${globalThis.location.origin}${shareHref}`
      : "";
    this._loading = true;
    this._open = true;

    document.body.style.overflow = "hidden";

    await this.updateComplete;
    this.querySelector<HTMLDialogElement>(".text-preview-dialog")?.showModal();
    this.querySelector<HTMLElement>(".text-preview-content")?.focus();

    try {
      const res = await fetch(`/api/media/${mediaId}/content`);
      if (!res.ok) throw new Error("Fetch failed");

      // For text attachments the endpoint returns a JSON envelope with
      // both the rendered HTML (for display) and the markdown source
      // (for the Copy button). Other media fall back to a bytes proxy
      // and end up in the `text/*` branch below.
      const contentType = res.headers.get("Content-Type") || "";
      if (contentType.includes("application/json")) {
        const payload = (await res.json()) as {
          html?: string;
          markdown?: string;
        };
        this._html = payload.html ?? "";
        this.#rawText = payload.markdown ?? "";
      } else {
        const raw = await res.text();
        this._html = raw;
        const scratch = document.createElement("div");
        scratch.innerHTML = raw;
        this.#rawText = scratch.innerText.trim();
      }
    } catch {
      this._html = "<p>Failed to load content.</p>";
      this.#rawText = "";
    } finally {
      this._loading = false;
    }
  }

  #close() {
    this.querySelector<HTMLDialogElement>(".text-preview-dialog")?.close();
    document.body.style.overflow = "";
    this._open = false;
    this._html = "";
    this.#rawText = "";
    this.#shareHref = "";
    this._copied = false;
    this._linkCopied = false;

    // When auto-opened via deep link, navigate to the parent post URL
    // and restore the post page title
    if (this.#postHref) {
      const postHref = this.#postHref;
      this.#postHref = null;
      globalThis.history.replaceState(null, "", postHref);
      if (this.#postTitle) {
        document.title = this.#postTitle;
        this.#postTitle = null;
      }
    }

    const restoreTarget = this.#focusReturnTarget;
    this.#focusReturnTarget = null;
    queueMicrotask(() => {
      if (restoreTarget?.isConnected) {
        restoreTarget.focus();
      }
    });
  }

  async #copy() {
    if (!this.#rawText) return;
    try {
      await globalThis.navigator.clipboard.writeText(this.#rawText);
      this._copied = true;
      showToast("Copied.");
      setTimeout(() => {
        this._copied = false;
      }, 2000);
    } catch {
      showToast("Could not copy.", "error");
    }
  }

  async #copyLink() {
    if (!this.#shareHref) return;
    try {
      await globalThis.navigator.clipboard.writeText(this.#shareHref);
      this._linkCopied = true;
      showToast("Link copied.");
      setTimeout(() => {
        this._linkCopied = false;
      }, 2000);
    } catch {
      showToast("Could not copy.", "error");
    }
  }

  #handleKeydown = (e: globalThis.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.#close();
    }
  };

  render() {
    if (!this._open) return nothing;

    return html`
      <dialog
        class="text-preview-dialog"
        @cancel=${(e: Event) => {
          e.preventDefault();
          this.#close();
        }}
        @keydown=${this.#handleKeydown}
        @click=${(e: Event) => {
          // Close on backdrop click
          if ((e.target as HTMLElement).tagName === "DIALOG") {
            this.#close();
          }
        }}
      >
        <div class="text-preview-content" tabindex="-1">
          <div class="text-preview-toolbar">
            <button
              type="button"
              class="text-preview-btn"
              @click=${() => this.#close()}
              title="Close"
              aria-label="Close"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
            <div class="text-preview-toolbar-actions">
              ${
                this.#shareHref
                  ? html`<button
                      type="button"
                      class="text-preview-btn"
                      @click=${() => this.#copyLink()}
                      ?disabled=${this._loading}
                      title="Copy link"
                      aria-label="Copy shareable link"
                    >
                      ${
                        this._linkCopied
                          ? html`<svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                            >
                              <path d="M20 6 9 17l-5-5" />
                            </svg>`
                          : html`<svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                            >
                              <path
                                d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"
                              />
                              <path
                                d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
                              />
                            </svg>`
                      }
                    </button>`
                  : nothing
              }
              <button
                type="button"
                class="text-preview-btn"
                @click=${() => this.#copy()}
                ?disabled=${this._loading || !this.#rawText}
                title="Copy text"
                aria-label="Copy text content"
              >
                ${
                  this._copied
                    ? html`<svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d="M20 6 9 17l-5-5" />
                      </svg>`
                    : html`<svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <rect width="14" height="14" x="8" y="8" rx="2" />
                        <path
                          d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"
                        />
                      </svg>`
                }
              </button>
            </div>
          </div>
          ${
            this._loading
              ? html`<div class="text-preview-loading">
                  <svg
                    class="animate-spin size-5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                </div>`
              : html`<div class="text-preview-body prose">
                  ${unsafeHTML(this._html)}
                </div>`
          }
        </div>
      </dialog>
    `;
  }
}

customElements.define("jant-text-preview", JantTextPreview);
