// @vitest-environment happy-dom

import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";
import { createTiptapEditor } from "../create-editor.js";
import {
  isCodeEditorHtml,
  isObsidianHtml,
  normalizeObsidianClipboardArtifacts,
  normalizePastedFootnoteHtml,
} from "../markdown-clipboard.js";

const editors: Editor[] = [];

function dispatchMarkdownPaste(
  editor: Editor,
  text: string,
  html = "",
  markdown = "",
) {
  const event = new Event("paste", {
    bubbles: true,
    cancelable: true,
  }) as Event & { clipboardData: unknown };
  event.clipboardData = {
    getData: (type: string) =>
      type === "text/plain"
        ? text
        : type === "text/html"
          ? html
          : type === "text/markdown"
            ? markdown
            : "",
    files: [],
    items: [],
    types: [
      ...(markdown ? ["text/markdown"] : []),
      ...(html ? ["text/html"] : []),
      ...(text ? ["text/plain"] : []),
    ],
  };
  editor.commands.focus();
  editor.view.dom.dispatchEvent(event);
}

afterEach(() => {
  while (editors.length > 0) editors.pop()?.destroy();
  document.body.innerHTML = "";
});

describe("Obsidian clipboard detection", () => {
  it("finds the marker even when metadata precedes it", () => {
    expect(
      isObsidianHtml('<meta charset="utf-8"><!-- obsidian --><p>Rendered</p>'),
    ).toBe(true);
  });

  it("does not infer Obsidian from its footnote classes", () => {
    expect(
      isObsidianHtml('<sup class="footnote-ref"><a href="#fn-1">1</a></sup>'),
    ).toBe(false);
  });
});

describe("normalizeObsidianClipboardArtifacts", () => {
  it("removes bare internal spacer paragraphs from marked fragments", () => {
    expect(
      normalizeObsidianClipboardArtifacts(
        "<!-- obsidian --><p>First</p><p> \n </p><p></p><p>Second</p>",
      ),
    ).toBe("<!-- obsidian --><p>First</p><p>Second</p>");
  });

  it("does not normalize the same shape from ordinary rich HTML", () => {
    const html = "<p>First</p><p> \n </p><p>Second</p>";
    expect(normalizeObsidianClipboardArtifacts(html)).toBe(html);
  });

  it.each([
    ["explicit break", "<p><br></p>"],
    ["media", '<p><img src="image.png"></p>'],
    ["attributed spacer", '<p data-purpose="spacer"></p>'],
    ["non-breaking space", "<p>&nbsp;</p>"],
  ])("preserves %s paragraphs", (_, middle) => {
    const html = `<!-- obsidian --><p>First</p>${middle}<p>Second</p>`;
    expect(normalizeObsidianClipboardArtifacts(html)).toBe(html);
  });

  it("preserves nested and edge empty paragraphs", () => {
    const html =
      "<!-- obsidian --><p></p><blockquote><p></p><p>Quote</p></blockquote><p></p>";
    expect(normalizeObsidianClipboardArtifacts(html)).toBe(html);
  });
});

