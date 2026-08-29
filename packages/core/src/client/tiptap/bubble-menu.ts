/**
 * Bubble Menu Extension
 *
 * Floating toolbar that appears on text selection with inline
 * formatting actions: Bold, Italic, H1, H2, Blockquote, Link.
 * Vanilla DOM — positioned via ProseMirror plugin, dialog-aware.
 */

import { Extension, type Editor } from "@tiptap/core";
import {
  AllSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
} from "@tiptap/pm/state";
import { liftTarget } from "@tiptap/pm/transform";
import type { EditorView } from "@tiptap/pm/view";
import { isLinkToolbarInputActive } from "./link-toolbar.js";
import type { FormattingToolbarMode } from "./toolbar-mode.js";
import {
  getFixedFloatingContainerRect,
  getFloatingArrowOffset,
  getFloatingPosition,
  getRangeAnchorRect,
  getVisibleClipRect,
} from "./floating-position.js";

const bubbleMenuKey = new PluginKey("bubbleMenu");

// SVG icons (16×16, stroke-based)
const ICONS = {
  bold: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12h9a4 4 0 0 1 0 8H6V4h8a4 4 0 0 1 0 8"/></svg>`,
  italic: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>`,
  h1: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17 12l3-2v10"/></svg>`,
  h2: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1"/></svg>`,
  blockquote: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>`,
  link: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  clear: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 22-1-4"/><path d="M19 14a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2h-3a1 1 0 0 1-1-1V4a2 2 0 0 0-4 0v5a1 1 0 0 1-1 1H6a2 2 0 0 0-2 2v1a1 1 0 0 0 1 1"/><path d="M19 14H5l-1.973 6.767A1 1 0 0 0 4 22h16a1 1 0 0 0 .973-1.233z"/><path d="m8 22 1-4"/></svg>`,
} as const;

interface BubbleBtn {
  key: string;
  icon: string;
  title: string;
  action: (view: EditorView) => void;
  isActive: (view: EditorView) => boolean;
}

/**
 * Toggle an inline mark on the current selection, then drop out of it.
 *
 * The toolbar mark buttons (bold, italic) format the *selection* — the same
 * intent as the `**x**` / `~~x~~` markdown shortcuts, which auto-exit once you
 * type the closing delimiter. These marks are inclusive, so a collapsed cursor
 * sitting at the end of the formatted word stays "inside" the mark and keeps
 * extending as the user types, with no obvious way to stop (the bubble menu is
 * hidden once the selection collapses). After toggling, we collapse the cursor
 * to the end of the selection and remove the just-applied mark from the stored
 * set so the next character is plain. Use the keyboard shortcuts (Mod-B /
 * Mod-I) for mode-style "keep typing in this format".
 */
export function toggleMarkAndExit(editor: Editor, markName: string): void {
  const { to, empty } = editor.state.selection;
  if (empty) {
    // No selection (e.g. shortcut-driven): behave as a plain mode toggle.
    editor.chain().focus().toggleMark(markName).run();
    return;
  }
  const markType = editor.schema.marks[markName];
  editor
    .chain()
    .focus()
    .toggleMark(markName)
    .setTextSelection(to)
    .command(({ tr }) => {
      if (markType) tr.removeStoredMark(markType);
      return true;
    })
    .run();
}

/**
 * Clears presentational formatting while preserving semantic content structure.
 *
 * Clearable marks (bold, italic, and similar text styling) are removed while
 * marks configured with `clearable: false`, such as links, are retained.
 * Headings become paragraphs and selected blockquote content is lifted out of
 * its quote wrapper. Lists, code blocks, tables, media, and other structural
 * nodes remain intact.
 *
 * @param editor - Editor whose current selection should be cleared
 * @returns Nothing
 */
