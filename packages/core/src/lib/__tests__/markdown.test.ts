import { describe, it, expect } from "vitest";
import { render, toPlainText, extractTitle } from "../markdown.js";

describe("render", () => {
  it("renders a heading", () => {
    const html = render("# Hello");
    expect(html).toContain("<h1>");
    expect(html).toContain("Hello");
  });

  it("renders bold text", () => {
    const html = render("This is **bold** text.");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("renders italic text", () => {
    const html = render("This is *italic* text.");
    expect(html).toContain("<em>italic</em>");
  });

  it("renders links", () => {
    const html = render("[link](https://example.com)");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain(">link</a>");
  });

  it("renders code blocks", () => {
    const html = render("```\nconst x = 1;\n```");
    expect(html).toContain("<code>");
  });

  it("renders inline code", () => {
    const html = render("Use `console.log()` here.");
    expect(html).toContain("<code>console.log()</code>");
  });

  it("treats single newlines as paragraph whitespace", () => {
    const html = render("Line 1\nLine 2");
    expect(html).toContain("<p>Line 1\nLine 2</p>");
    expect(html).not.toContain("<br>");
  });

  it("renders explicit hard breaks", () => {
    const html = render("Line 1  \nLine 2");
    expect(html).toContain("<br>");
  });

  it("renders Jant image figures through the shared pipeline", () => {
    const html = render(
      '<figure data-jant-node="image" data-jant-layout="wide"><a href="https://example.com/source"><img src="https://example.com/img.png" alt="Alt text" title="Title"></a><figcaption>Caption</figcaption></figure>',
    );

    expect(html).toBe(
      '<figure data-layout="wide"><a href="https://example.com/source"><img src="https://example.com/img.png" alt="Alt text" title="Title"></a><figcaption>Caption</figcaption></figure>',
    );
  });

  it("preserves more-break comments", () => {
    const html = render("Intro\n\n<!--more-->\n\nRest");
    expect(html).toBe("<p>Intro</p><!--more--><p>Rest</p>");
  });

  it("renders semantic footnote references and definitions", () => {
    const html = render("Body copy[^1]\n\n[^1]: Footnote body");

    expect(html).toContain('role="doc-noteref"');
    expect(html).toContain('role="doc-endnotes"');
    expect(html).toContain('class="footnote-list"');
    expect(html).toContain("Footnote body");
    expect(html).toContain('role="doc-backlink"');
    expect(html.match(/<ol class="footnote-list">/g)).toHaveLength(1);
    expect(html).not.toMatch(/footnote-document|data-footnote-|--footnote-/);
  });

  it("escapes raw HTML outside the supported markdown schema", () => {
    const html = render("<script>alert(1)</script>");
    expect(html).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });

  it("returns a string", () => {
    expect(typeof render("test")).toBe("string");
  });

  it("handles empty string", () => {
    expect(render("")).toBe("");
  });
});

describe("toPlainText", () => {
  it("removes headers", () => {
    expect(toPlainText("## Hello")).toBe("Hello");
  });

  it("removes bold syntax", () => {
    expect(toPlainText("This is **bold** text")).toBe("This is bold text");
  });

  it("removes italic syntax", () => {
    expect(toPlainText("This is *italic* text")).toBe("This is italic text");
  });

  it("extracts link text, removes URLs", () => {
    expect(toPlainText("[a link](https://example.com)")).toBe("a link");
  });

  it("removes images from plain text output", () => {
    expect(toPlainText("![alt](image.png)")).toBe("");
  });

  it("removes blockquotes", () => {
    expect(toPlainText("> quoted text")).toBe("quoted text");
  });

  it("replaces newlines with spaces", () => {
    const result = toPlainText("Line 1\nLine 2\nLine 3");
    expect(result).toBe("Line 1 Line 2 Line 3");
  });

  it("handles complex markdown", () => {
    const md = "## Hello\n\nThis is **bold** and [a link](url).";
    const result = toPlainText(md);
    expect(result).toBe("Hello This is bold and a link.");
  });

  it("includes footnote definitions in plain text extraction", () => {
    expect(toPlainText("Body copy[^1]\n\n[^1]: Footnote body")).toBe(
      "Body copy Footnote body",
    );
  });

  it("handles empty string", () => {
    expect(toPlainText("")).toBe("");
  });
});

describe("extractTitle", () => {
  it("extracts first sentence", () => {
    expect(extractTitle("This is the first sentence. And another one.")).toBe(
      "This is the first sentence",
    );
  });

  it("extracts text before exclamation mark", () => {
    expect(extractTitle("Hello world! More text here.")).toBe("Hello world");
  });

  it("extracts text before question mark", () => {
    expect(extractTitle("What is this? Some answer.")).toBe("What is this");
  });

  it("truncates long text with ellipsis", () => {
    const long = "A".repeat(200);
    const result = extractTitle(long, 50);
    expect(result.length).toBe(53); // 50 + "..."
    expect(result.endsWith("...")).toBe(true);
  });

  it("returns full first sentence if under maxLength", () => {
    expect(extractTitle("Short sentence.", 120)).toBe("Short sentence");
  });

  it("uses default maxLength of 120", () => {
    const long = "A".repeat(200) + ".";
    const result = extractTitle(long);
    expect(result.length).toBe(123); // 120 + "..."
  });

  it("strips markdown before extracting", () => {
    expect(extractTitle("## Hello world. More text.")).toBe("Hello world");
  });

  it("handles empty string", () => {
    expect(extractTitle("")).toBe("");
  });
});