describe("normalizePastedFootnoteHtml", () => {
  it("leaves ordinary superscript section links and lists unchanged", () => {
    const html =
      '<p>Chapter<sup><a href="#section-1">1</a></sup></p><ol><li id="section-1">Section</li></ol>';

    expect(normalizePastedFootnoteHtml(html)).toBe(html);
  });
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
  it("prefers an explicit text/markdown flavor over HTML and plain text", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createTiptapEditor({ element });
    editors.push(editor);

    dispatchMarkdownPaste(
      editor,
      "Plain fallback",
      "<p>Rich fallback</p>",
      "# Markdown source\n\nBody[^note]\n\n[^note]: Definition",
    );

    expect(editor.getJSON().content?.map((node) => node.type)).toEqual([
      "heading",
      "paragraph",
      "footnoteDefinition",
    ]);
    expect(editor.getJSON().content?.[2]?.attrs).toEqual({ label: "note" });
  });

  it("uses marked Obsidian plain text as Markdown instead of rendered HTML", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createTiptapEditor({ element });
    editors.push(editor);

    dispatchMarkdownPaste(
      editor,
      "Plain body[^plain-note]\n\n[^plain-note]: Plain definition",
      [
        '<meta charset="utf-8"><!-- obsidian -->',
        '<p><strong>HTML body</strong><sup class="footnote-ref" data-footnote-id="fnref-1">',
        '<a class="footnote-link" href="#fn-1">[1]</a></sup></p>',
        "<p></p>",
        '<section class="footnotes"><hr><ol>',
        '<li data-footnote-id="fn-1"><p>HTML <em>definition</em> ',
        '<a class="footnote-backref footnote-link" href="#fnref-1">↩︎</a>',
        "</p></li></ol></section>",
      ].join(""),
    );

    expect(editor.getJSON().content?.map((node) => node.type)).toEqual([
      "paragraph",
      "footnoteDefinition",
    ]);
    expect(editor.getJSON().content?.[0]?.content?.[0]).toEqual({
      type: "text",
      text: "Plain body",
    });
    expect(editor.getJSON().content?.[0]?.content?.[1]).toEqual({
      type: "footnoteReference",
      attrs: { label: "plain-note" },
    });
    expect(editor.getJSON().content?.[1]?.attrs).toEqual({
      label: "plain-note",
    });
    expect(JSON.stringify(editor.getJSON())).toContain("Plain definition");
    expect(JSON.stringify(editor.getJSON())).not.toContain("HTML body");
    expect(JSON.stringify(editor.getJSON())).not.toContain("footnote-backref");
  });

  it("keeps normal rich HTML ahead of its plain fallback", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createTiptapEditor({ element });
    editors.push(editor);

    dispatchMarkdownPaste(
      editor,
      "# Plain fallback",
      "<p><strong>Rich source</strong></p>",
    );

    expect(editor.getJSON()).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              marks: [{ type: "bold" }],
              text: "Rich source",
            },
          ],
        },
      ],
    });
  });

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

  it("converts Obsidian HTML-only footnotes and removes generated backlinks", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createTiptapEditor({ element });
    editors.push(editor);

    dispatchMarkdownPaste(
      editor,
      "",
      [
        '<p>Body<sup class="footnote-ref" data-footnote-id="fnref-1">',
        '<a class="footnote-link" href="#fn-1" data-footref="source-note">[1]</a>',
        "</sup></p>",
        '<section class="footnotes"><hr><ol>',
        '<li data-footnote-id="fn-1"><p>Definition with ',
        '<a href="https://example.com">a source</a> ',
        '<a class="footnote-backref footnote-link" href="#fnref-1">↩︎</a>',
        "</p></li></ol></section>",
      ].join(""),
    );

    const json = editor.getJSON();
    expect(json.content?.map((node) => node.type)).toEqual([
      "paragraph",
      "footnoteDefinition",
    ]);
    expect(json.content?.[0]?.content?.[1]).toEqual({
      type: "footnoteReference",
      attrs: { label: "source-note" },
    });
    expect(json.content?.[1]?.attrs).toEqual({ label: "source-note" });
    expect(JSON.stringify(json)).toContain("https://example.com");
    expect(JSON.stringify(json)).not.toContain("footnote-backref");
    expect(JSON.stringify(json)).not.toContain("#fnref-1");
  });

  it("converts GitHub-style footnotes into structural nodes", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createTiptapEditor({ element });
    editors.push(editor);

    dispatchMarkdownPaste(
      editor,
      "",
      [
        '<p>Body<sup><a id="user-content-fnref-1" href="#user-content-fn-1" data-footnote-ref>1</a></sup></p>',
        '<section class="footnotes" data-footnotes>',
        '<h2 id="footnote-label">Footnotes</h2><ol>',
        '<li id="user-content-fn-1"><p>Definition ',
        '<a href="#user-content-fnref-1" data-footnote-backref>↩</a>',
        "</p></li></ol></section>",
      ].join(""),
    );

    const json = editor.getJSON();
    expect(json.content?.map((node) => node.type)).toEqual([
      "paragraph",
      "footnoteDefinition",
    ]);
    expect(json.content?.[0]?.content?.[1]).toEqual({
      type: "footnoteReference",
      attrs: { label: "1" },
    });
    expect(json.content?.[1]?.attrs).toEqual({ label: "1" });
    expect(JSON.stringify(json)).not.toContain("horizontalRule");
    expect(JSON.stringify(json)).not.toContain("orderedList");
  });

  it("converts DPUB-ARIA inline footnotes with rich block content", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createTiptapEditor({ element });
    editors.push(editor);

    dispatchMarkdownPaste(
      editor,
      "",
      [
        '<p>Body <a id="fnref-note" href="#fn-note" role="doc-noteref">[note]</a>.</p>',
        '<aside id="fn-note" role="doc-footnote">',
        "<p>First paragraph.</p>",
        "<ul><li><p>Nested item</p></li></ul>",
        '<p><a href="#fnref-note" role="doc-backlink">Back</a></p>',
        "</aside>",
      ].join(""),
    );

    const json = editor.getJSON();
    expect(json.content?.map((node) => node.type)).toEqual([
      "paragraph",
      "footnoteDefinition",
    ]);
    expect(json.content?.[0]?.content?.[1]).toEqual({
      type: "footnoteReference",
      attrs: { label: "note" },
    });
    expect(json.content?.[1]?.content?.map((node) => node.type)).toEqual([
      "paragraph",
      "bulletList",
    ]);
    expect(JSON.stringify(json)).not.toContain("doc-backlink");
    expect(JSON.stringify(json)).not.toContain("Back");
  });

  it("keeps repeated HTML references paired to one definition", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createTiptapEditor({ element });
    editors.push(editor);

    dispatchMarkdownPaste(
      editor,
      "",
      [
        '<p>First<sup class="footnote-ref"><a href="#fn-1" data-footref="same">[1]</a></sup> ',
        'second<sup class="footnote-ref"><a href="#fn-1" data-footref="same">[1-2]</a></sup>.</p>',
        '<section class="footnotes"><ol><li id="fn-1"><p>Definition ',
        '<a class="footnote-backref" href="#first">↩</a>',
        '<a class="footnote-backref" href="#second">↩</a>',
        "</p></li></ol></section>",
      ].join(""),
    );

    const json = editor.getJSON();
    const serialized = JSON.stringify(json);
    expect(serialized.match(/"type":"footnoteReference"/g)).toHaveLength(2);
    expect(serialized.match(/"type":"footnoteDefinition"/g)).toHaveLength(1);
    expect(serialized.match(/"label":"same"/g)).toHaveLength(3);
    expect(serialized).not.toContain("↩");
  });

  it("round-trips Jant's editor HTML with raw footnote labels", () => {
    const sourceElement = document.createElement("div");
    const destinationElement = document.createElement("div");
    document.body.appendChild(sourceElement);
    document.body.appendChild(destinationElement);
    const content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Body" },
            { type: "footnoteReference", attrs: { label: "note" } },
          ],
        },
        {
          type: "footnoteDefinition",
          attrs: { label: "note" },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Definition" }],
            },
          ],
        },
      ],
    };
    const source = createTiptapEditor({ element: sourceElement, content });
    const destination = createTiptapEditor({ element: destinationElement });
    editors.push(source, destination);
    source.commands.selectAll();
    const { dom } = source.view.serializeForClipboard(
      source.state.selection.content(),
    );

    expect(
      dom
        .querySelector("[data-footnote-definition]")
        ?.getAttribute("data-footnote-label"),
    ).toBe("note");

    dispatchMarkdownPaste(destination, "", dom.innerHTML);

    expect(destination.getJSON()).toEqual(source.getJSON());
  });

  it("accepts the legacy display-form label in Jant editor HTML", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createTiptapEditor({ element });
    editors.push(editor);

    dispatchMarkdownPaste(
      editor,
      "",
      '<p>Body<sup data-footnote-reference data-footnote-label="1">[^1]</sup></p><div data-footnote-definition data-footnote-label="[^1]:"><p>Definition</p></div>',
    );

    expect(editor.getJSON().content?.[0]?.content?.[1]).toEqual({
      type: "footnoteReference",
      attrs: { label: "1" },
    });
    expect(editor.getJSON().content?.[1]?.attrs).toEqual({ label: "1" });
  });

  it("normalizes Obsidian inline footnotes into references and definitions", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createTiptapEditor({ element });
    editors.push(editor);

    dispatchMarkdownPaste(
      editor,
      "Body^[Inline **bold** with [a source](https://example.com).]",
    );

    const json = editor.getJSON();
    expect(json.content?.map((node) => node.type)).toEqual([
      "paragraph",
      "footnoteDefinition",
    ]);
    expect(json.content?.[0]?.content?.[1]).toEqual({
      type: "footnoteReference",
      attrs: { label: "1" },
    });
    expect(json.content?.[1]?.attrs).toEqual({ label: "1" });
    expect(JSON.stringify(json)).toContain('"type":"bold"');
    expect(JSON.stringify(json)).toContain("https://example.com");
  });

  it("allocates inline footnote labels around existing definitions", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createTiptapEditor({ element });
    editors.push(editor);

    dispatchMarkdownPaste(
      editor,
      "Named[^1] and inline^[Second definition.]\n\n[^1]: First definition.",
    );

    const json = editor.getJSON();
    expect(
      json.content
        ?.filter((node) => node.type === "footnoteDefinition")
        .map((node) => node.attrs?.label),
    ).toEqual(["1", "2"]);
    expect(json.content?.[0]?.content?.[3]).toEqual({
      type: "footnoteReference",
      attrs: { label: "2" },
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
