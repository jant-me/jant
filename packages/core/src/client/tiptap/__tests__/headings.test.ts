// @vitest-environment happy-dom

import type { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { createTiptapEditor, jsonToMarkdown } from "../create-editor.js";

/**
 * The editor creates three heading levels and keeps every level a post can
 * hold. `####` and below reach a post through the API, MCP, an import or a
 * Markdown paste, and the published page renders them as themselves; the
 * editor used to draw them as an `h1` and turn a pasted `<h4>` into a
 * paragraph.
 */

const editors: Editor[] = [];

function createEditor(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = createTiptapEditor({ element });
  editors.push(editor);
  return editor;
}

function headingLevels(editor: Editor): unknown[] {
  return (editor.getJSON().content ?? [])
    .filter((node) => node.type === "heading")
    .map((node) => node.attrs?.level);
}

/** Offer each character to the input rules, as typing does. */
function type(editor: Editor, text: string) {
  for (const char of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp("handleTextInput", (handler) =>
      handler(editor.view, from, to, char, () =>
        editor.state.tr.insertText(char, from, to),
      ),
    );
    if (!handled) {
      editor.view.dispatch(editor.state.tr.insertText(char, from, to));
    }
  }
}

function paste(editor: Editor, html: string, text: string) {
  const event = new Event("paste", {
    bubbles: true,
    cancelable: true,
  }) as Event & { clipboardData: unknown };
  event.clipboardData = {
    getData: (kind: string) =>
      kind === "text/html" ? html : kind === "text/plain" ? text : "",
    files: [],
    items: [],
    types: ["text/html", "text/plain"],
  };
  editor.commands.focus();
  editor.view.dom.dispatchEvent(event);
}

afterEach(() => {
  while (editors.length > 0) editors.pop()?.destroy();
  document.body.innerHTML = "";
});

describe("compose editor headings", () => {
  it("shows a stored level-four to level-six heading as itself", () => {
    const editor = createEditor();
    editor.commands.setContent("#### Four\n\n##### Five\n\n###### Six", {
      contentType: "markdown",
    });

    expect(
      [...editor.view.dom.querySelectorAll("h1, h2, h3, h4, h5, h6")].map(
        (heading) => heading.tagName,
      ),
    ).toEqual(["H4", "H5", "H6"]);
    expect(headingLevels(editor)).toEqual([4, 5, 6]);
    expect(jsonToMarkdown(editor.getJSON())).toBe(
      "#### Four\n\n##### Five\n\n###### Six",
    );
  });

  it("keeps the level of a heading pasted from a web page", () => {
    const editor = createEditor();
    paste(
      editor,
      "<h2>Two</h2><h4>Four</h4><p>Text</p><h6>Six</h6>",
      "Two\nFour\nText\nSix",
    );

    expect(headingLevels(editor)).toEqual([2, 4, 6]);
  });

  it("still creates headings at three levels only", () => {
    const editor = createEditor();

    type(editor, "### ");
    expect(headingLevels(editor)).toEqual([3]);

    editor.commands.setContent("<p></p>");
    type(editor, "#### ");
    expect(headingLevels(editor)).toEqual([]);
    expect(editor.getText()).toBe("#### ");

    expect(editor.commands.setHeading({ level: 4 })).toBe(false);
    expect(editor.commands.toggleHeading({ level: 4 })).toBe(false);
  });
});
