import { describe, expect, it } from "vitest";
import {
  discoverIntroRuns,
  getDiscoverFeedPath,
  getDiscoverPageUrls,
  getDiscoverSubmitUrl,
  linkTerms,
  measureDiscoverMaturity,
  parseDiscoverSetting,
  resolveDiscoverMode,
} from "../discover.js";
import {
  DEFAULT_DISCOVER_PING_URL,
  getDiscoverDirectoryBaseUrl,
  getDiscoverPingUrl,
} from "../env.js";

function resolve(
  overrides: Partial<Parameters<typeof resolveDiscoverMode>[0]>,
) {
  return resolveDiscoverMode({
    storedValue: null,
    defaultValue: null,
    demoMode: false,
    noindex: false,
    rssFeedsEnabled: true,
    ...overrides,
  });
}

describe("parseDiscoverSetting", () => {
  it("accepts the three stored values", () => {
    expect(parseDiscoverSetting("latest")).toBe("latest");
    expect(parseDiscoverSetting("featured")).toBe("featured");
    expect(parseDiscoverSetting("off")).toBe("off");
  });

  it("treats absent, blank, and unrecognized values as unset", () => {
    expect(parseDiscoverSetting(undefined)).toBeNull();
    expect(parseDiscoverSetting(null)).toBeNull();
    expect(parseDiscoverSetting("")).toBeNull();
    expect(parseDiscoverSetting("  ")).toBeNull();
    expect(parseDiscoverSetting("true")).toBeNull();
  });
});

describe("resolveDiscoverMode", () => {
  // The declaration is the consent record. A self-hosted site nobody
  // configured has said nothing, and a directory must read that as a no.
  it("keeps an untouched self-hosted site out", () => {
    expect(resolve({})).toBe("none");
  });

  it("honours the owner's stored choice", () => {
    expect(resolve({ storedValue: "featured" })).toBe("featured");
    expect(resolve({ storedValue: "latest" })).toBe("latest");
    expect(resolve({ storedValue: "off" })).toBe("none");
  });

  // How hosted Jant lists its fleet without asking every owner.
  it("takes the deployment default when nothing is stored", () => {
    expect(resolve({ defaultValue: "latest" })).toBe("latest");
    expect(resolve({ defaultValue: "featured" })).toBe("featured");
    expect(resolve({ defaultValue: "off" })).toBe("none");
  });

  it("lets the owner overrule the deployment default", () => {
    expect(resolve({ defaultValue: "latest", storedValue: "off" })).toBe(
      "none",
    );
    expect(resolve({ defaultValue: "off", storedValue: "latest" })).toBe(
      "latest",
    );
  });

  // Hiding from search engines and being surfaced by a directory contradict
  // each other, and the quieter reading is the safe one.
  it("reads noindex as none while the setting is unset", () => {
    expect(resolve({ noindex: true })).toBe("none");
  });

  // The whole reason the two are separate: a deployment-wide "list my blogs"
  // is a default, not the answer of the owner who hid this one from search.
  it("puts noindex above the deployment default", () => {
    expect(resolve({ noindex: true, defaultValue: "latest" })).toBe("none");
  });

  it("lets a stored choice override noindex", () => {
    expect(resolve({ noindex: true, storedValue: "latest" })).toBe("latest");
    expect(resolve({ noindex: true, storedValue: "featured" })).toBe(
      "featured",
    );
  });

  // Demos exist to be thrown away; nothing they publish belongs in a directory.
  it("locks demo sites out even when they ask to be listed", () => {
    expect(resolve({ demoMode: true })).toBe("none");
    expect(resolve({ demoMode: true, storedValue: "featured" })).toBe("none");
    expect(resolve({ demoMode: true, defaultValue: "latest" })).toBe("none");
  });

  // Every feed path 404s with feeds off, so there would be nothing to poll.
  it("declares none when the site publishes no feeds", () => {
    expect(resolve({ rssFeedsEnabled: false })).toBe("none");
    expect(resolve({ rssFeedsEnabled: false, storedValue: "latest" })).toBe(
      "none",
    );
  });

  it("ignores values it does not recognize, on either side", () => {
    expect(resolve({ storedValue: "sometimes", defaultValue: "latest" })).toBe(
      "latest",
    );
    expect(resolve({ defaultValue: "sometimes" })).toBe("none");
  });
});

describe("getDiscoverFeedPath", () => {
  it("names the feed each mode draws from", () => {
    expect(getDiscoverFeedPath("latest")).toBe("/latest/feed");
    expect(getDiscoverFeedPath("featured")).toBe("/featured/feed");
    expect(getDiscoverFeedPath("none")).toBeNull();
  });
});

/**
 * The two states that matter are spelled differently, and collapsing them is
 * how "switch the ping off" would quietly become "switch it on".
 */
