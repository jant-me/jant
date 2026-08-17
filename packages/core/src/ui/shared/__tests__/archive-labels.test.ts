import { describe, expect, it } from "vitest";
import {
  describeArchiveFilters,
  getArchiveViewTitle,
  hasActiveArchiveFilter,
} from "../archive-labels.js";

const i18n = {
  _: (descriptor: { message?: string } | string) =>
    typeof descriptor === "string" ? descriptor : (descriptor.message ?? ""),
};

describe("describeArchiveFilters", () => {
  it("returns nothing when no filter is active", () => {
    expect(describeArchiveFilters({}, i18n)).toEqual([]);
    expect(hasActiveArchiveFilter({})).toBe(false);
  });

  it("leads with the collection, which identifies a view best", () => {
    expect(
      describeArchiveFilters(
        { collectionTitle: "Books", format: "quote", year: 2024 },
        i18n,
      ),
    ).toEqual(["Books", "Quotes", "2024"]);
  });

  it("lets title presence absorb the format it refines", () => {
    expect(
      describeArchiveFilters({ format: "note", hasTitle: false }, i18n),
    ).toEqual(["Untitled"]);
    expect(
      describeArchiveFilters({ format: "note", hasTitle: true }, i18n),
    ).toEqual(["Titled"]);
  });

  it("names a single media kind but summarises several", () => {
    expect(describeArchiveFilters({ mediaKinds: ["image"] }, i18n)).toEqual([
      "Images",
    ]);
    expect(
      describeArchiveFilters({ mediaKinds: ["image", "video"] }, i18n),
    ).toEqual(["With media"]);
    expect(describeArchiveFilters({ hasMedia: false }, i18n)).toEqual([
      "Without media",
    ]);
  });

  it("describes the thread and visibility dimensions", () => {
    expect(describeArchiveFilters({ hasReplies: true }, i18n)).toEqual([
      "Threads",
    ]);
    expect(describeArchiveFilters({ hasReplies: false }, i18n)).toEqual([
      "Single posts",
    ]);
    expect(describeArchiveFilters({ visibility: "private" }, i18n)).toEqual([
      "Private",
    ]);
  });

  it("treats an empty media kind list as no filter", () => {
    expect(hasActiveArchiveFilter({ mediaKinds: [] })).toBe(false);
    expect(describeArchiveFilters({ mediaKinds: [] }, i18n)).toEqual([]);
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
          collectionTitle: "Books",
          format: "quote",
          year: 2024,
          hasReplies: true,
        },
        i18n,
      ),
    ).toBe("Books, Quotes");
  });
});
