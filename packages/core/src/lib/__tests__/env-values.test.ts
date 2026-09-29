import { describe, expect, it } from "vitest";
import { getEnvValueIssues, readConfigEnvValue } from "../env-values.js";
import { resolveConfig } from "../resolve-config.js";
import { buildApiSettingsResponse } from "../api-settings.js";
import type { Bindings } from "../../types.js";

function variables(env: Record<string, unknown>): string[] {
  return getEnvValueIssues(env)
    .map((issue) => issue.variable)
    .sort();
}

describe("getEnvValueIssues", () => {
  it("accepts every value a setting or rule allows", () => {
    expect(
      getEnvValueIssues({
        PUBLIC_API_ENABLED: "TRUE",
        NOINDEX: "false",
        PAGE_SIZE: "100",
        RSS_PUBLISH_DELAY_SECONDS: "0",
        MAIN_RSS_FEED: "latest",
        TIME_ZONE: "Asia/Shanghai",
        SITE_LANGUAGE: "zh-Hans",
        STORAGE_DRIVER: "s3",
        TRUST_PROXY: "True",
        DISCOVER: "latest",
        SITE_ORIGIN: "https://example.com/",
        SITE_RESOLUTION_MODE: "host-based",
        SLUG_ID_LENGTH: "8",
        PORT: "8080",
      }),
    ).toEqual([]);
  });

  it("reports each value Jant can't use", () => {
    expect(
      variables({
        PUBLIC_API_ENABLED: "yes",
        PAGE_SIZE: "500",
        MAIN_RSS_FEED: "all",
        TIME_ZONE: "Mars/Olympus",
        STORAGE_DRIVER: "S3",
        TRUST_PROXY: "1",
        DISCOVER: "featured",
        SITE_ORIGIN: "example.com",
        SLUG_ID_LENGTH: "2",
        UPLOAD_MAX_FILE_SIZE_MB: "0",
        PORT: "70000",
      }),
    ).toEqual([
      "DISCOVER",
      "MAIN_RSS_FEED",
      "PAGE_SIZE",
      "PORT",
      "PUBLIC_API_ENABLED",
      "SITE_ORIGIN",
      "SLUG_ID_LENGTH",
      "STORAGE_DRIVER",
      "TIME_ZONE",
      "TRUST_PROXY",
      "UPLOAD_MAX_FILE_SIZE_MB",
    ]);
  });

  it("names the value and what to use instead", () => {
    expect(getEnvValueIssues({ STORAGE_DRIVER: "S3" })).toEqual([
      {
        variable: "STORAGE_DRIVER",
        message: 'STORAGE_DRIVER can\'t be "S3". Use one of: r2, s3, local.',
      },
    ]);
  });

  it("refuses an origin with a path, which belongs in SITE_PATH_PREFIX", () => {
    expect(variables({ SITE_ORIGIN: "https://example.com/blog" })).toEqual([
      "SITE_ORIGIN",
    ]);
  });

  it("ignores unset and blank values", () => {
    expect(getEnvValueIssues({ PAGE_SIZE: "", NOINDEX: "  " })).toEqual([]);
  });
});

describe("readConfigEnvValue", () => {
  it("reads a setting in the form the dashboard stores", () => {
    expect(
      readConfigEnvValue(
        { PUBLIC_API_ENABLED: " TRUE " },
        "PUBLIC_API_ENABLED",
      ),
    ).toBe("true");
    expect(readConfigEnvValue({ PAGE_SIZE: "500" }, "PAGE_SIZE")).toBe(
      undefined,
    );
  });

  // The failure this guards: the site compared the raw value with "true" and
  // turned the public API off, while GET /api/settings normalized it and
  // reported it on.
  it("gives the site and the settings API the same answer", () => {
    const env = { PUBLIC_API_ENABLED: "TRUE" } as unknown as Bindings;
    expect(resolveConfig(env, {}).publicApiEnabled).toBe(true);
    expect(buildApiSettingsResponse({}, false, env).PUBLIC_API_ENABLED).toBe(
      "true",
    );
  });
});

describe("rate limit variables", () => {
  it("reads 0 as an unlimited search and RATE_LIMIT_ENABLED=false as off", () => {
    const config = resolveConfig(
      {
        RATE_LIMIT_SEARCH_PER_MIN: "0",
        RATE_LIMIT_ENABLED: "false",
      } as unknown as Bindings,
      {},
    );
    expect(config.rateLimit).toEqual({ enabled: false, searchPerMinute: 0 });
    expect(resolveConfig({} as Bindings, {}).rateLimit).toEqual({
      enabled: true,
      searchPerMinute: 30,
    });
  });
});