describe("getDiscoverPingUrl", () => {
  it("uses Jant's directory when nothing is configured", () => {
    expect(getDiscoverPingUrl({})).toBe(DEFAULT_DISCOVER_PING_URL);
    expect(getDiscoverPingUrl(undefined)).toBe(DEFAULT_DISCOVER_PING_URL);
  });

  it("announces nowhere when the binding is set but empty", () => {
    expect(getDiscoverPingUrl({ DISCOVER_PING_URL: "" })).toBeUndefined();
    expect(getDiscoverPingUrl({ DISCOVER_PING_URL: "   " })).toBeUndefined();
  });

  it("uses a directory of the operator's own", () => {
    expect(
      getDiscoverPingUrl({
        DISCOVER_PING_URL: "https://directory.example/api/discover/ping",
      }),
    ).toBe("https://directory.example/api/discover/ping");
  });

  // Naming the directory twice is what let a hosted deployment announce its
  // blogs to jant.me, which had never heard of them.
  it("announces to the control plane that hosts this deployment", () => {
    expect(
      getDiscoverPingUrl({
        HOSTED_CONTROL_PLANE_BASE_URL: "https://cloud.example",
      }),
    ).toBe("https://cloud.example/api/discover/ping");
  });

  // Server-to-server, like every other core to control-plane call.
  it("prefers the control plane's internal address", () => {
    expect(
      getDiscoverPingUrl({
        HOSTED_CONTROL_PLANE_BASE_URL: "https://cloud.example",
        HOSTED_CONTROL_PLANE_INTERNAL_BASE_URL: "http://127.0.0.1:3300",
      }),
    ).toBe("http://127.0.0.1:3300/api/discover/ping");
  });

  it("lets an explicit directory override the control plane", () => {
    expect(
      getDiscoverPingUrl({
        DISCOVER_PING_URL: "https://directory.example/api/discover/ping",
        HOSTED_CONTROL_PLANE_BASE_URL: "https://cloud.example",
      }),
    ).toBe("https://directory.example/api/discover/ping");
  });

  it("still announces nowhere when a hosted deployment empties the binding", () => {
    expect(
      getDiscoverPingUrl({
        DISCOVER_PING_URL: "",
        HOSTED_CONTROL_PLANE_BASE_URL: "https://cloud.example",
      }),
    ).toBeUndefined();
  });

  it("falls back to Jant's directory when the control plane URL is unusable", () => {
    expect(
      getDiscoverPingUrl({ HOSTED_CONTROL_PLANE_BASE_URL: "not a url" }),
    ).toBe(DEFAULT_DISCOVER_PING_URL);
  });
});

/**
 * The address a browser opens, for the same directory the ping goes to. The
 * two must never name different directories, which is why they share a source.
 */
describe("getDiscoverDirectoryBaseUrl", () => {
  it("uses Jant's directory when nothing is configured", () => {
    expect(getDiscoverDirectoryBaseUrl({})).toBe("https://jant.me/");
  });

  // The public address, not the internal one the ping uses: this ends up in an
  // href, and `127.0.0.1` is not a directory anybody can visit.
  it("links to the control plane's public address", () => {
    expect(
      getDiscoverDirectoryBaseUrl({
        HOSTED_CONTROL_PLANE_BASE_URL: "https://cloud.example",
        HOSTED_CONTROL_PLANE_INTERNAL_BASE_URL: "http://127.0.0.1:3300",
      }),
    ).toBe("https://cloud.example/");
  });

  it("follows an explicitly configured directory", () => {
    expect(
      getDiscoverDirectoryBaseUrl({
        DISCOVER_PING_URL: "https://directory.example/api/discover/ping",
      }),
    ).toBe("https://directory.example/");
  });

  it("has nothing to link to when announcing is off", () => {
    expect(
      getDiscoverDirectoryBaseUrl({ DISCOVER_PING_URL: "" }),
    ).toBeUndefined();
  });
});

describe("measureDiscoverMaturity", () => {
  it("passes a blog that has published something", () => {
    expect(measureDiscoverMaturity({ publicPostCount: 5 })).toEqual({
      publicPostCount: 5,
      established: true,
    });
  });

  // One post is the whole threshold; what keeps throwaways out is the opt-in.
  it("passes a blog with a single public post", () => {
    expect(measureDiscoverMaturity({ publicPostCount: 1 })).toMatchObject({
      established: true,
    });
  });

  it("holds back a blog with nothing public in it", () => {
    expect(measureDiscoverMaturity({ publicPostCount: 0 })).toEqual({
      publicPostCount: 0,
      established: false,
    });
  });
});

describe("getDiscoverSubmitUrl", () => {
  it("finds the form beside the directory's own ping endpoint", () => {
    expect(getDiscoverSubmitUrl("https://jant.me/api/discover/ping")).toBe(
      "https://jant.me/discover/submit",
    );
  });

  // Provider-neutral on purpose: a site announcing to its own directory must
  // not be sent to somebody else's form.
  it("follows a directory of your own", () => {
    expect(
      getDiscoverSubmitUrl("https://directory.example/api/discover/ping"),
    ).toBe("https://directory.example/discover/submit");
  });

  it("has nothing to offer when no directory is configured", () => {
    expect(getDiscoverSubmitUrl(undefined)).toBeNull();
    expect(getDiscoverSubmitUrl("")).toBeNull();
    expect(getDiscoverSubmitUrl("not a url")).toBeNull();
  });
});

