import { readFileSync } from "node:fs";
import type { Context } from "hono";
import { renderToString } from "hono/jsx/dom/server";
import { describe, expect, it } from "vitest";
import type { MediaView, PostView } from "../../../types.js";
import { I18nProvider } from "../../../i18n/context.js";
import { createI18n } from "../../../i18n/i18n.js";
import { NoteCard } from "../NoteCard.js";
import { LinkCard } from "../LinkCard.js";
import { QuoteCard } from "../QuoteCard.js";

function createMediaView(overrides: Partial<MediaView> = {}): MediaView {
  return {
    id: "media-1",
    url: "/media/full.jpg",
    thumbnailUrl: "/media/thumb.jpg",
    mimeType: "image/jpeg",
    ...overrides,
  };
}

function createPostView(overrides: Partial<PostView> = {}): PostView {
  return {
    id: "post-1",
    permalink: "/post-1",
    slug: "post-1",
    title: "Card title",
    bodyHtml: "<p>Summary</p>",
    quoteText: "Quoted text",
    url: "https://example.com/article",
    format: "note",
    status: "published",
    visibility: "public",
    pinned: false,
    featured: false,
    publishedAt: "2026-03-19T00:00:00.000Z",
    publishedAtFormatted: "Mar 19, 2026",
    publishedAtTime: "00:00",
    publishedAtRelative: "now",
    updatedAt: "2026-03-19T00:00:00.000Z",
    media: [createMediaView()],
    collections: [],
    isLastInThread: true,
    ...overrides,
  };
}

function renderWithI18n(
  html:
    | ReturnType<typeof NoteCard>
    | ReturnType<typeof LinkCard>
    | ReturnType<typeof QuoteCard>,
) {
  const i18n = createI18n("en");
  const c = {
    get(key: string) {
      if (key === "i18n") return i18n;
      return undefined;
    },
  } as unknown as Context;

  I18nProvider({ c, children: "" });
  return renderToString(html);
}

