// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { createMarkdownContentExtensions } from "../../../lib/markdown-manager.js";
import { clearFormatting } from "../bubble-menu.js";
import { ContinuousLists } from "../continuous-lists.js";
import { StructuralKeymap } from "../structural-keymap.js";

const editors: Editor[] = [];

function createEditor(content: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);

  const editor = new Editor({
    element,
    extensions: [
      ...createMarkdownContentExtensions(),
      StructuralKeymap,
      ContinuousLists,
    ],
    content,
  });

  editor.view.dispatch(editor.state.tr);
  editors.push(editor);
  return editor;
}

function setCursor(editor: Editor, pos: number): void {
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)),
  );
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

function pressKey(editor: Editor, key: string, shiftKey = false): boolean {
  return Boolean(
    editor.view.someProp("handleKeyDown", (handler) =>
      handler(
        editor.view,
        new KeyboardEvent("keydown", {
          key,
          code: key,
          shiftKey,
        }),
      ),
    ),
  );
}

function pasteHtml(editor: Editor, html: string): void {
  const event = new Event("paste", {
    bubbles: true,
    cancelable: true,
  }) as Event & { clipboardData: unknown };
  event.clipboardData = {
    getData: (type: string) => (type === "text/html" ? html : ""),
    files: [],
    items: [],
    types: ["text/html"],
  };
  editor.commands.focus();
  editor.view.dom.dispatchEvent(event);
}

afterEach(() => {
  while (editors.length > 0) editors.pop()?.destroy();
  document.body.innerHTML = "";
});

