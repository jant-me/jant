/**
 * The directory's two kinds of row read against each other.
 *
 * A collection and a smart collection sit in one list, one above the other, and
 * a reader compares them. So they carry the same two measures — how many
 * threads, and how long ago the newest one moved — and the only thing the smart
 * row says differently is the funnel marker naming where its members came from.
 */

import type { Context } from "hono";
import { renderToString } from "hono/jsx/dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../../i18n/context.js";
import { createI18n } from "../../../i18n/i18n.js";
import { CollectionsPage } from "../CollectionsPage.js";
import type { CollectionDirectoryItem } from "../../../types.js";

const COLLECTION_ACTIVITY_AT = 1_700_000_000;
const SMART_ACTIVITY_AT = 1_700_086_400;

const items: CollectionDirectoryItem[] = [
  {
    id: "cdi_test00000000000000000000000",
    type: "collection",
    collection: {
      id: "col_test000000000000000000000000",
      siteId: "sit_test000000000000000000000000",
      slug: "recipes",
      title: "Recipes",
      description: null,
      sortOrder: "manual",
      createdAt: 1_700_000_000,
      updatedAt: 1_700_000_000,
      threadCount: 2,
      recentActivityAt: COLLECTION_ACTIVITY_AT,
    },
  },
  {
    id: "cdi_test00000000000000000000001",
    type: "smart_collection",
    smartCollection: {
      id: "smc_test000000000000000000000000",
      siteId: "sit_test000000000000000000000000",
      slug: "quotes",
      title: "Quotes",
      description: null,
      selection: { format: "quote" },
      sort: "newest",
      layout: null,
      createdAt: 1_700_000_000,
      updatedAt: 1_700_000_000,
      threadCount: 5,
      recentActivityAt: SMART_ACTIVITY_AT,
    },
  },
];

function render(isAuthenticated: boolean) {
  const i18n = createI18n("en");
  const c = {
    get(key: string) {
      if (key === "i18n") return i18n;
      return undefined;
    },
  } as unknown as Context;

  I18nProvider({ c, children: "" });

  return renderToString(
    CollectionsPage({
      items,
      isAuthenticated,
      navigationCollectionIds: [],
      sitePathPrefix: "",
      basePath: "",
      siteOrigin: "",
    }),
  );
}

describe("collections directory rows", () => {
  it("dates a smart collection row the way it dates a collection row", () => {
    const html = render(false);

    expect(html.match(/class="collection-directory-updated"/g)).toHaveLength(2);
    expect(html).toContain(
      new Date(COLLECTION_ACTIVITY_AT * 1000).toISOString(),
    );
    expect(html).toContain(new Date(SMART_ACTIVITY_AT * 1000).toISOString());
    expect(html).toContain("5 threads");
  });
});
