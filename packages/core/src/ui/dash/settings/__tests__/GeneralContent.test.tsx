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
  locale: Parameters<typeof createI18n>[0] = "en",
) {
  const i18n = createI18n(locale);
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
    // The deployment has no answer of its own; a self-hosted site opts in.
    discoverDefault: "" as const,
    discoverPages: {
      home: "https://jant.me/discover",
      links: "https://jant.me/links",
      quotes: "https://jant.me/quotes",
      rules: "https://jant.me/discover/about",
    },
    discoverStatus: {
      announced: true,
      announceError: null,
      announceAt: STALE_ANNOUNCE_AT,
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

// The first-read line is the one status sentence that expires, so the fixtures
// place the announcement relative to the clock rather than on a fixed date that
// drifts in and out of the window as time passes.
const STALE_ANNOUNCE_AT = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
const FRESH_ANNOUNCE_AT = Math.floor(Date.now() / 1000) - 60;

describe("GeneralContent", () => {
  it("omits the demo-mode attribute when demo mode is disabled", async () => {
    const html = await renderGeneralContent(createProps(false));

    expect(html).not.toContain("demo-mode");
  });

  it("renders the demo-mode attribute when demo mode is enabled", async () => {
    const html = await renderGeneralContent(createProps(true));

    expect(html).toMatch(/<jant-settings-general[^>]*demo-mode(?:=|\s|>)/);
  });

  // The client turns the name and the rules into links by finding them in the
  // help line, so the labels have to agree with the sentence character for
  // character. A translation that reworded one and not the other would only
  // lose that link, but this catches it here rather than in a screenshot.
  it("carries every linked term verbatim inside the help line", async () => {
    const html = await renderGeneralContent(createProps(false));

    expect(html).toContain(
      "Jant Discover is a directory of Jant blogs, curated by hand by the Jant community",
    );
    expect(html).toContain(
      "appear on the Links and Quotes lists 24 hours after they are published",
    );
    expect(html).toContain("See the Discover community rules.");
    expect(html).toContain(
      "&quot;discoverName&quot;:&quot;Jant Discover&quot;",
    );
    expect(html).toContain(
      "&quot;discoverRules&quot;:&quot;Discover community rules&quot;",
    );
  });

  // Translations are written by hand or by a model, and one that rewords a
  // placeholder's value, or drops the placeholder, loses that link without a
  // word. Every catalog has to keep all four runs verbatim.
  it.each(["en", "zh-Hans", "zh-Hant"] as const)(
    "keeps every linked term inside the %s help line",
    async (locale) => {
      const html = await renderGeneralContent(createProps(false), locale);
      const attribute = /<jant-settings-general[^>]*\slabels="([^"]*)"/.exec(
        html,
      )?.[1];
      const labels = JSON.parse(
        (attribute ?? "{}").replaceAll("&quot;", '"').replaceAll("&amp;", "&"),
      ) as Record<string, string>;
      const intro = labels["discoverIntro"] ?? "";

      for (const term of [
        labels["discoverName"],
        "Links",
        "Quotes",
        labels["discoverRules"],
      ]) {
        expect(term).toBeTruthy();
        expect(intro).toContain(term);
      }
      // And the delay, so an author knows how long they have to edit.
      expect(intro).toContain("24");
    },
  );

  it("hands the browser every page the help line links to", async () => {
    const html = await renderGeneralContent(createProps(false));

    expect(html).toContain(
      'discover-pages="{&quot;home&quot;:&quot;https://jant.me/discover&quot;,&quot;links&quot;:&quot;https://jant.me/links&quot;,&quot;quotes&quot;:&quot;https://jant.me/quotes&quot;,&quot;rules&quot;:&quot;https://jant.me/discover/about&quot;}"',
    );
  });

  // No directory, no addresses: the help line then renders as plain text.
  it("omits the directory's pages when none is configured", async () => {
    const html = await renderGeneralContent(
      createProps(false, { discoverPages: null }),
    );

    expect(html).not.toContain("discover-pages");
  });

  // The browser decides what the site declares, because two of the inputs are
  // controls on this page. Resolving `noindex` into the default here would put
  // that decision back on the server and freeze it at page load — the checkbox
  // would then go on claiming a listing the feed had already dropped.
  it("hands the browser the deployment default with noindex unresolved", async () => {
    const html = await renderGeneralContent(
      createProps(false, { discoverDefault: "latest", noindex: true }),
    );

    expect(html).toContain('discover-default="latest"');
  });

  // The controls above the block already say that the site is listed and what
  // its feed declares, and a site past the directory's threshold has nothing
  // to do about being past it. A site in that state is told nothing at all.
  it("says nothing when the setting is already doing what it says", async () => {
    const html = await renderGeneralContent(createProps(false));

    expect(html).toContain('discover-status="{&quot;lines&quot;:[]');
    // Nothing failed, so neither the retry nor the manual form is offered.
    expect(html).toContain("&quot;showAnnounce&quot;:false");
    expect(html).toContain("&quot;submitUrl&quot;:null");
  });

  // The status sentences carry runtime numbers, so they are translated on the
  // server rather than in the browser. What reaches the component is finished
  // text — and this one only for as long as the answer is outstanding.
  it("confirms an announcement while its first read is still due", async () => {
    const html = await renderGeneralContent(
      createProps(false, {
        discoverStatus: {
          ...createProps(false).discoverStatus,
          announceAt: FRESH_ANNOUNCE_AT,
        },
      }),
    );

    expect(html).toContain(
      "Feed address sent. A directory reads a newly announced feed within 6 hours.",
    );
  });

  // An opt-in that cannot take effect is worth saying, because the ticked box
  // above claims the opposite.
  it("says the opt-in is not yet effective without a public post", async () => {
    const html = await renderGeneralContent(
      createProps(false, {
        discoverStatus: {
          ...createProps(false).discoverStatus,
          publicPostCount: 0,
          featuredPostCount: 0,
          established: false,
        },
      }),
    );

    expect(html).toContain(
      "Nothing published yet. jant.me lists a blog once it has one public post.",
    );
  });

  it("says a featured-only feed has nothing to carry", async () => {
    const html = await renderGeneralContent(
      createProps(false, {
        discoverStatus: {
          ...createProps(false).discoverStatus,
          declaredMode: "featured" as const,
          featuredPostCount: 0,
        },
      }),
    );

    expect(html).toContain("no post is marked Featured");
  });

  it("offers the manual form only when the announcement failed", async () => {
    const html = await renderGeneralContent(
      createProps(false, {
        discoverStatus: {
          announced: false,
          announceError: "The directory answered 503.",
          announceAt: STALE_ANNOUNCE_AT,
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
    expect(html).toContain("&quot;showAnnounce&quot;:true");
    expect(html).toContain("https://jant.me/discover/submit");
  });

  // A site whose mode came from the deployment's own default declares itself
  // without ever having announced. Nothing else on the page sends the address
  // now that the section saves on change, so the button has to.
  it("offers the announcement to a site that has never made one", async () => {
    const html = await renderGeneralContent(
      createProps(false, {
        discoverStatus: {
          announced: null,
          announceError: null,
          announceAt: null,
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
      "Not announced yet. No directory has been told this site exists.",
    );
    expect(html).toContain("&quot;showAnnounce&quot;:true");
    // The manual form stays with the failure it belongs to.
    expect(html).toContain("&quot;submitUrl&quot;:null");
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
    expect(html).not.toContain("Not announced yet");
    expect(html).not.toContain("jant.me lists a blog once");
    expect(html).toContain("&quot;showAnnounce&quot;:false");
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
    expect(html).toContain("&quot;showAnnounce&quot;:false");
    expect(html).toContain("&quot;submitUrl&quot;:null");
    // Nothing is left: the announcement was the only part of this block a
    // hosted owner could ever have acted on.
    expect(html).toContain('discover-status="{&quot;lines&quot;:[]');
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
          announceAt: STALE_ANNOUNCE_AT,
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
    expect(html).toContain("&quot;showAnnounce&quot;:false");
    expect(html).toContain("&quot;submitUrl&quot;:null");
  });
});
