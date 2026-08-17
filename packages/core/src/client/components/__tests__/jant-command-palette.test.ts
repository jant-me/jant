// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPathCommandSearchQuery,
  getPathCommandTarget,
} from "../jant-command-palette.js";
import type { JantCommandPalette } from "../jant-command-palette.js";

interface MockPaletteItem {
  title: string;
  path: string;
  type: "post" | "collection" | "system";
  status?: "draft" | "published";
}

function mockPaletteApi(items: MockPaletteItem[] = []) {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(JSON.stringify({ items }), {
        headers: { "Content-Type": "application/json" },
      }),
  );
}

async function renderPalette(query: string, items: MockPaletteItem[] = []) {
  mockPaletteApi(items);
  const el = document.createElement(
    "jant-command-palette",
  ) as JantCommandPalette;
  document.body.appendChild(el);
  await el.open();
  el._query = query;
  await el.updateComplete;
  return el;
}

function resultTitles(root: globalThis.Element): string[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(".command-palette-result-title"),
  ).map((item) => item.textContent?.trim() ?? "");
}

describe("JantCommandPalette slash path mode", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    delete document.documentElement.dataset.sitePathPrefix;
    globalThis.localStorage.clear();
    globalThis.history.replaceState({}, "", "/");
  });

  it("shows go-to-path first and search second for slash queries", async () => {
    const el = await renderPalette("/draft-123");

    expect(resultTitles(el)).toEqual([
      "Go to /draft-123",
      'Search for "draft-123"',
    ]);
  });

  it("normalizes repeated leading slashes into a local path", () => {
    expect(getPathCommandTarget("//example.com")).toBe("/example.com");
    expect(getPathCommandSearchQuery("//example.com")).toBe("example.com");
  });

  it("accepts fullwidth slash input", async () => {
    const el = await renderPalette("／notes");

    expect(resultTitles(el)).toEqual(["Go to /notes", 'Search for "notes"']);
  });

  it("treats a pasted URL of this site as the path it points at", async () => {
    // Copied out of the address bar in another tab: the only sensible answer
    // is to go there, so no search alternative is offered.
    const el = await renderPalette(
      `${globalThis.location.origin}/notes?page=2`,
    );

    expect(resultTitles(el)).toEqual(["Go to /notes?page=2"]);
  });

  it("drops the deployment prefix from a pasted URL", async () => {
    document.documentElement.dataset.sitePathPrefix = "/blog";
    const el = await renderPalette(`${globalThis.location.origin}/blog/notes`);

    // navPath adds the prefix back when the jump happens; carrying it here
    // would double it.
    expect(resultTitles(el)).toEqual(["Go to /notes"]);
  });

  it("leaves somebody else's URL to full-text search", async () => {
    // Looking for the post where you linked something is the likelier intent.
    const el = await renderPalette("https://example.com/notes");

    expect(resultTitles(el)).toEqual([
      'Search all content for "https://example.com/notes"',
    ]);
  });
});

describe("JantCommandPalette persistent search action", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    delete document.documentElement.dataset.sitePathPrefix;
    globalThis.localStorage.clear();
    globalThis.history.replaceState({}, "", "/");
  });

  const matchingItems: MockPaletteItem[] = Array.from(
    { length: 12 },
    (_, index) => ({
      title: `Match ${index + 1}`,
      path: `match-${index + 1}`,
      type: "post",
    }),
  );

  it("keeps search visible below all navigation matches", async () => {
    const el = await renderPalette("match", matchingItems);

    expect(
      el.querySelectorAll(".command-palette-results > .command-palette-result"),
    ).toHaveLength(12);
    expect(resultTitles(el)).toEqual([
      "Match 1",
      "Match 2",
      "Match 3",
      "Match 4",
      "Match 5",
      "Match 6",
      "Match 7",
      "Match 8",
      "Match 9",
      "Match 10",
      "Match 11",
      "Match 12",
      'Search all content for "match"',
    ]);
    expect(
      el
        .querySelector(".command-palette-results-container")
        ?.lastElementChild?.classList.contains("command-palette-search-action"),
    ).toBe(true);
  });

  it("uses plain Enter without a shortcut hint when search is the only result", async () => {
    const el = await renderPalette("nothing", matchingItems);
    const dialog = el.querySelector<HTMLDialogElement>(".command-palette");

    expect(resultTitles(el)).toEqual(['Search all content for "nothing"']);
    expect(el.querySelector(".command-palette-result-shortcut")).toBeNull();

    dialog?.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(globalThis.location.pathname).toBe("/search");
    expect(globalThis.location.search).toBe("?q=nothing");
  });

  it("wraps ArrowUp from the best match to the search action", async () => {
    const el = await renderPalette("match", matchingItems);
    const dialog = el.querySelector<HTMLDialogElement>(".command-palette");

    dialog?.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", {
        key: "ArrowUp",
        bubbles: true,
        cancelable: true,
      }),
    );
    await el.updateComplete;

    expect(
      el.querySelector(
        ".command-palette-result-selected .command-palette-result-title",
      )?.textContent,
    ).toBe('Search all content for "match"');
  });

  it.each(["metaKey", "ctrlKey"] as const)(
    "runs full-text search with the %s Enter shortcut",
    async (modifier) => {
      const el = await renderPalette("match", matchingItems);
      const dialog = el.querySelector<HTMLDialogElement>(".command-palette");

      dialog?.dispatchEvent(
        new globalThis.KeyboardEvent("keydown", {
          key: "Enter",
          [modifier]: true,
          bubbles: true,
          cancelable: true,
        }),
      );

      expect(globalThis.location.pathname).toBe("/search");
      expect(globalThis.location.search).toBe("?q=match");
    },
  );

  it("keeps plain Enter on the best navigation match", async () => {
    const el = await renderPalette("match", matchingItems);
    const dialog = el.querySelector<HTMLDialogElement>(".command-palette");

    dialog?.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(globalThis.location.pathname).toBe("/match-1");
  });

  it("opens draft post matches through the authenticated preview route", async () => {
    const el = await renderPalette("draft", [
      {
        title: "Draft post",
        path: "draft-post",
        type: "post",
        status: "draft",
      },
    ]);
    const dialog = el.querySelector<HTMLDialogElement>(".command-palette");
    expect(dialog?.textContent).toContain("Draft · draft-post");

    dialog?.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(globalThis.location.pathname).toBe("/preview/draft-post");
    expect(globalThis.location.search).toBe("?edit=1");
  });

  it("keeps the site path prefix when opening a draft preview", async () => {
    document.documentElement.dataset.sitePathPrefix = "/blog";
    const el = await renderPalette("draft", [
      {
        title: "Draft post",
        path: "draft-post",
        type: "post",
        status: "draft",
      },
    ]);
    const dialog = el.querySelector<HTMLDialogElement>(".command-palette");

    dialog?.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(globalThis.location.pathname).toBe("/blog/preview/draft-post");
    expect(globalThis.location.search).toBe("?edit=1");
  });
});
