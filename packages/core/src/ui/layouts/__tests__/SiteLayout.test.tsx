/**
 * The site chrome around every public page.
 *
 * The header's links are language-scoped: a page inside a language view —
 * /en/archive, or a Japanese post at its language-neutral URL — hands the
 * header a `basePath` carrying the view's prefix, and the logo, drawer brand,
 * and search icon must stay inside that view rather than leading back to the
 * primary language.
 */

import type { Context } from "hono";
import { renderToString } from "hono/jsx/dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../../i18n/context.js";
import { createI18n } from "../../../i18n/i18n.js";
import type { SiteLayoutProps } from "../../../types.js";
import { SiteHeader, SiteLayout } from "../SiteLayout.js";

function provideI18n(): void {
  const i18n = createI18n("en");
  const c = {
    get(key: string) {
      return key === "i18n" ? i18n : undefined;
    },
  } as unknown as Context;
  I18nProvider({ c, children: "" });
}

function renderHeader(
  props: Partial<Parameters<typeof SiteHeader>[0]> = {},
): string {
  provideI18n();

  return renderToString(
    SiteHeader({
      siteName: "Jant",
      links: [],
      currentPath: "/",
      ...props,
    }),
  );
}

function renderLayout(props: Partial<SiteLayoutProps> = {}): string {
  provideI18n();

  return renderToString(
    SiteLayout({
      siteName: "Jant",
      links: [],
      currentPath: "/",
      children: "",
      ...props,
    }),
  );
}

describe("SiteHeader", () => {
  it("keeps the logo and search inside a language view", () => {
    const html = renderHeader({ basePath: "/ja", currentPath: "/ja" });

    expect(html).toContain('href="/ja" class="site-logo"');
    expect(html).toContain('href="/ja/search"');
    expect(html).toContain('href="/ja" class="site-nav-drawer-brand"');
  });

  it("marks a language view's home as the home page", () => {
    expect(renderHeader({ basePath: "/ja", currentPath: "/ja" })).toContain(
      "site-header-top-home",
    );
    expect(
      renderHeader({ basePath: "/ja", currentPath: "/ja/archive" }),
    ).not.toContain("site-header-top-home");
  });

  it("links to the root without a base path", () => {
    const html = renderHeader({});

    expect(html).toContain('href="/" class="site-logo"');
    expect(html).toContain('href="/search"');
  });

  it("composes the deployment prefix with the language prefix", () => {
    const html = renderHeader({
      sitePathPrefix: "/blog",
      basePath: "/blog/ja",
      currentPath: "/blog/ja",
    });

    expect(html).toContain('href="/blog/ja" class="site-logo"');
    expect(html).toContain('href="/blog/ja/search"');
  });
});

describe("SiteLayout", () => {
  // The floating compose button is fixed to the bottom of a phone screen, so
  // the page has to keep room for it after its last element — the footer and
  // the Jant credit included, not only the posts. The modifier that keeps the
  // room and the button itself must never render apart.
  it.each([
    {
      name: "an author's home page",
      props: { isAuthenticated: true, currentPath: "/" },
      expected: true,
    },
    {
      name: "an author's collection page",
      props: {
        isAuthenticated: true,
        currentPath: "/notes",
        composeCollectionId: "col_01h455vb4pex5vsknk084sn02q",
      },
      expected: true,
    },
    {
      name: "an author's archive",
      props: { isAuthenticated: true, currentPath: "/archive" },
      expected: false,
    },
    {
      name: "an author's home page without the composer",
      props: {
        isAuthenticated: true,
        currentPath: "/",
        showComposeDialog: false,
      },
      expected: false,
    },
    {
      name: "a reader's home page",
      props: { isAuthenticated: false, currentPath: "/" },
      expected: false,
    },
  ])(
    "keeps room for the compose button exactly when it shows: $name",
    ({ props, expected }) => {
      const html = renderLayout({
        siteFooterHtml: "<p>Footer</p>",
        ...props,
      });

      expect(html.includes('class="site-mobile-compose-fab"')).toBe(expected);
      expect(
        html.includes('class="site-page site-page-mobile-compose-enabled"'),
      ).toBe(expected);
    },
  );
});
