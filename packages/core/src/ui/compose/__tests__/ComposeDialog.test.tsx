/**
 * Compose dialog labels.
 *
 * The composer fills two labels in the browser, from values only it knows: the
 * post being translated and the detected language. Lingui resolves an ICU
 * message completely at `i18n._()` time, so those slots have to be carried
 * through deliberately — a label formatted with no value renders as an empty
 * string, which reads as a missing title rather than as a bug.
 */

import type { Context } from "hono";
import { renderToString } from "hono/jsx/dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../../i18n/context.js";
import { createI18n } from "../../../i18n/i18n.js";
import { ComposeForm } from "../ComposeDialog.js";

function renderComposeLabels(): Record<string, string> {
  const i18n = createI18n("en");
  const c = {
    get(key: string) {
      return key === "i18n" ? i18n : undefined;
    },
  } as unknown as Context;
  I18nProvider({ c, children: "" });

  const html = renderToString(
    ComposeForm({
      languages: [
        { tag: "zh-Hans", label: "简体中文" },
        { tag: "en", label: "English" },
      ],
    }),
  );

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

describe("ComposeForm labels", () => {
  it("leaves the slots the browser fills", () => {
    const labels = renderComposeLabels();

    expect(labels.translationOf).toContain("{title}");
    expect(labels.translationContextInLanguage).toContain("{language}");
    expect(labels.languageAutoDetected).toContain("{language}");
  });

  it("never ships an unresolved ICU construct", () => {
    for (const [key, value] of Object.entries(renderComposeLabels())) {
      if (typeof value !== "string") continue;
      expect(value, key).not.toContain("plural,");
      expect(value, key).not.toContain("NaN");
    }
  });

  it("passes the site's languages to the component", () => {
    const i18n = createI18n("en");
    const c = {
      get(key: string) {
        return key === "i18n" ? i18n : undefined;
      },
    } as unknown as Context;
    I18nProvider({ c, children: "" });

    const html = renderToString(
      ComposeForm({
        languages: [{ tag: "en", label: "English" }],
      }),
    );
    expect(html).toContain("languages=");
    expect(html).toContain("English");
  });

  it("sends an empty list on a single-language site", () => {
    const i18n = createI18n("en");
    const c = {
      get(key: string) {
        return key === "i18n" ? i18n : undefined;
      },
    } as unknown as Context;
    I18nProvider({ c, children: "" });

    // The composer renders no language UI at all in that case.
    expect(renderToString(ComposeForm({}))).toContain('languages="[]"');
  });
});
