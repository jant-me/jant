import { describe, it, expect } from "vitest";
import { markdownToTiptapJson } from "../markdown-to-tiptap.js";
import { renderTiptapJson } from "../tiptap-render.js";

interface TiptapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface TiptapNode {
  type: string;
  content?: TiptapNode[];
  text?: string;
  marks?: TiptapMark[];
  attrs?: Record<string, unknown>;
}

describe("markdownToTiptapJson", () => {
  function parse(md: string) {
    return JSON.parse(markdownToTiptapJson(md));
  }

  describe("block elements", () => {
    it("converts a simple paragraph", () => {
      const doc = parse("Hello world");
      expect(doc.type).toBe("doc");
      expect(doc.content).toHaveLength(1);
      expect(doc.content[0].type).toBe("paragraph");
      expect(doc.content[0].content[0].text).toBe("Hello world");
    });

    it("converts multiple paragraphs", () => {
      const doc = parse("First paragraph.\n\nSecond paragraph.");
      expect(doc.content).toHaveLength(2);
      expect(doc.content[0].content[0].text).toBe("First paragraph.");
      expect(doc.content[1].content[0].text).toBe("Second paragraph.");
    });

    it("converts headings with correct levels", () => {
      const doc = parse("# H1\n\n## H2\n\n### H3");
      expect(doc.content[0].type).toBe("heading");
      expect(doc.content[0].attrs.level).toBe(1);
      expect(doc.content[1].type).toBe("heading");
      expect(doc.content[1].attrs.level).toBe(2);
      expect(doc.content[2].type).toBe("heading");
      expect(doc.content[2].attrs.level).toBe(3);
    });

    it("converts fenced code blocks", () => {
      const doc = parse("```javascript\nconsole.log('hi')\n```");
      expect(doc.content[0].type).toBe("codeBlock");
      expect(doc.content[0].attrs.language).toBe("javascript");
      expect(doc.content[0].content[0].text).toBe("console.log('hi')");
    });

    it("converts code blocks without language", () => {
      const doc = parse("```\nplain code\n```");
      expect(doc.content[0].type).toBe("codeBlock");
      expect(doc.content[0].attrs).toBeUndefined();
      expect(doc.content[0].content[0].text).toBe("plain code");
    });

    it("converts blockquotes", () => {
      const doc = parse("> Quoted text");
      expect(doc.content[0].type).toBe("blockquote");
      expect(doc.content[0].content[0].type).toBe("paragraph");
      expect(doc.content[0].content[0].content[0].text).toBe("Quoted text");
    });

    it("converts nested blockquotes", () => {
      const doc = parse("> Outer\n>\n> > Inner");
      expect(doc.content[0].type).toBe("blockquote");
      // The inner blockquote should be nested
      const inner = doc.content[0].content.find(
        (n: Record<string, unknown>) => n.type === "blockquote",
      );
      expect(inner).toBeDefined();
    });

    it("converts bullet lists", () => {
      const doc = parse("- Item 1\n- Item 2\n- Item 3");
      expect(doc.content[0].type).toBe("bulletList");
      expect(doc.content[0].content).toHaveLength(3);
      expect(doc.content[0].content[0].type).toBe("listItem");
    });

    it("converts ordered lists", () => {
      const doc = parse("1. First\n2. Second\n3. Third");
      expect(doc.content[0].type).toBe("orderedList");
      expect(doc.content[0].content).toHaveLength(3);
    });

    it("converts horizontal rules", () => {
      const doc = parse("Above\n\n---\n\nBelow");
      const hr = doc.content.find(
        (n: Record<string, unknown>) => n.type === "horizontalRule",
      );
      expect(hr).toBeDefined();
    });

    it("converts <!--more--> to moreBreak", () => {
      const doc = parse("Before\n\n<!--more-->\n\nAfter");
      const moreBreak = doc.content.find(
        (n: Record<string, unknown>) => n.type === "moreBreak",
      );
      expect(moreBreak).toBeDefined();
    });

    it("converts tables", () => {
      const md = "| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |";
      const doc = parse(md);
      expect(doc.content[0].type).toBe("table");
      const rows = doc.content[0].content;
      expect(rows).toHaveLength(3); // 1 header + 2 body
      expect(rows[0].content[0].type).toBe("tableHeader");
      expect(rows[1].content[0].type).toBe("tableCell");
    });

    it("converts footnote definitions into dedicated block nodes", () => {
      const doc = parse("Body[^1]\n\n[^1]: Footnote body");

      expect(doc.content[0].content).toEqual([
        { type: "text", text: "Body" },
        { type: "footnoteReference", attrs: { label: "1" } },
      ]);
      expect(doc.content[1].type).toBe("footnoteDefinition");
      expect(doc.content[1].attrs.label).toBe("1");
      expect(doc.content[1].content[0].type).toBe("paragraph");
      expect(doc.content[1].content[0].content[0].text).toBe("Footnote body");
    });

    it("normalizes inline footnotes into paired structural nodes", () => {
      const doc = parse("Body^[Inline **bold** note.]");

      expect(doc.content[0].content).toEqual([
        { type: "text", text: "Body" },
        { type: "footnoteReference", attrs: { label: "1" } },
      ]);
      expect(doc.content[1]).toMatchObject({
        type: "footnoteDefinition",
        attrs: { label: "1" },
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Inline " },
              { type: "text", text: "bold", marks: [{ type: "bold" }] },
              { type: "text", text: " note." },
            ],
          },
        ],
      });
    });
  });

  describe("inline elements", () => {
    it("keeps single newlines as plain text inside a paragraph", () => {
      const doc = parse("Line 1\nLine 2");
      const content = doc.content[0].content;

      expect(content).toHaveLength(1);
      expect(content[0].text).toBe("Line 1\nLine 2");
    });

    it("converts explicit hard breaks", () => {
      const doc = parse("Line 1  \nLine 2");
      const content = doc.content[0].content;

      expect(content).toHaveLength(3);
      expect(content[0].text).toBe("Line 1");
      expect(content[1].type).toBe("hardBreak");
      expect(content[2].text).toBe("Line 2");
    });

    it("converts bold text", () => {
      const doc = parse("This is **bold** text");
      const content = doc.content[0].content;
      const boldNode = content.find(
        (n: Record<string, unknown>) =>
          n.text === "bold" &&
          Array.isArray(n.marks) &&
          (n.marks as TiptapMark[]).some((m) => m.type === "bold"),
      );
      expect(boldNode).toBeDefined();
    });

    it("converts italic text", () => {
      const doc = parse("This is *italic* text");
      const content = doc.content[0].content;
      const italicNode = content.find(
        (n: Record<string, unknown>) =>
          n.text === "italic" &&
          Array.isArray(n.marks) &&
          (n.marks as TiptapMark[]).some((m) => m.type === "italic"),
      );
      expect(italicNode).toBeDefined();
    });

    it("converts inline code", () => {
      const doc = parse("Use `console.log` here");
      const content = doc.content[0].content;
      const codeNode = content.find(
        (n: Record<string, unknown>) =>
          n.text === "console.log" &&
          Array.isArray(n.marks) &&
          (n.marks as TiptapMark[]).some((m) => m.type === "code"),
      );
      expect(codeNode).toBeDefined();
    });

    it("converts strikethrough text", () => {
      const doc = parse("This is ~~deleted~~ text");
      const content = doc.content[0].content;
      const strikeNode = content.find(
        (n: Record<string, unknown>) =>
          n.text === "deleted" &&
          Array.isArray(n.marks) &&
          (n.marks as TiptapMark[]).some((m) => m.type === "strike"),
      );
      expect(strikeNode).toBeDefined();
    });

    it("converts links", () => {
      const doc = parse("[click here](https://example.com)");
      const content = doc.content[0].content;
      const linkNode = content.find(
        (n: Record<string, unknown>) =>
          Array.isArray(n.marks) &&
          (n.marks as TiptapMark[]).some(
            (m) =>
              m.type === "link" &&
              (m.attrs as Record<string, unknown>)?.href ===
                "https://example.com",
          ),
      );
      expect(linkNode).toBeDefined();
      expect(linkNode.text).toBe("click here");
    });

    it("converts images to image nodes", () => {
      const doc = parse("![Alt text](https://example.com/img.png)");
      // Image might be inside a paragraph or as a top-level node
      const findImage = (nodes: TiptapNode[]): TiptapNode | undefined => {
        for (const n of nodes) {
          if (n.type === "image") return n;
          if (n.content) {
            const found = findImage(n.content);
            if (found) return found;
          }
        }
        return undefined;
      };
      const img = findImage(doc.content);
      expect(img).toBeDefined();
      expect(img?.attrs?.src).toBe("https://example.com/img.png");
      expect(img?.attrs?.alt).toBe("Alt text");
    });

    it("converts Jant image figures to image nodes", () => {
      const doc = parse(
        '<figure data-jant-node="image" data-jant-layout="wide"><a href="https://example.com/source"><img src="https://example.com/img.png" alt="Alt text" title="Title"></a><figcaption>Caption</figcaption></figure>',
      );
      expect(doc.content[0].type).toBe("image");
      expect(doc.content[0].attrs.src).toBe("https://example.com/img.png");
      expect(doc.content[0].attrs.alt).toBe("Alt text");
      expect(doc.content[0].attrs.title).toBe("Title");
      expect(doc.content[0].attrs.href).toBe("https://example.com/source");
      expect(doc.content[0].attrs.caption).toBe("Caption");
      expect(doc.content[0].attrs.layout).toBe("wide");
    });

    it("converts nested marks (bold + italic)", () => {
      const doc = parse("***bold and italic***");
      const content = doc.content[0].content;
      // Find a node with both bold and italic marks
      const nested = content.find(
        (n: Record<string, unknown>) =>
          Array.isArray(n.marks) &&
          (n.marks as TiptapMark[]).some((m) => m.type === "bold") &&
          (n.marks as TiptapMark[]).some((m) => m.type === "italic"),
      );
      expect(nested).toBeDefined();
    });

    it("converts footnote references into inline atom nodes", () => {
      const doc = parse("Body[^1]");
      const content = doc.content[0].content;

      expect(content[0].text).toBe("Body");
      expect(content[1].type).toBe("footnoteReference");
      expect(content[1].attrs.label).toBe("1");
    });
  });

  it("handles empty input", () => {
    const doc = parse("");
    expect(doc.type).toBe("doc");
    expect(doc.content).toHaveLength(1);
    expect(doc.content[0].type).toBe("paragraph");
  });
});

