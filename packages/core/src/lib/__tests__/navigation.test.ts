import type { Context } from "hono";
import { describe, expect, it } from "vitest";
import type { NavItemView } from "../../types.js";
import {
  collectNavigationCollectionIds,
  getNavigationData,
} from "../navigation.js";

describe("getNavigationData", () => {
  it("renders site footer markdown through the shared pipeline", async () => {
    const context = {
      var: {
        publicPath: "/",
        currentSite: { id: "sit_navigation" },
        appConfig: {
          siteName: "Jant",
          sitePathPrefix: "",
          siteDescription: "Footer test",
          siteDescriptionExplicit: true,
          siteAvatarUrl: "",
          showHeaderAvatar: false,
          siteFooter:
            "Read the [docs](https://example.com)[^1]\n\n[^1]: Footer **note**\n\n<script>alert(1)</script>",
        },
        services: {
          navItems: {
            list: async () => [],
          },
          collections: {
            listByRecentActivity: async () => [],
          },
        },
        isAuthenticated: false,
        session: null,
      },
    } as unknown as Context;

    const result = await getNavigationData(context);

    expect(result.isAuthenticated).toBe(false);
    expect(result.collections).toEqual([]);
    expect(result.siteFooterHtml).toContain('role="doc-noteref"');
    expect(result.siteFooterHtml).toContain('role="doc-endnotes"');
    expect(result.siteFooterHtml).toContain("fn-2wpij13sz70fe-1");
    expect(result.siteFooterHtml).toContain("<strong>note</strong>");
    expect(result.siteFooterHtml).toContain(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  it("keeps system feed links fixed regardless of nav item order", async () => {
    const context = {
      var: {
        publicPath: "/",
        appConfig: {
          siteName: "Jant",
          sitePathPrefix: "",
          siteDescription: "",
          siteDescriptionExplicit: false,
          siteAvatarUrl: "",
          showHeaderAvatar: false,
          siteFooter: "",
        },
        services: {
          navItems: {
            list: async () => [
              {
                id: "nav_1",
                type: "system",
                systemKey: "featured",
                label: "Featured",
                url: "/featured",
                placement: "header",
                position: "a0",
                createdAt: 1,
                updatedAt: 1,
              },
              {
                id: "nav_2",
                type: "system",
                systemKey: "latest",
                label: "Latest",
                url: "/latest",
                placement: "header",
                position: "a1",
                createdAt: 1,
                updatedAt: 1,
              },
            ],
          },
          collections: {
            listByRecentActivity: async () => [],
          },
        },
        isAuthenticated: false,
        session: null,
      },
    } as unknown as Context;

    const result = await getNavigationData(context);

    expect(result.links[0]?.url).toBe("/featured");
    expect(result.links[1]?.url).toBe("/");
  });

  it("hides only the built-in RSS item when feeds are disabled", async () => {
    const context = {
      var: {
        publicPath: "/",
        appConfig: {
          siteName: "Jant",
          sitePathPrefix: "",
          siteOrigin: "https://example.com",
          siteDescription: "",
          siteDescriptionExplicit: false,
          siteAvatarUrl: "",
          showHeaderAvatar: false,
          siteFooter: "",
          rssFeedsEnabled: false,
        },
        services: {
          navItems: {
            list: async () => [
              {
                id: "nav_rss",
                type: "system",
                systemKey: "rss",
                label: "Feed",
                url: "/feed",
                placement: "header",
                position: "a0",
                createdAt: 1,
                updatedAt: 1,
              },
              {
                id: "nav_custom",
                type: "link",
                label: "Custom feed link",
                url: "/feed",
                placement: "header",
                position: "a1",
                createdAt: 1,
                updatedAt: 1,
              },
            ],
          },
          collections: {
            listByRecentActivity: async () => [],
          },
        },
        isAuthenticated: false,
        session: null,
      },
    } as unknown as Context;

    const result = await getNavigationData(context);

    expect(result.links.map((link) => link.id)).toEqual(["nav_custom"]);
  });

  // A post page's URL carries no language prefix, so its chrome is scoped by
  // the post's language instead of the request path.
  it("scopes the base path to an explicit language", async () => {
    const makeContext = (languageScope: string) =>
      ({
        var: {
          publicPath: "/some-post",
          appConfig: {
            siteName: "Jant",
            sitePathPrefix: "",
            siteDescription: "",
            siteDescriptionExplicit: false,
            siteAvatarUrl: "",
            showHeaderAvatar: false,
            siteFooter: "",
            siteLanguage: "zh-Hans",
            additionalLanguages: ["ja"],
            multilingualEnabled: true,
            rssFeedsEnabled: true,
          },
          services: {
            navItems: {
              list: async () => [
                {
                  id: "nav_latest",
                  type: "system",
                  systemKey: "latest",
                  label: "Latest",
                  url: "/",
                  placement: "header",
                  position: "a0",
                  createdAt: 1,
                  updatedAt: 1,
                },
              ],
            },
            collections: {
              listByRecentActivity: async () => [],
            },
          },
          isAuthenticated: false,
          session: null,
        },
      }) as unknown as Context;

    const japanese = await getNavigationData(makeContext("ja"), {
      languageScope: "ja",
    });
    expect(japanese.basePath).toBe("/ja");
    expect(japanese.links[0]?.url).toBe("/ja");

    const primary = await getNavigationData(makeContext("zh-Hans"), {
      languageScope: "zh-Hans",
    });
    expect(primary.basePath).toBe("");
    expect(primary.links[0]?.url).toBe("/");
  });
});

describe("collectNavigationCollectionIds", () => {
  // The directory used to read only `collection` items, so a smart collection
  // already in the navigation still offered "Add to Navigation".
  it("names both kinds of collection and ignores everything else", () => {
    const links = [
      { id: "nav_1", type: "system", systemKey: "home" },
      { id: "nav_2", type: "collection", collectionId: "col_1" },
      { id: "nav_3", type: "smart_collection", smartCollectionId: "smc_1" },
      { id: "nav_4", type: "link", url: "https://example.com" },
      { id: "nav_5", type: "collection" },
      { id: "nav_6", type: "smart_collection" },
    ] as unknown as NavItemView[];

    expect(collectNavigationCollectionIds(links)).toEqual(["col_1", "smc_1"]);
  });
});
