import type { Context } from "hono";
import { renderToString } from "hono/jsx/dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../../i18n/context.js";
import { createI18n } from "../../../i18n/i18n.js";
import type { PostView, SearchResultView } from "../../../types.js";
import { SearchPage } from "../SearchPage.js";

function createPostView(overrides: Partial<PostView> = {}): PostView {
  return {
    id: "pst_search_1",
    permalink: "/post-1",
    slug: "post-1",
    format: "note",
    status: "published",
    visibility: "public",
    pinned: false,
    featured: false,
    publishedAt: "2026-05-11T00:00:00.000Z",
    publishedAtFormatted: "May 11, 2026",
    publishedAtTime: "08:00",
    publishedAtRelative: "May 11",
    updatedAt: "2026-05-11T00:00:00.000Z",
    media: [],
    collections: [],
    isLastInThread: true,
    ...overrides,
  };
}

function renderSearchPage(
  results: SearchResultView[],
  query = "https://news.ycombinator.com/",
): string {
  const i18n = createI18n("en");
  const c = {
    get(key: string) {
      if (key === "i18n") return i18n;
      return undefined;
    },
  } as unknown as Context;

  I18nProvider({ c, children: "" });
  return renderToString(
    SearchPage({
      query,
      results,
      hasMore: false,
      page: 1,
      isAuthenticated: false,
    }),
  );
}

