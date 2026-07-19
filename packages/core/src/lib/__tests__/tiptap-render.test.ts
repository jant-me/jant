import { describe, expect, it } from "vitest";
import {
  renderTiptapDocument,
  renderTiptapDocumentAroundBoundary,
  renderTiptapJson,
  tryRenderTiptapJson,
  trimTiptapBody,
} from "../tiptap-render.js";

function doc(...content: Record<string, unknown>[]) {
  return { type: "doc", content };
}

function p(...content: Record<string, unknown>[]) {
  return { type: "paragraph", content };
}

function text(value: string, marks?: Record<string, unknown>[]) {
  return marks
    ? { type: "text", text: value, marks }
    : { type: "text", text: value };
}

describe("renderTiptapDocument", () => {
  it("renders parsed document objects directly", () => {
    expect(renderTiptapDocument(doc(p(text("Hello world"))))).toBe(
      "<p>Hello world</p>",
    );
  });

  it("renders links with safe target attributes when present", () => {
    const html = renderTiptapDocument(
      doc(
        p(
          text("OpenAI", [
            {
              type: "link",
              attrs: {
                href: "https://openai.com",
                target: "_blank",
              },
            },
          ]),
        ),
      ),
    );

    expect(html).toBe(
      '<p><a href="https://openai.com" target="_blank" rel="noopener noreferrer">OpenAI</a></p>',
    );
  });

  it("renders rich image figures consistently", () => {
    const html = renderTiptapDocument(
      doc({
        type: "image",
        attrs: {
          src: "https://example.com/img.png",
          alt: "Alt",
          title: "Title",
          caption: "Caption",
          href: "https://example.com/source",
          layout: "wide",
        },
      }),
    );

    expect(html).toBe(
      '<figure data-layout="wide"><a href="https://example.com/source"><img src="https://example.com/img.png" alt="Alt" title="Title"></a><figcaption>Caption</figcaption></figure>',
    );
  });

  it("renders canonical semantic endnotes without layout wrappers", () => {
    const html = renderTiptapDocument(
      doc(
        p(text("Body copy"), {
          type: "footnoteReference",
          attrs: { label: "1" },
        }),
        {
          type: "footnoteDefinition",
          attrs: { label: "1" },
          content: [p(text("Footnote body"))],
        },
      ),
      { namespace: "pst_test" },
    );

    expect(html).toBe(
      '<p>Body copy<sup class="footnote-ref">' +
        '<a id="fnref-0sk9zhgh1dhm5-1-1" href="#fn-0sk9zhgh1dhm5-1" role="doc-noteref">1</a></sup></p>' +
        '<section class="footnote-endnotes" role="doc-endnotes"><ol class="footnote-list">' +
        '<li id="fn-0sk9zhgh1dhm5-1" class="footnote"><p>Footnote body <span class="footnote-backlinks">' +
        '<a href="#fnref-0sk9zhgh1dhm5-1-1" class="footnote-backref" role="doc-backlink">↩︎</a>' +
        "</span></p></li></ol></section>",
    );
    expect(html).not.toMatch(/<div|\sstyle=|\sdata-footnote-/);
  });

  it("renders a missing footnote definition without a dead link", () => {
    const html = renderTiptapDocument(
      doc(
        p(text("Body copy"), {
          type: "footnoteReference",
          attrs: { label: "1" },
        }),
      ),
    );

    expect(html).toBe('<p>Body copy<sup class="footnote-ref">1</sup></p>');
  });

  it("uses a native list start when a missing definition creates a leading numbering gap", () => {
    const html = renderTiptapDocument(
      doc(
        p(text("Missing"), {
          type: "footnoteReference",
          attrs: { label: "missing" },
        }),
        p(text("Defined"), {
          type: "footnoteReference",
          attrs: { label: "defined" },
        }),
        {
          type: "footnoteDefinition",
          attrs: { label: "defined" },
          content: [p(text("Second definition"))],
        },
      ),
    );

    expect(html).toContain('<sup class="footnote-ref">1</sup>');
    expect(html).toContain('href="#fn-2" role="doc-noteref">2</a>');
    expect(html).toContain('<ol class="footnote-list" start="2">');
    expect(html).toContain('<li id="fn-2" class="footnote">');
    expect(html).not.toContain('value="2"');
  });

  it("uses a native list-item value only for an internal numbering gap", () => {
    const html = renderTiptapDocument(
      doc(
        p({ type: "footnoteReference", attrs: { label: "one" } }),
        p({ type: "footnoteReference", attrs: { label: "missing" } }),
        p({ type: "footnoteReference", attrs: { label: "three" } }),
        {
          type: "footnoteDefinition",
          attrs: { label: "one" },
          content: [p(text("First definition"))],
        },
        {
          type: "footnoteDefinition",
          attrs: { label: "three" },
          content: [p(text("Third definition"))],
        },
      ),
    );

    expect(html).toContain('<ol class="footnote-list">');
    expect(html).toContain('<li id="fn-1" class="footnote">');
    expect(html).toContain('<li id="fn-3" class="footnote" value="3">');
  });

  it("renders repeated references once with unique reciprocal backlinks", () => {
    const html = renderTiptapDocument(
      doc(
        p(text("First"), {
          type: "footnoteReference",
          attrs: { label: "Note" },
        }),
        p(text("Second"), {
          type: "footnoteReference",
          attrs: { label: "note" },
        }),
        {
          type: "footnoteDefinition",
          attrs: { label: "NOTE" },
          content: [p(text("Shared definition"))],
        },
      ),
      { namespace: "pst_repeat" },
    );

    expect(html.match(/role="doc-endnotes"/g)).toHaveLength(1);
    expect(html.match(/<ol class="footnote-list">/g)).toHaveLength(1);
    expect(html.match(/<li id="fn-/g)).toHaveLength(1);
    expect(html).toContain('id="fnref-0r3u815ai35bm-1-1"');
    expect(html).toContain('id="fnref-0r3u815ai35bm-1-2"');
    expect(html.match(/href="#fn-0r3u815ai35bm-1"/g)).toHaveLength(2);
    expect(html).toContain(
      'href="#fnref-0r3u815ai35bm-1-1" class="footnote-backref" role="doc-backlink">↩︎1</a>',
    );
    expect(html).toContain(
      'href="#fnref-0r3u815ai35bm-1-2" class="footnote-backref" role="doc-backlink">↩︎2</a>',
    );
    expect(html.indexOf("Shared definition")).toBeGreaterThan(
      html.indexOf("Second"),
    );
  });

  it("keeps all definitions in one native ordered list", () => {
    const html = renderTiptapDocument(
      doc(
        p(text("First"), {
          type: "footnoteReference",
          attrs: { label: "first" },
        }),
        p(text("Second"), {
          type: "footnoteReference",
          attrs: { label: "second" },
        }),
        {
          type: "footnoteDefinition",
          attrs: { label: "first" },
          content: [p(text("First definition"))],
        },
        {
          type: "footnoteDefinition",
          attrs: { label: "second" },
          content: [p(text("Second definition"))],
        },
      ),
    );

    expect(html.match(/<ol class="footnote-list">/g)).toHaveLength(1);
    expect(html).toContain('<li id="fn-1" class="footnote">');
    expect(html).toContain('<li id="fn-2" class="footnote">');
    expect(html).not.toMatch(/\s(?:start|value|style)=/);
    expect(html.indexOf("First definition")).toBeGreaterThan(
      html.indexOf("Second"),
    );
  });

  it("keeps rich footnote blocks inside a native endnote list item", () => {
    const html = renderTiptapDocument(
      doc(
        p(text("Body"), {
          type: "footnoteReference",
          attrs: { label: "rich" },
        }),
        {
          type: "footnoteDefinition",
          attrs: { label: "rich" },
          content: [
            p(text("First paragraph")),
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [p(text("List item"))],
                },
              ],
            },
          ],
        },
      ),
    );

    expect(html).toContain(
      '<section class="footnote-endnotes" role="doc-endnotes"><ol class="footnote-list"',
    );
    expect(html).toContain('<li id="fn-1" class="footnote">');
    expect(html).toContain(
      '<p>First paragraph</p><ul><li><p>List item</p></li></ul><p class="footnote-backlinks"><a href="#fnref-1-1" class="footnote-backref" role="doc-backlink">↩︎</a></p>',
    );
    expect(html).not.toContain('<div class="footnote-body"');
    expect(html).not.toContain('role="doc-footnote"');
  });

  it("appends backlinks to the authored final paragraph of rich definitions", () => {
    const html = renderTiptapDocument(
      doc(p({ type: "footnoteReference", attrs: { label: "rich" } }), {
        type: "footnoteDefinition",
        attrs: { label: "rich" },
        content: [
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [p(text("List item"))],
              },
            ],
          },
          p(text("Final paragraph")),
        ],
      }),
    );

    expect(html).toContain(
      '<ul><li><p>List item</p></li></ul><p>Final paragraph <span class="footnote-backlinks">',
    );
    expect(html).not.toContain('<p class="footnote-backlinks">');
  });

  it("uses the render namespace to isolate documents sharing a page", () => {
    const input = doc(p({ type: "footnoteReference", attrs: { label: "1" } }), {
      type: "footnoteDefinition",
      attrs: { label: "1" },
      content: [p(text("Definition"))],
    });

    const first = renderTiptapDocument(input, { namespace: "pst_first" });
    const second = renderTiptapDocument(input, { namespace: "pst_second" });

    expect(first).toContain('id="fn-3t66v0e9xc2qx-1"');
    expect(second).toContain('id="fn-2b338ib1g2med-1"');
    expect(first).not.toContain("2b338ib1g2med");
    expect(second).not.toContain("3t66v0e9xc2qx");
  });

  it("keeps immutable entity namespaces compact in public fragment IDs", () => {
    const input = doc(p({ type: "footnoteReference", attrs: { label: "1" } }), {
      type: "footnoteDefinition",
      attrs: { label: "1" },
      content: [p(text("Definition"))],
    });
    const namespace = "pst_01kxwe4tkwfqfsrwcgqgeg1b7k";
    const html = renderTiptapDocument(input, { namespace });
    const referenceId = html.match(/<a id="([^"]+)"/)?.[1];
    const definitionId = html.match(/<li id="([^"]+)"/)?.[1];

    expect(referenceId).toBe("fnref-0nj7nw33xdf9h-1-1");
    expect(definitionId).toBe("fn-0nj7nw33xdf9h-1");
    expect(referenceId?.length).toBeLessThan(30);
    expect(html).not.toContain(namespace);
    expect(html).toContain(`href="#${definitionId}"`);
    expect(html).toContain(`href="#${referenceId}"`);
  });

  it("splits at a source boundary using the full repeated-footnote plan", () => {
    const input = doc(
      p(text("First"), {
        type: "footnoteReference",
        attrs: { label: "shared" },
      }),
      p(text("Second"), {
        type: "footnoteReference",
        attrs: { label: "shared" },
      }),
      {
        type: "footnoteDefinition",
        attrs: { label: "shared" },
        content: [p(text("Definition"))],
      },
    );
    const options = { namespace: "pst_split" };
    const full = renderTiptapDocument(input, options);
    const split = renderTiptapDocumentAroundBoundary(input, 1, options);

    expect(split).not.toBeNull();
    expect(split!.beforeHtml + split!.afterHtml).toBe(full);
    expect(split!.beforeHtml).toContain("fnref-2q7yplng9am9n-1-1");
    expect(split!.beforeHtml).not.toContain("footnote-document");
    expect(split!.beforeHtml).not.toContain('role="doc-endnotes"');
    expect(split!.afterHtml).toContain('id="fnref-2q7yplng9am9n-1-2"');
    expect(split!.afterHtml).toContain('role="doc-endnotes"');
    expect(split!.afterHtml.endsWith("</section>")).toBe(true);
  });

  it("renders code blocks as escaped text, not nested inline markup", () => {
    const html = renderTiptapDocument(
      doc({
        type: "codeBlock",
        attrs: { language: "ts" },
        content: [{ type: "text", text: "const x = `<div>`;" }],
      }),
    );

    expect(html).toBe(
      '<pre><code class="language-ts">const x = `&lt;div&gt;`;</code></pre>',
    );
  });

  it("falls back to rendering children for unknown nodes", () => {
    const html = renderTiptapDocument(
      doc({
        type: "unknownWrapper",
        content: [p(text("Still visible"))],
      }),
    );

    expect(html).toBe("<p>Still visible</p>");
  });
});

