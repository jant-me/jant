/**
 * Editor CodeBlock extension: live syntax highlighting via ProseMirror
 * decorations and a minimal top-right language picker.
 *
 * Extends `MarkdownCodeBlock` so serialization (JSON, HTML, Markdown) and
 * fence input rules stay identical to the shared schema while the editor
 * renders the same `hljs-*` palette as published posts.
 */

import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import {
  CODE_BLOCK_LANGUAGES,
  DEFAULT_CODE_BLOCK_NODE_LABELS,
  resolveCodeLanguageOption,
  type CodeBlockNodeLabels,
} from "../../lib/code-languages.js";
import { MarkdownCodeBlock } from "../../lib/markdown-manager.js";
import type { HighlightToken } from "../highlight-code.js";

export {
  DEFAULT_CODE_BLOCK_NODE_LABELS,
  type CodeBlockNodeLabels,
} from "../../lib/code-languages.js";

type TokenizeCodeFn = typeof import("../highlight-code.js").tokenizeCode;

const codeBlockHighlightKey = new PluginKey<DecorationSet>(
  "codeBlockHighlight",
);

let cachedTokenizeCode: TokenizeCodeFn | null = null;
let loadingTokenizeCode: Promise<TokenizeCodeFn | null> | null = null;

/**
 * Per-node token cache. ProseMirror nodes are immutable, so unchanged code
 * blocks reuse their previous tokenization in O(1) while the author types
 * elsewhere in the document.
 */
const nodeTokenCache = new WeakMap<ProseMirrorNode, HighlightToken[] | null>();

function loadTokenizeCode(): Promise<TokenizeCodeFn | null> {
  if (cachedTokenizeCode) return Promise.resolve(cachedTokenizeCode);
  if (!loadingTokenizeCode) {
    loadingTokenizeCode = import("../highlight-code.js")
      .then((mod) => {
        cachedTokenizeCode = mod.tokenizeCode;
        return cachedTokenizeCode;
      })
      .catch(() => {
        loadingTokenizeCode = null;
        return null;
      });
  }
  return loadingTokenizeCode;
}

function getNodeLanguage(node: ProseMirrorNode): string {
  return typeof node.attrs.language === "string"
    ? node.attrs.language.trim()
    : "";
}

function docHasLabeledCodeBlock(doc: ProseMirrorNode): boolean {
  let found = false;
  doc.descendants((node) => {
    if (found) return false;
    if (node.type.name === "codeBlock") {
      if (getNodeLanguage(node)) found = true;
      return false;
    }
    return true;
  });
  return found;
}

function buildCodeBlockDecorations(
  doc: ProseMirrorNode,
  tokenize: TokenizeCodeFn,
): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== "codeBlock") return true;

    const language = getNodeLanguage(node);
    if (!language) return false;

    let tokens = nodeTokenCache.get(node);
    if (tokens === undefined) {
      tokens = tokenize(node.textContent, language);
      nodeTokenCache.set(node, tokens);
    }

    if (!tokens) return false;

    // Adding `.hljs` to the node view root lets `code-highlighting.css`
    // (`.hljs :is(.hljs-keyword, ...)`) color the inline token spans without
    // touching the serialized document HTML.
    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, { class: "hljs" }),
    );

    const contentStart = pos + 1;
    const maxOffset = node.content.size;
    for (const token of tokens) {
      const from = contentStart + token.from;
      const to = contentStart + Math.min(token.to, maxOffset);
      if (to > from) {
        decorations.push(
          Decoration.inline(from, to, { class: token.className }),
        );
      }
    }
    return false;
  });

  return decorations.length
    ? DecorationSet.create(doc, decorations)
    : DecorationSet.empty;
}

function createCodeHighlightPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: codeBlockHighlightKey,
    state: {
      init(_config, state) {
        if (!cachedTokenizeCode) return DecorationSet.empty;
        return buildCodeBlockDecorations(state.doc, cachedTokenizeCode);
      },
      apply(tr, oldSet, _oldState, newState) {
        const meta = tr.getMeta(codeBlockHighlightKey) as
          { loaded?: boolean } | undefined;
        if (meta?.loaded && cachedTokenizeCode) {
          return buildCodeBlockDecorations(newState.doc, cachedTokenizeCode);
        }
        if (!tr.docChanged) return oldSet;
        if (!cachedTokenizeCode) return DecorationSet.empty;
        return buildCodeBlockDecorations(newState.doc, cachedTokenizeCode);
      },
    },
    props: {
      decorations(state) {
        return codeBlockHighlightKey.getState(state) ?? DecorationSet.empty;
      },
    },
    view(editorView) {
      let requested = false;

      const ensureLoaded = (view: EditorView) => {
        if (cachedTokenizeCode || requested) return;
        if (!docHasLabeledCodeBlock(view.state.doc)) return;
        requested = true;
        void loadTokenizeCode().then((tokenize) => {
          if (!tokenize || view.isDestroyed) {
            requested = false;
            return;
          }
          view.dispatch(
            view.state.tr
              .setMeta(codeBlockHighlightKey, { loaded: true })
              .setMeta("addToHistory", false),
          );
        });
      };

      ensureLoaded(editorView);

      return {
        update(view) {
          ensureLoaded(view);
        },
      };
    },
  });
}

class CodeBlockNodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;

  private node: ProseMirrorNode;
  private view: EditorView;
  private getPos: () => number | undefined;
  private controls: HTMLElement;
  private select: globalThis.HTMLSelectElement;
  private customOption: globalThis.HTMLOptionElement | null = null;
  private languageClassPrefix: string;

  constructor(
    node: ProseMirrorNode,
    view: EditorView,
    getPos: () => number | undefined,
    labels: CodeBlockNodeLabels,
    languageClassPrefix: string,
  ) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.languageClassPrefix = languageClassPrefix;

    const wrapper = document.createElement("div");
    wrapper.className = "tiptap-code-block";
    this.dom = wrapper;

    const controls = document.createElement("div");
    // `not-prose` keeps reader typography rules out of the picker control.
    controls.className = "tiptap-code-block-controls not-prose";
    controls.contentEditable = "false";
    this.controls = controls;

    const select = document.createElement("select");
    select.className = "tiptap-code-block-select";
    select.setAttribute("aria-label", labels.languageLabel);

    const plainOption = document.createElement("option");
    plainOption.value = "";
    plainOption.textContent = labels.plainText;
    select.appendChild(plainOption);

    for (const lang of CODE_BLOCK_LANGUAGES) {
      const option = document.createElement("option");
      option.value = lang.value;
      option.textContent = lang.label;
      select.appendChild(option);
    }

    select.addEventListener("change", () => {
      const pos = this.getPos();
      if (pos === undefined) return;
      const nextLanguage = select.value || null;
      const currentLanguage = getNodeLanguage(this.node) || null;
      if (nextLanguage === currentLanguage) return;
      const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
        ...this.node.attrs,
        language: nextLanguage,
      });
      this.view.dispatch(tr);
    });

    select.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.view.focus();
      }
    });

    controls.appendChild(select);
    const chevron = document.createElement("span");
    chevron.className = "tiptap-code-block-chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
    controls.appendChild(chevron);
    this.select = select;

    const pre = document.createElement("pre");
    const code = document.createElement("code");
    pre.appendChild(code);
    this.contentDOM = code;

    wrapper.appendChild(controls);
    wrapper.appendChild(pre);

    this.syncLanguage(node);
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.syncLanguage(node);
    return true;
  }

  stopEvent(event: Event): boolean {
    const target = event.target;
    return target instanceof globalThis.Node && this.controls.contains(target);
  }

  ignoreMutation(
    mutation:
      | globalThis.MutationRecord
      | { type: "selection"; target: globalThis.Node },
  ): boolean {
    if (mutation.type === "selection") return false;
    return !this.contentDOM.contains(mutation.target);
  }

  private syncLanguage(node: ProseMirrorNode): void {
    const raw = getNodeLanguage(node);
    this.dom.dataset.hasLanguage = raw ? "true" : "false";
    this.contentDOM.className = raw ? `${this.languageClassPrefix}${raw}` : "";

    if (!raw) {
      this.removeCustomOption();
      this.select.value = "";
      return;
    }

    const builtInValue = resolveCodeLanguageOption(raw);
    if (builtInValue) {
      this.removeCustomOption();
      this.select.value = builtInValue;
      return;
    }

    // Preserve unrecognized/custom fence languages (e.g. `toml`, `elixir`)
    // without overwriting them unless the author explicitly picks another.
    if (!this.customOption) {
      this.customOption = document.createElement("option");
      this.customOption.dataset.customLanguage = "true";
      this.select.appendChild(this.customOption);
    }
    this.customOption.value = raw;
    this.customOption.textContent = raw;
    this.select.value = raw;
  }

  private removeCustomOption(): void {
    if (!this.customOption) return;
    this.customOption.remove();
    this.customOption = null;
  }
}

export interface EditorCodeBlockOptions {
  languageClassPrefix: string;
  exitOnTripleEnter: boolean;
  exitOnArrowDown: boolean;
  defaultLanguage: string | null | undefined;
  enableTabIndentation: boolean;
  tabSize: number;
  HTMLAttributes: Record<string, unknown>;
  labels: CodeBlockNodeLabels;
}

export const EditorCodeBlock = MarkdownCodeBlock.extend<EditorCodeBlockOptions>(
  {
    addOptions() {
      return {
        ...this.parent?.(),
        languageClassPrefix: "language-",
        exitOnTripleEnter: true,
        exitOnArrowDown: true,
        defaultLanguage: null,
        enableTabIndentation: false,
        tabSize: 4,
        HTMLAttributes: {},
        labels: DEFAULT_CODE_BLOCK_NODE_LABELS,
      };
    },

    addNodeView() {
      const labels: CodeBlockNodeLabels = {
        ...DEFAULT_CODE_BLOCK_NODE_LABELS,
        ...this.options.labels,
      };
      const prefix = this.options.languageClassPrefix ?? "language-";
      return ({ node, view, getPos }) =>
        new CodeBlockNodeView(
          node,
          view,
          typeof getPos === "function" ? getPos : () => undefined,
          labels,
          prefix,
        );
    },

    addProseMirrorPlugins() {
      return [...(this.parent?.() ?? []), createCodeHighlightPlugin()];
    },
  },
);
