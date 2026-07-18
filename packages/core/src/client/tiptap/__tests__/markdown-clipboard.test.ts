// @vitest-environment happy-dom

import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";
import { createTiptapEditor } from "../create-editor.js";
import { isCodeEditorHtml } from "../markdown-clipboard.js";

const editors: Editor[] = [];

function dispatchMarkdownPaste(editor: Editor, text: string, html = "") {
  const event = new Event("paste", {
    bubbles: true,
    cancelable: true,
  }) as Event & { clipboardData: unknown };
  event.clipboardData = {
    getData: (type: string) =>
      type === "text/plain" ? text : type === "text/html" ? html : "",
    files: [],
    items: [],
    types: html ? ["text/html", "text/plain"] : ["text/plain"],
  };
  editor.commands.focus();
  editor.view.dom.dispatchEvent(event);
}

afterEach(() => {
  while (editors.length > 0) editors.pop()?.destroy();
  document.body.innerHTML = "";
});

describe("isCodeEditorHtml", () => {
  it("detects VS Code HTML via data-vscode attribute", () => {
    const html = `<meta charset='utf-8'><div style="color: #d4d4d4;background-color: #1e1e1e;" data-vscode-theme-name="Default Dark+"><div style="line-height:18px"><span style="color: #569cd6;">const</span> x = 1;</div></div>`;
    expect(isCodeEditorHtml(html)).toBe(true);
  });

  it("detects Cursor / VS Code fork without data-vscode attribute", () => {
    const html = `<meta charset='utf-8'><div style="color: #bbbebf;background-color: #121314;font-family: Menlo, Monaco, 'Courier New', monospace;font-weight: normal;font-size: 12px;line-height: 24px;white-space: pre;"><div><span style="color: #79c0ff;font-weight: bold;">## Hello</span></div></div>`;
    expect(isCodeEditorHtml(html)).toBe(true);
  });

  it("detects JetBrains IDE HTML", () => {
    const html = `<html><body><pre style="background-color:#2b2b2b;color:#a9b7c6;font-family:'JetBrains Mono',monospace;font-size:13.0pt;white-space: pre;">const x = 1;</pre></body></html>`;
    expect(isCodeEditorHtml(html)).toBe(true);
  });

  it("detects generic monospace + pre style with Consolas", () => {
    const html = `<div style="font-family: Consolas, 'Courier New', monospace; white-space: pre; color: #fff;">hello</div>`;
    expect(isCodeEditorHtml(html)).toBe(true);
  });

  it("returns false for regular rich text HTML", () => {
    const html = `<p>Hello <strong>world</strong></p>`;
    expect(isCodeEditorHtml(html)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isCodeEditorHtml("")).toBe(false);
  });

  it("returns false for plain pre/code without editor markers", () => {
    const html = `<pre><code>some code</code></pre>`;
    expect(isCodeEditorHtml(html)).toBe(false);
  });

  it("returns false for monospace font without white-space: pre", () => {
    const html = `<div style="font-family: monospace; color: #333;">not from editor</div>`;
    expect(isCodeEditorHtml(html)).toBe(false);
  });

  it("returns false for white-space: pre without monospace font", () => {
    const html = `<div style="font-family: Arial, sans-serif; white-space: pre;">preformatted</div>`;
    expect(isCodeEditorHtml(html)).toBe(false);
  });
});

