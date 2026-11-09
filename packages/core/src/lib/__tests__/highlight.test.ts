import { describe, expect, it } from "vitest";
import {
  parseMarkdownDocument,
  serializeMarkdownDocument,
} from "../markdown-manager.js";
import { render } from "../markdown.js";

describe("highlight Markdown contract", () => {
  it("parses, renders, and serializes highlights beside CJK text", () => {
    const source = "这是==重点==，继续。";
    const doc = parseMarkdownDocument(source);
    expect(doc.content?.[0]?.content).toEqual([
      { type: "text", text: "这是" },
      { type: "text", text: "重点", marks: [{ type: "highlight" }] },
      { type: "text", text: "，继续。" },
    ]);
    expect(serializeMarkdownDocument(doc)).toBe(source);
    expect(render(source)).toBe("<p>这是<mark>重点</mark>，继续。</p>");
  });

  it("preserves nested formatting through a Markdown round trip", () => {
    const doc = parseMarkdownDocument(
      "==a **bold** and [link](https://example.com)==",
    );
    expect(parseMarkdownDocument(serializeMarkdownDocument(doc))).toEqual(doc);
    expect(render("==a **bold**==")).toContain("<strong>bold</strong>");
    expect(
      doc.content?.[0]?.content?.every((node) =>
        node.marks?.some((mark) => mark.type === "highlight"),
      ),
    ).toBe(true);
  });

  it("keeps delimiters literal in inline and fenced code", () => {
    expect(render("`==literal==`\n\n```\n==literal==\n```")).not.toContain(
      "<mark>",
    );
  });

  it("escapes HTML inside a highlight", () => {
    expect(render("==<script>alert(1)</script>==")).toBe(
      "<p><mark>&lt;script&gt;alert(1)&lt;/script&gt;</mark></p>",
    );
  });

  it("leaves incomplete or empty delimiters as text", () => {
    for (const source of ["==unfinished", "====", "== ==", "== spaced =="]) {
      expect(render(source)).not.toContain("<mark>");
    }
  });

  it("preserves literal equals delimiters in authored plain text", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "literal ==text==" }],
        },
      ],
    };
    expect(parseMarkdownDocument(serializeMarkdownDocument(doc))).toEqual(doc);
  });
});

describe("highlight literal content", () => {
  it("round trips literal delimiters and sentinel-like text inside highlights", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "JANTLITERALEQUALS ==literal== a = b",
              marks: [{ type: "highlight" }],
            },
          ],
        },
      ],
    };
    const original = JSON.stringify(doc);
    expect(parseMarkdownDocument(serializeMarkdownDocument(doc))).toEqual(doc);
    expect(JSON.stringify(doc)).toBe(original);
  });
});

describe("equals escaping", () => {
  const text = (value: string, highlighted = false) => ({
    type: "text",
    text: value,
    ...(highlighted ? { marks: [{ type: "highlight" }] } : {}),
  });
  const paragraph = (...content: ReturnType<typeof text>[]) => ({
    type: "doc",
    content: [{ type: "paragraph", content }],
  });

  it.each([
    ["a = b", "a = b"],
    ["E=mc²", "E=mc²"],
    ["x=1, y=2", "x=1, y=2"],
    ["a==b and c==d", "a\\=\\=b and c\\=\\=d"],
  ])("writes %s as %s", (value, markdown) => {
    const doc = paragraph(text(value));
    expect(serializeMarkdownDocument(doc)).toBe(markdown);
    expect(parseMarkdownDocument(markdown)).toEqual(doc);
  });

  it.each([
    [
      "plain text ending in = before a highlight",
      [text("a="), text("b", true)],
    ],
    ["a highlight starting with =", [text("=x", true)]],
    [
      "a highlight after plain text ending in a space and =",
      [text("a ="), text("b", true)],
    ],
    ["= on both sides of a highlight", [text("="), text("b", true), text("=")]],
  ])("round trips %s", (_label, content) => {
    const doc = paragraph(...content);
    expect(parseMarkdownDocument(serializeMarkdownDocument(doc))).toEqual(doc);
  });

  it("keeps a highlight ending in = when its trailing space moves outside", () => {
    // The serializer writes a mark's trailing whitespace after the closing
    // delimiter, so the space comes back as plain text.
    const doc = paragraph(text("x= ", true), text("y"));
    expect(parseMarkdownDocument(serializeMarkdownDocument(doc))).toEqual(
      paragraph(text("x=", true), text(" y")),
    );
  });
});
