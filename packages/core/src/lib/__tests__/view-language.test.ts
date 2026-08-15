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
  isPerLanguageSurface,
  isPrefixedLanguageView,
  languageScopeBasePath,
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

describe("languageScopeBasePath", () => {
  it("scopes an active non-primary language to its prefix", () => {
    expect(languageScopeBasePath(fakeContext(), "en")).toBe("/en");
  });

  it("keeps the primary language at the root", () => {
    expect(languageScopeBasePath(fakeContext(), "zh-Hans")).toBe("");
  });

  it("stays at the root without a language", () => {
    expect(languageScopeBasePath(fakeContext(), null)).toBe("");
  });

  it("stays at the root while multilingual is off", () => {
    // A post keeps its language column after the feature is switched off,
    // but there is no /en view to scope its chrome to any more.
    expect(
      languageScopeBasePath(fakeContext({ multilingualEnabled: false }), "en"),
    ).toBe("");
  });

  it("ignores a language the site no longer publishes", () => {
    expect(languageScopeBasePath(fakeContext(), "ja")).toBe("");
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
        isPrimary: true,
      },
      {
        lang: "en",
        label: "English",
        href: "/en/archive",
        isCurrent: true,
        isPrimary: false,
      },
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
      {
        lang: "zh-Hans",
        label: "简体中文",
        href: "/",
        isCurrent: true,
        isPrimary: true,
      },
      {
        lang: "en",
        label: "English",
        href: "/the-translation",
        isCurrent: false,
        isPrimary: false,
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

  it("aims at each language's home from a page no language view serves", () => {
    // /ja/settings/language would be a 404 — the switcher must never mint one.
    const c = fakeContext({ path: "/settings/language" });

    expect(buildLanguageSwitcher(c).map((option) => option.href)).toEqual([
      "/",
      "/en",
    ]);
  });
});

describe("isPerLanguageSurface", () => {
  it("recognizes the surfaces the language routes serve", () => {
    expect(isPerLanguageSurface("/")).toBe(true);
    expect(isPerLanguageSurface("/archive")).toBe(true);
    expect(isPerLanguageSurface("/collections/reading")).toBe(true);
  });

  it("rejects everything without a per-language counterpart", () => {
    expect(isPerLanguageSurface("/settings")).toBe(false);
    expect(isPerLanguageSurface("/settings/language")).toBe(false);
    expect(isPerLanguageSurface("/my-post")).toBe(false);
  });

  it("separates collection pages from the collection editors", () => {
    // `langGet()` serves /collections/:slug and its feed, and nothing else
    // under /collections — the editors are registered once, outside it.
    expect(isPerLanguageSurface("/collections/a+b")).toBe(true);
    expect(isPerLanguageSurface("/collections/a+b/feed")).toBe(true);
    expect(isPerLanguageSurface("/collections/new")).toBe(false);
    expect(isPerLanguageSurface("/collections/reading/edit")).toBe(false);
  });

  it("ignores a query string, so a built link can be passed as-is", () => {
    expect(isPerLanguageSurface("/archive?media=any")).toBe(true);
    expect(isPerLanguageSurface("/search?q=hello")).toBe(true);
    expect(isPerLanguageSurface("/settings?tab=general")).toBe(false);
  });
});
