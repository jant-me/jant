import type { Context } from "hono";
import { describe, expect, it } from "vitest";
import { getNavigationData } from "../navigation.js";

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
});
