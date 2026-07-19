import { describe, it, expect } from "vitest";
import {
  extractBodyText,
  extractSummary,
  extractSummaryHtml,
} from "../summary.js";

describe("extractBodyText", () => {
  it("extracts text from paragraphs", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Hello world" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Second paragraph" }],
        },
      ],
    });

    expect(extractBodyText(doc)).toBe("Hello world Second paragraph");
  });

  it("extracts text from headings", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "My Title" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Body text" }],
        },
      ],
    });

    expect(extractBodyText(doc)).toBe("My Title Body text");
  });

  it("extracts text from bullet lists", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Item one" }],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Item two" }],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(extractBodyText(doc)).toContain("Item one");
    expect(extractBodyText(doc)).toContain("Item two");
  });

  it("extracts text from ordered lists", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "orderedList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "First" }],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(extractBodyText(doc)).toContain("First");
  });

  it("extracts text from blockquotes", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Quoted text" }],
            },
          ],
        },
      ],
    });

    expect(extractBodyText(doc)).toContain("Quoted text");
  });

  it("extracts text from code blocks", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "codeBlock",
          content: [{ type: "text", text: "const x = 1;" }],
        },
      ],
    });

    expect(extractBodyText(doc)).toBe("const x = 1;");
  });

  it("extracts text from tables", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Header" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Cell data" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(extractBodyText(doc)).toContain("Header");
    expect(extractBodyText(doc)).toContain("Cell data");
  });

  it("skips image nodes", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Before image" }],
        },
        {
          type: "image",
          attrs: { src: "https://example.com/img.png", alt: "Alt text" },
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "After image" }],
        },
      ],
    });

    const result = extractBodyText(doc);
    expect(result).toContain("Before image");
    expect(result).toContain("After image");
    expect(result).not.toContain("Alt text");
    expect(result).not.toContain("img.png");
  });

  it("skips moreBreak nodes", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Before break" }],
        },
        { type: "moreBreak" },
        {
          type: "paragraph",
          content: [{ type: "text", text: "After break" }],
        },
      ],
    });

    const result = extractBodyText(doc);
    expect(result).toContain("Before break");
    expect(result).toContain("After break");
  });

  it("skips horizontalRule nodes", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Above rule" }],
        },
        { type: "horizontalRule" },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Below rule" }],
        },
      ],
    });

    const result = extractBodyText(doc);
    expect(result).toContain("Above rule");
    expect(result).toContain("Below rule");
  });

  it("includes link mark hrefs when includeLinkHrefs is true", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "See " },
            {
              type: "text",
              text: "this page",
              marks: [
                {
                  type: "link",
                  attrs: { href: "https://example.com/foo" },
                },
              ],
            },
            { type: "text", text: " for details." },
          ],
        },
      ],
    });

    const result = extractBodyText(doc, { includeLinkHrefs: true });
    expect(result).toContain("this page");
    expect(result).toContain("https://example.com/foo");
    expect(result).toContain("See");
    expect(result).toContain("for details.");
  });

  it("omits link mark hrefs by default (plain-text contract)", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "See " },
            {
              type: "text",
              text: "this page",
              marks: [
                {
                  type: "link",
                  attrs: { href: "https://example.com/foo" },
                },
              ],
            },
            { type: "text", text: "." },
          ],
        },
      ],
    });

    const result = extractBodyText(doc);
    expect(result).toContain("this page");
    expect(result).not.toContain("example.com");
    expect(result).not.toContain("https://");
  });

  it("ignores non-link marks (bold, italic, code, etc.)", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "emphasized",
              marks: [{ type: "bold" }, { type: "italic" }],
            },
          ],
        },
      ],
    });

    expect(extractBodyText(doc, { includeLinkHrefs: true })).toBe("emphasized");
  });

  it("skips link marks with empty or whitespace-only hrefs", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "broken",
              marks: [{ type: "link", attrs: { href: "   " } }],
            },
            {
              type: "text",
              text: "also-broken",
              marks: [{ type: "link", attrs: {} }],
            },
          ],
        },
      ],
    });

    const result = extractBodyText(doc, { includeLinkHrefs: true });
    expect(result).toContain("broken");
    expect(result).toContain("also-broken");
    expect(result).not.toMatch(/https?:\/\//);
  });

  it("returns null for invalid JSON", () => {
    expect(extractBodyText("not json")).toBeNull();
    expect(extractBodyText("{invalid")).toBeNull();
  });

  it("returns null for empty doc", () => {
    const doc = JSON.stringify({ type: "doc", content: [] });
    expect(extractBodyText(doc)).toBeNull();
  });

  it("returns null for non-doc type", () => {
    const doc = JSON.stringify({ type: "paragraph", content: [] });
    expect(extractBodyText(doc)).toBeNull();
  });

  it("returns null for doc without content", () => {
    const doc = JSON.stringify({ type: "doc" });
    expect(extractBodyText(doc)).toBeNull();
  });
});

// ============================================================================
// extractSummary
// ============================================================================

