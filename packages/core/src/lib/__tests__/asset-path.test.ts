import { describe, expect, it } from "vitest";
import {
  ASSET_BASE_PATH,
  getPreconnectHints,
  getPublicAssetBasePath,
  isAssetPath,
  toAssetPath,
  toPublicAssetPath,
} from "../asset-path.js";

describe("getPublicAssetBasePath", () => {
  it("uses the root asset path when the site has no prefix", () => {
    expect(getPublicAssetBasePath("")).toBe("/_assets");
  });

  it("includes the site prefix in the public asset path", () => {
    expect(getPublicAssetBasePath("/blog")).toBe("/blog/_assets");
  });
});

describe("toAssetPath", () => {
  it("joins relative asset paths against the internal base path", () => {
    expect(toAssetPath("client.js")).toBe("/_assets/client.js");
  });

  it("joins relative asset paths against a prefixed public base path", () => {
    expect(toAssetPath("chunks/app.js", "/blog/_assets")).toBe(
      "/blog/_assets/chunks/app.js",
    );
  });
});

describe("isAssetPath", () => {
  it("matches the internal asset namespace", () => {
    expect(isAssetPath("/_assets/client.css")).toBe(true);
  });

  it("matches prefixed public asset namespaces", () => {
    expect(isAssetPath("/blog/_assets/client.css", "/blog/_assets")).toBe(true);
  });
});

describe("toPublicAssetPath", () => {
  it("rewrites internal asset paths to the public asset base path", () => {
    expect(
      toPublicAssetPath(`${ASSET_BASE_PATH}/client.js`, "/blog/_assets"),
    ).toBe("/blog/_assets/client.js");
  });

  it("leaves already-public asset paths unchanged", () => {
    expect(toPublicAssetPath("/blog/_assets/client.js", "/blog/_assets")).toBe(
      "/blog/_assets/client.js",
    );
  });
});

describe("getPreconnectHints", () => {
  const site = "https://example.com";

  it("hints both connection kinds for a CDN asset host", () => {
    expect(
      getPreconnectHints({
        assetBasePath: "https://cdn.example.com/jant",
        siteUrl: site,
      }),
    ).toEqual([
      { href: "https://cdn.example.com", crossorigin: false },
      { href: "https://cdn.example.com", crossorigin: true },
    ]);
  });

  it("adds the media host after the asset host", () => {
    expect(
      getPreconnectHints({
        assetBasePath: "https://cdn.example.com/jant",
        mediaBaseUrl: "https://media.example.com",
        siteUrl: site,
      }),
    ).toEqual([
      { href: "https://cdn.example.com", crossorigin: false },
      { href: "https://cdn.example.com", crossorigin: true },
      { href: "https://media.example.com", crossorigin: false },
    ]);
  });

  it("hints a shared asset and media host only once", () => {
    expect(
      getPreconnectHints({
        assetBasePath: "https://cdn.example.com/_assets",
        mediaBaseUrl: "https://cdn.example.com/media",
        siteUrl: site,
      }),
    ).toEqual([
      { href: "https://cdn.example.com", crossorigin: false },
      { href: "https://cdn.example.com", crossorigin: true },
    ]);
  });

  it("hints the media host on its own when assets are same-origin", () => {
    expect(
      getPreconnectHints({
        assetBasePath: "/_assets",
        mediaBaseUrl: "https://media.example.com",
        siteUrl: site,
      }),
    ).toEqual([{ href: "https://media.example.com", crossorigin: false }]);
  });

  it("hints nothing when everything shares the site's origin", () => {
    expect(
      getPreconnectHints({
        assetBasePath: "/blog/_assets",
        mediaBaseUrl: "",
        siteUrl: "https://example.com/blog",
      }),
    ).toEqual([]);
    expect(
      getPreconnectHints({
        assetBasePath: "https://example.com/_assets",
        mediaBaseUrl: "https://example.com/media",
        siteUrl: site,
      }),
    ).toEqual([]);
  });

  it("hints anyway when the site URL is missing or unparseable", () => {
    expect(
      getPreconnectHints({ assetBasePath: "https://cdn.example.com" }),
    ).toEqual([
      { href: "https://cdn.example.com", crossorigin: false },
      { href: "https://cdn.example.com", crossorigin: true },
    ]);
    expect(
      getPreconnectHints({
        assetBasePath: "https://cdn.example.com",
        siteUrl: "not a url",
      }),
    ).toHaveLength(2);
  });

  it("skips a base URL it cannot parse", () => {
    expect(
      getPreconnectHints({ assetBasePath: "https://", siteUrl: site }),
    ).toEqual([]);
  });
});
