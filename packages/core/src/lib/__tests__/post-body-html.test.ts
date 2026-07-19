import { describe, expect, it } from "vitest";
import {
  POST_BODY_HTML_VERSION,
  renderPostBodyHtml,
  resolvePostBodyHtml,
  tryRenderPostBodyHtml,
} from "../post-body-html.js";

const body = JSON.stringify({
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
});

describe("post body HTML projection", () => {
  it("uses the immutable post ID as the footnote namespace", () => {
    const html = renderPostBodyHtml("pst_example", body);

    expect(html).toContain('id="fn-19lnbd7xufphl-1"');
    expect(html).toContain('id="fnref-19lnbd7xufphl-1-1"');
    expect(html).not.toContain("pst_example");
  });

  it("returns current stored bytes without rendering", () => {
    expect(
      resolvePostBodyHtml({
        id: "pst_example",
        body,
        bodyHtml: "<p>already current</p>",
        bodyHtmlVersion: POST_BODY_HTML_VERSION,
      }),
    ).toBe("<p>already current</p>");
  });

  it("renders stale stored HTML to the current contract", () => {
    const html = resolvePostBodyHtml({
      id: "pst_example",
      body,
      bodyHtml: '<span class="sidenote">legacy</span>',
      bodyHtmlVersion: 1,
    });

    expect(html).toContain('role="doc-noteref"');
    expect(html).toContain('role="doc-endnotes"');
    expect(html).not.toContain("legacy");
  });

  it("re-renders the short-lived v2 layout protocol as canonical v3 HTML", () => {
    const html = resolvePostBodyHtml({
      id: "pst_example",
      body,
      bodyHtml:
        '<div class="footnote-document"><div class="footnote-main"><p>v2</p></div></div>',
      bodyHtmlVersion: 2,
    });

    expect(html).toContain(
      '<section class="footnote-endnotes" role="doc-endnotes"><ol class="footnote-list">',
    );
    expect(html).not.toMatch(/footnote-document|footnote-main|data-footnote-/);
  });

  it("falls back to stored HTML when historical canonical JSON is invalid", () => {
    expect(
      resolvePostBodyHtml({
        id: "pst_example",
        body: "not json",
        bodyHtml: "<p>legacy fallback</p>",
        bodyHtmlVersion: 1,
      }),
    ).toBe("<p>legacy fallback</p>");
  });

  it("returns null when the canonical body is null", () => {
    expect(
      resolvePostBodyHtml({
        id: "pst_example",
        body: null,
        bodyHtml: "<p>stale</p>",
        bodyHtmlVersion: 1,
      }),
    ).toBeNull();
  });

  it("strict rendering reports malformed canonical JSON", () => {
    expect(tryRenderPostBodyHtml("pst_example", "not json")).toMatchObject({
      ok: false,
    });
  });
});
