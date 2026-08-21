// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lazy-slugify.js", () => ({
  slugify: (text: string) =>
    Promise.resolve(
      text
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, "")
        .replace(/[\s_-]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    ),
  preloadSlug: () => {},
}));

import type {
  CollectionFormInitial,
  CollectionFormLabels,
  CollectionSubmitDetail,
} from "../collection-types.js";
import {
  MAX_COLLECTION_SLUG_LENGTH,
  MAX_COLLECTION_TITLE_LENGTH,
} from "../../../types.js";
import "../jant-collection-form.js";
import type { JantCollectionForm } from "../jant-collection-form.js";

const labels: CollectionFormLabels = {
  titleLabel: "Title",
  titlePlaceholder: "Placeholder Title",
  slugLabel: "Collection link",
  slugHelp: "Help text",
  slugInvalidHelp: "Use lowercase letters, numbers, and hyphens only.",
  slugReservedHelp: "This link is reserved. Choose something else.",
  slugTooLongHelp: "Keep this link under 200 characters.",
  editSlugLabel: "Edit link",
  resetSlugLabel: "Reset link",
  quickHint: "More options are available after you create it.",
  quickSubmitLabel: "Done",
  createdLabel: "Collection created.",
  cancelLabel: "Cancel",
};

const initial: CollectionFormInitial = { title: "", slug: "" };

async function createElement(
  overrides: Partial<JantCollectionForm> = {},
): Promise<JantCollectionForm> {
  const el = document.createElement(
    "jant-collection-form",
  ) as JantCollectionForm;
  el.labels = labels;
  el.initial = initial;
  el.action = "/api/collections";
  Object.assign(el, overrides);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

async function flushSlugify(el: JantCollectionForm) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

function openSlugEditor(el: JantCollectionForm) {
  Array.from(el.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent?.includes("Edit link"))
    ?.click();
  return el.updateComplete;
}

describe("JantCollectionForm", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("asks for a title and nothing else", async () => {
    const el = await createElement();
    const titleInput = el.querySelector<HTMLInputElement>(
      "[data-collection-title-input]",
    );

    expect(titleInput).not.toBeNull();
    expect(titleInput?.maxLength).toBe(MAX_COLLECTION_TITLE_LENGTH);
    // The description and the ordering belong to the collection dialog; a
    // quick create only needs what a collection cannot exist without.
    expect(el.querySelector("select")).toBeNull();
    expect(el.querySelector("[data-collection-slug-input]")).toBeNull();
  });

  it("auto-generates a link from the title", async () => {
    const el = await createElement();
    const titleInput = el.querySelector<HTMLInputElement>(
      "[data-collection-title-input]",
    );
    if (!titleInput) throw new Error("Expected title input");

    titleInput.value = "My Great Collection!";
    titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    await flushSlugify(el);

    expect(
      el.querySelector<HTMLElement>(".collection-quick-link-preview")
        ?.textContent,
    ).toContain("/my-great-collection");
  });

  it("truncates auto-generated links to the configured maximum length", async () => {
    const el = await createElement();
    const titleInput = el.querySelector<HTMLInputElement>(
      "[data-collection-title-input]",
    );
    if (!titleInput) throw new Error("Expected title input");

    titleInput.value = "alpha ".repeat(30).trim();
    titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    await flushSlugify(el);
    await openSlugEditor(el);

    const slugInput = el.querySelector<HTMLInputElement>(
      "[data-collection-slug-input]",
    );
    expect(slugInput?.value.length).toBeLessThanOrEqual(
      MAX_COLLECTION_SLUG_LENGTH,
    );
    expect(slugInput?.value.endsWith("-")).toBe(false);
  });

  it("stops following the title once the link is edited by hand", async () => {
    const el = await createElement();
    const titleInput = el.querySelector<HTMLInputElement>(
      "[data-collection-title-input]",
    );
    if (!titleInput) throw new Error("Expected title input");

    titleInput.value = "Books";
    titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    await flushSlugify(el);
    await openSlugEditor(el);

    const slugInput = el.querySelector<HTMLInputElement>(
      "[data-collection-slug-input]",
    );
    if (!slugInput) throw new Error("Expected slug input");
    slugInput.value = "reading";
    slugInput.dispatchEvent(new Event("input", { bubbles: true }));
    await el.updateComplete;

    titleInput.value = "Books and More";
    titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    await flushSlugify(el);

    expect(slugInput.value).toBe("reading");
  });

  it("dispatches a title and a link on submit", async () => {
    const el = await createElement();
    const titleInput = el.querySelector<HTMLInputElement>(
      "[data-collection-title-input]",
    );
    if (!titleInput) throw new Error("Expected title input");

    titleInput.value = "Reading Notes";
    titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    await flushSlugify(el);

    let detail: CollectionSubmitDetail | null = null;
    el.addEventListener("jant:collection-submit", (event) => {
      detail = (event as CustomEvent<CollectionSubmitDetail>).detail;
    });

    el.querySelector("form")?.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );

    expect(detail).not.toBeNull();
    expect((detail as unknown as CollectionSubmitDetail).data).toEqual({
      title: "Reading Notes",
      slug: "reading-notes",
    });
  });

  it("opens the link editor and blocks submit when the link is invalid", async () => {
    const el = await createElement();
    const titleInput = el.querySelector<HTMLInputElement>(
      "[data-collection-title-input]",
    );
    if (!titleInput) throw new Error("Expected title input");

    titleInput.value = "Books";
    titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    await flushSlugify(el);
    await openSlugEditor(el);

    const slugInput = el.querySelector<HTMLInputElement>(
      "[data-collection-slug-input]",
    );
    if (!slugInput) throw new Error("Expected slug input");
    slugInput.value = "books/2025";
    slugInput.dispatchEvent(new Event("input", { bubbles: true }));
    await el.updateComplete;

    let detail: CollectionSubmitDetail | null = null;
    el.addEventListener("jant:collection-submit", (event) => {
      detail = (event as CustomEvent<CollectionSubmitDetail>).detail;
    });

    el.querySelector("form")?.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await el.updateComplete;

    expect(detail).toBeNull();
    expect(
      el.querySelector("[data-collection-slug-error]")?.textContent?.trim(),
    ).toBe(labels.slugInvalidHelp);
  });
});
