// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { createMarkdownContentExtensions } from "../../../lib/markdown-manager.js";
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
    if (position !== null) return false;
    if (node.type.name !== "paragraph" || node.textContent !== text) return;

    position = pos + 1 + (edge === "end" ? node.content.size : 0);
    return false;
  });

  if (position === null) throw new Error(`Paragraph not found: ${text}`);
  return position;
}

function editorAt(
  content: string,
  text: string,
  edge: "start" | "end",
): Editor {
  const editor = createEditor(content);
  setCursor(editor, paragraphPosition(editor, text, edge));
  return editor;
}

/**
 * Renders lists as Markdown-like lines with the caret as `|`, so an assertion
 * reads like the structure the author sees. A markerless paragraph inside an
 * item aligns with the item's text; the trailing empty paragraph is omitted.
 */
function outline(editor: Editor): string {
  const { selection } = editor.state;
  const lines: string[] = [];

  const lineText = (node: ProseMirrorNode, pos: number): string => {
    const start = pos + 1;
    const offset = selection.from - start;
    if (offset < 0 || offset > node.content.size) return node.textContent;
    return `${node.textContent.slice(0, offset)}|${node.textContent.slice(offset)}`;
  };

  const walk = (
    parent: ProseMirrorNode,
    contentStart: number,
    indent: string,
  ) => {
    parent.forEach((child, offset) => {
      const pos = contentStart + offset;
      if (child.isTextblock) {
        lines.push(`${indent}${lineText(child, pos)}`);
        return;
      }

      const ordered = child.type.name === "orderedList";
      if (!ordered && child.type.name !== "bulletList") {
        lines.push(`${indent}[${child.type.name}]`);
        return;
      }

      let number = Number(child.attrs.start ?? 1);
      child.forEach((item, itemOffset) => {
        const marker = ordered ? `${number++}. ` : "- ";
        const firstLine = lines.length;
        walk(
          item,
          pos + 1 + itemOffset + 1,
          indent + " ".repeat(marker.length),
        );
        lines[firstLine] = `${indent}${marker}${lines[firstLine]?.trimStart()}`;
      });
    });
  };

  walk(editor.state.doc, 0, "");
  if (lines.at(-1) === "") lines.pop();
  return lines.join("\n");
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

  describe("Backspace at the start of a line", () => {
    it("removes a top-level marker first, then merges into the line above", () => {
      const editor = editorAt(
        "<ul><li><p>1</p><ul><li><p>a</p></li><li><p>c</p></li></ul></li><li><p>2</p></li></ul>",
        "2",
        "start",
      );

      expect(pressKey(editor, "Backspace")).toBe(true);
      expect(outline(editor)).toBe(["- 1", "  - a", "  - c", "|2"].join("\n"));

      expect(pressKey(editor, "Backspace")).toBe(true);
      expect(outline(editor)).toBe(["- 1", "  - a", "  - c|2"].join("\n"));
    });

    it("rejoins a split ordered list once the unmarked line merges", () => {
      const editor = editorAt(
        "<ol><li><p>one</p></li><li><p>two</p></li><li><p>three</p></li></ol>",
        "two",
        "start",
      );

      expect(pressKey(editor, "Backspace")).toBe(true);
      expect(outline(editor)).toBe(["1. one", "|two", "1. three"].join("\n"));

      expect(pressKey(editor, "Backspace")).toBe(true);
      expect(outline(editor)).toBe(["1. one|two", "2. three"].join("\n"));
    });

    it("keeps a nested item inside its parent when removing its marker", () => {
      const editor = editorAt(
        "<ul><li><p>1</p><ul><li><p>a</p></li><li><p>b</p></li><li><p>c</p></li></ul></li></ul>",
        "b",
        "start",
      );

      expect(pressKey(editor, "Backspace")).toBe(true);
      expect(outline(editor)).toBe(
        ["- 1", "  - a", "  |b", "  - c"].join("\n"),
      );

      expect(pressKey(editor, "Backspace")).toBe(true);
      expect(outline(editor)).toBe(["- 1", "  - a|b", "  - c"].join("\n"));
    });

    it("moves an unmarked item's children up one level", () => {
      const editor = editorAt(
        "<ul><li><p>1</p><ul><li><p>a</p></li><li><p>b</p><ul><li><p>x</p></li></ul></li><li><p>c</p></li></ul></li></ul>",
        "b",
        "start",
      );

      expect(pressKey(editor, "Backspace")).toBe(true);
      expect(outline(editor)).toBe(
        ["- 1", "  - a", "  |b", "  - x", "  - c"].join("\n"),
      );
    });

    it("merges a first nested item into its parent line in two presses", () => {
      const editor = editorAt(
        "<ul><li><p>Parent</p><ul><li><p>Child</p></li><li><p>Sibling</p></li></ul></li></ul>",
        "Child",
        "start",
      );

      expect(pressKey(editor, "Backspace")).toBe(true);
      expect(outline(editor)).toBe(
        ["- Parent", "  |Child", "  - Sibling"].join("\n"),
      );

      expect(pressKey(editor, "Backspace")).toBe(true);
      expect(outline(editor)).toBe(
        ["- Parent|Child", "  - Sibling"].join("\n"),
      );
    });

    it("removes an empty nested item and returns to the end of the line above", () => {
      const editor = editorAt(
        "<ul><li><p>1</p><ul><li><p>c</p></li><li><p></p></li></ul></li><li><p>2</p></li></ul>",
        "",
        "start",
      );

      expect(pressKey(editor, "Backspace")).toBe(true);
      expect(pressKey(editor, "Backspace")).toBe(true);
      expect(outline(editor)).toBe(["- 1", "  - c|", "- 2"].join("\n"));
    });

    it("merges a paragraph after a nested list into the line above", () => {
      const editor = editorAt(
        "<ul><li><p>A</p><ul><li><p>Nested</p></li></ul><p>Continuation</p></li><li><p>B</p></li></ul>",
        "Continuation",
        "start",
      );

      expect(pressKey(editor, "Backspace")).toBe(true);
      expect(outline(editor)).toBe(
        ["- A", "  - Nested|Continuation", "- B"].join("\n"),
      );
    });

    it("restores list items and subtrees with undo", () => {
      const editor = editorAt(
        "<ul><li><p>A</p></li><li><p>B</p><ul><li><p>Child</p></li></ul></li></ul>",
        "B",
        "start",
      );
      const before = editor.getJSON();

      expect(pressKey(editor, "Backspace")).toBe(true);
      expect(editor.commands.undo()).toBe(true);
      expect(editor.getJSON()).toEqual(before);
    });
  });

  describe("Delete at the end of a line", () => {
    it.each([
      ["ordered", "ol", ["1. A|B", "   - y"]],
      ["bullet", "ul", ["- A|B", "  - y"]],
    ])(
      "merges the next %s item and keeps its children",
      (_name, tag, lines) => {
        const editor = editorAt(
          `<${tag}><li><p>A</p></li><li><p>B</p><ul><li><p>y</p></li></ul></li></${tag}>`,
          "A",
          "end",
        );

        expect(pressKey(editor, "Delete")).toBe(true);
        expect(outline(editor)).toBe(lines.join("\n"));
      },
    );

    it("pulls a shallower item up without moving its children", () => {
      const editor = editorAt(
        "<ul><li><p>1</p><ul><li><p>a</p></li><li><p>c</p></li></ul></li><li><p>2</p><ul><li><p>x</p></li></ul></li><li><p>3</p></li></ul>",
        "c",
        "end",
      );

      expect(pressKey(editor, "Delete")).toBe(true);
      expect(outline(editor)).toBe(
        ["- 1", "  - a", "  - c|2", "  - x", "- 3"].join("\n"),
      );
    });

    it("pulls a first nested item up and moves its children up one level", () => {
      const editor = editorAt(
        "<ul><li><p>P</p><ul><li><p>c1</p><ul><li><p>y</p></li></ul></li><li><p>c2</p></li></ul></li></ul>",
        "P",
        "end",
      );

      expect(pressKey(editor, "Delete")).toBe(true);
      expect(outline(editor)).toBe(["- P|c1", "  - y", "  - c2"].join("\n"));
    });

    it("pulls a list's first item into the paragraph above", () => {
      const editor = editorAt(
        "<p>intro</p><ul><li><p>A</p><ul><li><p>k</p></li></ul></li><li><p>B</p></li></ul>",
        "intro",
        "end",
      );

      expect(pressKey(editor, "Delete")).toBe(true);
      expect(outline(editor)).toBe(["intro|A", "- k", "- B"].join("\n"));
    });

    it("agrees with Backspace for a line without a marker", () => {
      const html =
        "<ul><li><p>A</p><ul><li><p>c</p></li></ul></li></ul><p>tail</p>";
      const forward = editorAt(html, "c", "end");
      const backward = editorAt(html, "tail", "start");

      expect(pressKey(forward, "Delete")).toBe(true);
      expect(pressKey(backward, "Backspace")).toBe(true);
      expect(outline(forward)).toBe(["- A", "  - c|tail"].join("\n"));
      expect(outline(backward)).toBe(outline(forward));
    });
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
});
