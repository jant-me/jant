/**
 * The header's language-scoped links.
 *
 * A page inside a language view — /en/archive, or a Japanese post at its
 * language-neutral URL — hands the header a `basePath` carrying the view's
 * prefix, and the logo, drawer brand, and search icon must stay inside that
 * view rather than leading back to the primary language.
 */

import type { Context } from "hono";
import { renderToString } from "hono/jsx/dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../../i18n/context.js";
import { createI18n } from "../../../i18n/i18n.js";
import { SiteHeader } from "../SiteLayout.js";

function renderHeader(
  props: Partial<Parameters<typeof SiteHeader>[0]> = {},
): string {
  const i18n = createI18n("en");
  const c = {
    get(key: string) {
      return key === "i18n" ? i18n : undefined;
    },
  } as unknown as Context;
  I18nProvider({ c, children: "" });

  return renderToString(
    SiteHeader({
      siteName: "Jant",
      links: [],
      currentPath: "/",
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
