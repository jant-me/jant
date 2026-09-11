import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createI18n } from "../../../../i18n/i18n.js";
import { getDiscoverCopy } from "../discover-copy.js";

const CORE_ROOT = resolve(import.meta.dirname, "../../../../..");

/**
 * Every msgid in a .po file, mapped to its msgstr. Joins the continuation
 * lines a long entry may be wrapped onto.
 */
function readCatalog(locale: string): Map<string, string> {
  const po = readFileSync(
    resolve(CORE_ROOT, `src/i18n/locales/settings/${locale}.po`),
    "utf8",
  );
  const entries = new Map<string, string>();
  for (const block of po.split(/\n{2,}/)) {
    const field = (keyword: string) => {
      const match = new RegExp(
        `^${keyword} ("(?:[^"\\\\]|\\\\.)*"(?:\\n"(?:[^"\\\\]|\\\\.)*")*)`,
        "m",
      ).exec(block);
      if (!match?.[1]) return null;
      return match[1]
        .split("\n")
        .map((line) => JSON.parse(line) as string)
        .join("");
    };
    const id = field("msgid");
    const str = field("msgstr");
    if (id !== null && str !== null) entries.set(id, str);
  }
  return entries;
}

describe("getDiscoverCopy", () => {
  // Setup shows `about` alone; Settings shows it and goes on. The opening is
  // one message, so the two can only differ in length, never in wording.
  it("opens the settings line with the sentence setup shows", () => {
    const copy = getDiscoverCopy(createI18n("en"));

    expect(copy.about).toBe(
      "Jant Discover is a directory of Jant blogs, curated by hand by the Jant community to help people find new Jant blogs and posts.",
    );
    expect(copy.intro.startsWith(`${copy.about} `)).toBe(true);
  });

  // Tests render through a macro stub that never reaches a translation, so the
  // catalogs are read directly. A translation that drops `{about}` would leave
  // the settings line without its first sentence in that language only.
  it.each(["zh-Hans", "zh-Hant"])(
    "keeps the opening sentence in the %s settings line",
    (locale) => {
      const catalog = readCatalog(locale);
      const intro = [...catalog].find(([id]) => id.startsWith("{about} "));
      const about = catalog.get(
        "{name} is a directory of Jant blogs, curated by hand by the Jant community to help people find new Jant blogs and posts.",
      );

      expect(intro?.[1]).toContain("{about}");
      expect(about).toContain("{name}");
    },
  );
});
