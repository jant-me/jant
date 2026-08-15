// @vitest-environment happy-dom

/**
 * `publicPath` vs `viewPath` — the client-side half of the language-view rule.
 *
 * The distinction is the same one the server draws with `toPublicPath` and
 * `toViewPath`: one address site-wide, or one address per language view.
 */

import { afterEach, describe, expect, it } from "vitest";
import { navPath, publicPath, viewPath } from "../runtime-paths.js";

afterEach(() => {
  delete document.documentElement.dataset.sitePathPrefix;
  delete document.documentElement.dataset.viewBasePath;
});

describe("viewPath", () => {
  it("carries the language prefix of the view being rendered", () => {
    document.documentElement.dataset.viewBasePath = "/en";
    expect(viewPath("/collections")).toBe("/en/collections");
    expect(viewPath("/recipes")).toBe("/en/recipes");
  });

  it("leaves publicPath alone, so site-wide addresses stay site-wide", () => {
    document.documentElement.dataset.viewBasePath = "/en";
    expect(publicPath("/collections")).toBe("/collections");
  });

  it("carries the site path prefix under it", () => {
    document.documentElement.dataset.sitePathPrefix = "/blog";
    document.documentElement.dataset.viewBasePath = "/blog/en";
    expect(viewPath("/collections")).toBe("/blog/en/collections");
    expect(publicPath("/collections")).toBe("/blog/collections");
  });

  it("falls back to the site path prefix when no view base is published", () => {
    // Pages rendered before the attribute existed, and any surface with no
    // language view: both must keep working as plain public paths.
    document.documentElement.dataset.sitePathPrefix = "/blog";
    expect(viewPath("/collections")).toBe("/blog/collections");
  });

  it("is a no-op at the root of a single-language site", () => {
    document.documentElement.dataset.viewBasePath = "";
    expect(viewPath("/collections")).toBe("/collections");
  });

  it("prefixes a root-namespace target the caller vouched for", () => {
    // A collection page lives at /{slug}, alongside post permalinks. Only the
    // call site can tell them apart, so viewPath takes its word for it.
    document.documentElement.dataset.viewBasePath = "/en";
    expect(viewPath("/recipes")).toBe("/en/recipes");
  });
});

describe("navPath", () => {
  afterEach(() => {
    delete document.documentElement.dataset.viewBasePath;
  });

  it("keeps per-language surfaces in the reader's view", () => {
    document.documentElement.dataset.viewBasePath = "/en";
    expect(navPath("/archive?media=any")).toBe("/en/archive?media=any");
    expect(navPath("/search?q=hello")).toBe("/en/search?q=hello");
    expect(navPath("/collections")).toBe("/en/collections");
    expect(navPath("/collections/a+b")).toBe("/en/collections/a+b");
  });

  it("leaves site-wide addresses alone, where a prefix would 404", () => {
    document.documentElement.dataset.viewBasePath = "/en";
    expect(navPath("/settings")).toBe("/settings");
    expect(navPath("/settings/language")).toBe("/settings/language");
    expect(navPath("/collections/recipes/edit")).toBe(
      "/collections/recipes/edit",
    );
  });

  it("leaves the root namespace alone, since a post has one address", () => {
    document.documentElement.dataset.viewBasePath = "/en";
    expect(navPath("/my-post")).toBe("/my-post");
    expect(navPath("/preview/my-post?edit=1")).toBe("/preview/my-post?edit=1");
  });
});