describe("MarkdownClipboard", () => {
  it("copies a complete document as canonical Markdown without changing it", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createTiptapEditor({
      element,
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Heading" }],
          },
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                marks: [{ type: "bold" }],
                text: "Bold",
              },
              { type: "text", text: " and " },
              {
                type: "text",
                marks: [
                  {
                    type: "link",
                    attrs: {
                      href: "https://example.com",
                      target: "_blank",
                    },
                  },
                ],
                text: "link",
              },
            ],
          },
          {
            type: "blockquote",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Quote" }],
              },
              {
                type: "paragraph",
                content: [{ type: "text", text: "Second" }],
              },
            ],
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "One" }],
                  },
                  {
                    type: "bulletList",
                    content: [
                      {
                        type: "listItem",
                        content: [
                          {
                            type: "paragraph",
                            content: [{ type: "text", text: "Nested" }],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Two" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    editors.push(editor);
    editor.commands.selectAll();
    const before = editor.getJSON();
    const { dom, text } = editor.view.serializeForClipboard(
      editor.state.selection.content(),
    );

    expect(text).toBe(
      "## Heading\n\n**Bold** and [link](https://example.com)\n\n> Quote\n>\n> Second\n\n- One\n  - Nested\n- Two",
    );
    expect(dom.querySelector("h2")?.textContent).toBe("Heading");
    expect(dom.innerHTML).toContain("<strong>Bold</strong>");
    expect(dom.innerHTML).toContain("<blockquote>");
    expect(editor.getJSON()).toEqual(before);
  });

  it("keeps partial selections as readable plain text", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createTiptapEditor({
      element,
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                marks: [{ type: "bold" }],
                text: "Bold",
              },
              { type: "text", text: " and " },
              {
                type: "text",
                marks: [
                  {
                    type: "link",
                    attrs: {
                      href: "https://example.com",
                      target: "_blank",
                    },
                  },
                ],
                text: "link",
              },
            ],
          },
        ],
      },
    });
    editors.push(editor);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, 1, 14),
      ),
    );

    const { dom, text } = editor.view.serializeForClipboard(
      editor.state.selection.content(),
    );

    expect(text).toBe("Bold and link");
    expect(text).not.toContain("**");
    expect(text).not.toContain("https://example.com");
    expect(dom.innerHTML).toContain("<strong>Bold</strong>");
    expect(dom.innerHTML).toContain("<a");
  });

  it.each([
    ["plain text", ""],
    [
      "code editor text",
      '<div data-vscode-theme-name="Default Dark+">Markdown</div>',
    ],
  ])("pastes a footnote from %s without adding an empty line", (_, html) => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createTiptapEditor({ element });
    editors.push(editor);

    dispatchMarkdownPaste(
      editor,
      "Body with a footnote.[^1]\n\n[^1]: Footnote body",
      html,
    );

    expect(editor.getJSON()).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Body with a footnote." },
            { type: "footnoteReference", attrs: { label: "1" } },
          ],
        },
        {
          type: "footnoteDefinition",
          attrs: { label: "1" },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Footnote body" }],
            },
          ],
        },
      ],
    });
  });

  it.each([
    ["plain text", ""],
    [
      "code editor text",
      '<div data-vscode-theme-name="Default Dark+">Markdown</div>',
    ],
  ])("adds an empty definition for an orphan footnote from %s", (_, html) => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createTiptapEditor({ element });
    editors.push(editor);

    dispatchMarkdownPaste(editor, "Body with a footnote.[^1]", html);

    expect(editor.getJSON()).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Body with a footnote." },
            { type: "footnoteReference", attrs: { label: "1" } },
          ],
        },
        {
          type: "footnoteDefinition",
          attrs: { label: "1" },
          content: [{ type: "paragraph" }],
        },
      ],
    });
  });

  it("keeps the formatting toolbar hidden for a selected footnote node", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createTiptapEditor({
      element,
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Body" },
              { type: "footnoteReference", attrs: { label: "1" } },
            ],
          },
          {
            type: "footnoteDefinition",
            attrs: { label: "1" },
            content: [{ type: "paragraph" }],
          },
        ],
      },
    });
    editors.push(editor);

    let referencePos: number | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "footnoteReference") {
        referencePos = pos;
      }
      return true;
    });
    if (referencePos === null) {
      throw new Error("expected footnote reference");
    }

    editor.commands.setNodeSelection(referencePos);

    expect(
      document.querySelector<HTMLElement>(".tiptap-bubble-menu")?.style.display,
    ).toBe("none");
  });
});
