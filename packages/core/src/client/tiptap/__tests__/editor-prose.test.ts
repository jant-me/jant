// @vitest-environment happy-dom

import type { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { createTiptapEditor } from "../create-editor.js";
import { readAuthorCss } from "../../../__tests__/helpers/component-css.js";

/**
 * A draft is set in the reader's typography. The compose editor's document
 * wears `.prose`, the class the published body wears, and the author sheet
 * styles only what an editor has and a post does not. The editor once carried
 * its own copy of the prose rules, which fell behind the reader's: inline code
 * on the composer's paper colour, headings on an older rhythm, list and table
 * defaults it never had.
 */

const editors: Editor[] = [];

/** Split a selector list on its top-level commas, not those inside `:is()`. */
function splitSelectorList(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const char = list[i];
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (char === "," && depth === 0) {
      parts.push(list.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(list.slice(start));
  return parts;
}

function createEditor(content: string): Editor {
  const element = document.createElement("div");
  element.className = "compose-tiptap-body";
  document.body.appendChild(element);
  const editor = createTiptapEditor({ element });
  editor.commands.setContent(content, { contentType: "markdown" });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  while (editors.length > 0) editors.pop()?.destroy();
  document.body.innerHTML = "";
});

describe("compose editor typography", () => {
  it("renders the document with the published body's prose class", () => {
    const editor = createEditor("Text with `code`.");

    expect(editor.view.dom.classList.contains("prose")).toBe(true);
    expect(editor.view.dom.classList.contains("tiptap")).toBe(true);
  });

  it("keeps the reader's typography out of node-view chrome", () => {
    const editor = createEditor(
      [
        "![Alt](/uploads/test.webp)",
        "",
        "```jant-embed",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "```",
      ].join("\n"),
    );
    editor.commands.setHtmlBlock({ html: "<div>Raw</div>" });

    const root = editor.view.dom;
    for (const selector of [
      ".tiptap-image-figure",
      ".tiptap-embed-card",
      ".tiptap-html-block-card",
    ]) {
      const chrome = root.querySelector(selector);
      expect(chrome, selector).not.toBeNull();
      expect(chrome?.classList.contains("not-prose"), selector).toBe(true);
    }
  });

  it("styles no editor block or mark by element alone except the listed exceptions", () => {
    const css = readAuthorCss().replace(/\/\*[\s\S]*?\*\//g, " ");
    const prefix = ".compose-tiptap-body .tiptap ";

    // Rules for the ordinary editor whose target is named by element only —
    // the shape a copy of the reader's prose rules takes. A selector with a
    // class in it styles something only an editor has (the placeholder, a gap
    // cursor, node-view chrome) and is not a copy. The reply composer's
    // compact rules sit under `.compose-reply-compose-layout` and are not
    // matched here.
    const elementOnly = css
      .split("{")
      .map((chunk) =>
        chunk.slice(
          Math.max(chunk.lastIndexOf(";"), chunk.lastIndexOf("}")) + 1,
        ),
      )
      .flatMap(splitSelectorList)
      .map((part) => part.replace(/\s+/g, " ").trim())
      .filter((part) => part.startsWith(prefix))
      .map((part) => part.slice(prefix.length))
      .filter((rest) => !/[.#[]/.test(rest));

    // Each of these is a place the editor has to differ from the post; the
    // comments on the rules in `ui-author.css` say why. Anything else belongs
    // to `.prose`.
    expect(elementOnly.sort()).toEqual(
      [
        // TipTap wraps a list item's text in a paragraph.
        "li > p:has(+ :is(ul, ol))",
        // The editor scrolls sideways, which clips a hanging list marker.
        "> ol",
        // Cells keep a grid while a table is being written.
        "table",
        ":is(td, th)",
      ].sort(),
    );
  });
});
