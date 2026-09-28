/**
 * The export's format version moves whenever what `site import` reads does.
 *
 * `site import` refuses an export whose `data/jant.toml` carries a format
 * version newer than it reads, and imports anything up to it. That only
 * protects anyone if the version rises when the import starts reading
 * something new: an older Jant given a newer export otherwise imports it,
 * drops the field it has never heard of, and says nothing. The version stayed
 * at 1 while fields came and went.
 *
 * docs/export-and-import.md's File reference lists every field the export
 * writes (export-docs.test.ts holds it to the exporter), and marks the ones
 * `site import` doesn't read "Theme only". The fields it reads are frozen here
 * per format version, in `fixtures/export-format/<version>.json`. Adding one,
 * dropping one, or starting to read a theme-only one fails this until
 * `SITE_EXPORT_FORMAT_VERSION` is raised and the next fixture written.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SITE_EXPORT_FORMAT_VERSION } from "../services/export.js";

const CORE_DIR = resolve(import.meta.dirname, "../..");
const FIXTURES = join(import.meta.dirname, "fixtures/export-format");

/**
 * Fields the File reference says `site import` reads, as `table: field`.
 * A table is named by the caption above it, up to its colon.
 */
function importedFields(): string[] {
  const doc = readFileSync(
    resolve(CORE_DIR, "../../docs/export-and-import.md"),
    "utf8",
  );
  const start = doc.indexOf("### File reference\n");
  const section = doc.slice(start, doc.indexOf("\n### ", start + 1));

  const fields: string[] = [];
  let caption = "";
  for (const line of section.split("\n")) {
    if (line && !line.startsWith("|") && !line.startsWith("#")) {
      caption = line.split(":")[0]!.replace(/`/g, "").trim();
      continue;
    }
    if (!line.startsWith("| `")) continue;
    const [, names = "", ...rest] = line.split("|");
    const notes = rest.at(-2)?.trim() ?? "";
    if (/^Theme only\b/.test(notes)) continue;
    for (const [, name] of names.matchAll(/`([a-z][a-z_]*)`/g)) {
      fields.push(`${caption}: ${name}`);
    }
  }
  return [...new Set(fields)].sort();
}

function fixtureVersions(): number[] {
  return readdirSync(FIXTURES)
    .map((name) => /^(\d+)\.json$/.exec(name)?.[1])
    .filter((version): version is string => version !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
}

describe("export format version", () => {
  it("has a frozen field list for every version, the current one last", () => {
    const versions = fixtureVersions();
    expect(versions.at(-1)).toBe(SITE_EXPORT_FORMAT_VERSION);
    expect(versions).toEqual(
      Array.from({ length: versions.length }, (_, i) => i + 1),
    );
  });

  it("changes when the fields site import reads change", () => {
    const fixture = join(FIXTURES, `${SITE_EXPORT_FORMAT_VERSION}.json`);
    expect(existsSync(fixture)).toBe(true);
    const frozen = JSON.parse(readFileSync(fixture, "utf8")) as string[];
    const current = importedFields();

    expect(current.length).toBeGreaterThan(40);
    expect(
      current,
      `site import now reads a different set of fields than format version ${SITE_EXPORT_FORMAT_VERSION} froze. ` +
        `Raise SITE_EXPORT_FORMAT_VERSION and SUPPORTED_SITE_EXPORT_VERSION to ${SITE_EXPORT_FORMAT_VERSION + 1} ` +
        `and write fixtures/export-format/${SITE_EXPORT_FORMAT_VERSION + 1}.json with this list. Never edit an existing one.`,
    ).toEqual(frozen);
  });
});