describe("getDiscoverPageUrls", () => {
  // The settings page links the directory's name to the directory itself, so
  // "what is Discover" is answered by the list rather than by a page about it.
  // The three lists sit flat on jant.me; only the rules sit under /discover.
  it("finds the directory's pages behind its own ping endpoint", () => {
    expect(getDiscoverPageUrls("https://jant.me/api/discover/ping")).toEqual({
      home: "https://jant.me/discover",
      links: "https://jant.me/links",
      quotes: "https://jant.me/quotes",
      rules: "https://jant.me/discover/about",
    });
  });

  it("follows a directory of your own", () => {
    expect(
      getDiscoverPageUrls("https://directory.example/api/discover/ping"),
    ).toEqual({
      home: "https://directory.example/discover",
      links: "https://directory.example/links",
      quotes: "https://directory.example/quotes",
      rules: "https://directory.example/discover/about",
    });
  });

  it("has nothing to link to when no directory is configured", () => {
    expect(getDiscoverPageUrls(undefined)).toBeNull();
    expect(getDiscoverPageUrls("")).toBeNull();
    expect(getDiscoverPageUrls("not a url")).toBeNull();
  });
});

describe("linkTerms", () => {
  const links = [
    { term: "Jant Discover", href: "/discover" },
    { term: "Links", href: "/links" },
    { term: "Quotes", href: "/quotes" },
    { term: "Discover community rules", href: "/discover/about" },
  ];

  it("links every term where the sentence puts it", () => {
    expect(
      linkTerms(
        "Jant Discover lists link and quote posts on Links and Quotes. See the Discover community rules.",
        links,
      ),
    ).toEqual([
      { text: "Jant Discover", href: "/discover" },
      { text: " lists link and quote posts on " },
      { text: "Links", href: "/links" },
      { text: " and " },
      { text: "Quotes", href: "/quotes" },
      { text: ". See the " },
      { text: "Discover community rules", href: "/discover/about" },
      { text: "." },
    ]);
  });

  // A translation owns its word order; the links follow the words, not the
  // order they were given in.
  it("follows the translation's word order", () => {
    expect(
      linkTerms("详见 Discover 社区规则。Jant Discover 是一个目录。", [
        { term: "Jant Discover", href: "/discover" },
        { term: "Discover 社区规则", href: "/discover/about" },
      ]),
    ).toEqual([
      { text: "详见 " },
      { text: "Discover 社区规则", href: "/discover/about" },
      { text: "。" },
      { text: "Jant Discover", href: "/discover" },
      { text: " 是一个目录。" },
    ]);
  });

  // "Discover" alone sits inside "Jant Discover"; whichever the sentence
  // mentions first, the longer name keeps its whole run.
  it("never lets a term inside another take the longer one's place", () => {
    expect(
      linkTerms("Jant Discover reads your feed. Discover shows it.", [
        { term: "Discover", href: "/about" },
        { term: "Jant Discover", href: "/discover" },
      ]),
    ).toEqual([
      { text: "Jant Discover", href: "/discover" },
      { text: " reads your feed. " },
      { text: "Discover", href: "/about" },
      { text: " shows it." },
    ]);
  });

  it("leaves a term the translation dropped as plain text", () => {
    expect(
      linkTerms("A directory of Jant blogs.", [
        { term: "Jant Discover", href: "/discover" },
      ]),
    ).toEqual([{ text: "A directory of Jant blogs." }]);
  });

  it("links nothing for an empty term or address", () => {
    expect(
      linkTerms("See Links.", [
        { term: "", href: "/links" },
        { term: "Links", href: "" },
      ]),
    ).toEqual([{ text: "See Links." }]);
  });
});

describe("discoverIntroRuns", () => {
  const terms = { name: "Jant Discover", rules: "Discover community rules" };
  const intro =
    "Jant Discover lists link and quote posts on Links and Quotes. See the Discover community rules.";

  // The settings page and the setup screen both render the line through here,
  // so this is the one place that says which words go where.
  it("links the name, both lists and the rules to their pages", () => {
    expect(
      discoverIntroRuns(intro, terms, getDiscoverPageUrls("https://jant.me/")),
    ).toEqual([
      { text: "Jant Discover", href: "https://jant.me/discover" },
      { text: " lists link and quote posts on " },
      { text: "Links", href: "https://jant.me/links" },
      { text: " and " },
      { text: "Quotes", href: "https://jant.me/quotes" },
      { text: ". See the " },
      {
        text: "Discover community rules",
        href: "https://jant.me/discover/about",
      },
      { text: "." },
    ]);
  });

  it("leaves the whole line plain when there is no directory", () => {
    expect(discoverIntroRuns(intro, terms, null)).toEqual([{ text: intro }]);
  });
});
