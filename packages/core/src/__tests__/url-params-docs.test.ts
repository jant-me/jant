/**
 * The address reference lists every query parameter a reader's page reads.
 *
 * docs/compatibility.md freezes the archive's query parameters, and
 * docs/writing-and-organizing.md is where they are listed. Before this test
 * that page named four of them "like" examples, so a parameter or a value
 * added to a filter dimension reached every bookmark without reaching the
 * contract. This reads the archive and collection-order tables in each locale
 * and checks them against what the pages parse: every parameter, every value,
 * and every older spelling still read.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COLLECTION_SORT_PARAMS,
  LEGACY_COLLECTION_SORT_PARAMS,
  parseCollectionSortParam,
} from "../lib/collection-sort.js";
import {
  FILTER_DIMENSION_KEYS,
  FILTER_DIMENSIONS,
  type FilterDimensionKey,
} from "../lib/filter-dimensions.js";
import {
  ARCHIVE_LAYOUTS,
  ARCHIVE_SORTS,
  FORMATS,
  MEDIA_KINDS,
  PUBLIC_ARCHIVE_VISIBILITIES,
} from "../types/constants.js";

const REPO_DIR = resolve(import.meta.dirname, "../../../..");

const LOCALES = [
  {
    path: "docs/writing-and-organizing.md",
    archive: "### Archive filters",
    order: "### Collection order",
  },
  {
    path: "docs/zh-Hans/writing-and-organizing.md",
    archive: "### 归档筛选参数",
    order: "### 合集排序",
  },
];

/**
 * The values each dimension's parameter takes, as the table must list them;
 * `null` for an open value (a slug, a year) the table describes in words.
 * Keyed by every dimension, so a new one fails to compile until it is here.
 */
const DIMENSION_VALUES: Record<FilterDimensionKey, readonly string[] | null> = {
  collection: null,
  format: FORMATS,
  title: ["any", "none"],
  year: null,
  media: ["any", "none", ...MEDIA_KINDS],
  replies: ["any", "none"],
  visibility: [...PUBLIC_ARCHIVE_VISIBILITIES, "private" as const].map(
    (visibility) =>
      FILTER_DIMENSIONS.visibility.url.serialize(visibility, {}) ?? visibility,
  ),
};

/** The archive's parameters that shape the page rather than select posts. */
const PAGE_PARAMS: Record<string, readonly string[] | null> = {
  sort: ARCHIVE_SORTS,
  layout: ARCHIVE_LAYOUTS,
  page: null,
};

/** The archive's older parameter names: each dimension's, and `view`. */
const LEGACY_ARCHIVE_PARAMS = [
  ...FILTER_DIMENSION_KEYS.flatMap(
    (key) => FILTER_DIMENSIONS[key].url.legacy ?? [],
  ),
  "view",
];

function section(doc: string, heading: string): string {
  const start = doc.indexOf(`${heading}\n`);
  if (start === -1) throw new Error(`Missing section "${heading}".`);
  const rest = doc.slice(start + heading.length);
  const next = rest.search(/\n#{2,3} /);
  return next === -1 ? rest : rest.slice(0, next);
}

/** Each table row: its parameter, and the backticked values beside it. */
function tableRows(text: string): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  for (const line of text.split("\n")) {
    if (!line.startsWith("| `")) continue;
    const [, name, values] = line.split("|");
    const param = /`([^`]+)`/.exec(name ?? "")?.[1];
    if (!param) continue;
    rows.set(
      param,
      [...(values ?? "").matchAll(/`([^`]+)`/g)].map((match) => match[1]!),
    );
  }
  return rows;
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

describe.each(LOCALES)("$path", ({ path, archive, order }) => {
  const doc = readFileSync(resolve(REPO_DIR, path), "utf8");
  const archiveSection = section(doc, archive);
  const archiveRows = tableRows(archiveSection);
  const orderSection = section(doc, order);
  const orderRows = tableRows(orderSection);

  it("lists every archive parameter, and nothing else", () => {
    expect(sorted(archiveRows.keys())).toEqual(
      sorted([
        ...FILTER_DIMENSION_KEYS.map((key) => FILTER_DIMENSIONS[key].url.param),
        ...Object.keys(PAGE_PARAMS),
      ]),
    );
  });

  it("lists each archive parameter's values", () => {
    for (const key of FILTER_DIMENSION_KEYS) {
      const param = FILTER_DIMENSIONS[key].url.param;
      expect(sorted(archiveRows.get(param) ?? []), param).toEqual(
        sorted(DIMENSION_VALUES[key] ?? []),
      );
      // A value the table names must also be one the page accepts.
      for (const value of archiveRows.get(param) ?? []) {
        const parsed = FILTER_DIMENSIONS[key].url.parse(
          (name) => (name === param ? value : undefined),
          {},
        );
        expect(parsed.state, `${param}=${value}`).toBe("value");
      }
    }
    for (const [param, values] of Object.entries(PAGE_PARAMS)) {
      expect(sorted(archiveRows.get(param) ?? []), param).toEqual(
        sorted(values ?? []),
      );
    }
  });

  it("names every older archive spelling the page still reads", () => {
    const named = new Set(
      [...archiveSection.matchAll(/`([^`=]+)(?:=[^`]*)?`/g)].map(
        (match) => match[1]!,
      ),
    );
    for (const param of LEGACY_ARCHIVE_PARAMS) {
      expect(named.has(param), param).toBe(true);
    }
    // Older visibility values: each one named must still be read.
    for (const match of archiveSection.matchAll(/`visibility=([a-z_]+)`/g)) {
      const parsed = FILTER_DIMENSIONS.visibility.url.parse(
        (name) => (name === "visibility" ? match[1] : undefined),
        {},
      );
      expect(parsed.state, match[0]).not.toBe("invalid");
    }
  });

  it("lists a collection page's parameters and orders", () => {
    expect(sorted(orderRows.keys())).toEqual(["page", "sort"]);
    expect(sorted(orderRows.get("sort") ?? [])).toEqual(
      sorted(COLLECTION_SORT_PARAMS),
    );
    for (const legacy of LEGACY_COLLECTION_SORT_PARAMS) {
      expect(orderSection, legacy).toContain(`\`sort=${legacy}\``);
      expect(parseCollectionSortParam(legacy), legacy).toBeDefined();
    }
  });
});