export function clearFormatting(editor: Editor): void {
  const { doc, selection } = editor.state;
  const { from, to } = selection;
  const headingPositions: number[] = [];
  const blockquoteRanges: Array<{ from: number; to: number }> = [];

  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type === editor.schema.nodes.heading) {
      headingPositions.push(pos);
    }

    if (node.type === editor.schema.nodes.blockquote) {
      blockquoteRanges.push({
        from: Math.max(from, pos + 1),
        to: Math.min(to, pos + node.nodeSize - 1),
      });
    }
  });

  editor
    .chain()
    .focus()
    .unsetAllMarks()
    .command(({ tr }) => {
      const headingType = editor.schema.nodes.heading;
      const paragraphType = editor.schema.nodes.paragraph;

      if (headingType && paragraphType) {
        for (const position of headingPositions) {
          const mappedPosition = tr.mapping.map(position);
          const node = tr.doc.nodeAt(mappedPosition);
          if (node?.type !== headingType) continue;

          const $position = tr.doc.resolve(mappedPosition);
          const index = $position.index();
          if (
            $position.parent.canReplaceWith(index, index + 1, paragraphType)
          ) {
            tr.setNodeMarkup(mappedPosition, paragraphType);
          }
        }
      }

      const blockquoteType = editor.schema.nodes.blockquote;
      if (blockquoteType) {
        // Nested wrappers must be lifted from the inside out. Mapping the
        // original ranges after each lift keeps later positions accurate.
        for (let index = blockquoteRanges.length - 1; index >= 0; index -= 1) {
          const range = blockquoteRanges[index];
          if (!range) continue;
          const mappedFrom = tr.mapping.map(range.from, 1);
          const mappedTo = tr.mapping.map(range.to, -1);
          if (mappedFrom > mappedTo) continue;

          const nodeRange = tr.doc
            .resolve(mappedFrom)
            .blockRange(
              tr.doc.resolve(mappedTo),
              (node) => node.type === blockquoteType,
            );
          if (!nodeRange) continue;

          const target = liftTarget(nodeRange);
          if (target !== null) tr.lift(nodeRange, target);
        }
      }

      const mappedEnd = tr.mapping.map(to, -1);
      tr.setSelection(TextSelection.create(tr.doc, mappedEnd));
      return true;
    })
    .run();
}

function getButtons(
  editor: Editor,
  toolbarMode: FormattingToolbarMode,
): BubbleBtn[] {
  if (toolbarMode === "compose") {
    return [
      {
        key: "bold",
        icon: ICONS.bold,
        title: "Bold",
        action: () => toggleMarkAndExit(editor, "bold"),
        isActive: () => editor.isActive("bold"),
      },
      {
        key: "italic",
        icon: ICONS.italic,
        title: "Italic",
        action: () => toggleMarkAndExit(editor, "italic"),
        isActive: () => editor.isActive("italic"),
      },
      {
        key: "sep",
        icon: "",
        title: "",
        action: () => {},
        isActive: () => false,
      },
      {
        key: "link",
        icon: ICONS.link,
        title: "Link",
        action: (view: EditorView) => {
          if (editor.isActive("link")) {
            editor.chain().focus().unsetLink().run();
          } else {
            view.dom.dispatchEvent(new CustomEvent("tiptap:open-link-input"));
          }
        },
        isActive: () => editor.isActive("link"),
      },
      {
        key: "clear",
        icon: ICONS.clear,
        title: "Clear formatting",
        action: () => clearFormatting(editor),
        isActive: () => false,
      },
    ];
  }

  return [
    {
      key: "bold",
      icon: ICONS.bold,
      title: "Bold",
      action: () => toggleMarkAndExit(editor, "bold"),
      isActive: () => editor.isActive("bold"),
    },
    {
      key: "italic",
      icon: ICONS.italic,
      title: "Italic",
      action: () => toggleMarkAndExit(editor, "italic"),
      isActive: () => editor.isActive("italic"),
    },
    {
      key: "h1",
      icon: ICONS.h1,
      title: "Heading 1",
      action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      isActive: () => editor.isActive("heading", { level: 1 }),
    },
    {
      key: "h2",
      icon: ICONS.h2,
      title: "Heading 2",
      action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      isActive: () => editor.isActive("heading", { level: 2 }),
    },
    {
      key: "sep",
      icon: "",
      title: "",
      action: () => {},
      isActive: () => false,
    },
    {
      key: "blockquote",
      icon: ICONS.blockquote,
      title: "Quote",
      action: () => editor.chain().focus().toggleBlockquote().run(),
      isActive: () => editor.isActive("blockquote"),
    },
    {
      key: "link",
      icon: ICONS.link,
      title: "Link",
      action: (view: EditorView) => {
        if (editor.isActive("link")) {
          editor.chain().focus().unsetLink().run();
        } else {
          view.dom.dispatchEvent(new CustomEvent("tiptap:open-link-input"));
        }
      },
      isActive: () => editor.isActive("link"),
    },
  ];
}

