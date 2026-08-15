/**
 * Collection links must keep the reader in the language view they are in.
 *
 * A collection page is served once per language (`langGet("/*")` in
 * routes/pages/language.tsx), so a link from `/en/collections` that points at
 * `/{slug}` does not just look odd — it silently moves the reader to the
 * primary language's copy of that collection.
 *
 * The signed-in directory renders through `CollectionsManager`, the signed-out
 * one directly through `CollectionDirectory`. Both are covered here because the
 * bug this pins down existed in only one of them.
 */

import type { Context } from "hono";
import { renderToString } from "hono/jsx/dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../../i18n/context.js";
import { createI18n } from "../../../i18n/i18n.js";
import { CollectionsPage } from "../CollectionsPage.js";
import type { CollectionDirectoryItem } from "../../../types.js";

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
      recentActivityAt: 1_700_000_000,
    },
  },
];

function render(isAuthenticated: boolean, basePath: string) {
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
      basePath,
      siteOrigin: "",
    }),
  );
}

describe("collections directory links", () => {
  it("keeps a signed-out reader inside the language view", () => {
    const html = render(false, "/en");
    expect(html).toContain('href="/en/recipes"');
    expect(html).not.toContain('href="/recipes"');
  });

  it("keeps the signed-in author inside the language view", () => {
    const html = render(true, "/en");
    expect(html).toContain('href="/en/recipes"');
    expect(html).not.toContain('href="/recipes"');
  });

  it("links at the root when there is no language view", () => {
    expect(render(false, "")).toContain('href="/recipes"');
    expect(render(true, "")).toContain('href="/recipes"');
  });
});
