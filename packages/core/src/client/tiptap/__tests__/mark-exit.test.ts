// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { createMarkdownContentExtensions } from "../../../lib/markdown-manager.js";
import { toggleMarkAndExit } from "../bubble-menu.js";

const editors: Editor[] = [];

function createEditor(content: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: createMarkdownContentExtensions(),
    content,
  });
  editor.view.dispatch(editor.state.tr);
  editors.push(editor);
  return editor;
}

// Mimic real ProseMirror typed input: each char is offered to handleTextInput
// (used by mark input rules); if unhandled, insert it normally.
function type(editor: Editor, text: string): void {
  const view = editor.view;
  for (const ch of text) {
    const { from, to } = view.state.selection;
    const handled = view.someProp("handleTextInput", (f) =>
      f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)),
    );
    if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to));
  }
}

/** Marks on the text node containing the last character of the doc. */
function marksOfLastText(editor: Editor): string[] {
  const json = editor.getJSON();
  const para = json.content?.[0];
  const last = para?.content?.[para.content.length - 1];
  return (last?.marks ?? []).map((m: { type: string }) => m.type);
}

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
});

describe("toggleMarkAndExit", () => {
  it("formats the selection, then continued typing is plain", () => {
    const editor = createEditor("<p>hello</p>");
    editor.chain().setTextSelection({ from: 1, to: 6 }).run();

    toggleMarkAndExit(editor, "strike");
    type(editor, "Z");

    // "hello" struck, "Z" plain — cursor exited the inclusive mark.
    expect(editor.getJSON().content?.[0]).toEqual({
      type: "paragraph",
      content: [
        { type: "text", marks: [{ type: "strike" }], text: "hello" },
        { type: "text", text: "Z" },
      ],
    });
  });

  it("works for bold the same way", () => {
    const editor = createEditor("<p>word</p>");
    editor.chain().setTextSelection({ from: 1, to: 5 }).run();

    toggleMarkAndExit(editor, "bold");
    type(editor, "!");

    expect(marksOfLastText(editor)).toEqual([]);
  });

  it("toggling a mark off leaves the cursor plain", () => {
    const editor = createEditor("<p><strong>bold</strong></p>");
    editor.chain().setTextSelection({ from: 1, to: 5 }).run();

    toggleMarkAndExit(editor, "bold");
    type(editor, "x");

    // Mark removed from the selection and from the trailing cursor.
    expect(editor.isActive("bold")).toBe(false);
    expect(marksOfLastText(editor)).toEqual([]);
  });

  it("with an empty selection it acts as a plain mode toggle (stays on)", () => {
    const editor = createEditor("<p></p>");
    editor.chain().setTextSelection(1).run();

    toggleMarkAndExit(editor, "bold");
    type(editor, "ab");

    // No selection → mode toggle: typed text carries the mark.
    expect(marksOfLastText(editor)).toEqual(["bold"]);
  });
});
