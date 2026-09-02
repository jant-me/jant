import { html, nothing } from "lit";
import { unsafeSVG } from "lit/directives/unsafe-svg.js";
import type { JantPostForm } from "./jant-post-form.js";
import type { PostMediaItem } from "./post-form-types.js";
import { getMediaCategory } from "../../lib/upload.js";

function renderFileIcon(mimeType: string) {
  const doc = `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>`;

  let inner: string;
  if (mimeType === "application/pdf") {
    inner = `<text x="12" y="16.5" text-anchor="middle" fill="currentColor" stroke="none" font-size="6" font-weight="700" font-family="system-ui, sans-serif">PDF</text>`;
  } else if (mimeType === "text/markdown") {
    inner = `<text x="12" y="16.5" text-anchor="middle" fill="currentColor" stroke="none" font-size="10" font-weight="700" font-family="system-ui, sans-serif">#</text>`;
  } else if (mimeType === "text/csv") {
    inner = `<line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="15" x2="16" y2="15"/><line x1="8" y1="18" x2="16" y2="18"/><line x1="10.7" y1="12" x2="10.7" y2="18"/><line x1="13.3" y1="12" x2="13.3" y2="18"/>`;
  } else if (getMediaCategory(mimeType) === "archive") {
    inner = `<line x1="12" y1="10" x2="12" y2="11.5"/><line x1="12" y1="13" x2="12" y2="14.5"/><line x1="12" y1="16" x2="12" y2="17.5"/>`;
  } else if (mimeType.startsWith("audio/")) {
    return html`<svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      ${unsafeSVG(
        `<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>`,
      )}
    </svg>`;
  } else if (mimeType.startsWith("video/")) {
    return html`<svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      ${unsafeSVG(
        `<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>`,
      )}
    </svg>`;
  } else {
    inner = `<line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/>`;
  }

  return html`<svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    ${unsafeSVG(doc + inner)}
  </svg>`;
}

function renderMediaThumb(item: PostMediaItem) {
  const category = getMediaCategory(item.mimeType);

  if (category === "image") {
    return html`<img
      src=${item.thumbUrl}
      alt=${item.alt}
      class="w-full h-full object-cover rounded-lg border"
      loading="lazy"
    />`;
  }

  return html`<div
    class="w-full h-full rounded-lg border bg-muted flex flex-col items-center justify-center gap-1 p-1 text-muted-foreground"
  >
    ${renderFileIcon(item.mimeType)}
    <span class="text-[10px] leading-tight text-center truncate w-full px-1"
      >${item.originalName}</span
    >
  </div>`;
}

function renderMediaList(component: JantPostForm) {
  const { media, labels, _mediaIds } = component;
  if (_mediaIds.length === 0) {
    return html`<p class="text-sm text-muted-foreground">
      ${labels.mediaEmptyLabel}
    </p>`;
  }

  const mediaMap = new Map(media.map((item) => [item.id, item]));

  return html`<div class="grid grid-cols-4 sm:grid-cols-6 gap-2 mb-2">
    ${_mediaIds.map((id) => {
      const item = mediaMap.get(id);
      if (!item) {
        return html`<div
          class="relative group aspect-square rounded-lg border bg-muted flex items-center justify-center text-xs text-muted-foreground"
        >
          ${id}
          <button
            type="button"
            class="absolute top-1 right-1 w-5 h-5 flex items-center justify-center bg-black/60 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            @click=${() => component.removeMedia(id)}
            aria-label=${labels.mediaRemoveButton}
          >
            &times;
          </button>
        </div>`;
      }

      return html`<div class="relative group aspect-square" data-media-id=${id}>
        ${renderMediaThumb(item)}
        <button
          type="button"
          class="absolute top-1 right-1 w-5 h-5 flex items-center justify-center bg-black/60 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
          @click=${() => component.removeMedia(id)}
          aria-label=${labels.mediaRemoveButton}
        >
          &times;
        </button>
      </div>`;
    })}
  </div>`;
}

function renderCollections(component: JantPostForm) {
  if (!component.collections.length) return nothing;

  return html`<div class="field">
    <label class="label">${component.labels.collectionsLabel}</label>
    <div class="flex flex-col gap-1">
      ${component.collections.map((col) => {
        return html`<label class="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            class="checkbox"
            .checked=${component._collectionIds.includes(col.id)}
            @change=${() => component.toggleCollection(col.id)}
          />
          <span>${col.title}</span>
        </label>`;
      })}
    </div>
  </div>`;
}

