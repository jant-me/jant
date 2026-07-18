/**
 * Tiptap Extension Configuration
 *
 * Shared extension set for all Tiptap editor instances (compose + post form).
 */

import { Extension, type Extensions } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";
import { SlashCommands } from "./slash-commands.js";
import { PasteMedia } from "./paste-media.js";
import type { PasteMediaOptions } from "./paste-media.js";
import { BubbleMenu } from "./bubble-menu.js";
import { LinkToolbar } from "./link-toolbar.js";
import { ExitableMarks } from "./exitable-marks.js";
import { CodeBlockIndent } from "./tab-indent.js";
import { StructuralKeymap } from "./structural-keymap.js";
import { ContinuousLists } from "./continuous-lists.js";
import { LinkInputRules } from "./link-input-rules.js";
import { InsertParagraphAround } from "./insert-paragraph-around.js";
import { Footnotes } from "./footnotes.js";
import type { FormattingToolbarMode } from "./toolbar-mode.js";
import { ImageNode, type ImageNodeLabels } from "./image-node.js";
import { MoreBreak } from "./more-break.js";
import { EmbedNode } from "./embed-node.js";
import { HtmlBlockNode } from "./html-block-node.js";
import { EmbedPaste } from "./embed-paste.js";
import { RehostImages } from "./rehost-images.js";
import type { RehostImagesOptions } from "./rehost-images.js";
import { MarkdownClipboard } from "./markdown-clipboard.js";
import { ImageInputRules } from "./image-input-rules.js";
import { TableControls } from "./table-controls.js";
import type { TableControlLabels } from "./table-control-labels.js";
import {
  MARKDOWN_MARKED_OPTIONS,
  createMarkdownContentExtensions,
} from "../../lib/markdown-manager.js";

export interface EditorExtensionOptions {
  placeholder?: string;
  toolbarMode?: FormattingToolbarMode;
  pasteMedia?: PasteMediaOptions;
  rehostImages?: RehostImagesOptions;
  imageNodeLabels?: Partial<ImageNodeLabels>;
  tableControlLabels?: TableControlLabels;
}

/**
 * Creates the standard Tiptap extension array.
 *
 * @param options - Configuration for extensions
 * @returns Configured extension array
 */
/**
 * Prevent TipTap's HardBreak extension from consuming Mod-Enter so the
 * keystroke bubbles up to the compose dialog's keydown handler for submit.
 * Returning `true` at a higher priority tells ProseMirror "handled — skip
 * remaining keymaps" without inserting a hard break. The DOM event still
 * bubbles, so the compose dialog receives it. Shift-Enter continues to
 * insert a hard break as usual.
 */
const ReclaimModEnter = Extension.create({
  name: "reclaimModEnter",
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      "Mod-Enter": () => true,
    };
  },
});

/**
 * Creates a minimal extension set for settings editors (site description, footer).
 * Includes markdown parsing/rendering, basic formatting, links, and clipboard support.
 * Omits: slash commands, paste media, footnotes, image uploads.
 */
export function createSettingsEditorExtensions(
  options: Pick<EditorExtensionOptions, "placeholder"> = {},
): Extensions {
  return [
    ...createMarkdownContentExtensions(),
    Markdown.configure({
      markedOptions: MARKDOWN_MARKED_OPTIONS,
    }),
    Placeholder.configure({
      placeholder: options.placeholder ?? "",
    }),
    ReclaimModEnter,
    LinkInputRules,
    MarkdownClipboard,
    ExitableMarks,
    InsertParagraphAround,
    StructuralKeymap,
    ContinuousLists,
    BubbleMenu.configure({
      toolbarMode: "compose",
    }),
    LinkToolbar,
  ];
}

export function createEditorExtensions(
  options: EditorExtensionOptions = {},
): Extensions {
  return [
    ...createMarkdownContentExtensions({
      imageExtension: ImageNode.configure({
        labels: options.imageNodeLabels,
      }),
      moreBreakExtension: MoreBreak,
      embedExtension: EmbedNode,
      htmlBlockExtension: HtmlBlockNode,
    }),
    ReclaimModEnter,
    Markdown.configure({
      markedOptions: MARKDOWN_MARKED_OPTIONS,
    }),
    Placeholder.configure({
      placeholder: options.placeholder ?? "Write something…",
    }),
    Footnotes,
    ImageInputRules,
    LinkInputRules,
    MarkdownClipboard,
    SlashCommands,
    ...(options.tableControlLabels
      ? [TableControls.configure({ labels: options.tableControlLabels })]
      : []),
    EmbedPaste,
    PasteMedia.configure(options.pasteMedia ?? {}),
    RehostImages.configure(options.rehostImages ?? {}),
    BubbleMenu.configure({
      toolbarMode: options.toolbarMode ?? "default",
    }),
    LinkToolbar,
    ExitableMarks,
    InsertParagraphAround,
    StructuralKeymap,
    ContinuousLists,
    CodeBlockIndent,
  ];
}
