/**
 * View language resolution.
 *
 * These are the rules the language routes are built on: which first path
 * segment counts as a language, what the primary language's own prefix means,
 * and how links stay inside the view they were rendered in.
 */

import { describe, expect, it } from "vitest";
import type { Context } from "hono";
import type { AppConfig } from "../../types/config.js";
import {
  buildLanguageSwitcher,
  buildSurfaceAlternates,
  getViewLang,
  getViewLanguages,
  isPrefixedLanguageView,
  resolveLanguageView,
  toLanguagePath,
  toViewPath,
  viewBasePath,
  viewRelativePath,
} from "../view-language.js";

interface FakeContextOptions {
  path?: string;
  query?: string;
  viewLang?: string;
  siteLanguage?: string;
  additionalLanguages?: string[];
  multilingualEnabled?: boolean;
  sitePathPrefix?: string;
  siteUrl?: string;
}

/** Minimal stand-in for the request context these helpers actually read. */
function fakeContext(options: FakeContextOptions = {}) {
  const {
    path = "/",
    query = "",
    viewLang,
    siteLanguage = "zh-Hans",
    additionalLanguages = ["en"],
    multilingualEnabled = true,
    sitePathPrefix = "",
    siteUrl = "https://example.com",
  } = options;

  const appConfig = {
    siteLanguage,
    additionalLanguages,
    multilingualEnabled,
    sitePathPrefix,
    siteUrl,
  } as unknown as AppConfig;

  return {
    req: { path, url: `https://example.com${path}${query}` },
    var: { appConfig, viewLang },
  } as unknown as Parameters<typeof resolveLanguageView>[0];
}

describe("resolveLanguageView", () => {
  it("serves a configured language prefix as a view", () => {
    const c = fakeContext({ path: "/en/archive" });

    expect(resolveLanguageView(c)).toEqual({ kind: "view", lang: "en" });
  });

  it("matches the prefix case-insensitively", () => {
    const c = fakeContext({
      path: "/zh-hant",
      additionalLanguages: ["zh-Hant"],
    });

    expect(resolveLanguageView(c)).toEqual({ kind: "view", lang: "zh-Hant" });
  });

  it("passes a segment that is not a configured language", () => {
    expect(resolveLanguageView(fakeContext({ path: "/fr" }))).toEqual({
      kind: "pass",
    });
    expect(resolveLanguageView(fakeContext({ path: "/hello" }))).toEqual({
      kind: "pass",
    });
  });

  it("passes everything on a site with no second language", () => {
    // Without this, a post at /en on a single-language site would 404.
    const c = fakeContext({ path: "/en", additionalLanguages: [] });

    expect(resolveLanguageView(c)).toEqual({ kind: "pass" });
  });

  it("ignores the primary language repeated in the additional list", () => {
    const c = fakeContext({
      path: "/zh-hans",
      additionalLanguages: ["zh-Hans"],
    });

    expect(resolveLanguageView(c)).toEqual({ kind: "pass" });
  });

  describe("the primary language's own prefix", () => {
    it("redirects to the root it aliases", () => {
      const c = fakeContext({ path: "/zh-hans" });

      expect(resolveLanguageView(c)).toEqual({ kind: "redirect", to: "/" });
    });

    it("strips the prefix from sub-paths, keeping the query", () => {
      const c = fakeContext({ path: "/zh-hans/archive", query: "?year=2024" });

      expect(resolveLanguageView(c)).toEqual({
        kind: "redirect",
        to: "/archive?year=2024",
      });
    });

    it("keeps the deployment path prefix", () => {
      const c = fakeContext({
        path: "/zh-hans/archive",
        sitePathPrefix: "/blog",
      });

      expect(resolveLanguageView(c)).toEqual({
        kind: "redirect",
        to: "/blog/archive",
      });
    });
  });

  describe("after multilingual is switched off", () => {
    it("redirects a previously configured prefix", () => {
      // The configuration is retained so old links and feed subscriptions
      // keep working rather than 404ing.
      const c = fakeContext({ path: "/en/feed", multilingualEnabled: false });

      expect(resolveLanguageView(c)).toEqual({ kind: "redirect", to: "/feed" });
    });
  });
});

describe("getViewLang", () => {
  it("returns the prefix language inside a language view", () => {
    expect(getViewLang(fakeContext({ viewLang: "en" }))).toBe("en");
  });

  it("returns the primary language at the root of a multilingual site", () => {
    // The root is the primary language's view — otherwise `/` would show every
    // language while `/en` showed one.
    expect(getViewLang(fakeContext())).toBe("zh-Hans");
  });

  it("returns null on a single-language site", () => {
    expect(getViewLang(fakeContext({ multilingualEnabled: false }))).toBeNull();
    expect(getViewLang(fakeContext({ additionalLanguages: [] }))).toBeNull();
  });
});

