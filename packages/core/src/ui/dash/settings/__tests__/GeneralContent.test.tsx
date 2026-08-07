import type { Context } from "hono";
import { renderToString } from "hono/jsx/dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../../../i18n/context.js";
import { createI18n } from "../../../../i18n/i18n.js";

async function loadGeneralContent() {
  const { GeneralContent } = await import("../GeneralContent.js");
  return GeneralContent;
}

function renderGeneralContent(
  props: Parameters<Awaited<ReturnType<typeof loadGeneralContent>>>[0],
) {
  const i18n = createI18n("en");
  const c = {
    get(key: string) {
      if (key === "i18n") return i18n;
      return undefined;
    },
  } as unknown as Context;

  I18nProvider({ c, children: "" });

  return loadGeneralContent().then((GeneralContent) =>
    renderToString(GeneralContent(props)),
  );
}

function createProps(
  demoMode: boolean,
  overrides: Partial<
    Parameters<Awaited<ReturnType<typeof loadGeneralContent>>>[0]
  > = {},
) {
  return {
    siteName: "My Blog",
    siteDescription: "A test blog",
    siteNameFallback: "Fallback Name",
    siteDescriptionFallback: "Fallback Description",
    mainRssFeed: "featured" as const,
    mainFeedUrl: "/feed",
    latestFeedUrl: "/latest/feed",
    featuredFeedUrl: "/featured/feed",
    archiveFeedUrl: "/archive/feed",
    timeZone: "UTC",
    siteFooter: "Footer text",
    showJantBrandingOnHome: false,
    noindex: false,
    demoMode,
    aboutPage: {
      state: "missing" as const,
      path: "/about" as const,
    },
    aboutEditUrl: "/about?edit=1",
    aboutCreateUrl: "/settings/general/about-page",
    timezones: [
      {
        value: "UTC",
        label: "(UTC) UTC",
        offset: "+00:00",
        iana: ["UTC"],
      },
    ],
    ...overrides,
  };
}

describe("GeneralContent", () => {
  it("omits the demo-mode attribute when demo mode is disabled", async () => {
    const html = await renderGeneralContent(createProps(false));

    expect(html).not.toContain("demo-mode");
  });

  it("renders the demo-mode attribute when demo mode is enabled", async () => {
    const html = await renderGeneralContent(createProps(true));

    expect(html).toMatch(/<jant-settings-general[^>]*demo-mode(?:=|\s|>)/);
  });
});
