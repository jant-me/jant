import { describe, expect, it } from "vitest";
import {
  getDiscoverFeedPath,
  getDiscoverSubmitUrl,
  parseDiscoverSetting,
  resolveDiscoverMode,
} from "../discover.js";
import { DEFAULT_DISCOVER_PING_URL, getDiscoverPingUrl } from "../env.js";

function resolve(
  overrides: Partial<Parameters<typeof resolveDiscoverMode>[0]>,
) {
  return resolveDiscoverMode({
    explicitValue: null,
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
  it("lists an ordinary site that never touched the setting", () => {
    expect(resolve({})).toBe("latest");
  });

  it("honours an explicit choice", () => {
    expect(resolve({ explicitValue: "featured" })).toBe("featured");
    expect(resolve({ explicitValue: "off" })).toBe("none");
  });

  // Hiding from search engines and being surfaced by a directory contradict
  // each other, and the quieter reading is the safe one.
  it("reads noindex as none while the setting is unset", () => {
    expect(resolve({ noindex: true })).toBe("none");
  });

  it("lets an explicit choice override noindex", () => {
    expect(resolve({ noindex: true, explicitValue: "latest" })).toBe("latest");
    expect(resolve({ noindex: true, explicitValue: "featured" })).toBe(
      "featured",
    );
  });

  // Demos exist to be thrown away; nothing they publish belongs in a directory.
  it("locks demo sites out even when they ask to be listed", () => {
    expect(resolve({ demoMode: true })).toBe("none");
    expect(resolve({ demoMode: true, explicitValue: "featured" })).toBe("none");
  });

  // Every feed path 404s with feeds off, so there would be nothing to poll.
  it("declares none when the site publishes no feeds", () => {
    expect(resolve({ rssFeedsEnabled: false })).toBe("none");
    expect(resolve({ rssFeedsEnabled: false, explicitValue: "latest" })).toBe(
      "none",
    );
  });

  it("ignores a stored value it does not recognize", () => {
    expect(resolve({ explicitValue: "sometimes" })).toBe("latest");
    expect(resolve({ explicitValue: "sometimes", noindex: true })).toBe("none");
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
