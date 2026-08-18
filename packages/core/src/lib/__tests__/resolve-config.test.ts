import { describe, it, expect } from "vitest";
import { resolveConfig, resolveSummaryConfig } from "../resolve-config.js";
import type { Bindings } from "../../types/bindings.js";

function makeEnv(overrides: Partial<Bindings> = {}): Bindings {
  return {
    DB: {} as D1Database,
    R2: undefined as unknown as R2Bucket,
    AUTH_SECRET: "",
    SITE_ORIGIN: "https://example.com",
    SITE_PATH_PREFIX: "",
    R2_PUBLIC_URL: "",
    IMAGE_TRANSFORM_URL: "",
    S3_PUBLIC_URL: "",
    STORAGE_DRIVER: "",
    ...overrides,
  } as Bindings;
}

describe("resolveConfig", () => {
  it("uses defaults when no settings or env overrides", () => {
    const config = resolveConfig(makeEnv(), {});

    expect(config.siteName).toBe("Jant");
    expect(config.siteDescription).toBe("");
    expect(config.siteLanguage).toBe("en");
    expect(config.mainRssFeed).toBe("featured");
    expect(config.timeZone).toBe("UTC");
    expect(config.showJantBrandingOnHome).toBe(false);
    expect(config.noindex).toBe(false);
    expect(config.publicApiEnabled).toBe(true);
    expect(config.rssFeedsEnabled).toBe(true);
    expect(config.demoMode).toBe(false);
    expect(config.pageSize).toBe(50);
    expect(config.searchPageSize).toBe(50);
    expect(config.archivePageSize).toBe(50);
    expect(config.rssFeedLimit).toBe(50);
    expect(config.rssPublishDelaySeconds).toBe(300);
  });

  it("DB settings override ENV and defaults", () => {
    const config = resolveConfig(makeEnv({ SITE_NAME: "FromEnv" }), {
      SITE_NAME: "FromDB",
    });

    expect(config.siteName).toBe("FromDB");
  });

  it("ENV overrides defaults when DB is empty", () => {
    const config = resolveConfig(makeEnv({ SITE_NAME: "FromEnv" }), {});

    expect(config.siteName).toBe("FromEnv");
  });

  it("lets an explicit empty DB value override an environment fallback", () => {
    const config = resolveConfig(
      makeEnv({ SITE_DESCRIPTION: "From environment" }),
      { SITE_DESCRIPTION: "" },
    );

    expect(config.siteDescription).toBe("");
    expect(config.siteDescriptionExplicit).toBe(false);
  });

  it("resolves mainRssFeed from DB, env, and defaults", () => {
    const defaultConfig = resolveConfig(makeEnv(), {});
    expect(defaultConfig.mainRssFeed).toBe("featured");

    const envConfig = resolveConfig(makeEnv({ MAIN_RSS_FEED: "latest" }), {});
    expect(envConfig.mainRssFeed).toBe("latest");

    const dbConfig = resolveConfig(makeEnv({ MAIN_RSS_FEED: "featured" }), {
      MAIN_RSS_FEED: "latest",
    });
    expect(dbConfig.mainRssFeed).toBe("latest");
  });

  it("falls back when feed kind settings are invalid", () => {
    const config = resolveConfig(makeEnv({ MAIN_RSS_FEED: "nope" }), {});

    expect(config.mainRssFeed).toBe("featured");
  });

  it("resolves archiveDefaultLayout from DB, env, and defaults", () => {
    const defaultConfig = resolveConfig(makeEnv(), {});
    expect(defaultConfig.archiveDefaultLayout).toBe("list");

    const envConfig = resolveConfig(
      makeEnv({ ARCHIVE_DEFAULT_LAYOUT: "grid" }),
      {},
    );
    expect(envConfig.archiveDefaultLayout).toBe("grid");

    const dbConfig = resolveConfig(
      makeEnv({ ARCHIVE_DEFAULT_LAYOUT: "list" }),
      {
        ARCHIVE_DEFAULT_LAYOUT: "grid",
      },
    );
    expect(dbConfig.archiveDefaultLayout).toBe("grid");
  });

  it("falls back when the archive layout setting is invalid", () => {
    const config = resolveConfig(
      makeEnv({ ARCHIVE_DEFAULT_LAYOUT: "carousel" }),
      {},
    );

    expect(config.archiveDefaultLayout).toBe("list");
  });

  it("normalizes legacy time zone values from the database", () => {
    const config = resolveConfig(makeEnv(), { TIME_ZONE: "Beijing" });

    expect(config.timeZone).toBe("Asia/Shanghai");
  });

  it("resolves siteDescriptionExplicit correctly", () => {
    // Default only -> not explicit
    const config1 = resolveConfig(makeEnv(), {});
    expect(config1.siteDescriptionExplicit).toBe(false);

    // DB setting -> explicit
    const config2 = resolveConfig(makeEnv(), {
      SITE_DESCRIPTION: "Custom description",
    });
    expect(config2.siteDescriptionExplicit).toBe(true);

    // ENV setting -> explicit
    const config3 = resolveConfig(
      makeEnv({
        SITE_DESCRIPTION: "Env description",
      }),
      {},
    );
    expect(config3.siteDescriptionExplicit).toBe(true);
  });

  it("resolves media URLs from env", () => {
    const config = resolveConfig(
      makeEnv({
        R2_PUBLIC_URL: "https://r2.example.com",
        IMAGE_TRANSFORM_URL: "https://img.example.com",
        S3_PUBLIC_URL: "https://s3.example.com",
        LOCAL_PUBLIC_URL: "https://media.example.com",
        STORAGE_DRIVER: "s3",
      }),
      {},
    );

    expect(config.r2PublicUrl).toBe("https://r2.example.com");
    expect(config.imageTransformUrl).toBe("https://img.example.com");
    expect(config.s3PublicUrl).toBe("https://s3.example.com");
    expect(config.localPublicUrl).toBe("https://media.example.com");
    expect(config.storageDriver).toBe("s3");
  });

  it("defaults to local storage in the Node runtime", () => {
    const config = resolveConfig(
      makeEnv({
        NODE_SQLITE: {} as Bindings["NODE_SQLITE"],
      }),
      {},
    );

    expect(config.storageDriver).toBe("local");
  });

  it("defaults to local storage in the Node Postgres runtime", () => {
    const config = resolveConfig(
      makeEnv({
        NODE_DATABASE: {
          db: {} as Bindings["NODE_DATABASE"]["db"],
          dialect: "pg",
          rawQuery: {} as Bindings["NODE_DATABASE"]["rawQuery"],
          schema: {} as Bindings["NODE_DATABASE"]["schema"],
        },
      }),
      {},
    );

    expect(config.storageDriver).toBe("local");
  });

  it("resolves siteAvatarUrl from storage key", () => {
    const config = resolveConfig(
      makeEnv({
        R2_PUBLIC_URL: "https://r2.example.com",
        STORAGE_DRIVER: "r2",
      }),
      {
        SITE_AVATAR:
          "media/sit_test00000000000000000000000/assets/avatar/avatar.jpg",
      },
    );

    expect(config.siteAvatar).toBe(
      "media/sit_test00000000000000000000000/assets/avatar/avatar.jpg",
    );
    expect(config.siteAvatarUrl).toBe(
      "https://r2.example.com/media/sit_test00000000000000000000000/assets/avatar/avatar.jpg",
    );
  });

  it("returns empty siteAvatarUrl when no avatar set", () => {
    const config = resolveConfig(makeEnv(), {});
    expect(config.siteAvatarUrl).toBe("");
  });

  it("derives the public asset base path from the site path prefix", () => {
    const rootConfig = resolveConfig(makeEnv(), {});
    const prefixedConfig = resolveConfig(
      makeEnv({ SITE_PATH_PREFIX: "/blog" }),
      {},
    );

    expect(rootConfig.assetBasePath).toBe("/_assets");
    expect(prefixedConfig.assetBasePath).toBe("/blog/_assets");
  });

  it("ignores SITE_ORIGIN and SITE_PATH_PREFIX by default in host-based mode", () => {
    const config = resolveConfig(
      makeEnv({
        SITE_RESOLUTION_MODE: "host-based",
        SITE_ORIGIN: "https://legacy.example.com",
        SITE_PATH_PREFIX: "/blog",
      }),
      {},
    );

    expect(config.siteUrl).toBe("");
    expect(config.siteOrigin).toBe("");
    expect(config.sitePathPrefix).toBe("");
    expect(config.assetBasePath).toBe("/_assets");
  });

  it("resolves boolean fields correctly", () => {
    const config = resolveConfig(makeEnv(), {
      NOINDEX: "true",
      PUBLIC_API_ENABLED: "false",
      RSS_FEEDS_ENABLED: "false",
      SHOW_HEADER_AVATAR: "true",
      SHOW_JANT_BRANDING_ON_HOME: "true",
    });

    expect(config.noindex).toBe(true);
    expect(config.publicApiEnabled).toBe(false);
    expect(config.rssFeedsEnabled).toBe(false);
    expect(config.showHeaderAvatar).toBe(true);
    expect(config.showJantBrandingOnHome).toBe(true);
  });

  it("forces noindex when DEMO_MODE is enabled", () => {
    const config = resolveConfig(
      makeEnv({
        DEMO_MODE: true,
      }),
      {},
    );

    expect(config.demoMode).toBe(true);
    expect(config.noindex).toBe(true);
  });

  it("resolves authConfigured from AUTH_SECRET", () => {
    const noAuth = resolveConfig(makeEnv(), {});
    expect(noAuth.authConfigured).toBe(false);

    const withAuth = resolveConfig(makeEnv({ AUTH_SECRET: "supersecret" }), {});
    expect(withAuth.authConfigured).toBe(true);
  });

  it("parses numeric fields with fallbacks", () => {
    const config1 = resolveConfig(
      makeEnv({
        PAGE_SIZE: 10,
        SEARCH_PAGE_SIZE: 7,
        ARCHIVE_PAGE_SIZE: "9",
        RSS_FEED_LIMIT: 25,
        RSS_PUBLISH_DELAY_SECONDS: "600",
      }),
      {},
    );
    expect(config1.pageSize).toBe(10);
    expect(config1.searchPageSize).toBe(7);
    expect(config1.archivePageSize).toBe(9);
    expect(config1.rssFeedLimit).toBe(25);
    expect(config1.rssPublishDelaySeconds).toBe(600);

    const configWithNoDelay = resolveConfig(
      makeEnv({ RSS_PUBLISH_DELAY_SECONDS: 0 }),
      {},
    );
    expect(configWithNoDelay.rssPublishDelaySeconds).toBe(0);

    const config2 = resolveConfig(
      makeEnv({
        PAGE_SIZE: "not-a-number",
        SEARCH_PAGE_SIZE: 0,
        ARCHIVE_PAGE_SIZE: false,
        RSS_FEED_LIMIT: "invalid",
        RSS_PUBLISH_DELAY_SECONDS: "-1",
      }),
      {},
    );
    expect(config2.pageSize).toBe(50);
    expect(config2.searchPageSize).toBe(50);
    expect(config2.archivePageSize).toBe(50);
    expect(config2.rssFeedLimit).toBe(50);
    expect(config2.rssPublishDelaySeconds).toBe(300);

    const configWithBlankDelay = resolveConfig(
      makeEnv({ RSS_PUBLISH_DELAY_SECONDS: "   " }),
      {},
    );
    expect(configWithBlankDelay.rssPublishDelaySeconds).toBe(300);
  });

  it("resolves runtime numeric settings from DB before environment values", () => {
    const config = resolveConfig(
      makeEnv({
        PAGE_SIZE: "20",
        SEARCH_PAGE_SIZE: "25",
        ARCHIVE_PAGE_SIZE: "30",
        SUMMARY_MAX_PARAGRAPHS: "6",
        SUMMARY_MAX_CHARS: "600",
        RSS_FEED_LIMIT: "60",
        RSS_PUBLISH_DELAY_SECONDS: "600",
      }),
      {
        PAGE_SIZE: "80",
        SUMMARY_MAX_PARAGRAPHS: "12",
        SUMMARY_MAX_CHARS: "1200",
        RSS_FEED_LIMIT: "120",
        RSS_PUBLISH_DELAY_SECONDS: "0",
      },
    );

    expect(config.pageSize).toBe(80);
    expect(config.searchPageSize).toBe(25);
    expect(config.archivePageSize).toBe(30);
    expect(config.summaryMaxParagraphs).toBe(12);
    expect(config.summaryMaxChars).toBe(1200);
    expect(config.rssFeedLimit).toBe(120);
    expect(config.rssPublishDelaySeconds).toBe(0);
  });

  it("inherits runtime page size and rejects out-of-range numeric values", () => {
    const config = resolveConfig(
      makeEnv({
        PAGE_SIZE: "101",
        SEARCH_PAGE_SIZE: "0",
        ARCHIVE_PAGE_SIZE: "1.5",
        SUMMARY_MAX_PARAGRAPHS: "51",
        SUMMARY_MAX_CHARS: "1501",
        RSS_FEED_LIMIT: "201",
        RSS_PUBLISH_DELAY_SECONDS: "7201",
      }),
      { PAGE_SIZE: "75" },
    );

    expect(config.pageSize).toBe(75);
    expect(config.searchPageSize).toBe(75);
    expect(config.archivePageSize).toBe(75);
    expect(config.summaryMaxParagraphs).toBe(5);
    expect(config.summaryMaxChars).toBe(500);
    expect(config.rssFeedLimit).toBe(50);
    expect(config.rssPublishDelaySeconds).toBe(300);
  });

  it("resolves summary limits without the full app config", () => {
    expect(
      resolveSummaryConfig(
        makeEnv({
          SUMMARY_MAX_PARAGRAPHS: "3",
          SUMMARY_MAX_CHARS: 240,
        }),
      ),
    ).toEqual({ maxParagraphs: 3, maxChars: 240 });

    expect(
      resolveSummaryConfig(
        makeEnv({
          SUMMARY_MAX_PARAGRAPHS: 0,
          SUMMARY_MAX_CHARS: "invalid",
        }),
      ),
    ).toEqual({ maxParagraphs: 5, maxChars: 500 });

    expect(
      resolveSummaryConfig(makeEnv({ SUMMARY_MAX_CHARS: "240" }), {
        SUMMARY_MAX_PARAGRAPHS: "8",
        SUMMARY_MAX_CHARS: "900",
      }),
    ).toEqual({ maxParagraphs: 8, maxChars: 900 });
  });

  it("resolves fallbacks without DB values", () => {
    const config = resolveConfig(makeEnv({ SITE_NAME: "EnvName" }), {
      SITE_NAME: "DBName",
    });

    // fallback should use ENV > Default, skipping DB
    expect(config.fallbacks.siteName).toBe("EnvName");
  });

  it("resolves theme fields from DB settings", () => {
    const config = resolveConfig(makeEnv(), {
      THEME: "blue",
      FONT_THEME: "serif",
      THEME_MODE: "dark",
      CUSTOM_CSS: "body { color: red; }",
    });

    expect(config.themeId).toBe("blue");
    expect(config.fontThemeId).toBe("serif");
    expect(config.themeMode).toBe("dark");
    expect(config.customCSS).toBe("body { color: red; }");
  });

  it("falls back to auto when THEME_MODE is missing or invalid", () => {
    const config1 = resolveConfig(makeEnv(), {});
    expect(config1.themeMode).toBe("auto");

    const config2 = resolveConfig(makeEnv(), { THEME_MODE: "sunset" });
    expect(config2.themeMode).toBe("auto");
  });

  it("resolves defaultThemeId from env", () => {
    const config = resolveConfig(makeEnv({ DEFAULT_THEME: "dark" }), {});
    expect(config.defaultThemeId).toBe("dark");

    // Falls back to hardcoded default
    const config2 = resolveConfig(makeEnv(), {});
    expect(config2.defaultThemeId).toBe("tufte");
  });

  it("themeId falls through DB → ENV → hardcoded default", () => {
    // DB wins
    const c1 = resolveConfig(makeEnv({ DEFAULT_THEME: "linen" }), {
      THEME: "frost",
    });
    expect(c1.themeId).toBe("frost");

    // ENV fallback
    const c2 = resolveConfig(makeEnv({ DEFAULT_THEME: "linen" }), {});
    expect(c2.themeId).toBe("linen");

    // Hardcoded default
    const c3 = resolveConfig(makeEnv(), {});
    expect(c3.themeId).toBe("tufte");
  });

  it("fontThemeId falls through DB → ENV → hardcoded default", () => {
    const c1 = resolveConfig(makeEnv({ DEFAULT_FONT_THEME: "tufte" }), {
      FONT_THEME: "geometric",
    });
    expect(c1.fontThemeId).toBe("geometric");

    const c2 = resolveConfig(makeEnv({ DEFAULT_FONT_THEME: "tufte" }), {});
    expect(c2.fontThemeId).toBe("tufte");

    const c3 = resolveConfig(makeEnv(), {});
    expect(c3.fontThemeId).toBe("classic");
  });

  it("uses unprefixed env names across the config surface", () => {
    const config = resolveConfig(
      makeEnv({
        SITE_ORIGIN: "https://canonical.example.com",
        SITE_PATH_PREFIX: "/blog",
        AUTH_SECRET: "legacy-secret",
        STORAGE_DRIVER: "s3",
        S3_PUBLIC_URL: "https://legacy-s3.example.com",
      }),
      {},
    );

    expect(config.siteUrl).toBe("https://canonical.example.com/blog");
    expect(config.siteOrigin).toBe("https://canonical.example.com");
    expect(config.sitePathPrefix).toBe("/blog");
    expect(config.authConfigured).toBe(true);
    expect(config.storageDriver).toBe("s3");
    expect(config.s3PublicUrl).toBe("https://legacy-s3.example.com");
  });
});
