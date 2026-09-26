/**
 * The theming docs name only hooks the markup and stylesheets provide.
 *
 * `docs/theming.md` is the public theme contract: the CSS variables it lists,
 * the `data-*` attributes and their values, and the footnote classes. The
 * rest of the roughly 270 custom properties are internal. `--site-width`
 * stayed documented after it was removed, and `data-page="subscribe"` shipped
 * without being documented; these checks fail on both kinds of drift.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CORE_DIR = resolve(import.meta.dirname, "../..");
const REPO_ROOT = resolve(CORE_DIR, "../..");
const SRC_DIR = join(CORE_DIR, "src");
const THEMING_DOCS = ["docs/theming.md", "docs/zh-Hans/theming.md"];

/** `data-page` values of author-only and internal pages, left out of the docs. */
const UNDOCUMENTED_PAGES = new Set(["compose", "brand", "theme-sample"]);

function listSourceFiles(dir: string, extensions: string[]): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" || entry.name === "i18n"
        ? []
        : listSourceFiles(fullPath, extensions);
    }
    return extensions.some((extension) => entry.name.endsWith(extension))
      ? [fullPath]
      : [];
  });
}

const stylesheets = listSourceFiles(SRC_DIR, [".css"])
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");
const markup = listSourceFiles(SRC_DIR, [".tsx", ".ts"])
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

const definedVariables = new Set(
  [...stylesheets.matchAll(/(--[a-z][a-z0-9-]*)\s*:/g)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  ),
);
const emittedPages = new Set(
  [
    ...markup.matchAll(/data-page="([a-z-]+)"/g),
    ...markup.matchAll(/"data-page": "([a-z-]+)"/g),
  ].flatMap((match) => (match[1] ? [match[1]] : [])),
);

function readRepoFile(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf8");
}

/** Variables in the first cell of the docs' tables, e.g. `| `--site-accent` | … |`. */
function readDocumentedVariables(markdown: string): string[] {
  return [...markdown.matchAll(/^\| `(--[a-z][a-z0-9-]*)`/gm)].flatMap(
    (match) => (match[1] ? [match[1]] : []),
  );
}

function readDocumentedAttributes(markdown: string): string[] {
  return [...markdown.matchAll(/`(data-[a-z][a-z-]*)`/g)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );
}

function readDocumentedPages(markdown: string): string[] {
  const row = markdown
    .split("\n")
    .find((line) => line.startsWith("| `data-page`"));
  const values = row?.split("|")[3] ?? "";
  return [...values.matchAll(/`([a-z-]+)`/g)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );
}

describe("theming docs", () => {
  for (const path of THEMING_DOCS) {
    it(`${path} lists only variables the stylesheets define`, () => {
      const markdown = readRepoFile(path);
      const documented = readDocumentedVariables(markdown);
      expect(documented.length).toBeGreaterThan(0);
      expect(documented.filter((name) => !definedVariables.has(name))).toEqual(
        [],
      );
    });

    it(`${path} lists only data attributes the markup emits`, () => {
      const documented = readDocumentedAttributes(readRepoFile(path));
      expect(documented.length).toBeGreaterThan(0);
      expect(documented.filter((name) => !markup.includes(name))).toEqual([]);
    });

    it(`${path} lists exactly the reader pages' data-page values`, () => {
      const readerPages = [...emittedPages]
        .filter((page) => !UNDOCUMENTED_PAGES.has(page))
        .sort();
      expect(readDocumentedPages(readRepoFile(path)).sort()).toEqual(
        readerPages,
      );
    });
  }
});
