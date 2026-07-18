/**
 * Code Block Indent Extension
 *
 * Handles Tab / Shift-Tab inside code blocks by inserting or removing 2-space
 * indentation. When text is selected across multiple lines, every selected
 * line is indented or outdented.
 *
 * List indentation belongs to StructuralKeymap. Normal paragraphs are left
 * alone so Tab keeps its default focus-navigation behavior for accessibility.
 */

import { Extension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

const INDENT = "  "; // 2 spaces

export const CodeBlockIndent = Extension.create({
  name: "codeBlockIndent",

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        if (editor.isActive("codeBlock")) {
          const { state, dispatch } = editor.view;
          const { selection } = state;
          const { from, to } = selection;

          // Resolve start/end positions inside the code block
          const $from = state.doc.resolve(from);
          const codeBlock = $from.parent;

          if (codeBlock.type.name !== "codeBlock") return false;

          const blockStart = $from.start();
          const text = codeBlock.textContent;

          // Single cursor (no selection) — insert 2 spaces
          if (from === to) {
            const tr = state.tr.insertText(INDENT, from);
            dispatch(tr);
            return true;
          }

          // Selection spans lines — indent each line
          const relFrom = from - blockStart;
          const relTo = to - blockStart;

          // Find all line-start offsets that overlap the selection
          const lines: number[] = [];
          // Always include the line containing the selection start
          const firstLineStart = text.lastIndexOf("\n", relFrom - 1) + 1;
          lines.push(firstLineStart);

          let pos = firstLineStart;
          while (true) {
            const next = text.indexOf("\n", pos);
            if (next === -1 || next >= relTo) break;
            lines.push(next + 1);
            pos = next + 1;
          }

          // Build transaction inserting INDENT at each line start
          let tr = state.tr;
          let offset = 0;
          for (const lineStart of lines) {
            tr = tr.insertText(INDENT, blockStart + lineStart + offset);
            offset += INDENT.length;
          }

          // Adjust selection to cover the indented range
          const newFrom = from + INDENT.length;
          const newTo = to + offset;
          tr.setSelection(TextSelection.create(tr.doc, newFrom, newTo));

          dispatch(tr);
          return true;
        }

        return false;
      },

      "Shift-Tab": ({ editor }) => {
        if (editor.isActive("codeBlock")) {
          const { state, dispatch } = editor.view;
          const { selection } = state;
          const { from, to } = selection;

          const $from = state.doc.resolve(from);
          const codeBlock = $from.parent;

          if (codeBlock.type.name !== "codeBlock") return false;

          const blockStart = $from.start();
          const text = codeBlock.textContent;

          // Single cursor — remove up to 2 leading spaces on current line
          if (from === to) {
            const relPos = from - blockStart;
            const lineStart = text.lastIndexOf("\n", relPos - 1) + 1;
            const lineText = text.slice(lineStart);

            const spacesToRemove = lineText.startsWith(INDENT)
              ? 2
              : lineText.startsWith(" ")
                ? 1
                : 0;

            if (spacesToRemove === 0) return true; // consume but do nothing

            const tr = state.tr.delete(
              blockStart + lineStart,
              blockStart + lineStart + spacesToRemove,
            );
            dispatch(tr);
            return true;
          }

          // Selection spans lines — outdent each line
          const relFrom = from - blockStart;
          const relTo = to - blockStart;

          const lines: number[] = [];
          const firstLineStart = text.lastIndexOf("\n", relFrom - 1) + 1;
          lines.push(firstLineStart);

          let pos = firstLineStart;
          while (true) {
            const next = text.indexOf("\n", pos);
            if (next === -1 || next >= relTo) break;
            lines.push(next + 1);
            pos = next + 1;
          }

          let tr = state.tr;
          let offset = 0;
          let firstLineRemoved = 0;
          for (let i = 0; i < lines.length; i++) {
            const lineStart = lines[i] as number;
            const lineText = text.slice(lineStart);
            const spacesToRemove = lineText.startsWith(INDENT)
              ? 2
              : lineText.startsWith(" ")
                ? 1
                : 0;

            if (spacesToRemove > 0) {
              const deleteFrom = blockStart + lineStart + offset;
              tr = tr.delete(deleteFrom, deleteFrom + spacesToRemove);
              offset -= spacesToRemove;
              if (i === 0) firstLineRemoved = spacesToRemove;
            }
          }

          if (offset < 0) {
            const newFrom = Math.max(from - firstLineRemoved, blockStart);
            const newTo = to + offset;
            tr.setSelection(
              TextSelection.create(tr.doc, newFrom, Math.max(newTo, newFrom)),
            );
          }

          dispatch(tr);
          return true;
        }

        return false;
      },
    };
  },
});