describe("list editing", () => {
  it("joins adjacent fragments so later items renumber with earlier edits", () => {
    const editor = createEditor(
      '<ol><li><p>One</p></li><li><p>Two</p></li></ol><ol start="8"><li><p>Three</p></li><li><p>Four</p></li></ol>',
    );

    const list = editor.state.doc.firstChild;
    expect(list?.type.name).toBe("orderedList");
    expect(list?.attrs.start).toBe(1);
    expect(list?.childCount).toBe(4);
    expect(list?.content.content.map((item) => item.textContent)).toEqual([
      "One",
      "Two",
      "Three",
      "Four",
    ]);

    let secondItemEnd = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "paragraph" && node.textContent === "Two") {
        secondItemEnd = pos + 1 + node.content.size;
      }
    });
    setCursor(editor, secondItemEnd);

    expect(pressKey(editor, "Enter")).toBe(true);
    expect(
      editor.state.doc.firstChild?.content.content.map(
        (item) => item.textContent,
      ),
    ).toEqual(["One", "Two", "", "Three", "Four"]);
  });

  it("keeps an intentional restart separated by another block", () => {
    const editor = createEditor(
      "<ol><li><p>One</p></li></ol><p>New section</p><ol><li><p>One again</p></li></ol>",
    );

    expect(editor.state.doc.child(0).type.name).toBe("orderedList");
    expect(editor.state.doc.child(1).type.name).toBe("paragraph");
    expect(editor.state.doc.child(2).type.name).toBe("orderedList");
    expect(editor.state.doc.child(2).attrs.start).toBe(1);
  });

  it("normalizes ordered-list fragments introduced by a later paste", () => {
    const editor = createEditor("<p></p>");

    pasteHtml(
      editor,
      '<ol start="3"><li><p>Three</p></li></ol><ol start="9"><li><p>Four</p></li></ol>',
    );

    const list = editor.state.doc.firstChild;
    expect(list?.type.name).toBe("orderedList");
    expect(list?.attrs.start).toBe(3);
    expect(list?.childCount).toBe(2);
    expect(list?.content.content.map((item) => item.textContent)).toEqual([
      "Three",
      "Four",
    ]);
  });

  it("normalizes adjacent nested ordered-list fragments", () => {
    const editor = createEditor(
      '<ol><li><p>Parent</p><ol type="a"><li><p>First child</p></li></ol><ol start="7"><li><p>Second child</p></li></ol></li></ol>',
    );

    const parentItem = editor.state.doc.firstChild?.firstChild;
    const nestedList = parentItem?.child(1);
    expect(parentItem?.childCount).toBe(2);
    expect(nestedList?.type.name).toBe("orderedList");
    expect(nestedList?.attrs.start).toBe(1);
    expect(nestedList?.childCount).toBe(2);
  });

  it("normalizes adjacent bullet-list fragments", () => {
    const editor = createEditor(
      "<ul><li><p>One</p></li></ul><ul><li><p>Two</p></li></ul>",
    );

    const list = editor.state.doc.firstChild;
    expect(list?.type.name).toBe("bulletList");
    expect(list?.childCount).toBe(2);
    expect(list?.content.content.map((item) => item.textContent)).toEqual([
      "One",
      "Two",
    ]);
  });

  it("keeps adjacent mixed list types separate", () => {
    const editor = createEditor(
      "<ul><li><p>Bullet</p></li></ul><ol><li><p>Numbered</p></li></ol>",
    );

    expect(editor.state.doc.child(0).type.name).toBe("bulletList");
    expect(editor.state.doc.child(1).type.name).toBe("orderedList");
  });

  it("joins an expected next number to the preceding ordered list", () => {
    const editor = createEditor(
      '<ol start="5"><li><p>Five</p></li><li><p>Six</p></li></ol><p></p>',
    );
    setCursor(editor, editor.state.doc.content.size - 1);

    typeText(editor, "7. ");

    expect(editor.state.doc.firstChild?.childCount).toBe(3);
    expect(editor.state.doc.firstChild?.type.name).toBe("orderedList");
    expect(editor.state.doc.firstChild?.attrs.start).toBe(5);
  });

  it("uses Tab and Shift-Tab to nest and unnest an ordered-list item", () => {
    const editor = createEditor(
      "<ol><li><p>One</p></li><li><p>Two</p></li><li><p>Three</p></li></ol>",
    );
    const list = editor.state.doc.firstChild!;
    const secondItemPos = 1 + list.child(0).nodeSize + 2;
    setCursor(editor, secondItemPos);

    expect(pressKey(editor, "Tab")).toBe(true);

    const nestedParent = editor.state.doc.firstChild?.child(0);
    expect(editor.state.doc.firstChild?.childCount).toBe(2);
    expect(nestedParent?.lastChild?.type.name).toBe("orderedList");
    expect(nestedParent?.lastChild?.firstChild?.textContent).toBe("Two");

    expect(pressKey(editor, "Tab", true)).toBe(true);

    expect(editor.state.doc.firstChild?.childCount).toBe(3);
    expect(
      editor.state.doc.firstChild?.content.content.map(
        (item) => item.textContent,
      ),
    ).toEqual(["One", "Two", "Three"]);
  });

  it("consumes Tab when the first list item cannot be indented", () => {
    const editor = createEditor(
      "<ol><li><p>One</p></li><li><p>Two</p></li></ol>",
    );
    setCursor(editor, 3);
    const before = editor.getJSON();

    expect(pressKey(editor, "Tab")).toBe(true);
    expect(editor.getJSON()).toEqual(before);
  });

  it("uses Enter for a new item and Shift-Enter for a hard break", () => {
    const enterEditor = createEditor("<ul><li><p>A</p></li></ul>");
    const hardBreakEditor = createEditor("<ul><li><p>A</p></li></ul>");
    setCursor(enterEditor, paragraphPosition(enterEditor, "A", "end"));
    setCursor(hardBreakEditor, paragraphPosition(hardBreakEditor, "A", "end"));

    expect(pressKey(enterEditor, "Enter")).toBe(true);
    expect(pressKey(hardBreakEditor, "Enter", true)).toBe(true);

    expect(enterEditor.state.doc.firstChild?.childCount).toBe(2);
    expect(hardBreakEditor.state.doc.firstChild?.childCount).toBe(1);
    expect(
      hardBreakEditor.state.doc.firstChild?.firstChild?.firstChild?.lastChild
        ?.type.name,
    ).toBe("hardBreak");
  });

  it("exits a list from an empty final item", () => {
    const editor = createEditor("<ul><li><p>A</p></li><li><p></p></li></ul>");
    const list = editor.state.doc.firstChild!;
    const emptyItemPosition = 1 + list.child(0).nodeSize + 2;
    setCursor(editor, emptyItemPosition);

    expect(pressKey(editor, "Enter")).toBe(true);

    expect(editor.state.doc.firstChild?.type.name).toBe("bulletList");
    expect(editor.state.doc.firstChild?.childCount).toBe(1);
    expect(editor.state.doc.child(1).type.name).toBe("paragraph");
  });

  it("undoes a just-typed list input rule before merging items", () => {
    const editor = createEditor("<p></p>");
    setCursor(editor, 1);

    typeText(editor, "- ");
    expect(editor.state.doc.firstChild?.type.name).toBe("bulletList");

    expect(pressKey(editor, "Backspace")).toBe(true);
    expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
  });

  it("merges paragraphs inside a list item without removing its marker", () => {
    const editor = createEditor(
      "<ol><li><p>First item</p></li><li><p>First paragraph</p><p>Second paragraph</p><p>Third paragraph</p></li></ol>",
    );
    let secondParagraphPos = 0;
    editor.state.doc.descendants((node, pos) => {
      if (
        node.type.name === "paragraph" &&
        node.textContent === "Second paragraph"
      ) {
        secondParagraphPos = pos + 1;
      }
    });
    setCursor(editor, secondParagraphPos);

    expect(pressKey(editor, "Backspace")).toBe(true);

    const list = editor.state.doc.firstChild;
    const secondItem = list?.child(1);
    expect(list?.childCount).toBe(2);
    expect(secondItem?.childCount).toBe(2);
    expect(secondItem?.child(0).textContent).toBe(
      "First paragraphSecond paragraph",
    );
    expect(secondItem?.child(1).textContent).toBe("Third paragraph");
  });

  it.each([
    ["ordered", "ol"],
    ["bullet", "ul"],
  ])(
    "merges adjacent %s items in one Backspace, matching forward Delete",
    (_name, tag) => {
      const html = `<${tag}><li><p>A</p></li><li><p>B</p></li></${tag}>`;
      const backwardEditor = createEditor(html);
      const forwardEditor = createEditor(html);

      setCursor(
        backwardEditor,
        paragraphPosition(backwardEditor, "B", "start"),
      );
      setCursor(forwardEditor, paragraphPosition(forwardEditor, "A", "end"));

      expect(pressKey(backwardEditor, "Backspace")).toBe(true);
      expect(pressKey(forwardEditor, "Delete")).toBe(true);

      expect(backwardEditor.state.doc.firstChild?.toJSON()).toEqual(
        forwardEditor.state.doc.firstChild?.toJSON(),
      );
      expect(backwardEditor.state.doc.firstChild?.childCount).toBe(1);
      expect(backwardEditor.state.doc.firstChild?.firstChild?.textContent).toBe(
        "AB",
      );
    },
  );

  it("removes a list marker without reordering existing subtrees", () => {
    const editor = createEditor(
      "<ul><li><p>A</p><ul><li><p>P</p></li></ul></li><li><p>B</p><ul><li><p>X</p></li></ul></li><li><p>C</p></li></ul>",
    );
    setCursor(editor, paragraphPosition(editor, "B", "start"));

    expect(pressKey(editor, "Backspace")).toBe(true);

    const list = editor.state.doc.firstChild;
    const mergedItem = list?.firstChild;
    expect(list?.type.name).toBe("bulletList");
    expect(list?.childCount).toBe(2);
    expect(
      mergedItem?.content.content.map((node) => [
        node.type.name,
        node.textContent,
      ]),
    ).toEqual([
      ["paragraph", "A"],
      ["bulletList", "P"],
      ["paragraph", "B"],
      ["bulletList", "X"],
    ]);
    expect(list?.child(1).textContent).toBe("C");
  });

  it("preserves the current item's subtree during a direct merge", () => {
    const editor = createEditor(
      "<ul><li><p>A</p></li><li><p>B</p><ul><li><p>Child</p></li></ul></li></ul>",
    );
    setCursor(editor, paragraphPosition(editor, "B", "start"));

    expect(pressKey(editor, "Backspace")).toBe(true);

    const mergedItem = editor.state.doc.firstChild?.firstChild;
    expect(editor.state.doc.firstChild?.childCount).toBe(1);
    expect(mergedItem?.firstChild?.textContent).toBe("AB");
    expect(mergedItem?.lastChild?.type.name).toBe("bulletList");
    expect(mergedItem?.lastChild?.firstChild?.textContent).toBe("Child");
  });

  it("restores list items and subtrees with undo", () => {
    const editor = createEditor(
      "<ul><li><p>A</p></li><li><p>B</p><ul><li><p>Child</p></li></ul></li></ul>",
    );
    setCursor(editor, paragraphPosition(editor, "B", "start"));
    const before = editor.getJSON();

    expect(pressKey(editor, "Backspace")).toBe(true);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON()).toEqual(before);
  });

  it("does not lift a whole item from a paragraph after a nested list", () => {
    const editor = createEditor(
      "<ul><li><p>A</p><ul><li><p>Nested</p></li></ul><p>Continuation</p></li><li><p>B</p></li></ul>",
    );
    setCursor(editor, paragraphPosition(editor, "Continuation", "start"));
    const before = editor.getJSON();

    expect(pressKey(editor, "Backspace")).toBe(true);
    expect(editor.getJSON()).toEqual(before);
  });

  it("lets the official keymap promote a first nested item", () => {
    const editor = createEditor(
      "<ul><li><p>Parent</p><ul><li><p>Child</p></li></ul></li></ul>",
    );
    setCursor(editor, paragraphPosition(editor, "Child", "start"));

    expect(pressKey(editor, "Backspace")).toBe(true);

    const list = editor.state.doc.firstChild;
    expect(list?.type.name).toBe("bulletList");
    expect(list?.childCount).toBe(2);
    expect(list?.child(0).textContent).toBe("Parent");
    expect(list?.child(1).textContent).toBe("Child");
  });

  it("preserves multiple paragraphs and a nested list when pasting HTML", () => {
    const editor = createEditor("<p></p>");

    pasteHtml(
      editor,
      '<ol start="4"><li><p>First paragraph</p><p>Second paragraph</p><ol><li><p>Nested item</p></li></ol></li><li><p>Next item</p></li></ol>',
    );

    const list = editor.state.doc.firstChild;
    const firstItem = list?.firstChild;
    expect(list?.type.name).toBe("orderedList");
    expect(list?.attrs.start).toBe(4);
    expect(list?.childCount).toBe(2);
    expect(firstItem?.childCount).toBe(3);
    expect(firstItem?.child(0).textContent).toBe("First paragraph");
    expect(firstItem?.child(1).textContent).toBe("Second paragraph");
    expect(firstItem?.child(2).type.name).toBe("orderedList");
    expect(firstItem?.child(2).firstChild?.textContent).toBe("Nested item");
  });

  it("clears marks without changing a pasted blockquote or nested ordered list", () => {
    const editor = createEditor(
      '<blockquote><ol start="5"><li><p><a href="https://example.com"><strong>Five</strong></a></p><ol><li><p>Nested</p></li></ol></li><li><p><em>Six</em></p></li></ol></blockquote>',
    );
    let from = Number.POSITIVE_INFINITY;
    let to = 0;
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText) return;
      from = Math.min(from, pos);
      to = Math.max(to, pos + node.nodeSize);
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, from, to),
      ),
    );

    clearFormatting(editor);

    const blockquote = editor.state.doc.firstChild;
    const outerList = blockquote?.firstChild;
    expect(blockquote?.type.name).toBe("blockquote");
    expect(outerList?.type.name).toBe("orderedList");
    expect(outerList?.attrs.start).toBe(5);
    expect(outerList?.childCount).toBe(2);
    expect(outerList?.child(0).lastChild?.type.name).toBe("orderedList");
    expect(outerList?.child(0).lastChild?.firstChild?.textContent).toBe(
      "Nested",
    );
    const linkedText = outerList?.child(0).firstChild?.firstChild;
    expect(linkedText?.marks.map((mark) => mark.type.name)).toEqual(["link"]);
    expect(linkedText?.marks[0]?.attrs.href).toBe("https://example.com");
    expect(editor.isActive("bold")).toBe(false);
    expect(editor.isActive("italic")).toBe(false);
  });
});
