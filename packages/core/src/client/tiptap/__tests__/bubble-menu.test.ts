// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { createEditorExtensions } from "../extensions.js";
import { clearFormatting, toggleMarkAndExit } from "../bubble-menu.js";

const editors: Editor[] = [];

function createEditor(content: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);

  const editor = new Editor({
    element,
    extensions: createEditorExtensions(),
    content,
  });

  editors.push(editor);
  return editor;
}

function getBubbleMenu(editor: Editor): HTMLElement {
  const el = (editor.options.element as HTMLElement)
    .closest("body")
    ?.querySelector<HTMLElement>(".tiptap-bubble-menu");
  if (!el) throw new Error("Bubble menu was never created");
  return el;
}

function isVisible(editor: Editor): boolean {
  return getBubbleMenu(editor).style.display !== "none";
}

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
  document.body.innerHTML = "";
});

describe("bubble menu visibility", () => {
  it("stays hidden while the selection is empty", () => {
    const editor = createEditor("<p>A quiet note</p>");
    editor.commands.focus();

    expect(isVisible(editor)).toBe(false);
  });

  it("shows for a text selection", () => {
    const editor = createEditor("<p>A quiet note</p>");
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, 1, 8),
      ),
    );

    expect(isVisible(editor)).toBe(true);
  });

  it("shows for select-all, which is an AllSelection rather than a text selection", () => {
    const editor = createEditor("<p>First line</p><p>Second line</p>");
    editor.commands.selectAll();

    expect(isVisible(editor)).toBe(true);
  });

  it("stays hidden when select-all covers an empty document", () => {
    const editor = createEditor("<p></p>");
    editor.commands.selectAll();

    expect(isVisible(editor)).toBe(false);
  });

  it("hides again once the selection collapses", () => {
    const editor = createEditor("<p>A quiet note</p>");
    editor.commands.selectAll();
    expect(isVisible(editor)).toBe(true);

    editor.commands.setTextSelection(2);

    expect(isVisible(editor)).toBe(false);
  });
});

describe("bubble menu actions on a document-wide selection", () => {
  it("bolds the whole document and leaves the cursor outside the mark", () => {
    const editor = createEditor("<p>First line</p><p>Second line</p>");
    editor.commands.selectAll();

    toggleMarkAndExit(editor, "bold");

    expect(editor.getHTML()).toBe(
      "<p><strong>First line</strong></p><p><strong>Second line</strong></p>",
    );
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.storedMarks ?? []).toHaveLength(0);
  });

  it("clears formatting across every selected block", () => {
    const editor = createEditor(
      "<h2>A heading</h2><p><strong>bold</strong> and <em>italic</em></p>",
    );
    editor.commands.selectAll();

    clearFormatting(editor);

    expect(editor.getHTML()).toBe("<p>A heading</p><p>bold and italic</p>");
  });
});
