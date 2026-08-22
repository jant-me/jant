import { describe, expect, it } from "vitest";
import {
  buildCollectionVocabulary,
  FILTER_DIMENSION_KEYS,
  FILTER_DIMENSION_PARAMS,
  parsePostFilterSelection,
  parsePostFilterSelectionStrict,
  readCollectionSlugs,
  selectionFromRow,
  selectionToColumns,
  serializePostFilterSelection,
  toPostFilters,
  type DimensionContext,
  type PostFilterSelection,
} from "../filter-dimensions.js";

const ctx: DimensionContext = {
  collections: buildCollectionVocabulary([
    { id: "col_tech", slug: "tech", title: "Tech" },
    { id: "col_art", slug: "art", title: "Art" },
  ]),
};

/** Read a query string the way Hono hands one to a route. */
function reader(query: string) {
  const params = new URLSearchParams(query);
  return (key: string) => params.get(key) ?? undefined;
}

function keysOf(query: string): string[] {
  return [...new URLSearchParams(query).keys()];
}

describe("parsePostFilterSelection", () => {
  it("reads every dimension in its current spelling", () => {
    const { selection, issues } = parsePostFilterSelection(
      reader(
        "collection=tech&format=quote&title=any&year=2024&media=image,video&replies=none&visibility=hidden",
      ),
      ctx,
    );

    expect(issues).toEqual([]);
    expect(selection).toEqual({
      collection: ["col_tech"],
      format: "quote",
      title: true,
      year: 2024,
      media: ["image", "video"],
      replies: false,
      visibility: "latest_hidden",
    });
  });

  it("reads the pre-rename presence flags stored URLs still carry", () => {
    const { selection } = parsePostFilterSelection(
      reader("hasMedia=1&hasTitle=0&hasReplies=1"),
      ctx,
    );
    expect(selection).toEqual({ media: "any", title: false, replies: true });
  });

  it("prefers the current spelling when a URL carries both", () => {
    const { selection } = parsePostFilterSelection(
      reader("title=none&hasTitle=1"),
      ctx,
    );
    expect(selection.title).toBe(false);
  });

  it("refuses a year outside the range a timestamp can carry", () => {
    // The ceiling is the load-bearing one: `Date.UTC` goes NaN past year
    // 275760, and a NaN bound is a comparison every row fails silently — an
    // empty page with nothing to explain it.
    for (const raw of ["1970", "0", "-5", "10000", "999999999"]) {
      const { selection, issues } = parsePostFilterSelection(
        reader(`year=${raw}`),
        ctx,
      );
      expect(selection.year).toBeUndefined();
      expect(issues.map((issue) => issue.param)).toEqual(["year"]);
    }

    expect(
      parsePostFilterSelection(reader("year=1971"), ctx).selection,
    ).toEqual({ year: 1971 });
    expect(
      parsePostFilterSelection(reader("year=9999"), ctx).selection,
    ).toEqual({ year: 9999 });
  });

  it("drops a value it cannot read, and says which one", () => {
    const { selection, issues } = parsePostFilterSelection(
      reader("format=banana&year=2024"),
      ctx,
    );
    expect(selection).toEqual({ year: 2024 });
    expect(issues.map((issue) => issue.param)).toEqual(["format"]);
  });

  it("reports a collection slug that names nothing rather than widening", () => {
    const { selection, issues } = parsePostFilterSelection(
      reader("collection=nope"),
      ctx,
    );
    expect(selection.collection).toBeUndefined();
    expect(issues.map((issue) => issue.param)).toEqual(["collection"]);
  });

  it("treats visibility=all as choosing nothing, not as a value", () => {
    const { selection, issues } = parsePostFilterSelection(
      reader("visibility=all"),
      ctx,
    );
    expect(selection.visibility).toBeUndefined();
    expect(issues).toEqual([]);
  });

  it("reads latest_hidden, the stored spelling of hidden", () => {
    const { selection } = parsePostFilterSelection(
      reader("visibility=latest_hidden"),
      ctx,
    );
    expect(selection.visibility).toBe("latest_hidden");
  });
});

describe("collection selections", () => {
  // Hono decodes a query value as form-urlencoded, so `+` arrives as a space.
  // The `/collections/{a+b}` path spelling therefore cannot survive a query
  // string on its own — which is why the comma is what gets written.
  it("accepts every separator a collection selection can arrive with", () => {
    for (const raw of ["tech,art", "tech+art", "tech art"]) {
      expect(readCollectionSlugs(reader(`collection=${raw}`))).toEqual([
        "tech",
        "art",
      ]);
    }
  });

  it("resolves slugs to ids and writes them back as slugs", () => {
    const { selection } = parsePostFilterSelection(
      reader("collection=tech%20art"),
      ctx,
    );
    expect(selection.collection).toEqual(["col_tech", "col_art"]);
    expect(serializePostFilterSelection(selection, ctx).get("collection")).toBe(
      "tech,art",
    );
  });

  it("names no collection when the URL names none", () => {
    expect(readCollectionSlugs(reader("format=note"))).toEqual([]);
  });
});

