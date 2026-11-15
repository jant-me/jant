/**
 * HtmlBlock Node — author-trusted raw HTML escape hatch.
 *
 * Use cases that don't fit the curated provider list (Letterbird forms,
 * Cal.com inline widgets, niche oEmbed services). The author pastes raw HTML
 * and accepts the responsibility — Jant is single-author and the editor is
 * admin-only, so there's no untrusted-input attack surface.
 *
 * The NodeView is a monospace textarea — visible, editable, and obviously
 * different from regular text so it can't be confused with prose. We
 * intentionally don't render a sandboxed live preview in the editor:
 * sandboxing scripts that depend on `parent.window` produces broken half-
 * previews that frustrate authors more than they help. The author sees the
 * real result on the published page.
 */

import {
  canInsertNode,
  isNodeSelection,
  Node,
  type Editor,
} from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { createHtmlBlockMarkdownToken } from "../../lib/markdown-manager.js";
import { moveSelectionAfterBlockInsertion } from "./block-insertion.js";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    htmlBlock: {
      setHtmlBlock: (options: { html: string }) => ReturnType;
    };
  }
}

class HtmlBlockNodeView {
  dom: HTMLElement;

  private node: ProseMirrorNode;
  private view: EditorView;
  private getPos: () => number | undefined;
  private editor: Editor;

  private textarea: HTMLTextAreaElement;

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

    const wrapper = document.createElement("div");
    // `not-prose`: this is editor chrome, not post content, so the reader's
    // typography defaults stay out of its controls.
    wrapper.className = "tiptap-html-block-card not-prose";
    wrapper.dataset.selected = "false";
    this.dom = wrapper;

    const header = document.createElement("div");
    header.className = "tiptap-html-block-header";
    header.textContent = "Raw HTML";
    wrapper.appendChild(header);

    const textarea = document.createElement("textarea");
    textarea.className = "tiptap-html-block-textarea";
    textarea.spellcheck = false;
    textarea.value = String(node.attrs.html ?? "");
    textarea.rows = Math.max(3, textarea.value.split("\n").length);
    textarea.addEventListener("input", () => {
      this.updateAttrs({ html: textarea.value });
      this.autoGrow();
    });
    wrapper.appendChild(textarea);
    this.textarea = textarea;

    const hint = document.createElement("p");
    hint.className = "tiptap-html-block-hint";
    hint.textContent = "Renders on the published page only.";
    wrapper.appendChild(hint);

    queueMicrotask(() => this.autoGrow());
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    if (document.activeElement !== this.textarea) {
      this.textarea.value = String(node.attrs.html ?? "");
      this.autoGrow();
    }
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
    return target.closest(".tiptap-html-block-textarea") !== null;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy() {
    // Nothing to clean up.
  }

  private autoGrow() {
    this.textarea.style.height = "auto";
    this.textarea.style.height = `${this.textarea.scrollHeight}px`;
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
}

export const HtmlBlockNode = Node.create({
  name: "htmlBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      html: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-jant-node="html-block"]',
        getAttrs(dom) {
          const el = dom as HTMLElement;
          return { html: el.textContent ?? "" };
        },
      },
    ];
  },

  renderHTML({ node }) {
    return [
      "div",
      { "data-jant-node": "html-block" },
      String(node.attrs.html ?? ""),
    ];
  },

  parseMarkdown: (token, helpers) => {
    const html = typeof token.html === "string" ? token.html : "";
    return helpers.createNode("htmlBlock", { html });
  },

  renderMarkdown: (node) => {
    const html =
      typeof node.attrs?.html === "string" ? (node.attrs.html as string) : "";
    return ["```jant-html", html, "```"].join("\n");
  },

  markdownTokenizer: createHtmlBlockMarkdownToken(),

  addCommands() {
    return {
      setHtmlBlock:
        (options) =>
        ({ chain, state }) => {
          if (!canInsertNode(state, state.schema.nodes[this.name])) {
            return false;
          }
          const attrs = { html: options.html };

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
      return new HtmlBlockNodeView(
        node,
        view,
        getPos as () => number | undefined,
        editor,
      );
    };
  },
});