describe("extractSummary", () => {
  it("extracts text from paragraphs", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "First paragraph" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Second paragraph" }],
        },
      ],
    });

    expect(extractSummary(doc, 5, 500)).toBe(
      "First paragraph\n\nSecond paragraph",
    );
  });

  it("extracts text from bullet lists", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Item one" }],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Item two" }],
                },
              ],
            },
          ],
        },
      ],
    });

    const result = extractSummary(doc, 5, 500);
    expect(result).toContain("Item one");
    expect(result).toContain("Item two");
  });

  it("extracts text from blockquotes", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Quoted text" }],
            },
          ],
        },
      ],
    });

    expect(extractSummary(doc, 5, 500)).toBe("Quoted text");
  });

  it("extracts text from headings", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "My Heading" }],
        },
      ],
    });

    expect(extractSummary(doc, 5, 500)).toBe("My Heading");
  });

  it("respects maxBlocks limit", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "One" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Two" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Three" }],
        },
      ],
    });

    expect(extractSummary(doc, 2, 500)).toBe("One\n\nTwo");
  });

  it("respects maxChars limit", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "A".repeat(300) }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "B".repeat(300) }],
        },
      ],
    });

    // First block (300 chars) is included, then totalChars >= 300 so stop
    const result = extractSummary(doc, 5, 300);
    expect(result).toContain("A".repeat(300));
    expect(result).not.toContain("B");
  });

  it("honors moreBreak with mixed node types", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Before break" }],
                },
              ],
            },
          ],
        },
        { type: "moreBreak" },
        {
          type: "paragraph",
          content: [{ type: "text", text: "After break" }],
        },
      ],
    });

    const result = extractSummary(doc, 5, 500);
    expect(result).toContain("Before break");
    expect(result).not.toContain("After break");
  });

  it("skips images and horizontal rules", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "image",
          attrs: { src: "https://example.com/img.png" },
        },
        { type: "horizontalRule" },
        {
          type: "paragraph",
          content: [{ type: "text", text: "After decorations" }],
        },
      ],
    });

    expect(extractSummary(doc, 5, 500)).toBe("After decorations");
  });

  it("does not leak link mark URLs into the plaintext summary", () => {
    // Regression guard: extractBodyText (for search) includes link hrefs,
    // but extractSummary (for feeds/meta descriptions) must not.
    const doc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "See " },
            {
              type: "text",
              text: "this link",
              marks: [
                {
                  type: "link",
                  attrs: { href: "https://example.com/foo" },
                },
              ],
            },
            { type: "text", text: "." },
          ],
        },
      ],
    });

    const result = extractSummary(doc, 5, 500);
    expect(result).toBe("See this link.");
    expect(result).not.toContain("example.com");
  });

  it("returns null for invalid JSON", () => {
    expect(extractSummary("not json", 5, 500)).toBeNull();
  });

  it("returns null for body with only images", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "image",
          attrs: { src: "https://example.com/img.png" },
        },
      ],
    });
    expect(extractSummary(doc, 5, 500)).toBeNull();
  });
});

// ============================================================================
// extractSummaryHtml
// ============================================================================