describe("timeline cards", () => {
  it("renders link attachments in feed and detail modes", () => {
    const post = createPostView({ format: "link" });

    const feedHtml = renderWithI18n(LinkCard({ post, mode: "feed" }));
    const detailHtml = renderWithI18n(LinkCard({ post, mode: "detail" }));

    expect(feedHtml).toContain("data-post-media");
    expect(feedHtml).toContain('href="/media/full.jpg"');
    expect(detailHtml).toContain("data-post-media");
    expect(detailHtml).toContain('href="/media/full.jpg"');
  });

  it("renders link reference before body and without a card wrapper", () => {
    const post = createPostView({ format: "link" });

    const feedHtml = renderWithI18n(LinkCard({ post, mode: "feed" }));
    const detailHtml = renderWithI18n(LinkCard({ post, mode: "detail" }));

    // No card wrapper in feed mode
    expect(feedHtml).not.toContain("feed-card");
    // Link title comes before body (commentary)
    expect(feedHtml.indexOf("feed-link-title")).toBeLessThan(
      feedHtml.indexOf("data-post-body"),
    );
    expect(detailHtml).not.toContain("feed-card");
  });

  it("marks a link post's referenced article as u-bookmark-of, never as the entry's own u-url", () => {
    const post = createPostView({ format: "link" });

    const feedHtml = renderWithI18n(LinkCard({ post, mode: "feed" }));
    const compactHtml = renderWithI18n(LinkCard({ post, mode: "compact" }));
    const detailHtml = renderWithI18n(LinkCard({ post, mode: "detail" }));

    for (const html of [feedHtml, compactHtml, detailHtml]) {
      expect(html).toContain(
        '<a href="https://example.com/article" class="u-bookmark-of feed-link-title-link"',
      );
    }

    // The entry's own URL is the permalink, and it is emitted exactly once —
    // a second `u-url` on the referenced article would make parsers read that
    // article as this post.
    expect(feedHtml.match(/u-url/g)).toHaveLength(1);
    expect(detailHtml.match(/u-url/g)).toHaveLength(1);
    expect(feedHtml).toContain('class="u-url post-footer-link"');
    expect(detailHtml).toContain('class="u-url post-footer-link"');
  });

  it("omits u-bookmark-of when a link post has no referenced article", () => {
    const post = createPostView({ format: "link", url: undefined });

    const feedHtml = renderWithI18n(LinkCard({ post, mode: "feed" }));
    const detailHtml = renderWithI18n(LinkCard({ post, mode: "detail" }));

    // The title falls back to the permalink; a post does not bookmark itself.
    for (const html of [feedHtml, detailHtml]) {
      expect(html).toContain('<a href="/post-1" class="feed-link-title-link"');
      expect(html).not.toContain("u-bookmark-of");
      expect(html.match(/u-url/g)).toHaveLength(1);
    }
  });

  it("scopes a quote post's citation to an h-cite and keeps e-content on the commentary", () => {
    const post = createPostView({ format: "quote" });

    const feedHtml = renderWithI18n(QuoteCard({ post, mode: "feed" }));
    const detailHtml = renderWithI18n(QuoteCard({ post, mode: "detail" }));

    for (const html of [feedHtml, detailHtml]) {
      expect(html).toContain('<figure class="feed-quote-cite h-cite">');
      // The quotation is the citation's content, not the entry's.
      expect(html).toContain('class="p-content feed-quote-content');
      expect(html).not.toContain("e-content feed-quote-content");
      expect(html).toContain('class="e-content feed-quote-commentary prose');

      // Source URL and attribution belong to the cited work, so they have to
      // sit inside the h-cite — outside it they would land on the h-entry.
      const cite = html.slice(
        html.indexOf('<figure class="feed-quote-cite h-cite">'),
        html.indexOf("</figure>"),
      );
      expect(cite).toContain(
        '<a href="https://example.com/article" class="u-url p-name feed-quote-source"',
      );
      expect(cite).toContain('<figcaption class="feed-quote-attribution">');
    }
  });

  it("keeps a quote attribution without a source link addressable as p-name", () => {
    const post = createPostView({ format: "quote", url: undefined });

    const feedHtml = renderWithI18n(QuoteCard({ post, mode: "feed" }));

    expect(feedHtml).toContain('<span class="p-name">Card title</span>');
    expect(feedHtml.match(/u-url/g)).toHaveLength(1);
  });

  it("leaves note card microformats untouched", () => {
    const post = createPostView({ format: "note" });

    const feedHtml = renderWithI18n(NoteCard({ post, mode: "feed" }));
    const detailHtml = renderWithI18n(NoteCard({ post, mode: "detail" }));

    expect(feedHtml).toContain('<h2 class="p-name feed-note-title">');
    expect(feedHtml).toContain('<a href="/post-1" class="hover:underline"');
    expect(feedHtml).toContain('class="e-content prose');
    expect(feedHtml).not.toContain("u-bookmark-of");
    expect(feedHtml).not.toContain("h-cite");

    expect(detailHtml).toContain('<h1 class="p-name post-detail-title">');
    expect(detailHtml).toContain('class="u-url post-header-meta-link"');
    expect(detailHtml).toContain('class="e-content prose post-detail-body"');
    expect(detailHtml).not.toContain("u-bookmark-of");
    expect(detailHtml).not.toContain("h-cite");
  });

  it("gives every card exactly one u-url, pointing at its permalink", () => {
    // A titled note's heading used to link the permalink as a second `u-url`.
    // Same value as the footer's, so no parser read the wrong post — but the
    // entry's URL is one fact, and the footer is where all three cards state it.
    const cards = [
      NoteCard({ post: createPostView({ format: "note" }), mode: "feed" }),
      NoteCard({ post: createPostView({ format: "note" }), mode: "detail" }),
      NoteCard({
        post: createPostView({ format: "note", title: undefined }),
        mode: "feed",
      }),
      LinkCard({ post: createPostView({ format: "link" }), mode: "feed" }),
      LinkCard({ post: createPostView({ format: "link" }), mode: "detail" }),
      QuoteCard({ post: createPostView({ format: "quote" }), mode: "feed" }),
      QuoteCard({ post: createPostView({ format: "quote" }), mode: "detail" }),
    ];

    for (const card of cards) {
      // A quote's source link is a `u-url` too, but it belongs to the nested
      // h-cite. Drop the citation before counting what the entry claims.
      const entry = renderWithI18n(card).replace(
        /<figure class="feed-quote-cite h-cite">[\s\S]*?<\/figure>/,
        "",
      );
      expect(entry.match(/u-url/g)).toHaveLength(1);
      expect(entry).toMatch(/<a href="\/post-1" class="u-url /);
    }
  });

  it("states empty content outright when a card has no name and nothing to say", () => {
    // The status badges are always in the DOM and hidden with CSS, which a
    // microformats parser does not run. With no `p-name` and no `e-content` to
    // go on, it names the entry after whatever text it finds — the badge
    // labels. An explicit empty `e-content` says what is true and stops that.
    const empty = { title: undefined, bodyHtml: undefined, media: [] };

    for (const mode of ["feed", "detail", "compact"] as const) {
      const cards = {
        note: NoteCard({
          post: createPostView({ format: "note", ...empty }),
          mode,
        }),
        link: LinkCard({
          post: createPostView({ format: "link", ...empty }),
          mode,
        }),
        quote: QuoteCard({
          post: createPostView({
            format: "quote",
            ...empty,
            quoteText: undefined,
            url: undefined,
          }),
          mode,
        }),
      };
      for (const [format, card] of Object.entries(cards)) {
        const html = renderWithI18n(card);
        expect(`${format}/${mode}: ${html}`).toContain(
          '<div class="e-content"></div>',
        );
      }
    }
  });

  it("keeps stray h-* utilities out of post markup", () => {
    // A microformats2 parser reads every `h-`-prefixed class as a microformat
    // root, so a Tailwind height utility inside a card becomes a phantom child
    // microformat on the entry. Only real roots may appear.
    const withMedia = createPostView({
      format: "note",
      media: [createMediaView(), createMediaView({ id: "media-2" })],
    });
    const cards = {
      "note with one image": NoteCard({
        post: { ...withMedia, media: [createMediaView()] },
        mode: "feed",
      }),
      "note with a gallery": NoteCard({ post: withMedia, mode: "feed" }),
      "link post": LinkCard({
        post: createPostView({ format: "link" }),
        mode: "detail",
      }),
      "quote post": QuoteCard({
        post: createPostView({ format: "quote" }),
        mode: "feed",
      }),
    };

    for (const [label, card] of Object.entries(cards)) {
      const html = renderWithI18n(card);
      const roots = [...html.matchAll(/class="([^"]*)"/g)]
        .flatMap((m) => m[1].split(/\s+/))
        .filter((c) => /^h-/.test(c));
      const unexpected = roots.filter((c) => c !== "h-entry" && c !== "h-cite");
      expect(`${label}: ${unexpected.join(", ")}`).toBe(`${label}: `);
    }
  });

  it("omits the empty content marker when the card carries a name or content", () => {
    const cards = {
      "titled note": NoteCard({
        post: createPostView({ format: "note", bodyHtml: undefined }),
        mode: "feed",
      }),
      "untitled note with a body": NoteCard({
        post: createPostView({ format: "note", title: undefined }),
        mode: "feed",
      }),
      "titled link": LinkCard({
        post: createPostView({ format: "link", bodyHtml: undefined }),
        mode: "feed",
      }),
      // A quotation is a nested h-cite, which is enough on its own.
      "quote without commentary": QuoteCard({
        post: createPostView({ format: "quote", bodyHtml: undefined }),
        mode: "feed",
      }),
    };

    for (const [label, card] of Object.entries(cards)) {
      const html = renderWithI18n(card);
      expect(`${label}: ${html}`).not.toContain(
        '<div class="e-content"></div>',
      );
    }
  });

  it("styles post titles by their own classes, never by their microformats class", () => {
    const css = readFileSync(
      new URL("../../../styles/ui.css", import.meta.url),
      "utf8",
    );

    // `.p-name` is parsed API; styling it would silently retypeset any element
    // that later needs the property — the quote attribution, for one.
    expect(css).not.toMatch(/^\s*\.p-name\s*\{/m);
    expect(css).toMatch(
      /\.post-detail-title,\s*\.feed-compact-title\s*\{[^}]*font-family:\s*var\(--font-heading\);/,
    );
    // Compact note titles have no other class carrying the heading face.
    const compactHtml = renderWithI18n(
      NoteCard({ post: createPostView({ format: "note" }), mode: "compact" }),
    );
    expect(compactHtml).toContain("feed-compact-title");
  });

  it("keeps embedded quotes on the host panel's type scale", () => {
    const css = readFileSync(
      new URL("../../../styles/ui.css", import.meta.url),
      "utf8",
    );

    // The quote body dropped `.e-content`, which is how this rule used to
    // reach it; without the explicit class it would out-size the panel.
    expect(css).toMatch(
      /\.compose-reply-context-body\s*:is\(\s*\.prose,\s*\.e-content,\s*\.feed-quote,\s*\.feed-quote-content\s*\)\s*\{[^}]*font-size:\s*inherit;/,
    );
  });

  it("renders quote attachments in feed and detail modes", () => {
    const post = createPostView({ format: "quote" });

    const feedHtml = renderWithI18n(QuoteCard({ post, mode: "feed" }));
    const detailHtml = renderWithI18n(QuoteCard({ post, mode: "detail" }));

    expect(feedHtml).toContain("data-post-media");
    expect(feedHtml).toContain('href="/media/full.jpg"');
    expect(detailHtml).toContain("data-post-media");
    expect(detailHtml).toContain('href="/media/full.jpg"');
  });

  it("preserves authored line breaks in quote cards", () => {
    const tokens = readFileSync(
      new URL("../../../styles/tokens.css", import.meta.url),
      "utf8",
    );
    const css = readFileSync(
      new URL("../../../styles/ui.css", import.meta.url),
      "utf8",
    );
    const exportCss = readFileSync(
      new URL(
        "../../../services/export-theme/styles/main.css",
        import.meta.url,
      ),
      "utf8",
    );

    expect(tokens).toMatch(
      /--feed-note-title-size:\s*calc\(var\(--type-content-body\) \* 1\.36\);/,
    );
    expect(tokens).toMatch(
      /--type-content-quote:\s*calc\(var\(--type-content-body\) \* 1\.16\);/,
    );
    expect(tokens).toMatch(/--type-content-quote-leading:\s*1\.4;/);
    expect(css).toMatch(
      /\.feed-note-title\s*\{[\s\S]*font-size:\s*var\(--feed-note-title-size\);/,
    );
    expect(css).toMatch(
      /\.feed-link-title\s*\{[\s\S]*font-size:\s*var\(--feed-note-title-size\);/,
    );
    expect(exportCss).toMatch(
      /\.post-card-title\s*\{[\s\S]*font-size:\s*var\(--feed-note-title-size\);/,
    );
    expect(css).toMatch(
      /\.feed-quote-content\s*\{[\s\S]*font-size:\s*var\(--type-content-quote\);[\s\S]*line-height:\s*var\(--type-content-quote-leading\);[\s\S]*white-space:\s*pre-line;/,
    );
    expect(exportCss).toMatch(
      /\.post-card-quote-content\s*\{[\s\S]*font-size:\s*var\(--type-content-quote\);[\s\S]*line-height:\s*var\(--type-content-quote-leading\);[\s\S]*white-space:\s*pre-line;/,
    );
  });

  it("resets default prose quote marks for editorial blockquotes", () => {
    const css = readFileSync(
      new URL("../../../preset.css", import.meta.url),
      "utf8",
    );

    expect(css).toMatch(
      /blockquote\s*:where\(p:first-of-type\)::before,\s*[\s\S]*blockquote\s*:where\(p:last-of-type\)::after\s*\{[\s\S]*content:\s*none;/,
    );
  });

  it("keeps feed summary prose overrides outside component layers", () => {
    const css = readFileSync(
      new URL("../../../preset.css", import.meta.url),
      "utf8",
    );

    expect(css).toContain("[data-post-body].prose");
    expect(css).toContain(".prose > :last-child");
    expect(css).toContain("margin-bottom: 0;");
  });

  it("aligns list rhythm across published and ordinary compose prose", () => {
    const presetCss = readFileSync(
      new URL("../../../preset.css", import.meta.url),
      "utf8",
    );
    const uiCss = readFileSync(
      new URL("../../../styles/ui.css", import.meta.url),
      "utf8",
    );
    const exportCss = readFileSync(
      new URL(
        "../../../services/export-theme/styles/main.css",
        import.meta.url,
      ),
      "utf8",
    );

    expect(presetCss).toMatch(
      /:where\(ul,\s*ol\)\s*\{[\s\S]*padding-left:\s*1\.4em;/,
    );
    expect(exportCss).toMatch(
      /ul,\s*[\s\S]*ol\s*\{[\s\S]*padding-left:\s*1\.4em;/,
    );
    expect(presetCss).toMatch(
      /:where\(li,\s*dt\)\s*\{[\s\S]*margin-top:\s*0\.5em;[\s\S]*margin-bottom:\s*0\.5em;/,
    );
    expect(exportCss).toMatch(
      /li\s*\{[\s\S]*margin-top:\s*0\.5em;[\s\S]*margin-bottom:\s*0\.5em;/,
    );
    expect(uiCss).toMatch(
      /\.compose-tiptap-body\s+\.tiptap\s+ul\s*\{[^}]*padding-left:\s*1\.4em;[^}]*margin:\s*1\.25em 0;/,
    );
    expect(uiCss).toMatch(
      /\.compose-tiptap-body\s+\.tiptap\s+ol\s*\{[^}]*padding-left:\s*2\.25em;[^}]*margin:\s*1\.25em 0;/,
    );
    expect(uiCss).toMatch(
      /\.compose-tiptap-body\s+\.tiptap\s+:is\(ul, ol\)\s+:is\(ul, ol\)\s*\{[^}]*padding-left:\s*1\.5em;[^}]*margin:\s*0\.4em 0;/,
    );
    expect(uiCss).toMatch(
      /\.compose-tiptap-body\s+\.tiptap\s+ul ul\s*\{[^}]*list-style-type:\s*circle;/,
    );
    expect(uiCss).toMatch(
      /\.compose-tiptap-body\s+\.tiptap\s+ul ul ul\s*\{[^}]*list-style-type:\s*square;/,
    );
    expect(uiCss).toMatch(
      /\.compose-tiptap-body\s+\.tiptap\s+ol ol\s*\{[^}]*list-style-type:\s*lower-alpha;/,
    );
    expect(uiCss).toMatch(
      /\.compose-tiptap-body\s+\.tiptap\s+ol ol ol\s*\{[^}]*list-style-type:\s*lower-roman;/,
    );
    expect(uiCss).toMatch(
      /\.compose-tiptap-body\s+\.tiptap\s+li\s*\{[^}]*margin:\s*0\.5em 0;/,
    );
    expect(uiCss).toContain(".compose-tiptap-body .tiptap li > p:first-child");
    expect(uiCss).toContain(
      ".compose-tiptap-body .tiptap li > p:has(+ :is(ul, ol))",
    );
    expect(uiCss).toMatch(
      /p:has\(\+ \.ProseMirror-gapcursor \+ :is\(ul, ol\)\)\s*\{[^}]*margin-bottom:\s*0;/,
    );
    expect(uiCss).toMatch(
      /\.compose-reply-compose-layout\s+\.compose-tiptap-body\s+\.tiptap\s+li\s*\{[^}]*margin:\s*0\.15em 0;/,
    );
    expect(uiCss).toMatch(
      /\.compose-reply-compose-layout\s+\.compose-tiptap-body\s+\.tiptap\s+ol\s*\{[^}]*padding-left:\s*2\.25em;[^}]*margin:\s*0\.25em 0;/,
    );
    expect(uiCss).toMatch(
      /\.compose-reply-compose-layout\s+\.compose-tiptap-body\s+\.tiptap\s+:is\(ul, ol\)\s+:is\(ul, ol\)\s*\{[^}]*padding-left:\s*1\.5em;[^}]*margin:\s*0\.2em 0;/,
    );
    expect(presetCss).toMatch(
      /:where\(ol ol\)\s*\{[^}]*list-style-type:\s*lower-alpha;[^}]*margin-top:\s*0\.4em;[^}]*margin-bottom:\s*0\.4em;/,
    );
    expect(presetCss).toMatch(
      /:where\(ol ol ol\)\s*\{[^}]*list-style-type:\s*lower-roman;/,
    );
    expect(exportCss).toMatch(
      /ol ol\s*\{[^}]*list-style-type:\s*lower-alpha;[^}]*margin-top:\s*0\.4em;[^}]*margin-bottom:\s*0\.4em;/,
    );
    expect(exportCss).toMatch(
      /ol ol ol\s*\{[^}]*list-style-type:\s*lower-roman;/,
    );
    expect(presetCss).toMatch(
      /:where\(li > p:has\(\+ ol\)\)\s*\{[^}]*margin-bottom:\s*0;/,
    );
    expect(exportCss).toMatch(
      /li > p:has\(\+ ol\)\s*\{[^}]*margin-bottom:\s*0;/,
    );
  });

  it("uses dedicated markdown code surfaces in live and exported prose", () => {
    const presetCss = readFileSync(
      new URL("../../../preset.css", import.meta.url),
      "utf8",
    );
    const tokenCss = readFileSync(
      new URL("../../../styles/tokens.css", import.meta.url),
      "utf8",
    );
    const exportCss = readFileSync(
      new URL(
        "../../../services/export-theme/styles/main.css",
        import.meta.url,
      ),
      "utf8",
    );

    expect(tokenCss).toContain("--site-code-bg:");
    expect(tokenCss).toContain("--site-code-block-bg:");
    expect(tokenCss).toContain(
      "--type-code: calc(var(--type-body-size) * 0.94);",
    );
    expect(tokenCss).toContain(
      "--type-code-block: calc(var(--type-body-size) * 0.9);",
    );
    expect(presetCss).toContain("background-color: var(--site-code-bg);");
    expect(presetCss).toContain("background-color: var(--site-code-block-bg);");
    expect(exportCss).toContain("background-color: var(--site-code-bg);");
    expect(exportCss).toContain("background-color: var(--site-code-block-bg);");
  });

  it("keeps markdown h2 and h3 headings upright across surfaces", () => {
    const presetCss = readFileSync(
      new URL("../../../preset.css", import.meta.url),
      "utf8",
    );
    const uiCss = readFileSync(
      new URL("../../../styles/ui.css", import.meta.url),
      "utf8",
    );
    const exportCss = readFileSync(
      new URL(
        "../../../services/export-theme/styles/main.css",
        import.meta.url,
      ),
      "utf8",
    );

    expect(presetCss).not.toMatch(
      /:where\(h[23]\)\s*\{[^}]*font-style:\s*italic;/,
    );
    expect(uiCss).not.toMatch(
      /\.compose-tiptap-body\s+\.tiptap\s+h[23]\s*\{[^}]*font-style:\s*italic;/,
    );
    expect(exportCss).not.toMatch(/h[23]\s*\{[^}]*font-style:\s*italic;/);
  });

  it("compacts authored headings inside feed body prose", () => {
    const presetCss = readFileSync(
      new URL("../../../preset.css", import.meta.url),
      "utf8",
    );
    const exportCss = readFileSync(
      new URL(
        "../../../services/export-theme/styles/main.css",
        import.meta.url,
      ),
      "utf8",
    );

    expect(presetCss).toContain(
      '[data-post]:not([data-page="post"]) [data-post-body].prose',
    );
    expect(presetCss).toMatch(
      /:where\(h1,\s*h2\)\s*\{[\s\S]*font-size:\s*calc\(var\(--type-content-body\) \* 1\.12\);/,
    );
    expect(presetCss).toMatch(
      /:where\(h3,\s*h4\)\s*\{[\s\S]*font-size:\s*var\(--type-content-body\);/,
    );
    expect(presetCss).toMatch(
      /:where\(h5,\s*h6\)\s*\{[\s\S]*font-size:\s*var\(--type-secondary\);/,
    );
    expect(exportCss).toMatch(
      /\.post-card > \.post-card-summary :is\(h1,\s*h2\),/,
    );
    expect(exportCss).toMatch(
      /\.post-card > \.post-card-summary :is\(h5,\s*h6\),/,
    );
  });

  it("keeps quote footers on the shared card spacing baseline", () => {
    const css = readFileSync(
      new URL("../../../styles/ui.css", import.meta.url),
      "utf8",
    );

    expect(css).toContain(".feed-quote-post [data-post-meta] {");
    expect(css).not.toContain(
      ".feed-quote-post [data-post-meta] {\n    margin-top: 0.9rem;",
    );
  });

  it("uses inset-note styling for compose editor blockquotes", () => {
    const css = readFileSync(
      new URL("../../../styles/ui.css", import.meta.url),
      "utf8",
    );

    expect(css).toMatch(
      /\.compose-tiptap-body\s+\.tiptap\s+blockquote\s*\{[\s\S]*background:\s*linear-gradient\(/,
    );
    expect(css).toMatch(
      /\.compose-tiptap-body\s+\.tiptap\s+blockquote:focus-within\s*\{/,
    );
    expect(css).toMatch(
      /\.compose-tiptap-body\s+\.tiptap\s+blockquote\s*\{[^}]*margin:\s*1\.4rem 0;[^}]*padding:\s*1\.4rem 1rem 0\.75rem;/,
    );
    expect(css).toMatch(
      /\.compose-reply-compose-layout\s+\.compose-tiptap-body\s+\.tiptap\s+blockquote\s*\{[^}]*margin:\s*0\.72em 0;/,
    );
  });

  it("keeps quote compose aligned with quote-card typography", () => {
    const css = readFileSync(
      new URL("../../../styles/ui.css", import.meta.url),
      "utf8",
    );

    expect(css).toMatch(
      /\.compose-quote-wrap\s*\{[\s\S]*background-color:\s*color-mix\(/,
    );
    expect(css).toMatch(
      /\.compose-quote-text\s*\{[\s\S]*font-family:\s*var\(--font-serif\);/,
    );
    expect(css).toContain(".compose-divider-quote");
  });

  it("keeps reply context previews on thread-context type tokens", () => {
    const uiCss = readFileSync(
      new URL("../../../styles/ui.css", import.meta.url),
      "utf8",
    );
    const tokenCss = readFileSync(
      new URL("../../../styles/tokens.css", import.meta.url),
      "utf8",
    );

    expect(tokenCss).toContain("--type-thread-context: var(--type-base);");
    expect(tokenCss).toContain(
      "--type-thread-context-title: var(--type-secondary);",
    );
    expect(tokenCss).toContain("--type-thread-context-meta: var(--type-sm);");
    expect(uiCss).toMatch(
      /\.compose-reply-context-body\s*\{[\s\S]*font-size:\s*var\(--type-thread-context\);/,
    );
    expect(uiCss).toMatch(
      /\.compose-reply-meta\s*\{[\s\S]*font-size:\s*var\(--type-thread-context-meta\);/,
    );
  });

  it("resets cloned reply previews away from feed/detail width constraints", () => {
    const uiCss = readFileSync(
      new URL("../../../styles/ui.css", import.meta.url),
      "utf8",
    );
    const unlayeredCssStart = uiCss.indexOf(" * Home description");
    const resetRule = uiCss.match(
      /\.compose-reply-context-body\s*:is\([^{}]*\[data-post-body\]\.prose[^{}]*\)\s*\{[^{}]*width:\s*100%;[^{}]*max-width:\s*none;[^{}]*\}/,
    );

    expect(unlayeredCssStart).toBeGreaterThan(0);
    expect(resetRule?.index).toBeGreaterThan(unlayeredCssStart);
    expect(resetRule?.[0]).toContain("width: 100%;");
    expect(resetRule?.[0]).toContain("max-width: none;");
  });

  it("keeps link and quote attachments hidden in compact mode", () => {
    const linkPost = createPostView({ format: "link" });
    const quotePost = createPostView({ format: "quote" });

    const linkHtml = renderWithI18n(
      LinkCard({ post: linkPost, mode: "compact" }),
    );
    const quoteHtml = renderWithI18n(
      QuoteCard({ post: quotePost, mode: "compact" }),
    );

    expect(linkHtml).not.toContain("data-post-media");
    expect(quoteHtml).not.toContain("data-post-media");
  });

  it("keeps rated note feed cards bottom-weighted while moving detail ratings under the title", () => {
    const post = createPostView({
      format: "note",
      rating: 4,
      summaryHtml: "<p>Summary</p>",
    });

    const feedHtml = renderWithI18n(NoteCard({ post, mode: "feed" }));
    const detailHtml = renderWithI18n(NoteCard({ post, mode: "detail" }));

    expect(feedHtml.indexOf("data-post-body")).toBeLessThan(
      feedHtml.indexOf('class="post-rating"'),
    );
    expect(detailHtml).toContain(
      'class="post-header-block post-header-block-detail"',
    );
    expect(detailHtml.indexOf('class="post-rating"')).toBeLessThan(
      detailHtml.indexOf("data-post-body"),
    );
  });

  it("moves titled note detail timestamps into the header while keeping footer actions", () => {
    const post = createPostView({
      format: "note",
      rating: 4,
      summaryHtml: "<p>Summary</p>",
    });

    const detailHtml = renderWithI18n(NoteCard({ post, mode: "detail" }));

    expect(detailHtml).toContain('class="post-header-meta-row"');
    expect(detailHtml).toContain('class="u-url post-header-meta-link"');
    expect(detailHtml.match(/class="dt-published"/g)).toHaveLength(1);
    expect(detailHtml).toContain("data-reply-trigger");
    expect(detailHtml.match(/data-post-menu-trigger/g)).toHaveLength(1);
    expect(detailHtml.indexOf('class="post-header-meta-row"')).toBeLessThan(
      detailHtml.indexOf("data-post-body"),
    );
  });

  it("keeps titled detail headers spaced as one reading group", () => {
    const css = readFileSync(
      new URL("../../../styles/ui.css", import.meta.url),
      "utf8",
    );

    expect(css).toMatch(
      /\.post-header-block\s*\{[\s\S]*margin-bottom:\s*1\.7rem;/,
    );
    expect(css).toMatch(
      /\.post-header-block-detail\s*\{[\s\S]*gap:\s*0\.7rem;/,
    );
  });

  it("keeps detail dates quiet while preserving standalone footer spacing", () => {
    const css = readFileSync(
      new URL("../../../styles/ui.css", import.meta.url),
      "utf8",
    );

    expect(css).toMatch(
      /\.post-header-meta-link\s*\{[^}]*font-size:\s*var\(--type-ui-hint\);/,
    );
    expect(css).toMatch(
      /\.post-footer-detail\s*\{[^}]*margin-top:\s*24px;[^}]*font-size:\s*var\(--type-ui-hint\);[^}]*color:\s*var\(--site-text-secondary\);/,
    );
    expect(css).toMatch(
      /\.thread-group-detail \.post-footer-detail\s*\{[^}]*margin-top:\s*var\(--content-gap\);/,
    );
  });

  it("adds breathing room when a quote source leads directly into its footer", () => {
    const css = readFileSync(
      new URL("../../../styles/ui.css", import.meta.url),
      "utf8",
    );

    expect(css).toMatch(
      /\.feed-quote-cite:has\(\+ \.post-menu-footer\) \.feed-quote-attribution\s*\{[^}]*margin-bottom:\s*0\.45rem;/,
    );
  });

  it("renders titled note feed summaries as secondary prose without shrinking detail reading", () => {
    const post = createPostView({
      format: "note",
      summaryHtml: "<p>Summary</p>",
    });

    const feedHtml = renderWithI18n(NoteCard({ post, mode: "feed" }));
    const detailHtml = renderWithI18n(NoteCard({ post, mode: "detail" }));

    expect(feedHtml).toContain('class="e-content prose post-body-summary"');
    expect(detailHtml).toContain('class="e-content prose post-detail-body"');
  });

  it("progressively enhances canonical endnotes on wide detail and timeline posts", () => {
    const css = readFileSync(
      new URL("../../../styles/ui.css", import.meta.url),
      "utf8",
    );
    const tokens = readFileSync(
      new URL("../../../styles/tokens.css", import.meta.url),
      "utf8",
    );

    expect(css).toMatch(
      /\[data-post-view\],\s*\[data-timeline-item\]\s*\{[^}]*container:\s*post-view\s*\/\s*inline-size;/,
    );
    expect(css).toContain(
      "[data-timeline-item] article[data-post] > [data-post-body].prose",
    );
    expect(css).toContain("@container post-view (min-width: 56rem)");
    expect(css).toContain("--jant-footnote-rail-enabled: 1");
    expect(css).toContain(".footnote-rail-measuring");
    expect(css).toContain(".footnote-rail-ready");
    expect(css).toContain("--footnote-rail-y");
    expect(css).toContain("--footnote-rail-number");
    expect(css).toContain("--footnote-rail-block-size");
    expect(css).toMatch(
      /> \.footnote-endnotes\s*\{[^}]*position:\s*absolute;[^}]*inset-inline-start:\s*calc\(100% \+ var\(--layout-sidenote-gap\)\);[^}]*width:\s*var\(--layout-sidenote-width\);/,
    );
    expect(css).toMatch(
      /> \.footnote-list\s*> \.footnote\s*\{[^}]*display:\s*grid;[^}]*column-gap:\s*1ch;[^}]*align-items:\s*baseline;[^}]*list-style:\s*none;/,
    );
    expect(css).toMatch(
      /> \.footnote::before\s*\{[^}]*content:\s*var\(--footnote-rail-number\);[^}]*font-size:\s*inherit;[^}]*line-height:\s*inherit;[^}]*color:\s*var\(--site-footnote-marker\);/,
    );
    expect(css).toMatch(
      /\.footnote-rail-ready[\s\S]*> \.footnote-list[\s\S]*> \.footnote\s*\{[^}]*position:\s*absolute;[^}]*inset-block-start:\s*var\(--footnote-rail-y\);/,
    );
    expect(css).toMatch(
      /\.footnote-rail-ready[\s\S]*\.footnote:target\s*\{[^}]*background:\s*transparent;/,
    );
    expect(css).toMatch(
      /\.footnote-rail-ready[\s\S]*\.footnote-backlinks\s*\{[^}]*position:\s*absolute;[^}]*clip-path:\s*inset\(50%\);/,
    );
    expect(css).toMatch(
      /\.footnote-rail-ready[\s\S]*\.footnote-backlinks:focus-within\s*\{[^}]*position:\s*static;[^}]*clip-path:\s*none;/,
    );
    expect(css).toMatch(
      /\.footnote-ref\s*\{[^}]*--site-prose-link-color:\s*var\(--site-footnote-marker\);[^}]*--site-prose-link-underline:\s*transparent;[^}]*margin-inline:\s*0\.25rem;[^}]*vertical-align:\s*super;[^}]*font-size:\s*var\(--type-footnote-ref\);[^}]*color:\s*var\(--site-footnote-marker\);/,
    );
    expect(tokens).toContain(
      "--type-footnote-ref: calc(var(--type-body-size) * 0.75)",
    );
    expect(css).toContain("@media print");
    expect(css).not.toContain("@supports (grid-template-rows: subgrid)");
    expect(css).not.toContain(".footnote-document");
    expect(css).not.toContain(".footnote-main");
    expect(css).not.toContain(".footnote-body");
  });

  it("can render full article bodies inside feed contexts without permalink anchors", () => {
    const post = createPostView({
      format: "note",
      bodyHtml: '<p>Intro</p><span id="continue"></span><p>Rest</p>',
      summaryHtml: "<p>Intro</p>",
      summaryHasMore: true,
    });

    const feedHtml = renderWithI18n(
      NoteCard({
        post,
        mode: "feed",
        display: { showFullBody: true },
      }),
    );

    expect(feedHtml).toContain("<p>Rest</p>");
    expect(feedHtml).toContain('class="e-content prose post-detail-body"');
    expect(feedHtml).not.toContain('id="continue"');
    expect(feedHtml).not.toContain("feed-continue-link");
  });

  it("article continue links point to the post permalink without hash", () => {
    const post = createPostView({
      format: "note",
      summaryHtml: "<p>Intro</p>",
      summaryHasMore: true,
    });

    const html = renderWithI18n(NoteCard({ post, mode: "feed" }));

    expect(html).toContain('href="/post-1"');
    expect(html).not.toContain("#continue");
    // Titled articles link out; they do not expand in place.
    expect(html).not.toContain("data-note-expand");
  });

  it("clamps the body and renders an expand control for truncated untitled notes", () => {
    const post = createPostView({
      format: "note",
      title: undefined,
      bodyHtml: "<p>Intro</p><span data-note-break></span><p>Rest</p>",
      summaryHasMore: true,
    });

    const html = renderWithI18n(NoteCard({ post, mode: "feed" }));

    expect(html).toContain("data-note-expand");
    expect(html).toContain('href="/post-1"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('data-label-more="Read more"');
    expect(html).toContain('data-label-less="Read less"');
    // The full body is rendered (the marker + CSS clamp hide the tail), and the
    // body carries the clamp flag.
    expect(html).toContain("data-note-clamp");
    expect(html).toContain("data-note-break");
    expect(html).toContain("<p>Intro</p>");
    expect(html).toContain("<p>Rest</p>");
  });

  it("renders read more before text attachments on truncated notes", () => {
    const post = createPostView({
      format: "note",
      title: undefined,
      bodyHtml: "<p>Intro</p><span data-note-break></span><p>Rest</p>",
      summaryHasMore: true,
      media: [
        createMediaView({
          url: "/attachments/notes.txt",
          thumbnailUrl: undefined,
          mimeType: "text/plain",
        }),
      ],
    });

    const html = renderWithI18n(NoteCard({ post, mode: "feed" }));

    expect(html.indexOf("data-note-expand")).toBeLessThan(
      html.indexOf("data-post-media"),
    );
  });

  it("renders untitled notes in full without a control when not truncated", () => {
    const post = createPostView({
      format: "note",
      title: undefined,
      bodyHtml: "<p>Whole note</p>",
      summaryHasMore: undefined,
    });

    const html = renderWithI18n(NoteCard({ post, mode: "feed" }));

    expect(html).toContain("<p>Whole note</p>");
    expect(html).not.toContain("data-note-expand");
    expect(html).not.toContain("data-note-clamp");
    expect(html).not.toContain("feed-continue-link");
  });

  it("shows the full untitled note body without clamping on the detail page", () => {
    const post = createPostView({
      format: "note",
      title: undefined,
      bodyHtml: "<p>Intro</p><span data-note-break></span><p>Rest</p>",
      summaryHasMore: true,
    });

    const html = renderWithI18n(NoteCard({ post, mode: "detail" }));

    expect(html).toContain("<p>Rest</p>");
    expect(html).not.toContain("data-note-expand");
    expect(html).not.toContain("data-note-clamp");
  });

  it("renders the full untitled body with showFullBody and no clamp", () => {
    const post = createPostView({
      format: "note",
      title: undefined,
      bodyHtml: "<p>Intro</p><span data-note-break></span><p>Rest</p>",
      summaryHasMore: true,
    });

    const html = renderWithI18n(
      NoteCard({ post, mode: "feed", display: { showFullBody: true } }),
    );

    expect(html).toContain("<p>Rest</p>");
    expect(html).not.toContain("data-note-expand");
    expect(html).not.toContain("data-note-clamp");
  });

  it("moves rated link detail cards into the title block without changing feed ordering", () => {
    const post = createPostView({
      format: "link",
      rating: 5,
    });

    const feedHtml = renderWithI18n(LinkCard({ post, mode: "feed" }));
    const detailHtml = renderWithI18n(LinkCard({ post, mode: "detail" }));

    expect(feedHtml.indexOf("data-post-body")).toBeLessThan(
      feedHtml.indexOf('class="post-rating"'),
    );
    expect(detailHtml).toContain('class="post-header-block"');
    expect(detailHtml.indexOf('class="post-rating"')).toBeLessThan(
      detailHtml.indexOf("data-post-body"),
    );
  });

  it("can hide reply without hiding the more menu on note cards", () => {
    const post = createPostView({ format: "note", isLastInThread: true });

    const html = renderWithI18n(
      NoteCard({
        post,
        mode: "feed",
        display: {
          footer: {
            hideReply: true,
          },
        },
      }),
    );

    expect(html).not.toContain("data-reply-trigger");
    expect(html).toContain("data-post-menu-trigger");
  });
});
