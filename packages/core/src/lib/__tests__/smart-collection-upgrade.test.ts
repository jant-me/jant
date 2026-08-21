import { describe, expect, it } from "vitest";
import { buildCollectionVocabulary } from "../filter-dimensions.js";
import { parseArchiveUrlForUpgrade } from "../smart-collection-upgrade.js";

/**
 * The strict half of the pair.
 *
 * Turning a URL into a smart collection is a promise that *this page will keep
 * answering what that URL answers*. Anything less than a complete reading has
 * to refuse — a renderer may drop what it cannot read and still show a page,
 * but a promise made on a partial reading is a promise about something else.
 */

const ctx = {
  collections: buildCollectionVocabulary([
    { id: "col_01m0f291t3fzvte3vj2g8d611z", slug: "books", title: "Books" },
  ]),
};

describe("parseArchiveUrlForUpgrade", () => {
  it("reads a URL it fully understands", () => {
    expect(parseArchiveUrlForUpgrade("/archive?format=quote", ctx)).toEqual({
      selection: { format: "quote" },
      sort: "newest",
      layout: null,
    });
  });

  it("accepts a bare archive path, which collects everything", () => {
    expect(parseArchiveUrlForUpgrade("/archive", ctx)).toEqual({
      selection: {},
      sort: "newest",
      layout: null,
    });
  });

  it("accepts the stored query form, with no path in front of it", () => {
    // What `path_registry.archive_query` holds.
    expect(parseArchiveUrlForUpgrade("?format=note&title=none", ctx)).toEqual({
      selection: { format: "note", title: false },
      sort: "newest",
      layout: null,
    });
  });

  it("reads legacy spellings, which stored URLs really carry", () => {
    expect(
      parseArchiveUrlForUpgrade("/archive?hasTitle=0&hasMedia=1", ctx),
    ).toEqual({
      selection: { title: false, media: "any" },
      sort: "newest",
      layout: null,
    });
  });

  it("carries presentation across without counting it as unknown", () => {
    expect(
      parseArchiveUrlForUpgrade(
        "/archive?format=note&sort=updated&view=grid",
        ctx,
      ),
    ).toEqual({
      selection: { format: "note" },
      sort: "updated",
      layout: "grid",
    });
  });

  it("resolves a collection slug, and refuses one that names nothing", () => {
    expect(parseArchiveUrlForUpgrade("/archive?collection=books", ctx)).toEqual(
      {
        selection: { collection: ["col_01m0f291t3fzvte3vj2g8d611z"] },
        sort: "newest",
        layout: null,
      },
    );
    expect(
      parseArchiveUrlForUpgrade("/archive?collection=gone", ctx),
    ).toBeNull();
  });

  // The set only its author can see. A smart collection is a published page,
  // so this is the one refusal the whole design rests on.
  it("refuses a private selection", () => {
    expect(
      parseArchiveUrlForUpgrade("/archive?visibility=private", ctx),
    ).toBeNull();
  });

  it("refuses a parameter nobody declared", () => {
    expect(
      parseArchiveUrlForUpgrade("/archive?format=note&utm_source=x", ctx),
    ).toBeNull();
    // `page` is pagination, not a condition and not a presentation field.
    expect(parseArchiveUrlForUpgrade("/archive?page=2", ctx)).toBeNull();
  });

  it("refuses a value it cannot read", () => {
    expect(parseArchiveUrlForUpgrade("/archive?format=banana", ctx)).toBeNull();
    expect(
      parseArchiveUrlForUpgrade("/archive?media=nonsense", ctx),
    ).toBeNull();
  });

  it("refuses a URL that is not the archive at all", () => {
    expect(parseArchiveUrlForUpgrade("/books", ctx)).toBeNull();
    expect(parseArchiveUrlForUpgrade("https://example.com/x", ctx)).toBeNull();
    expect(parseArchiveUrlForUpgrade("", ctx)).toBeNull();
  });

  it("reads an absolute URL on this site", () => {
    expect(
      parseArchiveUrlForUpgrade(
        "https://example.com/archive?format=link",
        ctx,
        {
          origin: "https://example.com",
        },
      ),
    ).toEqual({
      selection: { format: "link" },
      sort: "newest",
      layout: null,
    });
  });

  it("refuses an absolute URL on another site", () => {
    // A directory link holds whatever the author typed. Reading someone else's
    // archive URL and offering to keep answering what it answers would be a
    // promise about a page this site has no say over.
    expect(
      parseArchiveUrlForUpgrade(
        "https://elsewhere.example/archive?format=link",
        ctx,
        { origin: "https://example.com" },
      ),
    ).toBeNull();
  });

  it("refuses any absolute URL when the caller names no origin", () => {
    // Not a guess either way: a caller that cannot say which origin is its own
    // gets the relative forms only.
    expect(
      parseArchiveUrlForUpgrade("https://example.com/archive?format=link", ctx),
    ).toBeNull();
  });
});
