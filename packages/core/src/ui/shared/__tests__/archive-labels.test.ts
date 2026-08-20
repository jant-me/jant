import { describe, expect, it } from "vitest";
import {
  describeArchiveFilters,
  getArchiveViewTitle,
  hasActiveArchiveFilter,
} from "../archive-labels.js";
import { buildCollectionVocabulary } from "../../../lib/filter-dimensions.js";

const i18n = {
  _: (descriptor: { message?: string } | string) =>
    typeof descriptor === "string" ? descriptor : (descriptor.message ?? ""),
};

const ctx = {
  collections: buildCollectionVocabulary([
    { id: "col_books", slug: "books", title: "Books" },
  ]),
};

describe("describeArchiveFilters", () => {
  it("returns nothing when no filter is active", () => {
    expect(describeArchiveFilters({}, i18n)).toEqual([]);
    expect(hasActiveArchiveFilter({})).toBe(false);
  });

  it("leads with the collection, which identifies a view best", () => {
    expect(
      describeArchiveFilters(
        { collection: ["col_books"], format: "quote", year: 2024 },
        i18n,
        ctx,
      ),
    ).toEqual(["Books", "Quotes", "2024"]);
  });

  it("lets title presence absorb the format it refines", () => {
    expect(
      describeArchiveFilters({ format: "note", title: false }, i18n),
    ).toEqual(["Untitled"]);
    expect(
      describeArchiveFilters({ format: "note", title: true }, i18n),
    ).toEqual(["Titled"]);
  });

  it("names a single media kind but summarises several", () => {
    expect(describeArchiveFilters({ media: ["image"] }, i18n)).toEqual([
      "Images",
    ]);
    expect(describeArchiveFilters({ media: ["image", "video"] }, i18n)).toEqual(
      ["With media"],
    );
    expect(describeArchiveFilters({ media: "none" }, i18n)).toEqual([
      "Without media",
    ]);
    expect(describeArchiveFilters({ media: "any" }, i18n)).toEqual([
      "With media",
    ]);
  });

  it("describes the thread and visibility dimensions", () => {
    expect(describeArchiveFilters({ replies: true }, i18n)).toEqual([
      "Threads",
    ]);
    expect(describeArchiveFilters({ replies: false }, i18n)).toEqual([
      "Single posts",
    ]);
    expect(describeArchiveFilters({ visibility: "private" }, i18n)).toEqual([
      "Private",
    ]);
  });

  it("says nothing about a collection it cannot name", () => {
    // The id resolves to no title here, so the dimension is left undescribed
    // rather than described with a raw id.
    expect(describeArchiveFilters({ collection: ["col_gone"] }, i18n)).toEqual(
      [],
    );
  });
});

describe("getArchiveViewTitle", () => {
  it("names the unfiltered view", () => {
    expect(getArchiveViewTitle({}, i18n)).toBe("All posts");
  });

  it("stops at two parts, since a tab truncates from the right", () => {
    expect(
      getArchiveViewTitle(
        {
          collection: ["col_books"],
          format: "quote",
          year: 2024,
          replies: true,
        },
        i18n,
        ctx,
      ),
    ).toBe("Books, Quotes");
  });
});
