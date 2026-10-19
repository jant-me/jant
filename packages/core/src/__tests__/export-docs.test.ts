/**
 * The export's file reference lists every field `site export` writes.
 *
 * docs/export-and-import.md promises that the fields it lists change only in
 * a major release, and marks the rest "theme only". Before this test, the page
 * named a handful of fields in prose; everything else — `title`, `format`,
 * `media`, the keys of `data/jant.toml` — was outside the contract by
 * omission. This exports a site with every kind of content
 * (`helpers/rich-sites.ts`) and requires each front-matter field and data key
 * to appear in the reference; each field the tables name must still exist in
 * the exporter.
 *
 * The fields the reference marks theme only are the ones the public surface
 * manifest leaves out (`THEME_ONLY_EXPORT_FIELDS`), so a promised field can't
 * leave the manifest by being listed there.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import { describe, expect, it } from "vitest";
import { parseFrontMatter } from "../lib/hugo-markdown.js";
import { THEME_ONLY_EXPORT_FIELDS } from "./helpers/public-surface.js";
import { exportRichSite } from "./helpers/rich-sites.js";

const CORE_DIR = resolve(import.meta.dirname, "../..");

/** The "File reference" section of one language's export page. */
function readReference(docPath: string, heading: string): string {
  const doc = readFileSync(resolve(CORE_DIR, "../..", docPath), "utf8");
  const start = doc.indexOf(`${heading}\n`);
  const end = doc.indexOf("\n### ", start + 1);
  return doc.slice(start, end);
}

/** Every backticked field name in a reference's table rows, prose left out. */
function tableNames(reference: string): Set<string> {
  return new Set(
    reference
      .split("\n")
      .filter((line) => line.startsWith("| `"))
      .flatMap((line) =>
        [...line.matchAll(/`([a-z][a-z_]*)`/g)].map((match) => match[1]!),
      ),
  );
}

const REFERENCE = readReference(
  "docs/export-and-import.md",
  "### File reference",
);
const REFERENCE_ZH = readReference(
  "docs/zh-Hans/export-and-import.md",
  "### 文件字段一览",
);

/** Every field the tables name, in either column: the documented fields. */
const documented = tableNames(REFERENCE);

/** Every key in a parsed value, nested objects and arrays of objects included. */
function keysOf(value: unknown, into: Set<string>): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, into);
  } else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      into.add(key);
      // A smart collection's conditions are the filter vocabulary, which
      // the archive documents; the reference names only `selection`.
      if (key !== "selection") keysOf(nested, into);
    }
  }
  return into;
}

/** Every front-matter field and data key a rich site's export writes. */
async function writtenKeys(): Promise<Set<string>> {
  const written = new Set<string>();
  for (const file of await exportRichSite()) {
    const content =
      typeof file.content === "string"
        ? file.content
        : new TextDecoder().decode(file.content);
    if (file.path.startsWith("content/") && file.path.endsWith(".md")) {
      keysOf((await parseFrontMatter(content)).frontMatter, written);
    } else if (file.path === "data/jant.toml") {
      keysOf(parseToml(content), written);
    }
  }
  return written;
}

/**
 * Documented names the rich site doesn't produce. Each is written only under
 * a condition the fixture doesn't meet, or names a value rather than a key.
 */
const NOT_IN_FIXTURE = new Set([
  // Values named in a field's notes, not keys.
  "post",
  "note",
  "link",
  "quote",
  "published",
  "draft",
  "public",
  "latest_hidden",
  "private",
  "image",
  "video",
  "audio",
  "text",
  "document",
  "collection",
  "smart_collection",
  "newest",
  "oldest",
  "rating_desc",
  "list",
  "grid",
  "render",
  "true",
  "static",
  // Written only for a custom URL of the retired archive kind, which can
  // no longer be created.
  "archive_query",
]);

/**
 * The rows of each table in a reference, header and divider left out, as
 * cells.
 */
function tableRows(reference: string): string[][][] {
  const tables: string[][][] = [];
  let current: string[][] | null = null;
  for (const line of reference.split("\n")) {
    if (!line.startsWith("|")) {
      current = null;
      continue;
    }
    if (!current) {
      current = [];
      tables.push(current);
    }
    current.push(
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
  }
  return tables.map((rows) => rows.slice(2));
}

/**
 * The fields the reference marks theme only, as `THEME_ONLY_EXPORT_FIELDS`
 * holds them. Its tables come in order: post files, each `media` entry,
 * collection pages, `data/jant.toml`.
 */
function themeOnlyFields(reference: string) {
  const names = (cell: string) =>
    [...cell.matchAll(/`([a-z][a-z_]*)`/g)].map((match) => match[1]!);
  const [posts = [], media = [], collections = [], data = []] =
    tableRows(reference);
  const marked = (rows: string[][], prefix = "") =>
    rows.flatMap((row) => {
      const notes = row.at(-1) ?? "";
      const fields = names(row[0] ?? "");
      return [
        ...(notes.startsWith("Theme only") ? fields : []),
        // "each with `slug`, …, and a theme-only `title`"
        ...[...notes.matchAll(/theme-only `([a-z_]+)`/g)].flatMap((match) =>
          fields.map((field) => `${field}.${match[1]}`),
        ),
      ].map((field) => prefix + field);
    });
  const directoryEntries = data.filter((row) =>
    (row.at(-1) ?? "").includes("in `directory` entries"),
  );
  return {
    post: [...marked(posts), ...marked(media, "media.")].sort(),
    collection: marked(collections).sort(),
    data: [
      ...marked(data.filter((row) => !directoryEntries.includes(row))),
      ...marked(directoryEntries, "directory."),
    ].sort(),
  };
}

describe("export file reference", () => {
  it("marks theme only exactly the fields the public surface leaves out", () => {
    expect(themeOnlyFields(REFERENCE)).toEqual({
      post: [...THEME_ONLY_EXPORT_FIELDS.post].sort(),
      collection: [...THEME_ONLY_EXPORT_FIELDS.collection].sort(),
      data: [...THEME_ONLY_EXPORT_FIELDS.data].sort(),
    });
  });

  it("lists every field and data key the export writes", async () => {
    const written = await writtenKeys();

    expect(written.size).toBeGreaterThan(60);
    expect([...written].filter((key) => !documented.has(key)).sort()).toEqual(
      [],
    );
  });

  it("lists only fields the export still writes", async () => {
    const written = await writtenKeys();

    expect(
      [...documented]
        .filter((name) => !written.has(name) && !NOT_IN_FIXTURE.has(name))
        .sort(),
    ).toEqual([]);
  });

  it("names the same fields in the Chinese reference", () => {
    expect([...tableNames(REFERENCE_ZH)].sort()).toEqual(
      [...documented].sort(),
    );
  });
});