describe("renderTiptapJson", () => {
  it("returns an empty string for invalid JSON", () => {
    expect(renderTiptapJson("not json")).toBe("");
  });

  it("returns an empty string for non-doc JSON", () => {
    expect(renderTiptapDocument({ type: "paragraph" })).toBe("");
  });

  it("distinguishes invalid JSON from a valid empty document", () => {
    expect(tryRenderTiptapJson("not json")).toMatchObject({ ok: false });
    expect(tryRenderTiptapJson(JSON.stringify(doc()))).toEqual({
      ok: true,
      html: "",
    });
  });
});

describe("trimTiptapBody", () => {
  it("removes leading empty paragraphs", () => {
    const input = JSON.stringify(doc(p(), p(text("Hello"))));
    const expected = JSON.stringify(doc(p(text("Hello"))));
    expect(trimTiptapBody(input)).toBe(expected);
  });

  it("removes trailing empty paragraphs", () => {
    const input = JSON.stringify(doc(p(text("Hello")), p(), p()));
    const expected = JSON.stringify(doc(p(text("Hello"))));
    expect(trimTiptapBody(input)).toBe(expected);
  });

  it("removes both leading and trailing empty paragraphs", () => {
    const input = JSON.stringify(doc(p(), p(text("Hello")), p()));
    const expected = JSON.stringify(doc(p(text("Hello"))));
    expect(trimTiptapBody(input)).toBe(expected);
  });

  it("preserves inner empty paragraphs", () => {
    const input = JSON.stringify(doc(p(text("A")), p(), p(text("B"))));
    expect(trimTiptapBody(input)).toBe(input);
  });

  it("returns null when all paragraphs are empty", () => {
    const input = JSON.stringify(doc(p(), p()));
    expect(trimTiptapBody(input)).toBeNull();
  });

  it("returns the original string when no trimming needed", () => {
    const input = JSON.stringify(doc(p(text("Hello"))));
    expect(trimTiptapBody(input)).toBe(input);
  });

  it("treats whitespace-only text as empty", () => {
    const input = JSON.stringify(
      doc(p(text("  ")), p(text("Hello")), p(text("\n"))),
    );
    const expected = JSON.stringify(doc(p(text("Hello"))));
    expect(trimTiptapBody(input)).toBe(expected);
  });

  it("does not strip paragraphs with images", () => {
    const imgParagraph = {
      type: "paragraph",
      content: [{ type: "image", attrs: { src: "test.png" } }],
    };
    const input = JSON.stringify(doc(imgParagraph, p()));
    const expected = JSON.stringify(doc(imgParagraph));
    expect(trimTiptapBody(input)).toBe(expected);
  });

  it("does not strip non-paragraph blocks like headings with content", () => {
    const heading = {
      type: "heading",
      attrs: { level: 1 },
      content: [text("Title")],
    };
    const input = JSON.stringify(doc(p(), heading, p()));
    const expected = JSON.stringify(doc(heading));
    expect(trimTiptapBody(input)).toBe(expected);
  });

  it("strips empty headings", () => {
    const emptyHeading = { type: "heading", attrs: { level: 1 } };
    const input = JSON.stringify(doc(emptyHeading, p(text("Hello"))));
    const expected = JSON.stringify(doc(p(text("Hello"))));
    expect(trimTiptapBody(input)).toBe(expected);
  });

  it("returns original string for invalid JSON", () => {
    expect(trimTiptapBody("not json")).toBe("not json");
  });

  it("returns original string for non-doc JSON", () => {
    const input = JSON.stringify({ type: "paragraph" });
    expect(trimTiptapBody(input)).toBe(input);
  });
});
