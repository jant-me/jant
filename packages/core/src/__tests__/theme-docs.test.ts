/**
 * The theming docs name only hooks the markup and stylesheets provide.
 *
 * `docs/theming.md` is the public theme contract: the CSS variables it lists,
 * the `data-*` attributes and their values, and the footnote classes. The
 * rest of the roughly 270 custom properties are internal. `--site-width`
 * stayed documented after it was removed, `data-page="subscribe"` shipped
 * without being documented, and eight documented variables — the `--card-*`
 * set among them — were defined but read by nothing, so setting one changed
 * nothing. These checks fail on each kind of drift.
 */

import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_MODES } from "../types/config.js";
import { FORMATS, PAGE_NAMES } from "../types/constants.js";
import { BUILTIN_COLOR_THEMES } from "../ui/color-themes.js";

const CORE_DIR = resolve(import.meta.dirname, "../..");
const REPO_ROOT = resolve(CORE_DIR, "../..");
const SRC_DIR = join(CORE_DIR, "src");
const THEMING_DOCS = ["docs/theming.md", "docs/zh-Hans/theming.md"];

/** `data-page` values of author-only and internal pages, left out of the docs. */
const UNDOCUMENTED_PAGES = new Set([
  "compose",
  "settings",
  "brand",
  "theme-sample",
]);

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

const stylesheetFiles = listSourceFiles(SRC_DIR, [".css"]);
const stylesheets = stylesheetFiles
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

/**
 * Drop every rule whose selector matches `pattern`, with its whole block.
 * A brace counter, not a parser: enough for the stylesheets here, which put
 * no braces inside strings or comments.
 */
function stripRules(css: string, pattern: RegExp): string {
  let result = "";
  let preludeStart = 0;
  let index = 0;
  while (index < css.length) {
    const char = css[index];
    if (char === "{") {
      const prelude = css.slice(preludeStart, index);
      if (pattern.test(prelude)) {
        let depth = 1;
        let end = index + 1;
        while (end < css.length && depth > 0) {
          if (css[end] === "{") depth += 1;
          if (css[end] === "}") depth -= 1;
          end += 1;
        }
        index = end;
        preludeStart = end;
        continue;
      }
      result += css.slice(preludeStart, index + 1);
      preludeStart = index + 1;
    } else if (char === "}" || char === ";") {
      result += css.slice(preludeStart, index + 1);
      preludeStart = index + 1;
    }
    index += 1;
  }
  return result + css.slice(preludeStart);
}

/**
 * What a reader's page loads: everything but the author-only sheets, and
 * without the theme sample page's rules, which preview themes rather than
 * render a site.
 */
const readerStylesheets = stripRules(
  stylesheetFiles
    .filter((path) => !path.endsWith("-author.css"))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n"),
  /theme-sample/,
);
/** BaseCoat's components read its palette variables, which the docs list. */
const baseCoatStylesheet = readFileSync(
  createRequire(import.meta.url).resolve("basecoat-css"),
  "utf8",
);
const markup = listSourceFiles(SRC_DIR, [".tsx", ".ts"])
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");
/** Reader markup: the public UI, without the theme sample page. */
const readerMarkup = listSourceFiles(join(SRC_DIR, "ui"), [".tsx", ".ts"])
  .filter(
    (path) =>
      !path.includes("/dash/") &&
      !path.includes("/compose/") &&
      !path.endsWith("ThemeSamplePage.tsx"),
  )
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

/** Whether markup emits an attribute by that exact name, not a longer one. */
function emitsAttribute(name: string): boolean {
  return new RegExp(`(?<![a-z-])${name}(?![a-z-])`).test(markup);
}

/** The backticked values in the third cell of an attribute's table row. */
function readDocumentedValues(markdown: string, attribute: string): string[] {
  const row = markdown
    .split("\n")
    .find((line) => line.startsWith(`| \`${attribute}\``));
  const values = row?.split("|")[3] ?? "";
  return [...values.matchAll(/`([a-z-]+)`/g)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );
}

const definedVariables = new Set(
  [...stylesheets.matchAll(/(--[a-z][a-z0-9-]*)\s*:/g)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  ),
);
const emittedPages = new Set<string>(PAGE_NAMES);

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

    it(`${path} lists only variables a reader's page reads`, () => {
      // A variable the stylesheets define but never read is a knob connected
      // to nothing: the docs would promise an effect that setting it lacks.
      // Reads in the author's sheets or on the theme sample page don't
      // count; a reader never loads them.
      const documented = readDocumentedVariables(readRepoFile(path));
      expect(
        documented.filter(
          (name) =>
            !readerStylesheets.includes(`var(${name}`) &&
            !baseCoatStylesheet.includes(`var(${name}`) &&
            !readerMarkup.includes(`var(${name}`),
        ),
      ).toEqual([]);
    });

    it(`${path} lists only data attributes the markup emits`, () => {
      // By whole name: `data-post` used to pass on `data-post-body` alone.
      const documented = readDocumentedAttributes(readRepoFile(path));
      expect(documented.length).toBeGreaterThan(0);
      expect(documented.filter((name) => !emitsAttribute(name))).toEqual([]);
    });

    it(`${path} lists exactly the reader pages' data-page values`, () => {
      const readerPages = [...emittedPages]
        .filter((page) => !UNDOCUMENTED_PAGES.has(page))
        .sort();
      expect(
        readDocumentedValues(readRepoFile(path), "data-page").sort(),
      ).toEqual(readerPages);
    });

    it(`${path} lists exactly the data-format and data-theme-mode values`, () => {
      const markdown = readRepoFile(path);
      expect(readDocumentedValues(markdown, "data-format").sort()).toEqual(
        [...FORMATS].sort(),
      );
      expect(readDocumentedValues(markdown, "data-theme-mode").sort()).toEqual(
        [...THEME_MODES].sort(),
      );
    });

    it(`${path} names only built-in themes as data-theme values`, () => {
      const ids = new Set(BUILTIN_COLOR_THEMES.map((theme) => theme.id));
      const named = readDocumentedValues(readRepoFile(path), "data-theme");
      expect(named.length).toBeGreaterThan(0);
      expect(named.filter((id) => !ids.has(id))).toEqual([]);
    });
  }
});
