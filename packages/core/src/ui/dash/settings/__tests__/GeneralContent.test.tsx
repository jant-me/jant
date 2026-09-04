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
    discoverDefault: "none" as const,
    discoverUrl: "https://jant.me/discover",
    discoverStatus: {
      announced: true,
      announceError: null,
      announceAt: 1_800_000_000,
      hasDirectory: true,
      managedByHost: false,
      submitUrl: "https://jant.me/discover/submit",
      declaredMode: "latest" as const,
      publicPostCount: 5,
      featuredPostCount: 2,
      established: true,
      minPublicPosts: 1,
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

  // The client turns the directory's name into the docs link by finding it in
  // the checkbox label, so the two labels have to agree character for
  // character. A translation that renamed one and not the other would only
  // lose the link, but this catches it here rather than in a screenshot.
  it("carries the directory name verbatim inside the checkbox label", async () => {
    const html = await renderGeneralContent(createProps(false));

    expect(html).toContain("Allow Jant Discover to list my site");
    expect(html).toContain(
      "&quot;discoverName&quot;:&quot;Jant Discover&quot;",
    );
  });

  // The status sentences carry runtime numbers, so they are translated here
  // rather than in the browser. What reaches the component is finished text.
  it("hands the component finished status sentences", async () => {
    const html = await renderGeneralContent(createProps(false));

    expect(html).toContain("Your feed says latest.");
    expect(html).toContain("Feed address sent to the directory.");
    expect(html).toContain("5 public posts");
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
          managedByHost: false,
          submitUrl: "https://jant.me/discover/submit",
          declaredMode: "latest",
          publicPostCount: 5,
          featuredPostCount: 2,
          established: true,
          minPublicPosts: 1,
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

  it("reports nothing at all when the feed declares none", async () => {
    const html = await renderGeneralContent(
      createProps(false, {
        discoverStatus: {
          announced: null,
          announceError: null,
          announceAt: null,
          hasDirectory: true,
          managedByHost: false,
          submitUrl: "https://jant.me/discover/submit",
          declaredMode: "none",
          publicPostCount: 5,
          featuredPostCount: 2,
          established: true,
          minPublicPosts: 1,
          firstReadMaxHours: 6,
        },
      }),
    );

    // A site that is not listed is told nothing: not that it is not listed —
    // the unticked checkbox says that — not how close it is to a threshold it
    // has opted out of, and not whether an announcement it never made got
    // through. With no lines the component drops the whole block.
    expect(html).toContain('discover-status="{&quot;lines&quot;:[]');
    expect(html).not.toContain("Your feed says");
    expect(html).toContain("&quot;showRetry&quot;:false");
  });

  // The announcement answers "does the directory know my address". A blog on
  // a hosted platform never has to ask: the control plane enrols its whole
  // fleet, so an owner who has never touched this control is already listed,
  // and telling them otherwise sends them after a task that does not exist.
  it("says nothing about announcing on a hosted blog", async () => {
    const html = await renderGeneralContent(
      createProps(false, {
        discoverStatus: {
          announced: null,
          announceError: null,
          announceAt: null,
          hasDirectory: true,
          managedByHost: true,
          submitUrl: "https://jant.me/discover/submit",
          declaredMode: "latest",
          publicPostCount: 5,
          featuredPostCount: 2,
          established: true,
          minPublicPosts: 1,
          firstReadMaxHours: 6,
        },
      }),
    );

    expect(html).not.toContain("Not announced yet");
    expect(html).not.toContain("https://jant.me/discover/submit");
    expect(html).toContain("&quot;showRetry&quot;:false");
    expect(html).toContain("&quot;submitUrl&quot;:null");
    // What is left is the part the owner can act on.
    expect(html).toContain("Your feed says latest.");
    expect(html).toContain("Enough for jant.me to list you.");
  });

  // A failed announcement is the one case that used to leave a hosted owner
  // reading an error about their own host's plumbing, with a Retry and a
  // manual submission form for a directory that already has them.
  it("hides the retry and the manual form on a hosted blog", async () => {
    const html = await renderGeneralContent(
      createProps(false, {
        discoverStatus: {
          announced: false,
          announceError: "The directory answered 503.",
          announceAt: 1_800_000_000,
          hasDirectory: true,
          managedByHost: true,
          submitUrl: "https://jant.me/discover/submit",
          declaredMode: "latest",
          publicPostCount: 5,
          featuredPostCount: 2,
          established: true,
          minPublicPosts: 1,
          firstReadMaxHours: 6,
        },
      }),
    );

    expect(html).not.toContain("The directory could not be reached");
    expect(html).toContain("&quot;showRetry&quot;:false");
    expect(html).toContain("&quot;submitUrl&quot;:null");
  });
});