export const BubbleMenu = Extension.create({
  name: "bubbleMenu",

  addOptions() {
    return {
      toolbarMode: "default" as FormattingToolbarMode,
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const toolbarMode = this.options.toolbarMode as FormattingToolbarMode;
    let el: HTMLElement | null = null;
    let buttons: BubbleBtn[] = [];
    const btnEls: Map<string, HTMLButtonElement> = new Map();

    function create() {
      el = document.createElement("div");
      el.className = "tiptap-bubble-menu";
      el.dataset.editorFloatingUi = "true";
      el.style.position = "fixed";
      el.style.display = "none";

      buttons = getButtons(editor, toolbarMode);
      for (const btn of buttons) {
        if (btn.key === "sep") {
          const sep = document.createElement("span");
          sep.className = "tiptap-bubble-sep";
          el.appendChild(sep);
          continue;
        }
        const b = document.createElement("button");
        b.type = "button";
        b.innerHTML = btn.icon;
        b.title = btn.title;
        b.className = "tiptap-bubble-btn";
        b.addEventListener("mousedown", (e) => {
          e.preventDefault();
          btn.action(editor.view);
        });
        el.appendChild(b);
        btnEls.set(btn.key, b);
      }
    }

    function show(view: EditorView) {
      if (!el) return;
      el.style.display = "flex";

      // Anchor on the first visible line of the selection, centered on its
      // horizontal span. Select-all lands on the text you are looking at
      // rather than at the top of a document scrolled out of view.
      const { from, to } = view.state.selection;
      const dialog = view.dom.closest("dialog");
      const containerRect = getFixedFloatingContainerRect(dialog);
      const anchorRect = getRangeAnchorRect(
        view,
        from,
        to,
        getVisibleClipRect(view.dom, containerRect),
      );
      const rect = el.getBoundingClientRect();
      const layout = getFloatingPosition({
        anchorRect,
        containerRect,
        floatingWidth: rect.width,
        floatingHeight: rect.height,
        preferredPlacement: "top",
        fallbackPlacement: "bottom",
        align: "center",
      });

      el.style.left = `${layout.left}px`;
      el.style.top = `${layout.top}px`;
      el.dataset.placement = layout.placement;
      el.style.setProperty(
        "--floating-arrow-x",
        `${getFloatingArrowOffset({
          anchorRect,
          containerRect,
          floatingLeft: layout.left,
          floatingWidth: rect.width,
        })}px`,
      );

      syncActive();
    }

    function hide() {
      if (!el) return;
      el.style.display = "none";
    }

    function syncActive() {
      for (const btn of buttons) {
        if (btn.key === "sep") continue;
        const b = btnEls.get(btn.key);
        if (b) b.classList.toggle("is-active", btn.isActive(editor.view));
      }
    }

    function shouldShow(view: EditorView): boolean {
      const { state } = view;
      const { selection } = state;
      if (selection.empty) return false;
      // Hide when link input popup is open
      if (isLinkToolbarInputActive()) return false;

      // Select-all reports an AllSelection, not a TextSelection. Clearing
      // formatting off a pasted draft and quoting a whole note are exactly
      // what a document-wide selection is for, so it gets the same toolbar as
      // dragging over everything — as long as there is text to format.
      if (selection instanceof AllSelection) {
        return (
          state.doc.textBetween(selection.from, selection.to, " ").trim() !== ""
        );
      }

      // Otherwise only non-empty text selections (not node selections)
      if (!(selection instanceof TextSelection)) return false;
      return selection.$from.parent.isTextblock;
    }

    return [
      new Plugin({
        key: bubbleMenuKey,
        view(editorView) {
          create();
          const dialog = editorView.dom.closest("dialog");
          const container = dialog ?? document.body;
          if (el) container.appendChild(el);

          // Dismiss bubble menu when clicking outside the editor
          function onContainerMousedown(e: Event) {
            const target = e.target as HTMLElement | null;
            if (!target) return;
            // Ignore clicks inside the editor itself
            if (editorView.dom.contains(target)) return;
            // Ignore clicks on floating UI (bubble menu, link toolbar)
            if (target.closest("[data-editor-floating-ui]")) return;
            if (el?.contains(target)) return;
            // Collapse selection to dismiss the bubble menu
            const { state } = editorView;
            const pos = state.selection.from;
            editorView.dispatch(
              state.tr.setSelection(Selection.near(state.doc.resolve(pos))),
            );
            editorView.dom.blur();
          }
          container.addEventListener("mousedown", onContainerMousedown);

          return {
            update(view) {
              if (shouldShow(view)) {
                show(view);
              } else {
                hide();
              }
            },
            destroy() {
              container.removeEventListener("mousedown", onContainerMousedown);
              el?.remove();
              el = null;
            },
          };
        },
      }),
    ];
  },
});