describe("serializePostFilterSelection", () => {
  it("round trips every dimension through the canonical spelling", () => {
    const selection: PostFilterSelection = {
      collection: ["col_art"],
      format: "note",
      title: false,
      year: 2020,
      media: "none",
      replies: true,
      visibility: "featured",
    };

    const query = serializePostFilterSelection(selection, ctx).toString();
    const reparsed = parsePostFilterSelection(reader(query), ctx);

    expect(reparsed.issues).toEqual([]);
    expect(reparsed.selection).toEqual(selection);
  });

  it("never writes a legacy spelling", () => {
    const query = serializePostFilterSelection(
      {
        media: "any",
        title: true,
        replies: false,
        visibility: "latest_hidden",
      },
      ctx,
    );
    expect(query.get("media")).toBe("any");
    expect(query.get("visibility")).toBe("hidden");
    expect(query.has("hasMedia")).toBe(false);
    expect(query.has("hasTitle")).toBe(false);
    expect(query.has("hasReplies")).toBe(false);
  });

  it("omits a collection it cannot spell", () => {
    expect(
      serializePostFilterSelection({ collection: ["col_gone"] }, ctx).has(
        "collection",
      ),
    ).toBe(false);
  });
});

describe("parsePostFilterSelectionStrict", () => {
  it("accepts a URL it fully understands, legacy spellings included", () => {
    const query = "format=note&hasTitle=0&visibility=latest_hidden";
    const result = parsePostFilterSelectionStrict(
      reader(query),
      keysOf(query),
      ctx,
    );
    expect(result).toEqual({
      ok: true,
      selection: { format: "note", title: false, visibility: "latest_hidden" },
    });
  });

  it("refuses a parameter nobody declared", () => {
    const query = "format=note&utm_source=x";
    const result = parsePostFilterSelectionStrict(
      reader(query),
      keysOf(query),
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.param)).toEqual(["utm_source"]);
    }
  });

  it("allows the caller's own parameters through", () => {
    const query = "format=note&limit=5";
    const result = parsePostFilterSelectionStrict(
      reader(query),
      keysOf(query),
      ctx,
      { allow: ["limit"] },
    );
    expect(result.ok).toBe(true);
  });

  it("refuses a value it cannot read, where the lenient parser drops it", () => {
    const query = "media=nonsense";
    expect(
      parsePostFilterSelectionStrict(reader(query), keysOf(query), ctx).ok,
    ).toBe(false);
    expect(parsePostFilterSelection(reader(query), ctx).selection).toEqual({});
  });
});

describe("toPostFilters", () => {
  it("pins the year to publication by default", () => {
    expect(toPostFilters({ year: 2024 }, {})).toEqual({
      publishedAfter: Date.UTC(2024, 0, 1) / 1000,
      publishedBefore: Date.UTC(2025, 0, 1) / 1000,
    });
  });

  it("follows the sort axis when the caller asks it to", () => {
    expect(toPostFilters({ year: 2024 }, { yearAxis: "sort" })).toEqual({
      axisAfter: Date.UTC(2024, 0, 1) / 1000,
      axisBefore: Date.UTC(2025, 0, 1) / 1000,
    });
  });

  it("fans one media value out into the two fields PostFilters carries", () => {
    expect(toPostFilters({ media: "any" }, {})).toEqual({ hasMedia: true });
    expect(toPostFilters({ media: "none" }, {})).toEqual({ hasMedia: false });
    expect(toPostFilters({ media: ["image"] }, {})).toEqual({
      mediaKinds: ["image"],
    });
  });

  it("treats featured as a flag, not a stored visibility", () => {
    expect(toPostFilters({ visibility: "featured" }, {})).toEqual({
      featured: true,
    });
    expect(toPostFilters({ visibility: "latest_hidden" }, {})).toEqual({
      visibility: "latest_hidden",
    });
  });

  it("contributes nothing for an empty selection", () => {
    expect(toPostFilters({}, {})).toEqual({});
  });
});

describe("the registry itself", () => {
  it("declares a query parameter for every dimension, with no collisions", () => {
    expect(FILTER_DIMENSION_KEYS.length).toBe(7);
    expect(new Set(FILTER_DIMENSION_PARAMS).size).toBe(
      FILTER_DIMENSION_PARAMS.length,
    );
  });
});

describe("storing a selection", () => {
  it("names every dimension, writing null for the ones not selected", () => {
    const columns = selectionToColumns({ format: "note", title: false });

    expect(columns).toEqual({
      collectionId: null,
      format: "note",
      hasTitle: false,
      year: null,
      media: null,
      hasReplies: null,
      visibility: null,
    });
  });

  it("round trips a full selection through storage", () => {
    const selection: PostFilterSelection = {
      collection: ["col_tech"],
      format: "quote",
      title: true,
      year: 2024,
      media: ["image", "video"],
      replies: false,
      visibility: "latest_hidden",
    };

    expect(selectionFromRow(selectionToColumns(selection))).toEqual(selection);
  });

  it("reads a boolean column in either dialect's spelling", () => {
    // SQLite stores 0/1; Postgres stores real booleans.
    expect(selectionFromRow({ hasTitle: 1, hasReplies: 0 })).toEqual({
      title: true,
      replies: false,
    });
    expect(selectionFromRow({ hasTitle: true, hasReplies: false })).toEqual({
      title: true,
      replies: false,
    });
  });

  it("treats a column it cannot read as unset, rather than failing to render", () => {
    expect(selectionFromRow({ format: "banana", year: 2024 })).toEqual({
      year: 2024,
    });
  });
});
