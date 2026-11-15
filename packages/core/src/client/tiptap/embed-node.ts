/**
 * Embed Node — placeholder card in the editor, real iframe on the published page.
 *
 * The NodeView is intentionally NOT a live iframe. Reasons:
 *   - third-party scripts in the editor are a security and DX hazard
 *   - iframes steal focus from ProseMirror selection
 *   - large embeds tank typing latency
 *
 * What the author sees: a card with the provider name, the URL, and small
 * Edit / Open buttons. The real embed renders only on the published page via
 * `lib/embed-render.ts`.
 *
 * Round-trips through markdown as a ```jant-embed fenced block (see
 * `MarkdownEmbedNode` in `markdown-manager.ts`). Persisted attrs hold the
 * resolved iframe `src` so old posts keep rendering even if a provider entry
 * is later removed.
 */

import {
  canInsertNode,
  isNodeSelection,
  Node,
  type Editor,
} from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { createEmbedMarkdownToken } from "../../lib/markdown-manager.js";
import { resolveEmbed } from "../../lib/embed-providers.js";
import { moveSelectionAfterBlockInsertion } from "./block-insertion.js";
import { openEmbedDialog } from "./embed-dialog.js";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    embed: {
      setEmbed: (options: { url: string; caption?: string }) => ReturnType;
    };
  }
}

class EmbedNodeView {
  dom: HTMLElement;

  private node: ProseMirrorNode;
  private view: EditorView;
  private getPos: () => number | undefined;
  private editor: Editor;

  private providerLabel: HTMLElement;
  private urlLink: HTMLAnchorElement;
  private captionInput: HTMLInputElement;

  constructor(
    node: ProseMirrorNode,
    view: EditorView,
    getPos: () => number | undefined,
    editor: Editor,
  ) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.editor = editor;

    const card = document.createElement("div");
    // `not-prose`: this is editor chrome, not post content, so the reader's
    // typography defaults stay out of its controls.
    card.className = "tiptap-embed-card not-prose";
    card.dataset.selected = "false";
    this.dom = card;

    const header = document.createElement("div");
    header.className = "tiptap-embed-card-header";
    card.appendChild(header);

    const providerLabel = document.createElement("span");
    providerLabel.className = "tiptap-embed-card-provider";
    header.appendChild(providerLabel);
    this.providerLabel = providerLabel;

    const actions = document.createElement("span");
    actions.className = "tiptap-embed-card-actions";
    header.appendChild(actions);

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "Edit";
    editBtn.className = "tiptap-embed-card-btn";
    editBtn.addEventListener("mousedown", (event) => {
      event.preventDefault();
      this.requestEdit();
    });
    actions.appendChild(editBtn);

    const urlLink = document.createElement("a");
    urlLink.className = "tiptap-embed-card-url";
    urlLink.target = "_blank";
    urlLink.rel = "noopener noreferrer";
    card.appendChild(urlLink);
    this.urlLink = urlLink;

    const captionInput = document.createElement("input");
    captionInput.type = "text";
    captionInput.placeholder = "Add a caption…";
    captionInput.className = "tiptap-embed-card-caption";
    captionInput.value = String(node.attrs.caption ?? "");
    captionInput.addEventListener("input", () => {
      this.updateAttrs({ caption: captionInput.value });
    });
    captionInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.view.focus();
      }
    });
    card.appendChild(captionInput);
    this.captionInput = captionInput;

    this.refresh();
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    if (document.activeElement !== this.captionInput) {
      this.captionInput.value = String(node.attrs.caption ?? "");
    }
    this.refresh();
    return true;
  }

  selectNode() {
    this.dom.dataset.selected = "true";
  }

  deselectNode() {
    this.dom.dataset.selected = "false";
  }

  stopEvent(event: Event): boolean {
    const target = event.target as HTMLElement;
    if (target.closest(".tiptap-embed-card-header")) return true;
    if (target.closest(".tiptap-embed-card-caption")) return true;
    return false;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy() {
    // Nothing to clean up.
  }

  private refresh() {
    const url = String(this.node.attrs.url ?? "");
    const providerName =
      String(this.node.attrs.providerName ?? "") || providerFallback(url);
    this.providerLabel.textContent = providerName;
    this.urlLink.href = url;
    this.urlLink.textContent = url;
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

  private requestEdit() {
    const initialUrl = String(this.node.attrs.url ?? "");
    const initialCaption = String(this.node.attrs.caption ?? "");
    void openEmbedDialog({ initialUrl, initialCaption }).then((result) => {
      if (!result) return;
      const pos = this.getPos();
      if (pos === undefined) return;

      if (result.kind === "link") {
        // Replace the embed node with the URL as a linked paragraph. We use
        // chain commands so the link mark is applied through the schema's
        // own Link extension instead of constructed by hand.
        const from = pos;
        const to = pos + this.node.nodeSize;
        this.editor
          .chain()
          .focus()
          .insertContentAt(
            { from, to },
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: result.url,
                  marks: [{ type: "link", attrs: { href: result.url } }],
                },
              ],
            },
          )
          .run();
        return;
      }

      if (result.kind !== "embed") return;
      const resolved = resolveEmbed(result.url);
      const nextAttrs = resolved
        ? {
            url: resolved.url || result.url,
            provider: resolved.provider,
            providerName: resolved.providerName,
            src: resolved.src,
            orientation: resolved.orientation,
            heightPx: resolved.heightPx ?? null,
            sandbox: resolved.sandbox,
            allow: resolved.allow ?? "",
            caption: result.caption ?? "",
          }
        : {
            ...this.node.attrs,
            url: result.url,
            caption: result.caption ?? "",
          };
      const tr = this.view.state.tr.setNodeMarkup(pos, undefined, nextAttrs);
      this.view.dispatch(tr);
    });
  }
}