describe("end-to-end: Markdown → markdownToTiptapJson → renderTiptapJson", () => {
  it("renders paragraphs correctly", () => {
    const json = markdownToTiptapJson("Hello world");
    const html = renderTiptapJson(json);
    expect(html).toBe("<p>Hello world</p>");
  });

  it("does not render single newlines as hard breaks", () => {
    const json = markdownToTiptapJson("Line 1\nLine 2");
    const html = renderTiptapJson(json);
    expect(html).toBe("<p>Line 1\nLine 2</p>");
  });

  it("renders explicit hard breaks correctly", () => {
    const json = markdownToTiptapJson("Line 1  \nLine 2");
    const html = renderTiptapJson(json);
    expect(html).toBe("<p>Line 1<br>Line 2</p>");
  });

  it("renders headings correctly", () => {
    const json = markdownToTiptapJson("## Section Title");
    const html = renderTiptapJson(json);
    expect(html).toBe("<h2>Section Title</h2>");
  });

  it("renders bold text correctly", () => {
    const json = markdownToTiptapJson("This is **bold** text");
    const html = renderTiptapJson(json);
    expect(html).toContain("<strong>bold</strong>");
  });

  it("renders italic text correctly", () => {
    const json = markdownToTiptapJson("This is *italic* text");
    const html = renderTiptapJson(json);
    expect(html).toContain("<em>italic</em>");
  });

  it("renders links correctly", () => {
    const json = markdownToTiptapJson("[click](https://example.com)");
    const html = renderTiptapJson(json);
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain("nofollow");
    expect(html).toContain("click");
  });

  it("renders code blocks correctly", () => {
    const json = markdownToTiptapJson("```js\nconst x = 1;\n```");
    const html = renderTiptapJson(json);
    expect(html).toContain("<pre><code");
    expect(html).toContain("const x = 1;");
  });

  it("renders blockquotes correctly", () => {
    const json = markdownToTiptapJson("> Quoted text");
    const html = renderTiptapJson(json);
    expect(html).toContain("<blockquote>");
    expect(html).toContain("Quoted text");
  });

  it("renders bullet lists correctly", () => {
    const json = markdownToTiptapJson("- Item 1\n- Item 2");
    const html = renderTiptapJson(json);
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>");
    expect(html).toContain("Item 1");
    expect(html).toContain("Item 2");
  });

  it("renders ordered lists correctly", () => {
    const json = markdownToTiptapJson("1. First\n2. Second");
    const html = renderTiptapJson(json);
    expect(html).toContain("<ol>");
    expect(html).toContain("First");
    expect(html).toContain("Second");
  });

  it("renders horizontal rules correctly", () => {
    const json = markdownToTiptapJson("Above\n\n---\n\nBelow");
    const html = renderTiptapJson(json);
    expect(html).toContain("<hr>");
  });

  it("renders <!--more--> correctly", () => {
    const json = markdownToTiptapJson("Before\n\n<!--more-->\n\nAfter");
    const html = renderTiptapJson(json);
    expect(html).toContain("<!--more-->");
  });

  it("renders tables correctly", () => {
    const json = markdownToTiptapJson("| A | B |\n| --- | --- |\n| 1 | 2 |");
    const html = renderTiptapJson(json);
    expect(html).toContain("<table>");
    expect(html).toContain("<th>");
    expect(html).toContain("<td>");
  });

  it("renders inline code correctly", () => {
    const json = markdownToTiptapJson("Use `console.log` here");
    const html = renderTiptapJson(json);
    expect(html).toContain("<code>console.log</code>");
  });

  it("renders strikethrough correctly", () => {
    const json = markdownToTiptapJson("This is ~~deleted~~ text");
    const html = renderTiptapJson(json);
    expect(html).toContain("<s>deleted</s>");
  });

  it("renders Jant image figures correctly", () => {
    const json = markdownToTiptapJson(
      '<figure data-jant-node="image" data-jant-layout="wide"><a href="https://example.com/source"><img src="https://example.com/img.png" alt="Alt text" title="Title"></a><figcaption>Caption</figcaption></figure>',
    );
    const html = renderTiptapJson(json);
    expect(html).toContain('<figure data-layout="wide">');
    expect(html).toContain('href="https://example.com/source"');
    expect(html).toContain('src="https://example.com/img.png"');
    expect(html).toContain("<figcaption>Caption</figcaption>");
  });

  it("renders semantic footnotes through the shared document renderer", () => {
    const json = markdownToTiptapJson("Body[^1]\n\n[^1]: Footnote body");
    const html = renderTiptapJson(json);

    expect(html).toContain('role="doc-noteref"');
    expect(html).toContain(
      '<section class="footnote-endnotes" role="doc-endnotes">',
    );
    expect(html).toContain('<ol class="footnote-list">');
    expect(html).toContain('<li id="fn-1" class="footnote">');
    expect(html).toMatch(/<p>Footnote body <span class="footnote-backlinks">/);
    expect(html).toContain('role="doc-backlink"');
    expect(html).not.toMatch(/footnote-document|footnote-main|footnote-body/);
    expect(html).not.toMatch(/data-footnote-|--footnote-|tabindex=/);
  });

  it("renders a complex document", () => {
    const md = [
      "# My Post",
      "",
      "This is a **bold** and *italic* paragraph with a [link](https://example.com).",
      "",
      "## Code Example",
      "",
      "```typescript",
      "const x = 42;",
      "```",
      "",
      "- Item 1",
      "- Item 2",
      "",
      "> A wise quote",
      "",
      "---",
      "",
      "Final paragraph.",
    ].join("\n");

    const json = markdownToTiptapJson(md);
    const html = renderTiptapJson(json);

    expect(html).toContain("<h1>My Post</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("<h2>Code Example</h2>");
    expect(html).toContain("const x = 42;");
    expect(html).toContain("<ul>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<hr>");
    expect(html).toContain("Final paragraph.");
  });
});
