import type { JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { upgradeLegacyFootnotes } from "../footnotes.js";
import { markdownToTiptapJson } from "../markdown-to-tiptap.js";
import { renderTiptapDocument } from "../tiptap-render.js";

function linkedText(text: string, href: string): JSONContent {
  return {
    type: "text",
    text,
    marks: [
      {
        type: "link",
        attrs: { href, target: "_blank", rel: "noopener noreferrer" },
      },
    ],
  };
}

function legacyDocument(): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "First" },
          linkedText("[1]", "#fn-1"),
          { type: "text", text: " and repeated" },
          linkedText("[1]", "#fn-1"),
          { type: "text", text: ". Second" },
          linkedText("[2]", "#fn-2"),
        ],
      },
      { type: "horizontalRule" },
      {
        type: "orderedList",
        attrs: { start: 1, type: null },
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "Rich definition with " },
                  linkedText("source", "https://example.com"),
                  linkedText("↩︎", "#fnref-1"),
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
                        content: [{ type: "text", text: "Nested detail" }],
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
                content: [
                  { type: "text", text: "Second definition" },
                  linkedText("↩︎", "#fnref-2"),
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("upgradeLegacyFootnotes", () => {
  it("upgrades the historical link, rule, list, and backlink shape", () => {
    const result = upgradeLegacyFootnotes(legacyDocument());

    expect(result.upgraded).toBe(true);
    expect(result.doc.content?.map((node) => node.type)).toEqual([
      "paragraph",
      "footnoteDefinition",
      "footnoteDefinition",
    ]);
    expect(
      result.doc.content?.[0]?.content?.filter(
        (node) => node.type === "footnoteReference",
      ),
    ).toEqual([
      { type: "footnoteReference", attrs: { label: "1" } },
      { type: "footnoteReference", attrs: { label: "1" } },
      { type: "footnoteReference", attrs: { label: "2" } },
    ]);

    const serialized = JSON.stringify(result.doc);
    expect(serialized).not.toContain("#fn-");
    expect(serialized).not.toContain("#fnref-");
    expect(serialized).not.toContain("↩");
    expect(serialized).toContain("https://example.com");
    expect(serialized).toContain("Nested detail");

    const html = renderTiptapDocument(result.doc, {
      namespace: "pst_legacy",
    });
    expect(html).toContain('role="doc-noteref"');
    expect(html).toContain('role="doc-endnotes"');
    expect(html).toContain('role="doc-backlink"');
    expect(html).not.toContain("<hr>");
  });

  it("is idempotent after the canonical nodes have been created", () => {
    const first = upgradeLegacyFootnotes(legacyDocument());
    const second = upgradeLegacyFootnotes(first.doc);

    expect(second).toEqual({ doc: first.doc, upgraded: false });
  });

  it("upgrades the Markdown round-trip shape observed on historical posts", () => {
    const body = markdownToTiptapJson(
      [
        "Codex[\\[1\\]](#fn-1) and Claude[\\[2\\]](#fn-2).",
        "",
        "---",
        "",
        "1. First definition.[↩︎](#fnref-1)",
        "2. Second definition.[↩︎](#fnref-2)",
      ].join("\n"),
    );
    const result = upgradeLegacyFootnotes(JSON.parse(body) as JSONContent);

    expect(result.upgraded).toBe(true);
    expect(JSON.stringify(result.doc)).toContain('"type":"footnoteReference"');
    expect(JSON.stringify(result.doc)).toContain('"type":"footnoteDefinition"');
  });

  it.each([
    {
      name: "has no separator",
      mutate(doc: JSONContent) {
        doc.content?.splice(-2, 1);
      },
    },
    {
      name: "has an unmatched backlink",
      mutate(doc: JSONContent) {
        const list = doc.content?.at(-1);
        const backlink = list?.content?.[0]?.content?.[0]?.content?.at(-1);
        if (backlink?.marks?.[0]?.attrs) {
          backlink.marks[0].attrs.href = "#fnref-99";
        }
      },
    },
    {
      name: "has an ordinary numbered list",
      mutate(doc: JSONContent) {
        const list = doc.content?.at(-1);
        const paragraph = list?.content?.[0]?.content?.[0];
        paragraph?.content?.pop();
      },
    },
  ])("leaves a document unchanged when it $name", ({ mutate }) => {
    const doc = legacyDocument();
    mutate(doc);
    const original = globalThis.structuredClone(doc);

    expect(upgradeLegacyFootnotes(doc)).toEqual({
      doc: original,
      upgraded: false,
    });
  });
});
