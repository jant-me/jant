/**
 * Custom Image Node with Ghost-Style NodeView
 *
 * Replaces @tiptap/extension-image with a block-level figure that supports:
 * - Caption and alt text editing (Ghost-style inline bar)
 * - Layout variants (regular / wide / full)
 * - Link wrapping, image replacement, and lightbox preview
 * - Toolbar shown on selection
 */

import {
  canInsertNode,
  isNodeSelection,
  Node,
  type Editor,
} from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { moveSelectionAfterBlockInsertion } from "./block-insertion.js";
import type { EditorView } from "@tiptap/pm/view";
import { uploadWithMetadata } from "../upload-with-metadata.js";
import { renderMarkdownImage } from "../../lib/rich-image.js";

export const INLINE_IMAGE_LOAD_STATE_EVENT = "jant:inline-image-load-state";

export interface ImageNodeLabels {
  unavailable: string;
  delete: string;
  replace: string;
  open: string;
}

const DEFAULT_IMAGE_NODE_LABELS: ImageNodeLabels = {
  unavailable: "Image unavailable",
  delete: "Delete image",
  replace: "Replace image",
  open: "Open image URL",
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    image: {
      setImage: (options: {
        src: string;
        alt?: string;
        title?: string;
        caption?: string;
        href?: string;
        layout?: string;
      }) => ReturnType;
    };
  }
}

// ---------------------------------------------------------------------------
// SVG icon helpers (inline, 16×16)
// ---------------------------------------------------------------------------