describe("isPrefixedLanguageView", () => {
  it("is true only under a language prefix", () => {
    expect(isPrefixedLanguageView(fakeContext({ viewLang: "en" }))).toBe(true);
    expect(isPrefixedLanguageView(fakeContext())).toBe(false);
  });
});

describe("path helpers", () => {
  it("prefixes in-view links and leaves root links alone", () => {
    const inView = fakeContext({ viewLang: "en" });
    const atRoot = fakeContext();

    expect(toViewPath(inView, "/")).toBe("/en");
    expect(toViewPath(inView, "/archive")).toBe("/en/archive");
    expect(toViewPath(atRoot, "/")).toBe("/");
    expect(toViewPath(atRoot, "/archive")).toBe("/archive");
  });

  it("composes with the deployment path prefix", () => {
    const c = fakeContext({ viewLang: "en", sitePathPrefix: "/blog" });

    expect(toViewPath(c, "/")).toBe("/blog/en");
    expect(toViewPath(c, "/archive")).toBe("/blog/en/archive");
    expect(viewBasePath(c)).toBe("/en");
  });

  it("strips the prefix when resolving against site content", () => {
    expect(
      viewRelativePath(fakeContext({ path: "/en/hello", viewLang: "en" })),
    ).toBe("/hello");
    expect(viewRelativePath(fakeContext({ path: "/en", viewLang: "en" }))).toBe(
      "/",
    );
    expect(viewRelativePath(fakeContext({ path: "/hello" }))).toBe("/hello");
  });

  it("builds paths into another language's view", () => {
    const c = fakeContext({ viewLang: "en" });

    expect(toLanguagePath(c, "zh-Hans", "/archive")).toBe("/archive");
    expect(toLanguagePath(c, "en", "/archive")).toBe("/en/archive");
    expect(toLanguagePath(c, null, "/")).toBe("/");
  });
});

describe("getViewLanguages", () => {
  it("lists the primary language first", () => {
    expect(
      getViewLanguages(fakeContext({ additionalLanguages: ["en", "ja"] })),
    ).toEqual(["zh-Hans", "en", "ja"]);
  });

  it("is empty when the site serves one language", () => {
    expect(
      getViewLanguages(fakeContext({ multilingualEnabled: false })),
    ).toEqual([]);
    expect(getViewLanguages(fakeContext({ additionalLanguages: [] }))).toEqual(
      [],
    );
  });
});

describe("buildSurfaceAlternates", () => {
  it("points at the same surface in every language", () => {
    const c = fakeContext({ path: "/en/archive", viewLang: "en" });

    expect(buildSurfaceAlternates(c)).toEqual([
      { hreflang: "zh-Hans", href: "https://example.com/archive" },
      { hreflang: "en", href: "https://example.com/en/archive" },
      { hreflang: "x-default", href: "https://example.com/archive" },
    ]);
  });

  it("keeps the query string, so a filtered view alternates correctly", () => {
    const c = fakeContext({ path: "/archive", query: "?year=2024" });

    expect(buildSurfaceAlternates(c)[1]).toEqual({
      hreflang: "en",
      href: "https://example.com/en/archive?year=2024",
    });
  });

  it("is empty without an absolute site URL, which hreflang requires", () => {
    expect(buildSurfaceAlternates(fakeContext({ siteUrl: "" }))).toEqual([]);
  });

  it("is empty on a single-language site", () => {
    expect(
      buildSurfaceAlternates(fakeContext({ multilingualEnabled: false })),
    ).toEqual([]);
  });
});

describe("buildLanguageSwitcher", () => {
  it("offers the current surface in each language", () => {
    const c = fakeContext({ path: "/en/archive", viewLang: "en" });

    expect(buildLanguageSwitcher(c)).toEqual([
      {
        lang: "zh-Hans",
        label: "简体中文",
        href: "/archive",
        isCurrent: false,
      },
      { lang: "en", label: "English", href: "/en/archive", isCurrent: true },
    ]);
  });

  it("takes an explicit destination per language", () => {
    // A post links to its translation, not to its own path in another view.
    const c = fakeContext({ path: "/my-post" });

    expect(
      buildLanguageSwitcher(c, {
        hrefByLanguage: new Map([["en", "/the-translation"]]),
        fallbackPath: "/",
        currentLang: "zh-Hans",
      }),
    ).toEqual([
      { lang: "zh-Hans", label: "简体中文", href: "/", isCurrent: true },
      {
        lang: "en",
        label: "English",
        href: "/the-translation",
        isCurrent: false,
      },
    ]);
  });

  it("falls back to a language's home when there is no translation", () => {
    const c = fakeContext({ path: "/my-post" });

    const options = buildLanguageSwitcher(c, { fallbackPath: "/" });
    expect(options.map((option) => option.href)).toEqual(["/", "/en"]);
  });

  it("is empty on a single-language site", () => {
    expect(
      buildLanguageSwitcher(fakeContext({ additionalLanguages: [] })),
    ).toEqual([]);
  });
});
