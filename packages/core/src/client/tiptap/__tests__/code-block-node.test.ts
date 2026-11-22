// @vitest-environment happy-dom

import type { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveCodeLanguageOption } from "../../../lib/code-languages.js";
import { tokenizeCode } from "../../highlight-code.js";
import { createTiptapEditor, jsonToMarkdown } from "../create-editor.js";

const editors: Editor[] = [];

function createEditor(markdown: string): Editor {
  const element = document.createElement("div");
  element.className = "compose-tiptap-body";
  document.body.appendChild(element);
  const editor = createTiptapEditor({ element });
  editor.commands.setContent(markdown, { contentType: "markdown" });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  while (editors.length > 0) editors.pop()?.destroy();
  document.body.innerHTML = "";
});

describe("code-languages", () => {
  it("maps aliases case-insensitively to canonical picker values", () => {
    expect(resolveCodeLanguageOption("js")).toBe("javascript");
    expect(resolveCodeLanguageOption("TSX")).toBe("typescript");
    expect(resolveCodeLanguageOption("py")).toBe("python");
    expect(resolveCodeLanguageOption("sh")).toBe("bash");
    expect(resolveCodeLanguageOption("xml")).toBe("html");
    expect(resolveCodeLanguageOption("yml")).toBe("yaml");
    expect(resolveCodeLanguageOption("c++")).toBe("cpp");
    expect(resolveCodeLanguageOption("cs")).toBe("csharp");
    expect(resolveCodeLanguageOption("")).toBeNull();
    expect(resolveCodeLanguageOption(null)).toBeNull();
    expect(resolveCodeLanguageOption("toml")).toBeNull();
  });
});

describe("tokenizeCode", () => {
  it("returns relative token ranges matching the source string", () => {
    const source = 'const html = "<b>&</b>"; // note';
    const tokens = tokenizeCode(source, "js");
    expect(tokens).not.toBeNull();

    const keyword = tokens?.find((t) => t.className === "hljs-keyword");
    const str = tokens?.find((t) => t.className === "hljs-string");
    const comment = tokens?.find((t) => t.className === "hljs-comment");

    expect(keyword && source.slice(keyword.from, keyword.to)).toBe("const");
    expect(str && source.slice(str.from, str.to)).toBe('"<b>&</b>"');
    expect(comment && source.slice(comment.from, comment.to)).toBe("// note");
  });

  it("returns null for unsupported languages, empty input, or oversized blocks", () => {
    expect(tokenizeCode("const x = 1;", "not-a-language")).toBeNull();
    expect(tokenizeCode("", "js")).toBeNull();
    expect(tokenizeCode("a".repeat(20_001), "js")).toBeNull();
  });
});

function getSelect(editor: Editor): globalThis.HTMLSelectElement {
  const select = editor.view.dom.querySelector(".tiptap-code-block-select");
  if (!(select instanceof globalThis.HTMLSelectElement)) {
    throw new Error("Expected code block language select");
  }
  return select;
}

describe("EditorCodeBlock", () => {
  it("highlights labeled code blocks with ProseMirror decorations and updates on edits", async () => {
    const editor = createEditor('```js\nconst greeting = "hi";\n```');

    await vi.waitFor(() => {
      const wrapper = editor.view.dom.querySelector(".tiptap-code-block");
      expect(wrapper?.classList.contains("hljs")).toBe(true);
      expect(wrapper?.querySelector(".hljs-keyword")?.textContent).toBe(
        "const",
      );
      expect(wrapper?.querySelector(".hljs-string")?.textContent).toBe('"hi"');
    });

    // Editing text inside the code block updates decorations without touching serialization.
    editor.view.dispatch(editor.state.tr.insertText("let x = 42;\n", 1));

    await vi.waitFor(() => {
      const keywords = [
        ...editor.view.dom.querySelectorAll(".hljs-keyword"),
      ].map((el) => el.textContent);
      expect(keywords).toContain("let");
      expect(keywords).toContain("const");
      expect(editor.view.dom.querySelector(".hljs-number")?.textContent).toBe(
        "42",
      );
    });

    // Picker chrome stays isolated from prose and serialized output.
    const controls = editor.view.dom.querySelector(
      ".tiptap-code-block-controls",
    );
    expect(controls?.classList.contains("not-prose")).toBe(true);
    expect(controls?.getAttribute("contenteditable")).toBe("false");
    expect(jsonToMarkdown(editor.getJSON())).toContain("```js\n");
    expect(jsonToMarkdown(editor.getJSON())).not.toContain("Plain text");
  });

  it("switches languages via the picker and clears highlighting for plain text", async () => {
    const editor = createEditor("```\ndef greet():\n    return 42\n```");
    const select = getSelect(editor);
    expect(select.value).toBe("");
    expect(editor.view.dom.querySelector(".hljs-keyword")).toBeNull();

    // Pick Python from the selector.
    select.value = "python";
    select.dispatchEvent(new Event("change"));

    await vi.waitFor(() => {
      expect(editor.view.dom.querySelector(".hljs-keyword")?.textContent).toBe(
        "def",
      );
      expect(editor.view.dom.querySelector(".hljs-number")?.textContent).toBe(
        "42",
      );
    });
    expect(editor.state.doc.firstChild?.attrs.language).toBe("python");
    expect(jsonToMarkdown(editor.getJSON())).toContain("```python\n");

    // Switch back to Plain text.
    select.value = "";
    select.dispatchEvent(new Event("change"));

    expect(editor.state.doc.firstChild?.attrs.language).toBeNull();
    expect(editor.view.dom.querySelector(".hljs-keyword")).toBeNull();
    expect(
      editor.view.dom
        .querySelector(".tiptap-code-block")
        ?.classList.contains("hljs"),
    ).toBe(false);
  });

  it("displays canonical picker option for aliases without rewriting stored attr", () => {
    const editor = createEditor("```js\nconst a = 1;\n```");
    const select = getSelect(editor);

    expect(select.value).toBe("javascript");
    expect(editor.state.doc.firstChild?.attrs.language).toBe("js");
  });

  it("preserves unlisted custom languages in the picker without dropping them", () => {
    const editor = createEditor('```toml\ntitle = "Jant"\n```');
    const select = getSelect(editor);

    expect(select.value).toBe("toml");
    expect(editor.state.doc.firstChild?.attrs.language).toBe("toml");
    expect(
      select.querySelector('option[data-custom-language="true"]')?.textContent,
    ).toBe("toml");
  });

  it("stops Escape propagation on the picker so enclosing dialogs stay open", () => {
    const editor = createEditor("```js\nconst a = 1;\n```");
    const select = getSelect(editor);
    const parentKeydown = vi.fn();
    document.body.addEventListener("keydown", parentKeydown);

    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    select.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(parentKeydown).not.toHaveBeenCalled();
    document.body.removeEventListener("keydown", parentKeydown);
  });
});