function providerFallback(url: string): string {
  if (!url) return "Embed";
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname;
  } catch {
    return "Embed";
  }
}

export const EmbedNode = Node.create({
  name: "embed",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      url: { default: "" },
      provider: { default: "" },
      providerName: { default: "" },
      src: { default: "" },
      orientation: { default: "landscape" },
      heightPx: { default: null },
      sandbox: { default: "" },
      allow: { default: "" },
      caption: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'figure[data-jant-node="embed"]',
        getAttrs(dom) {
          const el = dom as HTMLElement;
          return {
            url: el.getAttribute("data-url") ?? "",
            provider: el.getAttribute("data-provider") ?? "",
            providerName: el.getAttribute("data-provider-name") ?? "",
            src: el.getAttribute("data-src") ?? "",
            orientation: el.getAttribute("data-orientation") ?? "landscape",
          };
        },
      },
    ];
  },

  renderHTML({ node }) {
    const attrs: Record<string, string> = { "data-jant-node": "embed" };
    if (node.attrs.provider)
      attrs["data-provider"] = String(node.attrs.provider);
    if (node.attrs.providerName)
      attrs["data-provider-name"] = String(node.attrs.providerName);
    if (node.attrs.url) attrs["data-url"] = String(node.attrs.url);
    if (node.attrs.src) attrs["data-src"] = String(node.attrs.src);
    if (node.attrs.orientation)
      attrs["data-orientation"] = String(node.attrs.orientation);
    return ["figure", attrs];
  },

  parseMarkdown: (token, helpers) => {
    const url = typeof token.url === "string" ? token.url : "";
    const tokenAttrs =
      token.attrs && typeof token.attrs === "object"
        ? (token.attrs as Record<string, string>)
        : {};
    return helpers.createNode("embed", {
      url,
      caption: tokenAttrs.caption ?? "",
    });
  },

  renderMarkdown: (node) => {
    const attrs = (node.attrs ?? {}) as Record<string, unknown>;
    const url = typeof attrs.url === "string" ? attrs.url.trim() : "";
    if (!url) return "";
    const lines = [url];
    const caption =
      typeof attrs.caption === "string" ? attrs.caption.trim() : "";
    if (caption) lines.push(`caption=${caption}`);
    return ["```jant-embed", ...lines, "```"].join("\n");
  },

  markdownTokenizer: createEmbedMarkdownToken(),

  addCommands() {
    return {
      setEmbed:
        (options) =>
        ({ chain, state }) => {
          if (!canInsertNode(state, state.schema.nodes[this.name])) {
            return false;
          }
          const resolved = resolveEmbed(options.url);
          const attrs = resolved
            ? {
                url: resolved.url || options.url,
                provider: resolved.provider,
                providerName: resolved.providerName,
                src: resolved.src,
                orientation: resolved.orientation,
                heightPx: resolved.heightPx ?? null,
                sandbox: resolved.sandbox,
                allow: resolved.allow ?? "",
                caption: options.caption ?? "",
              }
            : {
                url: options.url,
                caption: options.caption ?? "",
              };

          const { $to: $originTo } = state.selection;
          const currentChain = chain();
          if (isNodeSelection(state.selection)) {
            currentChain.insertContentAt($originTo.pos, {
              type: this.name,
              attrs,
            });
          } else {
            currentChain.insertContent({ type: this.name, attrs });
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
      return new EmbedNodeView(
        node,
        view,
        getPos as () => number | undefined,
        editor,
      );
    };
  },
});
