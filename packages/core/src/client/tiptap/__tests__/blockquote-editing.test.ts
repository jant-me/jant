// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";
import { createMarkdownContentExtensions } from "../../../lib/markdown-manager.js";
import { StructuralKeymap } from "../structural-keymap.js";

const editors: Editor[] = [];

function createEditor(content: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);

  const editor = new Editor({
    element,
    extensions: [...createMarkdownContentExtensions(), StructuralKeymap],
    content,
  });

  editor.view.dispatch(editor.state.tr);
  editors.push(editor);
  return editor;
}

function paragraphPosition(
  editor: Editor,
  text: string,
  edge: "start" | "end",
): number {
  let position: number | null = null;

  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "paragraph" || node.textContent !== text) return;

    position = pos + 1 + (edge === "end" ? node.content.size : 0);
    return false;
  });

  if (position === null) throw new Error(`Paragraph not found: ${text}`);
  return position;
}

function setCursor(editor: Editor, pos: number): void {
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)),
  );
}

function pressKey(
  editor: Editor,
  key: string,
  options: globalThis.KeyboardEventInit = {},
): boolean {
  return Boolean(
    editor.view.someProp("handleKeyDown", (handler) =>
      handler(
        editor.view,
        new KeyboardEvent("keydown", { key, code: key, ...options }),
      ),
    ),
  );
}

function typeText(editor: Editor, text: string): void {
  for (const character of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp("handleTextInput", (handler) =>
      handler(editor.view, from, to, character, () =>
        editor.state.tr.insertText(character, from, to),
      ),
    );

    if (!handled) {
      editor.view.dispatch(editor.state.tr.insertText(character, from, to));
    }
  }
}

function meaningfulTopLevelNodes(editor: Editor) {
  return editor.state.doc.content.content.filter(
    (node) => node.type.name !== "paragraph" || node.content.size > 0,
  );
}

afterEach(() => {
  while (editors.length > 0) editors.pop()?.destroy();
  document.body.innerHTML = "";
});

describe("blockquote boundary editing", () => {
  it.each([
    {
      name: "paragraphs in one quote",
      html: "<blockquote><p>A</p><p>B</p></blockquote>",
      expectedType: "blockquote",
    },
    {
      name: "quote followed by paragraph",
      html: "<blockquote><p>A</p></blockquote><p>B</p>",
      expectedType: "blockquote",
    },
    {
      name: "paragraph followed by quote",
      html: "<p>A</p><blockquote><p>B</p></blockquote>",
      expectedType: "paragraph",
    },
    {
      name: "adjacent quotes",
      html: "<blockquote><p>A</p></blockquote><blockquote><p>B</p></blockquote>",
      expectedType: "blockquote",
    },
  ])(
    "merges $name symmetrically with Backspace and Delete",
    ({ html, expectedType }) => {
      const backwardEditor = createEditor(html);
      const forwardEditor = createEditor(html);
      setCursor(
        backwardEditor,
        paragraphPosition(backwardEditor, "B", "start"),
      );
      setCursor(forwardEditor, paragraphPosition(forwardEditor, "A", "end"));

      expect(pressKey(backwardEditor, "Backspace")).toBe(true);
      expect(pressKey(forwardEditor, "Delete")).toBe(true);

      const backwardNodes = meaningfulTopLevelNodes(backwardEditor);
      const forwardNodes = meaningfulTopLevelNodes(forwardEditor);
      expect(backwardNodes.map((node) => node.toJSON())).toEqual(
        forwardNodes.map((node) => node.toJSON()),
      );
      expect(backwardNodes).toHaveLength(1);
      expect(backwardNodes[0]?.type.name).toBe(expectedType);
      expect(backwardNodes[0]?.textContent).toBe("AB");
      if (expectedType === "blockquote") {
        expect(backwardNodes[0]?.childCount).toBe(1);
      }
      expect(backwardEditor.state.selection.$from.parentOffset).toBe(1);
    },
  );

  it.each([
    ["Backspace", {}],
    ["Shift-Backspace", { shiftKey: true }],
    ["Mod-Backspace", { ctrlKey: true }],
  ])("uses the same quote merge for %s", (_name, eventOptions) => {
    const editor = createEditor("<blockquote><p>A</p><p>B</p></blockquote>");
    setCursor(editor, paragraphPosition(editor, "B", "start"));

    expect(pressKey(editor, "Backspace", eventOptions)).toBe(true);
    expect(meaningfulTopLevelNodes(editor)[0]?.toJSON()).toMatchObject({
      type: "blockquote",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "AB" }],
        },
      ],
    });
  });

  it("restores the original quote structure with undo", () => {
    const editor = createEditor("<blockquote><p>A</p></blockquote><p>B</p>");
    setCursor(editor, paragraphPosition(editor, "B", "start"));
    const before = editor.getJSON();

    expect(pressKey(editor, "Backspace")).toBe(true);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON()).toEqual(before);
  });

  it("removes an empty trailing quote paragraph in one Backspace", () => {
    const editor = createEditor("<blockquote><p>A</p><p></p></blockquote>");
    const quote = editor.state.doc.firstChild!;
    const emptyParagraphPosition = 1 + quote.child(0).nodeSize + 1;
    setCursor(editor, emptyParagraphPosition);

    expect(pressKey(editor, "Backspace")).toBe(true);
    expect(editor.state.doc.firstChild?.toJSON()).toEqual({
      type: "blockquote",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "A" }],
        },
      ],
    });
  });

  it("keeps the official input rule that joins a new adjacent quote", () => {
    const editor = createEditor("<blockquote><p>A</p></blockquote><p></p>");
    setCursor(editor, editor.state.doc.content.size - 1);

    typeText(editor, "> ");

    const quote = editor.state.doc.firstChild;
    expect(quote?.type.name).toBe("blockquote");
    expect(quote?.childCount).toBe(2);
    expect(editor.state.doc.child(1).type.name).toBe("paragraph");
  });
});