const ICONS = {
  /** Broken image placeholder */
  imageBroken: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m5 17 4.25-4.25 2.5 2.5 1.75-1.75L19 19"/><path d="m4 4 16 16"/></svg>`,
  /** Content-width — centered column */
  regular: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="3" y="3" width="10" height="10" rx="1.5"/></svg>`,
  /** Wide — max 1200 px breakout */
  wide: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="1.5" y="4" width="13" height="8" rx="1.5"/></svg>`,
  /** Full — edge-to-edge viewport */
  full: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="0.75" y="3" width="14.5" height="10" rx="1"/><path d="M4 8h8M4 6l-1.5 2L4 10M12 6l1.5 2L12 10"/></svg>`,
  /** Link */
  link: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  /** Replace / swap */
  replace: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>`,
  /** Expand / fullscreen preview */
  expand: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>`,
} as const;

// ---------------------------------------------------------------------------
// NodeView (vanilla DOM)
// ---------------------------------------------------------------------------

class ImageNodeView {
  dom: HTMLElement;

  private img: HTMLImageElement;
  private missingPanel: HTMLElement;
  private missingSource: HTMLElement;
  private openBtn: HTMLButtonElement;
  private figcaption: HTMLElement;
  private captionInput: HTMLInputElement;
  private altBtn: HTMLButtonElement;
  private toolbar: HTMLElement;
  private captionBar: HTMLElement;
  private layoutBtns: Map<string, HTMLButtonElement> = new Map();

  private node: ProseMirrorNode;
  private view: EditorView;
  private getPos: () => number | undefined;
  private editor: Editor;
  private labels: ImageNodeLabels;

  private editingAlt = false;
  private missing = false;
  private currentSrc = "";

  constructor(
    node: ProseMirrorNode,
    view: EditorView,
    getPos: () => number | undefined,
    editor: Editor,
    labels: ImageNodeLabels,
  ) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.editor = editor;
    this.labels = labels;

    // --- Build DOM tree ---
    const figure = document.createElement("figure");
    // `not-prose`: this is editor chrome, not post content, so the reader's
    // typography defaults stay out of its controls.
    figure.className = "tiptap-image-figure not-prose";
    figure.dataset.selected = "false";
    figure.dataset.layout = String(node.attrs.layout || "regular");
    figure.dataset.loadState = "loading";
    this.dom = figure;

    // Image container
    const container = document.createElement("div");
    container.className = "tiptap-image-container";
    figure.appendChild(container);

    // <img>
    const img = document.createElement("img");
    img.draggable = false;
    img.addEventListener("load", () => this.setMissing(false));
    img.addEventListener("error", () => this.setMissing(true));
    container.appendChild(img);
    this.img = img;

    // --- Missing image panel ---
    const missingPanel = document.createElement("div");
    missingPanel.className = "tiptap-image-missing";
    missingPanel.role = "group";
    missingPanel.tabIndex = 0;
    missingPanel.setAttribute("aria-label", labels.unavailable);
    missingPanel.addEventListener("keydown", (e) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      e.preventDefault();
      this.deleteNode();
    });
    container.appendChild(missingPanel);
    this.missingPanel = missingPanel;

    const missingIcon = document.createElement("span");
    missingIcon.className = "tiptap-image-missing-icon";
    missingIcon.setAttribute("aria-hidden", "true");
    missingIcon.innerHTML = ICONS.imageBroken;
    missingPanel.appendChild(missingIcon);

    const missingCopy = document.createElement("span");
    missingCopy.className = "tiptap-image-missing-copy";
    missingPanel.appendChild(missingCopy);

    const missingTitle = document.createElement("strong");
    missingTitle.textContent = labels.unavailable;
    missingCopy.appendChild(missingTitle);

    const missingSource = document.createElement("span");
    missingSource.className = "tiptap-image-missing-source";
    missingCopy.appendChild(missingSource);
    this.missingSource = missingSource;

    const missingActions = document.createElement("span");
    missingActions.className = "tiptap-image-missing-actions";
    missingPanel.appendChild(missingActions);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "tiptap-image-missing-delete";
    deleteBtn.textContent = labels.delete;
    deleteBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      this.deleteNode();
    });
    missingActions.appendChild(deleteBtn);

    const replaceMissingBtn = document.createElement("button");
    replaceMissingBtn.type = "button";
    replaceMissingBtn.textContent = labels.replace;
    replaceMissingBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      this.handleReplace();
    });
    missingActions.appendChild(replaceMissingBtn);

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.textContent = labels.open;
    openBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      this.handleOpenOriginal();
    });
    missingActions.appendChild(openBtn);
    this.openBtn = openBtn;

    // --- Toolbar (shown when selected) ---
    const toolbar = document.createElement("div");
    toolbar.className = "tiptap-image-toolbar";
    container.appendChild(toolbar);
    this.toolbar = toolbar;

    const layouts: Array<[string, string, string]> = [
      ["regular", ICONS.regular, "Content width"],
      ["wide", ICONS.wide, "Wide \u2014 max 1200px"],
      ["full", ICONS.full, "Full width \u2014 edge to edge"],
    ];
    for (const [value, icon, title] of layouts) {
      if (this.layoutBtns.size > 0) toolbar.appendChild(this.sep());
      const btn = document.createElement("button");
      btn.type = "button";
      btn.innerHTML = icon;
      btn.title = title;
      btn.dataset.layout = value;
      if (value === (node.attrs.layout || "regular"))
        btn.className = "is-active";
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.updateAttrs({ layout: value });
      });
      toolbar.appendChild(btn);
      this.layoutBtns.set(value, btn);
    }

    // Link button
    toolbar.appendChild(this.sep());
    const linkBtn = this.iconBtn(ICONS.link, "Add link");
    linkBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      this.handleLink();
    });
    toolbar.appendChild(linkBtn);

    // Replace button
    toolbar.appendChild(this.sep());
    const replaceBtn = this.iconBtn(ICONS.replace, "Replace image");
    replaceBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      this.handleReplace();
    });
    toolbar.appendChild(replaceBtn);

    // Expand button
    toolbar.appendChild(this.sep());
    const expandBtn = this.iconBtn(ICONS.expand, "Preview fullscreen");
    expandBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      this.handleExpand();
    });
    toolbar.appendChild(expandBtn);

    // --- Caption bar (shown when selected, directly below image) ---
    const captionBar = document.createElement("div");
    captionBar.className = "tiptap-image-caption-bar";
    figure.appendChild(captionBar);
    this.captionBar = captionBar;

    const captionInput = document.createElement("input");
    captionInput.type = "text";
    captionInput.placeholder = "Add a caption\u2026";
    captionInput.value = String(node.attrs.caption ?? "");
    captionInput.addEventListener("input", () => {
      if (this.editingAlt) {
        this.updateAttrs({ alt: captionInput.value });
      } else {
        this.updateAttrs({ caption: captionInput.value });
      }
    });
    captionInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.view.focus();
      }
    });
    captionBar.appendChild(captionInput);
    this.captionInput = captionInput;

    const altBtn = document.createElement("button");
    altBtn.type = "button";
    altBtn.className = "tiptap-image-alt-btn";
    altBtn.textContent = "Alt";
    altBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      this.toggleAltMode();
    });
    captionBar.appendChild(altBtn);
    this.altBtn = altBtn;

    // --- Static figcaption (shown when NOT selected, if caption exists) ---
    const figcaption = document.createElement("figcaption");
    figcaption.className = "tiptap-image-figcaption";
    figcaption.textContent = String(node.attrs.caption ?? "");
    figure.appendChild(figcaption);
    this.figcaption = figcaption;

    this.syncImageAttrs(node);
  }

  // --- ProseMirror NodeView interface ---

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;

    // Sync DOM with new attrs
    this.syncImageAttrs(node);

    this.dom.dataset.layout = String(node.attrs.layout || "regular");
    this.layoutBtns.forEach((btn, value) => {
      btn.classList.toggle(
        "is-active",
        value === (node.attrs.layout || "regular"),
      );
    });

    const caption = String(node.attrs.caption ?? "");
    this.figcaption.textContent = caption;

    // Sync input value (only if user isn't actively editing)
    if (document.activeElement !== this.captionInput) {
      if (this.editingAlt) {
        this.captionInput.value = String(node.attrs.alt ?? "");
      } else {
        this.captionInput.value = caption;
      }
    }

    return true;
  }

  selectNode() {
    this.dom.dataset.selected = "true";
  }

  deselectNode() {
    this.dom.dataset.selected = "false";
    this.editingAlt = false;
    this.altBtn.classList.remove("is-active");
    this.captionInput.placeholder = "Add a caption\u2026";
    this.captionInput.value = String(this.node.attrs.caption ?? "");
  }

  stopEvent(event: Event): boolean {
    const target = event.target as HTMLElement;
    // Let the NodeView handle events on toolbar, caption bar, and their children
    if (target.closest(".tiptap-image-toolbar")) return true;
    if (target.closest(".tiptap-image-caption-bar")) return true;
    if (target.closest(".tiptap-image-missing")) return true;
    return false;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy() {
    // No cleanup needed — DOM removed automatically
  }

  // --- Helpers ---

  private sep(): HTMLElement {
    const s = document.createElement("span");
    s.className = "tiptap-toolbar-sep";
    return s;
  }

  private iconBtn(svg: string, title: string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.innerHTML = svg;
    btn.title = title;
    return btn;
  }

  private updateAttrs(attrs: Record<string, unknown>) {
    const pos = this.getPos();
    if (pos === undefined) return;
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...this.node.attrs,
      ...attrs,
    });
    this.view.dispatch(tr);
  }

  private syncImageAttrs(node: ProseMirrorNode) {
    const src = String(node.attrs.src ?? "");
    this.img.alt = String(node.attrs.alt ?? "");
    this.img.title = String(node.attrs.title ?? "");
    this.missingSource.textContent = imageSourceHint(src);
    this.openBtn.disabled = !canOpenImageSource(src);

    if (src !== this.currentSrc) {
      this.currentSrc = src;
      this.setMissing(false);
      this.dom.dataset.loadState = "loading";
      this.img.setAttribute("src", src);
      this.checkCachedImageState();
      return;
    }

    this.checkCachedImageState();
  }

  private checkCachedImageState() {
    queueMicrotask(() => {
      if (
        !this.img.complete ||
        this.img.getAttribute("src") !== this.currentSrc
      ) {
        return;
      }
      this.setMissing(this.img.naturalWidth === 0);
    });
  }

  private setMissing(missing: boolean) {
    if (this.missing === missing) {
      this.dom.dataset.loadState = missing ? "missing" : "loaded";
      return;
    }

    this.missing = missing;
    this.dom.dataset.loadState = missing ? "missing" : "loaded";
    this.dom.dispatchEvent(
      new CustomEvent(INLINE_IMAGE_LOAD_STATE_EVENT, {
        bubbles: true,
        composed: true,
        detail: {
          src: this.currentSrc,
          missing,
        },
      }),
    );
  }

  private deleteNode() {
    const pos = this.getPos();
    if (pos === undefined) return;
    const tr = this.view.state.tr.delete(pos, pos + this.node.nodeSize);
    this.view.dispatch(tr);
    this.view.focus();
  }

  private handleLink() {
    const current = String(this.node.attrs.href ?? "");
    if (current) {
      // Remove existing link
      this.updateAttrs({ href: "" });
    } else {
      const url = globalThis.prompt("Enter URL");
      if (url) this.updateAttrs({ href: url });
    }
  }

  private handleReplace() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const data = await uploadWithMetadata(file);
        this.updateAttrs({ src: data.url });
      } catch {
        // Upload failed — keep current image
      }
    });
    input.click();
  }

  private handleOpenOriginal() {
    const src = String(this.node.attrs.src ?? "");
    if (!canOpenImageSource(src)) return;
    window.open(src, "_blank", "noopener,noreferrer");
  }

  private handleExpand() {
    const lightbox = document.querySelector("jant-media-lightbox") as {
      open: (
        images: Array<{ url: string; alt: string }>,
        index: number,
      ) => void;
    } | null;
    if (lightbox) {
      lightbox.open(
        [
          {
            url: String(this.node.attrs.src ?? ""),
            alt: String(this.node.attrs.alt ?? ""),
          },
        ],
        0,
      );
    }
  }

  private toggleAltMode() {
    this.editingAlt = !this.editingAlt;
    this.altBtn.classList.toggle("is-active", this.editingAlt);
    if (this.editingAlt) {
      this.captionInput.placeholder = "Add alt text\u2026";
      this.captionInput.value = String(this.node.attrs.alt ?? "");
    } else {
      this.captionInput.placeholder = "Add a caption\u2026";
      this.captionInput.value = String(this.node.attrs.caption ?? "");
    }
    this.captionInput.focus();
  }
}

function imageSourceHint(src: string): string {
  const trimmed = src.trim();
  if (!trimmed) return "";
  if (trimmed.length > 140) return `${trimmed.slice(0, 137)}...`;
  return trimmed;
}

function canOpenImageSource(src: string): boolean {
  const trimmed = src.trim();
  if (!trimmed) return false;
  return /^(https?:|\/|\.\/|\.\.\/|blob:)/i.test(trimmed);
}

// ---------------------------------------------------------------------------
// Node Extension
// ---------------------------------------------------------------------------

export const ImageNode = Node.create<{ labels?: Partial<ImageNodeLabels> }>({
  name: "image",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return {
      labels: DEFAULT_IMAGE_NODE_LABELS,
    };
  },

  addAttributes() {
    return {
      src: { default: "" },
      alt: { default: "" },
      title: { default: "" },
      caption: { default: "" },
      href: { default: "" },
      layout: { default: "regular" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "figure[data-image]",
        getAttrs(dom) {
          const el = dom as HTMLElement;
          const img = el.querySelector("img");
          const figcaption = el.querySelector("figcaption");
          const link = el.querySelector("a");
          return {
            src: img?.getAttribute("src") ?? "",
            alt: img?.getAttribute("alt") ?? "",
            title: img?.getAttribute("title") ?? "",
            caption: figcaption?.textContent ?? "",
            href: link?.getAttribute("href") ?? "",
            layout: el.dataset.layout ?? "regular",
          };
        },
      },
      {
        tag: "figure",
        getAttrs(dom) {
          const el = dom as HTMLElement;
          const img = el.querySelector("img");
          if (!img) return false;
          const figcaption = el.querySelector("figcaption");
          const link = el.querySelector("a");
          return {
            src: img.getAttribute("src") ?? "",
            alt: img.getAttribute("alt") ?? "",
            title: img.getAttribute("title") ?? "",
            caption: figcaption?.textContent ?? "",
            href: link?.getAttribute("href") ?? "",
            layout: el.dataset.layout ?? "regular",
          };
        },
      },
      {
        tag: "img[src]",
        getAttrs(dom) {
          const el = dom as HTMLImageElement;
          return {
            src: el.getAttribute("src") ?? "",
            alt: el.getAttribute("alt") ?? "",
            title: el.getAttribute("title") ?? "",
          };
        },
      },
    ];
  },

  renderHTML({ node }) {
    const attrs: Record<string, string> = {};
    if (node.attrs.layout && node.attrs.layout !== "regular") {
      attrs["data-layout"] = node.attrs.layout;
    }
    attrs["data-image"] = "";

    const imgAttrs: Record<string, string> = { src: node.attrs.src };
    if (node.attrs.alt) imgAttrs.alt = node.attrs.alt;
    if (node.attrs.title) imgAttrs.title = node.attrs.title;

    const imgNode: [string, Record<string, string>] = ["img", imgAttrs];

    const children: Array<
      | [string, Record<string, string>]
      | [string, Record<string, string>, ...unknown[]]
      | string
    > = [];

    if (node.attrs.href) {
      children.push(["a", { href: node.attrs.href }, imgNode]);
    } else {
      children.push(imgNode);
    }

    if (node.attrs.caption) {
      children.push(["figcaption", {}, node.attrs.caption]);
    }

    return ["figure", attrs, ...children];
  },

  parseMarkdown: (token, helpers) => {
    return helpers.createNode("image", {
      src: token.href,
      title: token.title ?? "",
      alt: token.text ?? "",
    });
  },

  renderMarkdown: (node) => {
    return renderMarkdownImage(node.attrs ?? {});
  },

  addCommands() {
    return {
      setImage:
        (options) =>
        ({ chain, state }) => {
          if (!canInsertNode(state, state.schema.nodes[this.name])) {
            return false;
          }

          const { $to: $originTo } = state.selection;
          const currentChain = chain();

          if (isNodeSelection(state.selection)) {
            currentChain.insertContentAt($originTo.pos, {
              type: this.name,
              attrs: options,
            });
          } else {
            currentChain.insertContent({
              type: this.name,
              attrs: options,
            });
          }

          return currentChain
            .command(({ state: chainState, tr, dispatch }) => {
              if (dispatch) {
                moveSelectionAfterBlockInsertion(tr, chainState.schema);
              }

              return true;
            })
            .run();
        },
    };
  },

  addNodeView() {
    return ({ node, view, getPos, editor }) => {
      const labels = {
        ...DEFAULT_IMAGE_NODE_LABELS,
        ...(this.options.labels ?? {}),
      };
      return new ImageNodeView(
        node,
        view,
        getPos as () => number | undefined,
        editor,
        labels,
      );
    };
  },
});
