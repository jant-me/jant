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
    discover: "",
    discoverDocsUrl: "https://jant.me/docs/discover",
    discoverStatus: {
      announced: true,
      announceError: null,
      announceAt: 1_800_000_000,
      hasDirectory: true,
      submitUrl: "https://jant.me/discover/submit",
      declaredMode: "latest" as const,
      publicPostCount: 5,
      featuredPostCount: 2,
      firstReadMaxHours: 6,
    },
    rssFeedsEnabled: true,
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

  // The status sentences carry runtime numbers, so they are translated here
  // rather than in the browser. What reaches the component is finished text.
  it("hands the component finished status sentences", async () => {
    const html = await renderGeneralContent(createProps(false));

    expect(html).toContain("Your feed says latest.");
    expect(html).toContain("Feed address sent to the directory.");
    expect(html).toContain(
      "A directory reads a newly announced feed within 6 hours.",
    );
    // Nothing failed, so neither the retry nor the manual form is offered.
    expect(html).toContain("&quot;showRetry&quot;:false");
    expect(html).toContain("&quot;submitUrl&quot;:null");
  });

  it("offers the manual form only when the announcement failed", async () => {
    const html = await renderGeneralContent(
      createProps(false, {
        discoverStatus: {
          announced: false,
          announceError: "The directory answered 503.",
          announceAt: 1_800_000_000,
          hasDirectory: true,
          submitUrl: "https://jant.me/discover/submit",
          declaredMode: "latest",
          publicPostCount: 5,
          featuredPostCount: 2,
          firstReadMaxHours: 6,
        },
      }),
    );

    expect(html).toContain(
      "The directory could not be reached: The directory answered 503.",
    );
    expect(html).toContain("&quot;showRetry&quot;:true");
    expect(html).toContain("https://jant.me/discover/submit");
  });

  it("names the one thing that leaves a directory nothing to list", async () => {
    const html = await renderGeneralContent(
      createProps(false, {
        discoverStatus: {
          announced: true,
          announceError: null,
          announceAt: 1_800_000_000,
          hasDirectory: true,
          submitUrl: "https://jant.me/discover/submit",
          declaredMode: "latest",
          publicPostCount: 0,
          featuredPostCount: 0,
          firstReadMaxHours: 6,
        },
      }),
    );

    expect(html).toContain(
      "No public posts yet, so your feed carries nothing to show.",
    );
  });

  it("says nothing about announcing when the feed declares none", async () => {
    const html = await renderGeneralContent(
      createProps(false, {
        discoverStatus: {
          announced: null,
          announceError: null,
          announceAt: null,
          hasDirectory: true,
          submitUrl: "https://jant.me/discover/submit",
          declaredMode: "none",
          publicPostCount: 5,
          featuredPostCount: 2,
          firstReadMaxHours: 6,
        },
      }),
    );

    expect(html).toContain(
      "Your feed says none, so no directory will list this site.",
    );
    // A site that has said no is told that and nothing else: not what its feed
    // would otherwise carry, and not whether an announcement it never made got
    // through.
    expect(html).toContain(
      'discover-status="{&quot;lines&quot;:[&quot;Your feed says none, ' +
        "so no directory will list this site.&quot;]",
    );
    expect(html).toContain("&quot;showRetry&quot;:false");
  });
});
