import { describe, expect, it } from "vitest";
import { enhancePostHeadings } from "../post-toc.js";

describe("enhancePostHeadings", () => {
  it("supports h1, h2, and h3 and normalizes relative depth", () => {
    const html = [
      "<h1>Overview</h1>",
      "<p>Intro</p>",
      "<h2>Details</h2>",
      "<h3>Caveats</h3>",
      "<h2>Examples</h2>",
      "<h2>Summary</h2>",
    ].join("");
    const result = enhancePostHeadings(html, {
      getAnchorLabel: (heading) => `Copy link to ${heading}`,
    });

    expect(result.showToc).toBe(true);
    expect(result.entries).toEqual([
      { id: "section-overview", label: "Overview", level: 1, depth: 0 },
      { id: "section-details", label: "Details", level: 2, depth: 1 },
      { id: "section-caveats", label: "Caveats", level: 3, depth: 2 },
      { id: "section-examples", label: "Examples", level: 2, depth: 1 },
      { id: "section-summary", label: "Summary", level: 2, depth: 1 },
    ]);
    expect(result.bodyHtml).toContain('id="section-overview"');
    expect(result.bodyHtml).toContain('data-post-heading=""');
    expect(result.bodyHtml).toContain('class="heading-anchor"');
    expect(result.bodyHtml).toContain('aria-label="Copy link to Overview"');
  });

  it("normalizes h2 + h3 posts so h2 starts at depth 0", () => {
    const html =
      "<h2>First</h2><h3>Nested</h3><h2>Second</h2><h2>Third</h2><h2>Fourth</h2>";
    const result = enhancePostHeadings(html);

    expect(result.showToc).toBe(true);
    expect(result.entries.map((entry) => entry.depth)).toEqual([0, 1, 0, 0, 0]);
  });

  it("adds heading anchors without enabling TOC when fewer than 5 headings exist", () => {
    const html =
      "<h2>One</h2><p>Body</p><h2>Two</h2><h2>Three</h2><h2>Four</h2>";
    const result = enhancePostHeadings(html);

    expect(result.showToc).toBe(false);
    expect(result.entries).toHaveLength(4);
    expect(result.bodyHtml).toContain('id="section-one"');
    expect(result.bodyHtml).toContain('data-heading-anchor=""');
  });

  it("deduplicates IDs, handles CJK, strips footnote refs, and skips headings inside blockquotes", () => {
    const html = [
      '<h2>Start &amp; <em>continue</em><sup class="footnote-ref"><a href="#fn-1">1</a></sup></h2>',
      "<h3>中文标题</h3>",
      "<h2>Start &amp; continue</h2>",
      "<h2>Next</h2>",
      "<h2>End</h2>",
      "<blockquote><h2>Quoted heading</h2></blockquote>",
    ].join("");
    const result = enhancePostHeadings(html);

    expect(result.showToc).toBe(true);
    expect(result.entries).toEqual([
      {
        id: "section-start-continue",
        label: "Start & continue",
        level: 2,
        depth: 0,
      },
      { id: "section-中文标题", label: "中文标题", level: 3, depth: 1 },
      {
        id: "section-start-continue-2",
        label: "Start & continue",
        level: 2,
        depth: 0,
      },
      { id: "section-next", label: "Next", level: 2, depth: 0 },
      { id: "section-end", label: "End", level: 2, depth: 0 },
    ]);
    expect(result.bodyHtml).not.toContain("section-quoted-heading");
  });

  it("returns input unchanged when no top-level headings exist", () => {
    const html = "<p>Just a short note.</p>";
    const result = enhancePostHeadings(html);

    expect(result.showToc).toBe(false);
    expect(result.entries).toEqual([]);
    expect(result.bodyHtml).toBe(html);
  });
});
