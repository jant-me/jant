import type { Context } from "hono";
import { renderToString } from "hono/jsx/dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../../../i18n/context.js";
import { createI18n } from "../../../../i18n/i18n.js";
import { SettingsRootContent } from "../SettingsRootContent.js";

function renderSettingsRootContent(
  props: Parameters<typeof SettingsRootContent>[0],
): string {
  const i18n = createI18n("en");
  const c = {
    get(key: string) {
      if (key === "i18n") return i18n;
      return undefined;
    },
  } as unknown as Context;

  I18nProvider({ c, children: "" });
  return renderToString(SettingsRootContent(props));
}

describe("SettingsRootContent", () => {
  it("lists Custom URLs first and Config Editor last in Advanced, and preserves the site path prefix", () => {
    const html = renderSettingsRootContent({ sitePathPrefix: "/notes" });

    const advancedSection = html.indexOf(">Advanced<");
    const customUrls = html.indexOf("/notes/settings/custom-urls");
    const codeInjection = html.indexOf("/notes/settings/code-injection");
    const apiTokens = html.indexOf("/notes/settings/api-tokens");
    const configEditor = html.indexOf("/notes/settings/config");
    const accountSection = html.indexOf(">Account<");

    // The docs send authors to Settings → Advanced → Custom URLs.
    expect(advancedSection).toBeGreaterThan(-1);
    expect(customUrls).toBeGreaterThan(advancedSection);
    expect(codeInjection).toBeGreaterThan(customUrls);
    expect(apiTokens).toBeGreaterThan(codeInjection);
    expect(configEditor).toBeGreaterThan(apiTokens);
    expect(accountSection).toBeGreaterThan(configEditor);
    expect(html).toContain("Config Editor");
  });

  it("omits Manage Hosting when no hosted site settings URL is configured", () => {
    const html = renderSettingsRootContent({});

    expect(html).not.toContain("Manage Hosting");
  });

  it("renders the Manage Hosting external link with the configured provider label", () => {
    const html = renderSettingsRootContent({
      hostedControlPlaneSiteSettingsUrl:
        "https://cloud.example/sites/core/site_123/settings",
      hostedControlPlaneProviderLabel: "jant.me",
    });

    expect(html).toContain("Manage Hosting");
    expect(html).toContain("Domains, plan, and billing in jant.me");
    expect(html).toContain(
      'href="https://cloud.example/sites/core/site_123/settings"',
    );
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("falls back to the hosted URL host when the provider label is blank", () => {
    const html = renderSettingsRootContent({
      hostedControlPlaneSiteSettingsUrl:
        "https://cloud.example/sites/core/site_123/settings",
      hostedControlPlaneProviderLabel: "   ",
    });

    expect(html).toContain("Domains, plan, and billing in cloud.example");
  });
});
