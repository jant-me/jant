import type { Context } from "hono";
import { renderToString } from "hono/jsx/dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../../../i18n/context.js";
import { createI18n } from "../../../../i18n/i18n.js";

async function loadLanguageContent() {
  const { LanguageContent } = await import("../LanguageContent.js");
  return LanguageContent;
}

type LanguageContentProps = Parameters<
  Awaited<ReturnType<typeof loadLanguageContent>>
>[0];

function renderLanguageContent(overrides: Partial<LanguageContentProps> = {}) {
  const i18n = createI18n("en");
  const c = {
    get(key: string) {
      if (key === "i18n") return i18n;
      return undefined;
    },
  } as unknown as Context;

  I18nProvider({ c, children: "" });

  return loadLanguageContent().then((LanguageContent) =>
    renderToString(
      LanguageContent({
        contentLanguage: "zh-Hans",
        dashboardLanguage: "en",
        multilingualEnabled: false,
        additionalLanguages: [],
        unmarkedPostCount: 0,
        sitePathPrefix: "",
        ...overrides,
      }),
    ),
  );
}

/** Pull the JSON blob the component reads its translated copy from. */
function readLabels(html: string): Record<string, string> {
  const match = /labels="([^"]*)"/.exec(html);
  if (!match?.[1]) throw new Error("expected a labels attribute");
  const decoded = match[1]
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'");
  return JSON.parse(decoded) as Record<string, string>;
}

describe("LanguageContent", () => {
  it("mounts the Lit element with an initial-state payload", async () => {
    const html = await renderLanguageContent({
      multilingualEnabled: true,
      additionalLanguages: ["en", "ja"],
      unmarkedPostCount: 3,
      sitePathPrefix: "/blog",
    });

    expect(html).toContain("<jant-settings-language");
    const state = /id="language-settings-initial-data">(.*?)<\/script>/s.exec(
      html,
    );
    expect(state?.[1]).toBeDefined();
    expect(JSON.parse(state?.[1] ?? "{}")).toEqual({
      contentLanguage: "zh-Hans",
      dashboardLanguage: "en",
      multilingualEnabled: true,
      additionalLanguages: ["en", "ja"],
      unmarkedPostCount: 3,
      sitePathPrefix: "/blog",
    });
  });

  // Lingui resolves an ICU message completely at `i18n._()` time, so any
  // plural has to be formatted here — a template shipped to the browser would
  // be formatted against an undefined count and render "NaN".
  describe("copy that carries runtime values", () => {
    it("resolves the plural against the real post count", async () => {
      const labels = readLabels(
        await renderLanguageContent({
          unmarkedPostCount: 347,
        }),
      );

      expect(labels.enableMarkWarning).toContain("347 existing posts");
      expect(labels.enableMarkWarning).not.toContain("NaN");
      expect(labels.enableMarkWarning).not.toContain("plural");
    });

    it("uses the singular form for a single post", async () => {
      const labels = readLabels(
        await renderLanguageContent({
          unmarkedPostCount: 1,
        }),
      );

      expect(labels.enableMarkWarning).toContain("1 existing post will");
      expect(labels.enableMarkWarning).not.toContain("posts");
    });

    it("leaves the language slot for the component to fill", async () => {
      const labels = readLabels(
        await renderLanguageContent({
          unmarkedPostCount: 5,
        }),
      );

      // Chosen inside the dialog, so it cannot be resolved here.
      expect(labels.enableMarkWarning).toContain("{language}");
      expect(labels.removeLanguage).toContain("{language}");
    });

    it("leaves every slot of the change-primary and disable copy", async () => {
      const labels = readLabels(await renderLanguageContent());

      expect(labels.changePrimaryBody).toContain("{next}");
      expect(labels.changePrimaryBody).toContain("{previous}");
      expect(labels.changePrimaryBody).toContain("{prefix}");
      expect(labels.disableBody).toContain("{prefix}");
    });

    it("never leaks an unresolved ICU construct into a label", async () => {
      const labels = readLabels(
        await renderLanguageContent({
          unmarkedPostCount: 12,
        }),
      );

      for (const [key, value] of Object.entries(labels)) {
        expect(value, key).not.toContain("plural,");
        expect(value, key).not.toContain("NaN");
      }
    });
  });
});
