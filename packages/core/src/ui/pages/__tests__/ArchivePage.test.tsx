import type { Context } from "hono";
import { renderToString } from "hono/jsx/dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../../i18n/context.js";
import { createI18n } from "../../../i18n/i18n.js";
import { ArchivePage } from "../ArchivePage.js";

function renderArchivePage(
  props: Partial<Parameters<typeof ArchivePage>[0]> = {},
): string {
  const i18n = createI18n("en");
  const c = {
    get(key: string) {
      if (key === "i18n") return i18n;
      return undefined;
    },
  } as unknown as Context;

  I18nProvider({ c, children: "" });

  return renderToString(
    ArchivePage({
      groups: [
        {
          year: "2026",
          month: "03",
          label: "March 2026",
          totalCount: 1,
          posts: [
            {
              id: "pst_01",
              permalink: "/post-1",
              slug: "post-1",
              title: "Test post",
              summary: "A post for tooltip interpolation.",
              format: "note",
              status: "published",
              visibility: "public",
              pinned: false,
              featured: false,
              publishedAt: "2026-03-30T12:00:00Z",
              publishedAtFormatted: "Mar 30, 2026",
              publishedAtTime: "20:00",
              publishedAtRelative: "Mar 30",
              updatedAt: "2026-03-30T12:00:00Z",
              media: [],
              collections: [],
              isLastInThread: true,
            },
          ],
        },
      ],
      totalCount: 1,
      currentPage: 1,
      totalPages: 1,
      filters: {},
      availableYears: [2026],
      availableCollections: [],
      isAuthenticated: false,
      timeZone: "UTC",
      ...props,
    }),
  );
}

describe("ArchivePage", () => {
  it("interpolates the published timestamp label for archive tiles", () => {
    const html = renderArchivePage();

    expect(html).toContain('title="Published on Mar 30, 2026 at 20:00"');
  });

  it("renders the collection filter alongside the thread filter", () => {
    const html = renderArchivePage({
      availableCollections: [{ slug: "tech", title: "Tech" }],
    });

    expect(html).toContain('id="af-collection"');
    expect(html).toContain('id="af-thread"');
  });

  it("renders the thread filter with all options", () => {
    const html = renderArchivePage();

    expect(html).toContain('id="af-thread"');
    expect(html).toContain("All posts");
    expect(html).toContain("Threads");
    expect(html).toContain("Single posts");
    expect(html).toContain("replies=any");
    expect(html).toContain("replies=none");
  });

  it("serializes visibility latest_hidden as the hidden URL alias", () => {
    const html = renderArchivePage({
      isAuthenticated: true,
      filters: { visibility: "latest_hidden" },
    });

    expect(html).toContain("visibility=hidden");
    expect(html).not.toContain("visibility=latest_hidden");
  });

  it("marks the thread filter active when filtering single posts", () => {
    const html = renderArchivePage({ filters: { hasReplies: false } });

    expect(html).toContain("archive-chip-active");
    expect(html).toContain("Single posts");
  });

  it("uses a recognizable quote mark for the quote format filter", () => {
    const html = renderArchivePage({ filters: { format: "quote" } });

    expect(html).toContain('class="lucide lucide-quote"');
    expect(html).not.toContain('class="lucide lucide-text-quote"');
  });

  it("renders the feed button only when a feed href is provided", () => {
    expect(renderArchivePage()).not.toContain('class="feed-link"');
    expect(renderArchivePage({ feedHref: "/archive/feed" })).toContain(
      'class="feed-link"',
    );
  });

  it("offers the updated sort and marks published as the default", () => {
    const html = renderArchivePage();

    expect(html).toContain('aria-label="Sort order"');
    expect(html).toContain("sort=updated");
    expect(html).toContain(
      '<a href="/archive" class="archive-view-btn archive-view-btn-active" role="radio" aria-checked="true" aria-label="Sort by when each thread was published"',
    );
  });

  it("marks the updated sort active and keeps a way back", () => {
    const html = renderArchivePage({ filters: { sort: "updated" } });

    expect(html).toContain(
      '<a href="/archive?sort=updated" class="archive-view-btn archive-view-btn-active" role="radio" aria-checked="true" aria-label="Sort by when each thread was last added to"',
    );
    expect(html).toContain('<a href="/archive" class="archive-view-btn"');
  });

  // Icon-only controls need a hover tooltip too — aria-label only reaches
  // assistive tech, and a bare clock/history pair is unreadable without one.
  it("gives every toolbar toggle a tooltip matching its accessible name", () => {
    const html = renderArchivePage();

    for (const label of [
      "Sort by when each thread was published",
      "Sort by when each thread was last added to",
      "Show as a grid of tiles",
      "Show as a list with full posts",
    ]) {
      expect(html).toContain(`aria-label="${label}" title="${label}"`);
    }
  });

  it("labels month headers as update months in the updated sort", () => {
    expect(renderArchivePage()).toContain(
      '<span class="archive-month-header-label">March 2026</span>',
    );

    const updated = renderArchivePage({ filters: { sort: "updated" } });
    expect(updated).toContain(
      '<span class="archive-month-header-label">Updated March 2026</span>',
    );
    expect(updated).toContain("newest changes first");
  });

  it("keeps the sort selection in filter and view links", () => {
    const html = renderArchivePage({
      filters: { sort: "updated" },
      availableCollections: [{ slug: "tech", title: "Tech" }],
    });

    expect(html).toContain("collection=tech&amp;sort=updated");
    expect(html).toContain("view=list&amp;sort=updated");
  });
});
