import type { Context } from "hono";
import { renderToString } from "hono/jsx/dom/server";
import { describe, expect, it } from "vitest";
import { readComponentCss } from "../../../../__tests__/helpers/component-css.js";
import { I18nProvider } from "../../../../i18n/context.js";
import { createI18n } from "../../../../i18n/i18n.js";
import { NavigationContent } from "../NavigationContent.js";

function renderNavigationContent(
  props: Partial<Parameters<typeof NavigationContent>[0]> = {},
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
    NavigationContent({
      navItems: [],
      directoryData: {
        collections: [],
        smartCollections: [],
        items: [],
        directoryItems: [],
      },
      suggestedLinks: [],
      mainRssFeed: "latest",
      rssFeedsEnabled: true,
      siteName: "Test Site",
      ...props,
    }),
  );
}

describe("NavigationContent", () => {
  it("names which end the RSS entry currently points at", () => {
    expect(renderNavigationContent({ mainRssFeed: "latest" })).toContain(
      "currently your Latest feed",
    );
    expect(renderNavigationContent({ mainRssFeed: "featured" })).toContain(
      "currently your Featured feed",
    );
  });

  // RSS and Subscribe are the only pair an author has to choose between, and
  // they are adjacent switches. Each has to say who it is for, or the choice is
  // two near-identical toggles.
  it("offers RSS and Subscribe as a legible choice", () => {
    const html = renderNavigationContent({ mainRssFeed: "latest" });

    expect(html).toContain("already use a feed reader");
    expect(html).toContain("a page listing your feeds with copy buttons");
    expect(html).toContain("don&#39;t already use one");
  });

  it("renders the built-in links heading", () => {
    const html = renderNavigationContent();

    expect(html).toContain("Built-in links");
  });

  it("hides the saved RSS item only from the preview when feeds are off", () => {
    const html = renderNavigationContent({
      rssFeedsEnabled: false,
      navItems: [
        {
          id: "nav_rss",
          type: "system",
          systemKey: "rss",
          label: "Saved feed",
          url: "/feed",
          placement: "header",
          position: "a0",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    expect(html).not.toContain(">Saved feed<");
    expect(html).toContain("&quot;systemKey&quot;:&quot;rss&quot;");
  });

  it("serializes suggested links with translated target labels", () => {
    const html = renderNavigationContent({
      suggestedLinks: [
        {
          key: "now",
          label: "Now",
          url: "/now",
          targetType: "collection",
          navItemType: "collection",
          collectionId: "col_now",
        },
      ],
    });

    expect(html).toContain("suggested-links=");
    expect(html).toContain("&quot;targetLabel&quot;:&quot;Collection&quot;");
  });

  it("leaves the preview frame unclipped so the More menu can escape it", () => {
    const css = readComponentCss();
    const frame = css.match(/\.nav-preview \{[^}]*\}/)?.[0] ?? "";

    // The menu opens below the frame's own bottom edge. Clipping here cuts it
    // off entirely — a stacking order cannot escape an ancestor's overflow.
    expect(frame).not.toContain("overflow-hidden");
    expect(css).toMatch(
      /\.nav-preview-chrome \{[\s\S]*?border-top-left-radius/,
    );
  });
});
