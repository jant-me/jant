import { describe, expect, it } from "vitest";
import {
  getDiscoverDirectoryUrl,
  getDiscoverFeedPath,
  getDiscoverSubmitUrl,
  measureDiscoverMaturity,
  parseDiscoverSetting,
  resolveDiscoverMode,
} from "../discover.js";
import { DEFAULT_DISCOVER_PING_URL, getDiscoverPingUrl } from "../env.js";

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

describe("getDiscoverDirectoryUrl", () => {
  // The settings page links the directory's name to the directory itself, so
  // "what is Discover" is answered by the list rather than by a page about it.
  it("finds the directory behind its own ping endpoint", () => {
    expect(getDiscoverDirectoryUrl("https://jant.me/api/discover/ping")).toBe(
      "https://jant.me/discover",
    );
  });

  it("follows a directory of your own", () => {
    expect(
      getDiscoverDirectoryUrl("https://directory.example/api/discover/ping"),
    ).toBe("https://directory.example/discover");
  });

  it("has nothing to link to when no directory is configured", () => {
    expect(getDiscoverDirectoryUrl(undefined)).toBeNull();
    expect(getDiscoverDirectoryUrl("")).toBeNull();
    expect(getDiscoverDirectoryUrl("not a url")).toBeNull();
  });
});