describe("SearchPage", () => {
  describe("link results", () => {
    it("renders a clickable external domain link alongside the title", () => {
      const html = renderSearchPage([
        {
          post: createPostView({
            format: "link",
            title: "How to put down your phone",
            url: "https://news.ycombinator.com/item?id=33072552",
          }),
          rank: 0,
          titleHighlighted: "How to put down your phone",
          snippet:
            "<mark>https</mark>://<mark>news</mark>.<mark>ycombinator</mark>.<mark>com</mark>/item?id=33072552",
          snippetFromUrl: true,
        },
      ]);

      expect(html).toContain(
        '<a href="https://news.ycombinator.com/item?id=33072552" target="_blank" rel="noopener noreferrer" class="search-result-external-link"><span>news.ycombinator.com</span>',
      );
      expect(html).toContain('href="#icon-link-domain"');
      expect(html).toContain(
        '<a href="https://news.ycombinator.com/item?id=33072552" target="_blank" rel="noopener noreferrer" class="search-result-url-snippet">',
      );
    });

    it("keeps an external link clickable even when the link post has no title", () => {
      const html = renderSearchPage([
        {
          post: createPostView({
            format: "link",
            title: undefined,
            url: "https://www.example.com/essay",
          }),
          rank: 0,
          snippet: "Great commentary about <mark>essay</mark>",
        },
      ]);

      expect(html).toContain(
        '<a href="https://www.example.com/essay" target="_blank" rel="noopener noreferrer" class="search-result-external-link"><span>example.com</span>',
      );
      expect(html).not.toContain("search-result-url-snippet");
    });

    it("rejects unsafe link URLs and falls back title to the post permalink", () => {
      const html = renderSearchPage([
        {
          post: createPostView({
            format: "link",
            title: "Unsafe link",
            url: "javascript:alert(1)",
          }),
          rank: 0,
          titleHighlighted: "Unsafe link",
        },
      ]);

      expect(html).not.toContain("javascript:alert");
      expect(html).not.toContain("search-result-external-link");
      expect(html).toContain('<a href="/post-1" class="hover:underline">');
    });
  });

  describe("quote results", () => {
    it("renders a clickable domain source link for untitled quotes with a source URL", () => {
      const html = renderSearchPage(
        [
          {
            post: createPostView({
              format: "quote",
              quoteText: "You will live with the consequences of every choice.",
              title: undefined,
              url: "https://news.ycombinator.com/item?id=8082029",
            }),
            rank: 0,
            quoteHighlighted:
              "You will live with the consequences of every <mark>choice</mark>.",
          },
        ],
        "choice",
      );

      expect(html).toContain(
        '<a href="https://news.ycombinator.com/item?id=8082029" target="_blank" rel="noopener noreferrer" class="search-result-source-link"><span>news.ycombinator.com</span>',
      );
      expect(html).toContain('href="#icon-link-domain"');
    });

    it("folds a URL-matched snippet into the source link for untitled quotes without duplicating it", () => {
      const html = renderSearchPage([
        {
          post: createPostView({
            format: "quote",
            quoteText: "You will live with the consequences of every choice.",
            title: undefined,
            url: "https://news.ycombinator.com/item?id=8082029",
          }),
          rank: 0,
          quoteHighlighted:
            "You will live with the consequences of every choice.",
          snippet:
            "<mark>https</mark>://<mark>news</mark>.<mark>ycombinator</mark>.<mark>com</mark>/item?id=8082029",
          snippetFromUrl: true,
        },
      ]);

      expect(html).toContain(
        '<a href="https://news.ycombinator.com/item?id=8082029" target="_blank" rel="noopener noreferrer" class="search-result-source-link"><span><mark>https</mark>://<mark>news</mark>.<mark>ycombinator</mark>.<mark>com</mark>/item?id=8082029</span>',
      );
      expect(html).not.toContain('class="search-snippet"');
    });

    it("renders both highlighted attribution and URL snippet as clickable external links on titled quotes", () => {
      const html = renderSearchPage([
        {
          post: createPostView({
            format: "quote",
            quoteText: "Any thought derives from prior experience.",
            title: "HN reader",
            url: "https://news.ycombinator.com/item?id=23097738",
          }),
          rank: 0,
          titleHighlighted: "<mark>HN</mark> reader",
          quoteHighlighted: "Any thought derives from prior experience.",
          snippet:
            "<mark>https</mark>://<mark>news</mark>.<mark>ycombinator</mark>.<mark>com</mark>/item?id=23097738",
          snippetFromUrl: true,
        },
      ]);

      expect(html).toContain(
        '<a href="https://news.ycombinator.com/item?id=23097738" target="_blank" rel="noopener noreferrer" class="search-result-source-link"><span><mark>HN</mark> reader</span>',
      );
      expect(html).toContain(
        '<a href="https://news.ycombinator.com/item?id=23097738" target="_blank" rel="noopener noreferrer" class="search-result-url-snippet">',
      );
    });

    it("keeps plain quote attribution unlinked when there is no source URL", () => {
      const html = renderSearchPage(
        [
          {
            post: createPostView({
              format: "quote",
              quoteText: "Simplicity is prerequisite for reliability.",
              title: "Edsger Dijkstra",
              url: undefined,
            }),
            rank: 0,
            quoteHighlighted: "Simplicity is prerequisite for reliability.",
            titleHighlighted: "Edsger <mark>Dijkstra</mark>",
          },
        ],
        "Dijkstra",
      );

      expect(html).toContain("<span>Edsger <mark>Dijkstra</mark></span>");
      expect(html).not.toContain("search-result-source-link");
      expect(html).not.toContain("icon-link-domain");
    });

    it("still renders the external source link when a quote has no quoteText", () => {
      const html = renderSearchPage([
        {
          post: createPostView({
            format: "quote",
            quoteText: undefined,
            title: undefined,
            url: "https://news.ycombinator.com/item?id=999",
          }),
          rank: 0,
          snippet: "Commentary mentioning <mark>news</mark>",
        },
      ]);

      expect(html).toContain(
        '<a href="https://news.ycombinator.com/item?id=999" target="_blank" rel="noopener noreferrer" class="search-result-source-link"><span>news.ycombinator.com</span>',
      );
    });

    it("refuses unsafe source URLs on quotes", () => {
      const html = renderSearchPage([
        {
          post: createPostView({
            format: "quote",
            quoteText: "Quoted words",
            title: "Someone",
            url: "javascript:alert(1)",
          }),
          rank: 0,
          quoteHighlighted: "Quoted words",
        },
      ]);

      expect(html).not.toContain("javascript:alert");
      expect(html).not.toContain("search-result-source-link");
      expect(html).toContain("<span>Someone</span>");
    });
  });
});