describe("extractSummaryHtml", () => {
  it("renders paragraph as HTML", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Hello world" }],
        },
      ],
    });

    const result = extractSummaryHtml(doc);
    expect(result).not.toBeNull();
    expect(result!.html).toBe("<p>Hello world</p>");
    expect(result!.hasMore).toBe(false);
  });

  it("preserves bullet list structure", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Item one" }],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Item two" }],
                },
              ],
            },
          ],
        },
      ],
    });

    const result = extractSummaryHtml(doc);
    expect(result).not.toBeNull();
    expect(result!.html).toContain("<ul>");
    expect(result!.html).toContain("<li>");
    expect(result!.html).toContain("Item one");
    expect(result!.html).toContain("Item two");
    expect(result!.hasMore).toBe(false);
  });

  it("preserves blockquote structure", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Quoted text" }],
            },
          ],
        },
      ],
    });

    const result = extractSummaryHtml(doc);
    expect(result!.html).toContain("<blockquote>");
  });

  it("truncates at maxBlocks and sets hasMore", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "First" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Second" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Third" }],
        },
      ],
    });

    const result = extractSummaryHtml(doc, 2, 500);
    expect(result).not.toBeNull();
    expect(result!.html).toContain("First");
    expect(result!.html).toContain("Second");
    expect(result!.html).not.toContain("Third");
    expect(result!.hasMore).toBe(true);
  });

  it("honors moreBreak", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Before" }],
        },
        { type: "moreBreak" },
        {
          type: "paragraph",
          content: [{ type: "text", text: "After" }],
        },
      ],
    });

    const result = extractSummaryHtml(doc);
    expect(result!.html).toContain("Before");
    expect(result!.html).not.toContain("After");
    expect(result!.hasMore).toBe(true);
  });

  it("returns null for invalid JSON", () => {
    expect(extractSummaryHtml("not json")).toBeNull();
  });

  it("returns null for body with only images", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "image",
          attrs: { src: "https://example.com/img.png" },
        },
      ],
    });
    expect(extractSummaryHtml(doc)).toBeNull();
  });

  it("preserves links in HTML output", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "Link text",
                      marks: [
                        {
                          type: "link",
                          attrs: {
                            href: "https://example.com",
                            target: "_blank",
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    const result = extractSummaryHtml(doc);
    expect(result!.html).toContain('<a href="https://example.com"');
    expect(result!.html).toContain("Link text");
    // Link text should be inside a proper <a> tag, not a broken fragment
    expect(result!.html).toContain(">Link text</a>");
  });

  it("includes referenced footnote definitions with the requested namespace", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Visible" },
            { type: "footnoteReference", attrs: { label: "note" } },
          ],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Hidden tail" }],
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
    });

    const result = extractSummaryHtml(doc, 1, 500, 0, {
      namespace: "pst_summary",
    });

    expect(result?.hasMore).toBe(true);
    expect(result?.html).toContain('id="fn-0pba1ne36oeor-1"');
    expect(result?.html).toContain('role="doc-endnotes"');
    expect(result?.html.match(/<ol class="footnote-list">/g)).toHaveLength(1);
    expect(result?.html).not.toMatch(
      /footnote-document|footnote-main|data-footnote-|--footnote-/,
    );
    expect(result?.html).not.toContain("Hidden tail");
    expect(result!.html.indexOf("Definition")).toBeGreaterThan(
      result!.html.indexOf("Visible"),
    );
  });

  it("omits a footnote when its first reference is beyond the summary boundary", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Visible summary" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hidden reference" },
            { type: "footnoteReference", attrs: { label: "note" } },
          ],
        },
        {
          type: "footnoteDefinition",
          attrs: { label: "note" },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Hidden definition" }],
            },
          ],
        },
      ],
    });

    const result = extractSummaryHtml(doc, 1, 500);

    expect(result?.hasMore).toBe(true);
    expect(result?.html).toContain("Visible summary");
    expect(result?.html).not.toContain("Hidden reference");
    expect(result?.html).not.toContain("Hidden definition");
    expect(result?.html).not.toContain('role="doc-endnotes"');
  });

  function paragraphsDoc(...texts: string[]): string {
    return JSON.stringify({
      type: "doc",
      content: texts.map((text) => ({
        type: "paragraph",
        content: [{ type: "text", text }],
      })),
    });
  }

  it("cancels char-limit truncation when the hidden tail is below minHiddenChars", () => {
    const doc = paragraphsDoc("A".repeat(600), "B".repeat(150));
    const result = extractSummaryHtml(doc, 10, 500, 200);
    expect(result!.hasMore).toBe(false);
    expect(result!.html).toContain("A".repeat(600));
    expect(result!.html).toContain("B".repeat(150));
  });

  it("keeps truncation when the hidden tail meets minHiddenChars", () => {
    const doc = paragraphsDoc("A".repeat(600), "B".repeat(600));
    const result = extractSummaryHtml(doc, 10, 500, 200);
    expect(result!.hasMore).toBe(true);
    expect(result!.breakAtIndex).toBe(1);
    expect(result!.html).toContain("A".repeat(600));
    expect(result!.html).not.toContain("B".repeat(600));
  });

  it("treats minHiddenChars as a strict threshold", () => {
    // Hidden tail of exactly 200 chars is not below 200, so it still truncates.
    const doc = paragraphsDoc("A".repeat(600), "B".repeat(200));
    const result = extractSummaryHtml(doc, 10, 500, 200);
    expect(result!.hasMore).toBe(true);
  });

  it("applies tolerance to block-limit truncation too", () => {
    const texts = Array.from({ length: 11 }, (_, i) => `p${i}`);
    const doc = paragraphsDoc(...texts);
    const result = extractSummaryHtml(doc, 10, 500, 200);
    expect(result!.hasMore).toBe(false);
    for (const text of texts) {
      expect(result!.html).toContain(text);
    }
  });

  it("never lets tolerance override an explicit moreBreak", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Before" }] },
        { type: "moreBreak" },
        { type: "paragraph", content: [{ type: "text", text: "After tail" }] },
      ],
    });
    const result = extractSummaryHtml(doc, 10, 500, 200);
    expect(result!.hasMore).toBe(true);
    expect(result!.html).toContain("Before");
    expect(result!.html).not.toContain("After tail");
  });

  it("leaves limit truncation intact when minHiddenChars defaults to 0", () => {
    const doc = paragraphsDoc("A".repeat(600), "B".repeat(150));
    const result = extractSummaryHtml(doc, 10, 500);
    expect(result!.hasMore).toBe(true);
    expect(result!.html).not.toContain("B".repeat(150));
  });

  it("excludes trailing non-content nodes when tolerance includes the tail", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "A".repeat(600) }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "B".repeat(150) }],
        },
        { type: "image", attrs: { src: "https://example.com/x.png" } },
      ],
    });
    const result = extractSummaryHtml(doc, 10, 500, 200);
    expect(result!.hasMore).toBe(false);
    expect(result!.html).toContain("B".repeat(150));
    expect(result!.html).not.toContain("<img");
  });
});