export function renderPostForm(component: JantPostForm) {
  return html`<form
      class="flex flex-col gap-4 max-w-2xl"
      @submit=${(e: Event) => component.handleSubmit(e)}
    >
      <div class="field">
        <label class="label">${component.labels.formatLabel}</label>
        <select
          class="select"
          .value=${component._format}
          @change=${(e: Event) => {
            const target = e.target as HTMLSelectElement;
            component._format =
              (target.value as typeof component._format) ?? "note";
          }}
        >
          <option value="note">${component.labels.noteOption}</option>
          <option value="link">${component.labels.linkOption}</option>
          <option value="quote">${component.labels.quoteOption}</option>
        </select>
      </div>

      <div class="field">
        <label class="label">${component.labels.titleLabel}</label>
        <input
          type="text"
          class="input"
          placeholder=${component.labels.titlePlaceholder}
          .value=${component._title}
          @input=${(e: Event) => component.handleTitleInput(e)}
        />
      </div>

      <div class="field">
        <label class="label">${component.labels.slugLabel}</label>
        <input
          type="text"
          class="input"
          placeholder=${component.labels.slugPlaceholder}
          .value=${component._slug}
          @input=${(e: Event) => component.handleSlugInput(e)}
        />
        ${
          component._slug
            ? html`<p class="text-xs text-muted-foreground mt-1">
                ${component.siteUrl}/${component._slug}
              </p>`
            : html`<p class="text-xs text-muted-foreground mt-1">
                ${component.labels.slugHelp}
              </p>`
        }
      </div>

      <div class="field">
        <label class="label">${component.labels.bodyLabel}</label>
        <div
          class="post-form-tiptap-body compose-tiptap-body border rounded-lg p-3 min-h-32"
        ></div>
      </div>

      <div class="field">
        <label class="label">${component.labels.urlLabel}</label>
        <input
          type="url"
          class="input"
          placeholder=${component.labels.urlPlaceholder}
          .value=${component._url}
          @input=${(e: Event) => component.handleInput("_url", e)}
        />
      </div>

      ${
        component._format === "quote"
          ? html`<div class="field">
              <label class="label">${component.labels.quoteTextLabel}</label>
              <textarea
                class="textarea"
                rows="3"
                placeholder=${component.labels.quoteTextPlaceholder}
                .value=${component._quoteText}
                @input=${(e: Event) => component.handleInput("_quoteText", e)}
              ></textarea>
            </div>`
          : nothing
      }

      <div class="field">
        <label class="label">${component.labels.mediaLabel}</label>
        ${renderMediaList(component)}
        <button
          type="button"
          class="btn-outline text-sm"
          @click=${() => component.openMediaPicker()}
        >
          ${component.labels.mediaAddButton}
        </button>
      </div>

      <div class="field">
        <label class="label">${component.labels.statusLabel}</label>
        <select
          class="select"
          .value=${component._status}
          @change=${(e: Event) => {
            const target = e.target as HTMLSelectElement;
            component._status =
              (target.value as typeof component._status) ?? "published";
          }}
        >
          <option value="published">${component.labels.statusPublished}</option>
          <option value="draft">${component.labels.statusDraft}</option>
        </select>
      </div>

      <div class="field">
        <label class="label">${component.labels.visibilityLabel}</label>
        <select
          class="select"
          .value=${component._visibility}
          @change=${(e: Event) => {
            const target = e.target as HTMLSelectElement;
            component._visibility =
              (target.value as typeof component._visibility) ?? "public";
          }}
        >
          <option value="public">${component.labels.visibilityPublic}</option>
          <option value="latest_hidden">
            ${component.labels.visibilityHiddenFromLatest}
          </option>
        </select>
      </div>

      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          class="checkbox"
          .checked=${component._pinned}
          @change=${(e: Event) => {
            const target = e.target as HTMLInputElement;
            component._pinned = target.checked;
          }}
        />
        ${component.labels.pinnedLabel}
      </label>

      ${renderCollections(component)}

      <div class="flex gap-2">
        <button type="submit" class="btn" ?disabled=${component._loading}>
          ${
            component._loading
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
          ${component.labels.submitLabel}
        </button>
        <a href=${component.cancelHref} class="btn-outline"
          >${component.labels.cancelLabel}</a
        >
      </div>
    </form>

    <dialog
      id="post-media-picker"
      class="p-6 rounded-lg max-w-2xl w-full backdrop:bg-black/50"
      @click=${(event: Event) => {
        if (event.target === event.currentTarget) {
          component.closeMediaPicker();
        }
      }}
    >
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold">
          ${component.labels.mediaDialogTitle}
        </h2>
        <button
          type="button"
          class="btn-outline text-sm"
          @click=${() => component.closeMediaPicker()}
        >
          ${component.labels.mediaDialogDone}
        </button>
      </div>
      <div
        id="post-media-grid"
        class="grid grid-cols-4 gap-2 max-h-96 overflow-y-auto"
      >
        <p class="text-muted-foreground text-sm col-span-4">
          ${component.labels.mediaDialogLoading}
        </p>
      </div>
    </dialog>`;
}
