/**
 * Tiptap Editor Factory
 *
 * Creates configured Tiptap editor instances for use in Lit components.
 */

import { Editor, type JSONContent } from "@tiptap/core";
import {
  createEditorExtensions,
  createSettingsEditorExtensions,
} from "./extensions.js";
import type { FormattingToolbarMode } from "./toolbar-mode.js";
import type { PasteMediaOptions } from "./paste-media.js";
import type { RehostImagesOptions } from "./rehost-images.js";
import type { ImageNodeLabels } from "./image-node.js";
import type { TableControlLabels } from "./table-control-labels.js";
import { normalizeFootnoteArtifacts } from "../../lib/footnotes.js";
import { tiptapJsonToMarkdown } from "../../lib/tiptap-to-markdown.js";
import { parseMarkdownDocument } from "../../lib/markdown-manager.js";

export interface CreateEditorOptions {
  element: HTMLElement;
  placeholder?: string;
  content?: JSONContent | null;
  onUpdate?: (json: JSONContent) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onSelectionUpdate?: (selection: { from: number; to: number }) => void;
  toolbarMode?: FormattingToolbarMode;
  highlightLabel?: string;
  pasteMedia?: PasteMediaOptions;
  rehostImages?: RehostImagesOptions;
  imageNodeLabels?: Partial<ImageNodeLabels>;
  tableControlLabels?: TableControlLabels;
}

/**
 * Creates a Tiptap editor instance with the standard extension set.
 *
 * @param options - Editor configuration
 * @returns Tiptap Editor instance
 */
export function createTiptapEditor(options: CreateEditorOptions): Editor {
  const editor = new Editor({
    element: options.element,
    extensions: createEditorExtensions({
      placeholder: options.placeholder,
      toolbarMode: options.toolbarMode,
      highlightLabel: options.highlightLabel,
      pasteMedia: options.pasteMedia,
      rehostImages: options.rehostImages,
      imageNodeLabels: options.imageNodeLabels,
      tableControlLabels: options.tableControlLabels,
    }),
    content: options.content ?? undefined,
    editorProps: {
      scrollMargin: { top: 5, right: 5, bottom: 80, left: 5 },
      scrollThreshold: { top: 5, right: 5, bottom: 80, left: 5 },
    },
    onUpdate: ({ editor }) => {
      options.onUpdate?.(normalizeFootnoteArtifacts(editor.getJSON()));
    },
    onFocus: () => {
      options.onFocus?.();
    },
    onBlur: () => {
      options.onBlur?.();
    },
    onSelectionUpdate: ({ editor }) => {
      options.onSelectionUpdate?.({
        from: editor.state.selection.from,
        to: editor.state.selection.to,
      });
    },
  });

  return editor;
}

/**
 * Converts TipTap JSON content to Markdown using a headless editor.
 *
 * @param json - TipTap JSONContent
 * @returns Markdown string
 *
 * @example
 * const md = jsonToMarkdown({ type: "doc", content: [...] });
 */
export function jsonToMarkdown(json: JSONContent): string {
  return tiptapJsonToMarkdown(JSON.stringify(json));
}

export interface CreateSettingsEditorOptions {
  element: HTMLElement;
  placeholder?: string;
  /** Initial content as a Markdown string */
  content?: string;
  /** Called on every edit with the current Markdown string */
  onUpdate?: (markdown: string) => void;
}

/**
 * Creates a lightweight TipTap editor for settings fields (site description, footer).
 * Accepts and emits Markdown strings.
 *
 * @param options - Editor configuration
 * @returns TipTap Editor instance
 */
export function createSettingsEditor(
  options: CreateSettingsEditorOptions,
): Editor {
  const doc = options.content
    ? parseMarkdownDocument(options.content)
    : undefined;

  return new Editor({
    element: options.element,
    extensions: createSettingsEditorExtensions({
      placeholder: options.placeholder,
    }),
    content: doc,
    onUpdate: ({ editor }) => {
      options.onUpdate?.(jsonToMarkdown(editor.getJSON()));
    },
  });
}
