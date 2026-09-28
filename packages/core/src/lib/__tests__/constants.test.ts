import { describe, it, expect } from "vitest";
import { createApp } from "../../app.js";
import { RESERVED_PATHS, isReservedPath } from "../constants.js";

describe("RESERVED_PATHS", () => {
  it("contains expected critical paths", () => {
    expect(RESERVED_PATHS).toContain("dash");
    expect(RESERVED_PATHS).toContain("api");
    expect(RESERVED_PATHS).toContain("feed");
    expect(RESERVED_PATHS).toContain("signin");
    expect(RESERVED_PATHS).toContain("search");
    expect(RESERVED_PATHS).toContain("collections");
    expect(RESERVED_PATHS).toContain("preview");
    expect(RESERVED_PATHS).toContain("_assets");
    expect(RESERVED_PATHS).toContain("skill.md");
  });
});

describe("isReservedPath", () => {
  it("returns true for reserved paths", () => {
    expect(isReservedPath("dash")).toBe(true);
    expect(isReservedPath("api")).toBe(true);
    expect(isReservedPath("feed")).toBe(true);
    expect(isReservedPath("signin")).toBe(true);
    expect(isReservedPath("skill.md")).toBe(true);
  });

  it("checks only the first segment", () => {
    expect(isReservedPath("dash/settings")).toBe(true);
    expect(isReservedPath("api/posts")).toBe(true);
    expect(isReservedPath("preview/draft-slug")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isReservedPath("DASH")).toBe(true);
    expect(isReservedPath("Api")).toBe(true);
    expect(isReservedPath("FEED")).toBe(true);
    expect(isReservedPath("PREVIEW/DRAFT-SLUG")).toBe(true);
  });

  // Every slug and custom URL starts with a letter or digit, so these are
  // where new system addresses go without taking one of the author's.
  it("reserves every first segment that starts with _ or .", () => {
    expect(isReservedPath("_x")).toBe(true);
    expect(isReservedPath("__sso")).toBe(true);
    expect(isReservedPath("_drafts/notes")).toBe(true);
    expect(isReservedPath(".well-known/security.txt")).toBe(true);
    expect(isReservedPath("notes/_x")).toBe(false);
  });

  it("returns false for non-reserved paths", () => {
    expect(isReservedPath("about")).toBe(false);
    expect(isReservedPath("contact")).toBe(false);
    expect(isReservedPath("my-custom-page")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isReservedPath("")).toBe(false);
  });
});

describe("reserved paths and the app's routes", () => {
  /**
   * A first segment a post, collection, or custom URL could claim. Slugs are
   * stricter; custom URL paths start with a letter or digit and may hold dots.
   */
  const ADDRESSABLE = /^[a-z0-9][a-z0-9.-]*$/;

  it("reserves every first segment the app routes at the root", () => {
    // A route at the root answers before the page catch-all, so an address
    // it shadows would be saved but never reachable.
    const segments = new Set(
      createApp()
        .routes.map((route) => route.path.split("/")[1] ?? "")
        .filter((segment) => ADDRESSABLE.test(segment)),
    );

    expect(segments.size).toBeGreaterThan(10);
    expect([...segments].filter((segment) => !isReservedPath(segment))).toEqual(
      [],
    );
  });

  it("reserves the sitemap family, numbered post sitemaps included", () => {
    for (const name of [
      "sitemap.xml",
      "sitemap-pages.xml",
      "sitemap-collections.xml",
      "sitemap-posts-12.xml",
    ]) {
      expect(isReservedPath(name), name).toBe(true);
    }
    expect(isReservedPath("sitemaps")).toBe(false);
    expect(isReservedPath("sitemap-notes")).toBe(false);
  });
});
