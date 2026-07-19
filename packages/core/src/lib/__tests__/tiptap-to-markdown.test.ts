import { describe, it, expect } from "vitest";
import { tiptapJsonToMarkdown } from "../tiptap-to-markdown.js";
import { markdownToTiptapJson } from "../markdown-to-tiptap.js";

/** Helper: markdown → tiptap json → markdown */
function roundtrip(md: string): string {
  const json = markdownToTiptapJson(md);
  return tiptapJsonToMarkdown(json);
}

/** Helper: build tiptap JSON string directly */
function doc(...content: Record<string, unknown>[]): string {
  return JSON.stringify({ type: "doc", content });
}

function p(...content: Record<string, unknown>[]) {
  return { type: "paragraph", content };
}

function text(t: string, marks?: Record<string, unknown>[]) {
  const node: Record<string, unknown> = { type: "text", text: t };
  if (marks) node.marks = marks;
  return node;
}

describe("tiptapJsonToMarkdown", () => {
  describe("basic blocks", () => {
    it("converts a simple paragraph", () => {
      expect(tiptapJsonToMarkdown(doc(p(text("Hello world"))))).toBe(
        "Hello world",
      );
    });

    it("converts multiple paragraphs", () => {
      expect(
        tiptapJsonToMarkdown(doc(p(text("First")), p(text("Second")))),
      ).toBe("First\n\nSecond");
    });

    it("converts empty paragraph to blank line", () => {
      expect(
        tiptapJsonToMarkdown(
          doc(p(text("A")), { type: "paragraph" }, p(text("B"))),
        ),
      ).toBe("A\n\n\n\nB");
    });

    it("converts headings", () => {
      const json = doc(
        { type: "heading", attrs: { level: 1 }, content: [text("H1")] },
        { type: "heading", attrs: { level: 3 }, content: [text("H3")] },
      );
      expect(tiptapJsonToMarkdown(json)).toBe("# H1\n\n### H3");
    });

    it("converts horizontal rule", () => {
      expect(
        tiptapJsonToMarkdown(
          doc(p(text("Above")), { type: "horizontalRule" }, p(text("Below"))),
        ),
      ).toBe("Above\n\n---\n\nBelow");
    });

    it("converts moreBreak", () => {
      expect(
        tiptapJsonToMarkdown(
          doc(p(text("Preview")), { type: "moreBreak" }, p(text("Rest"))),
        ),
      ).toBe("Preview\n\n<!--more-->\n\nRest");
    });
  });

  describe("inline marks", () => {
    it("converts bold", () => {
      expect(
        tiptapJsonToMarkdown(
          doc(p(text("hello ", undefined), text("world", [{ type: "bold" }]))),
        ),
      ).toBe("hello **world**");
    });

    it("converts italic", () => {
      expect(
        tiptapJsonToMarkdown(
          doc(
            p(text("hello ", undefined), text("world", [{ type: "italic" }])),
          ),
        ),
      ).toBe("hello *world*");
    });

    it("converts strikethrough", () => {
      expect(
        tiptapJsonToMarkdown(
          doc(
            p(text("hello ", undefined), text("world", [{ type: "strike" }])),
          ),
        ),
      ).toBe("hello ~~world~~");
    });

    it("converts inline code", () => {
      expect(
        tiptapJsonToMarkdown(
          doc(p(text("run ", undefined), text("npm test", [{ type: "code" }]))),
        ),
      ).toBe("run `npm test`");
    });

    it("converts links", () => {
      expect(
        tiptapJsonToMarkdown(
          doc(
            p(
              text("click ", undefined),
              text("here", [
                { type: "link", attrs: { href: "https://example.com" } },
              ]),
            ),
          ),
        ),
      ).toBe("click [here](https://example.com)");
    });

    it("converts nested marks (bold + italic)", () => {
      expect(
        tiptapJsonToMarkdown(
          doc(p(text("emphasis", [{ type: "bold" }, { type: "italic" }]))),
        ),
      ).toBe("***emphasis***");
    });
  });

  describe("code blocks", () => {
    it("converts code block without language", () => {
      const json = doc({
        type: "codeBlock",
        content: [text("const x = 1;")],
      });
      expect(tiptapJsonToMarkdown(json)).toBe("```\nconst x = 1;\n```");
    });

    it("converts code block with language", () => {
      const json = doc({
        type: "codeBlock",
        attrs: { language: "typescript" },
        content: [text("const x: number = 1;")],
      });
      expect(tiptapJsonToMarkdown(json)).toBe(
        "```typescript\nconst x: number = 1;\n```",
      );
    });

    it("uses extra backticks when content contains triple backticks", () => {
      const json = doc({
        type: "codeBlock",
        content: [text("```\ninner\n```")],
      });
      expect(tiptapJsonToMarkdown(json)).toBe("````\n```\ninner\n```\n````");
    });
  });

  describe("lists", () => {
    it("converts bullet list", () => {
      const json = doc({
        type: "bulletList",
        content: [
          { type: "listItem", content: [p(text("Item 1"))] },
          { type: "listItem", content: [p(text("Item 2"))] },
        ],
      });
      expect(tiptapJsonToMarkdown(json)).toBe("- Item 1\n- Item 2");
    });

    it("converts ordered list", () => {
      const json = doc({
        type: "orderedList",
        content: [
          { type: "listItem", content: [p(text("First"))] },
          { type: "listItem", content: [p(text("Second"))] },
        ],
      });
      expect(tiptapJsonToMarkdown(json)).toBe("1. First\n2. Second");
    });

    it("converts ordered list with custom start", () => {
      const json = doc({
        type: "orderedList",
        attrs: { start: 5 },
        content: [
          { type: "listItem", content: [p(text("Fifth"))] },
          { type: "listItem", content: [p(text("Sixth"))] },
        ],
      });
      expect(tiptapJsonToMarkdown(json)).toBe("5. Fifth\n6. Sixth");
    });

    it("converts nested lists", () => {
      const json = doc({
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              p(text("Parent")),
              {
                type: "bulletList",
                content: [{ type: "listItem", content: [p(text("Child"))] }],
              },
            ],
          },
        ],
      });
      const result = tiptapJsonToMarkdown(json);
      expect(result).toContain("- Parent");
      expect(result).toContain("  - Child");
    });
  });

  describe("blockquotes", () => {
    it("converts blockquotes", () => {
      const json = doc({
        type: "blockquote",
        content: [p(text("Quoted text"))],
      });
      expect(tiptapJsonToMarkdown(json)).toBe("> Quoted text");
    });

    it("converts multi-paragraph blockquotes", () => {
      const json = doc({
        type: "blockquote",
        content: [p(text("First")), p(text("Second"))],
      });
      expect(tiptapJsonToMarkdown(json)).toBe("> First\n>\n> Second");
    });
  });

  describe("images", () => {
    it("converts inline images", () => {
      const json = doc(
        p({
          type: "image",
          attrs: { src: "https://example.com/img.png", alt: "My image" },
        }),
      );
      expect(tiptapJsonToMarkdown(json)).toBe(
        "![My image](https://example.com/img.png)",
      );
    });

    it("converts block-level images", () => {
      const json = doc({
        type: "image",
        attrs: {
          src: "https://example.com/img.png",
          alt: "Alt",
          title: "Title",
        },
      });
      expect(tiptapJsonToMarkdown(json)).toBe(
        '![Alt](https://example.com/img.png "Title")',
      );
    });

    it("converts rich images to Jant figure HTML", () => {
      const json = doc({
        type: "image",
        attrs: {
          src: "https://example.com/img.png",
          alt: "Alt",
          title: "Title",
          caption: "Caption",
          href: "https://example.com/source",
          layout: "wide",
        },
      });
      expect(tiptapJsonToMarkdown(json)).toBe(
        '<figure data-jant-node="image" data-jant-layout="wide"><a href="https://example.com/source"><img src="https://example.com/img.png" alt="Alt" title="Title"></a><figcaption>Caption</figcaption></figure>',
      );
    });
  });

  describe("tables", () => {
    it("converts a simple table", () => {
      const json = doc({
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableHeader", content: [p(text("Name"))] },
              { type: "tableHeader", content: [p(text("Age"))] },
            ],
          },
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [p(text("Alice"))] },
              { type: "tableCell", content: [p(text("30"))] },
            ],
          },
        ],
      });
      const result = tiptapJsonToMarkdown(json);
      expect(result).toContain("| Name");
      expect(result).toContain("| ---");
      expect(result).toContain("| Alice");
    });
  });

  describe("footnotes", () => {
    it("converts footnote references and single-paragraph definitions", () => {
      const json = doc(
        p(text("Body copy"), {
          type: "footnoteReference",
          attrs: { label: "1" },
        }),
        {
          type: "footnoteDefinition",
          attrs: { label: "1" },
          content: [p(text("Footnote body"))],
        },
      );

      expect(tiptapJsonToMarkdown(json)).toBe(
        "Body copy[^1]\n\n[^1]: Footnote body",
      );
    });

    it("converts multi-block footnote definitions with indented bodies", () => {
      const json = doc(
        p(text("Body copy"), {
          type: "footnoteReference",
          attrs: { label: "1" },
        }),
        {
          type: "footnoteDefinition",
          attrs: { label: "1" },
          content: [
            p(text("First paragraph")),
            {
              type: "bulletList",
              content: [
                { type: "listItem", content: [p(text("Nested item"))] },
              ],
            },
          ],
        },
      );

      expect(tiptapJsonToMarkdown(json)).toBe(
        "Body copy[^1]\n\n[^1]:\n    First paragraph\n\n    - Nested item",
      );
    });
  });

  describe("hard breaks", () => {
    it("converts hard breaks to trailing spaces + newline", () => {
      const json = doc(
        p(text("Line 1"), { type: "hardBreak" }, text("Line 2")),
      );
      expect(tiptapJsonToMarkdown(json)).toBe("Line 1  \nLine 2");
    });
  });

  describe("round-trip", () => {
    it("round-trips a simple paragraph", () => {
      expect(roundtrip("Hello world")).toBe("Hello world");
    });

    it("round-trips bold text", () => {
      expect(roundtrip("Hello **world**")).toBe("Hello **world**");
    });

    it("round-trips a heading", () => {
      expect(roundtrip("## My Heading")).toBe("## My Heading");
    });

    it("round-trips a code block", () => {
      const md = "```js\nconsole.log('hi')\n```";
      expect(roundtrip(md)).toBe("```js\nconsole.log('hi')\n```");
    });

    it("round-trips a blockquote", () => {
      expect(roundtrip("> Quoted text")).toBe("> Quoted text");
    });

    it("round-trips a bullet list", () => {
      const md = "- Item 1\n- Item 2";
      const result = roundtrip(md);
      expect(result).toContain("- Item 1");
      expect(result).toContain("- Item 2");
    });

    it("round-trips a rich image figure", () => {
      const md =
        '<figure data-jant-node="image" data-jant-layout="wide"><a href="https://example.com/source"><img src="https://example.com/img.png" alt="Alt" title="Title"></a><figcaption>Caption</figcaption></figure>';
      expect(roundtrip(md)).toBe(md);
    });

    it("round-trips footnotes", () => {
      const md = "Body copy[^1]\n\n[^1]: Footnote body";
      expect(roundtrip(md)).toBe(md);
    });

    it("canonicalizes inline footnotes as references plus definitions", () => {
      expect(roundtrip("Body^[Inline **bold** note.]")).toBe(
        "Body[^1]\n\n[^1]: Inline **bold** note.",
      );
    });
  });

  describe("edge cases", () => {
    it("returns empty string for invalid JSON", () => {
      expect(tiptapJsonToMarkdown("not json")).toBe("");
    });

    it("returns empty string for non-doc node", () => {
      expect(tiptapJsonToMarkdown('{"type":"paragraph"}')).toBe("");
    });

    it("handles empty doc", () => {
      expect(tiptapJsonToMarkdown('{"type":"doc","content":[]}')).toBe("");
    });
  });
});
