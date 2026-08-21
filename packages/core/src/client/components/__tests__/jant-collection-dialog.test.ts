// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../toast.js", () => ({
  showToast: vi.fn(),
  showToastWithAction: vi.fn(),
}));

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

// happy-dom has no contenteditable, so the description editor is stood in for.
let editorContent: string | undefined;
vi.mock("../../tiptap/create-editor.js", () => ({
  createSettingsEditor: (opts: { element: HTMLElement; content?: string }) => {
    editorContent = opts.content;
    opts.element.innerHTML =
      '<div class="ProseMirror" contenteditable="true"></div>';
    return {
      getJSON: () => ({ type: "doc", content: [] }),
      destroy: () => {},
    };
  },
  jsonToMarkdown: () => "",
}));

import "../jant-collection-dialog.js";
import type { JantCollectionDialog } from "../jant-collection-dialog.js";
import type { CollectionDialogLabels } from "../collection-dialog-types.js";

/**
 * The dialog is now the only place a collection is written, so what it has to
 * hold is what the editor page used to: an address derived from the title and
 * checked against the server, a warning before an existing link moves, and a
 * save that reports where the collection ended up.
 */

const labels: CollectionDialogLabels = {
  createHeading: "New Collection",
  editHeading: "Edit Collection",
  title: "Title",
  titlePlaceholder: "My Collection",
  link: "Collection link",
  linkHelp: "This is the last part of the collection link.",
  editLink: "Edit link",
  resetLink: "Reset link",
  linkTaken: "This link is taken. Choose another.",
  linkInvalid: "Use lowercase letters, numbers, and hyphens only.",
  linkReserved: "This link is reserved. Choose something else.",
  linkTooLong: "Keep this link under 200 characters.",
  linkMovesWarning: "Changing the link breaks the old one immediately.",
  description: "Description (optional)",
  descriptionPlaceholder: "What's this collection about?",
  orderBy: "Order by",
  sortOptions: {
    newest: "Newest first",
    oldest: "Oldest first",
    rating_desc: "Highest rated",
  },
  cancel: "Cancel",
  save: "Save",
  saved: "Collection saved.",
  saveFailed: "Couldn't save. Try again in a moment.",
  loadFailed: "Could not open this collection. Try again.",
  titleAndLinkRequired: "A collection needs a title and a link.",
};

/** Responses the dialog's fetches get, keyed by the path they hit. */
let responses: Record<string, { ok?: boolean; body: unknown }>;
let requests: Array<{ url: string; method: string; body: unknown }>;

function mountDialog(): JantCollectionDialog {
  const element = document.createElement(
    "jant-collection-dialog",
  ) as JantCollectionDialog;
  element.labels = labels;
  document.body.appendChild(element);
  return element;
}

/** Let the debounced address check and the slugify round trip settle. */
async function settle(element: JantCollectionDialog) {
  await vi.advanceTimersByTimeAsync(400);
  await element.updateComplete;
}

function findButton(
  element: JantCollectionDialog,
  text: string,
): HTMLButtonElement | undefined {
  return [...element.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === text,
  );
}

async function typeTitle(element: JantCollectionDialog, value: string) {
  const input = element.querySelector<HTMLInputElement>("[data-field='title']");
  if (!input) throw new Error("Expected the title field");
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await settle(element);
}

beforeEach(() => {
  document.body.innerHTML = "";
  vi.useFakeTimers();
  editorContent = undefined;

  responses = {
    "/api/collections/slug": { body: { slug: "reading", available: true } },
    "/api/collections": { body: { id: "col_new", slug: "reading" } },
    "/api/collections/col_books": {
      body: {
        id: "col_books",
        slug: "books",
        title: "Books",
        description: "Notes from books",
        sortOrder: "oldest",
      },
    },
  };
  requests = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: globalThis.RequestInit) => {
      const path = url.split("?")[0] ?? url;
      requests.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      const response = responses[path] ?? { body: {} };
      return {
        ok: response.ok ?? true,
        status: response.ok === false ? 400 : 200,
        json: async () => response.body,
      } as Response;
    }),
  );

  // happy-dom's <dialog> has no modal implementation.
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
});

describe("JantCollectionDialog", () => {
  it("opens on the create heading with nothing filled in", async () => {
    const element = mountDialog();
    void element.open({});
    await settle(element);

    expect(element.textContent).toContain("New Collection");
    expect(
      element.querySelector<HTMLInputElement>("[data-field='title']")?.value,
    ).toBe("");
    // The link only appears once there is one to show.
    expect(element.querySelector(".collection-quick-link-box")).toBeNull();
  });

  it("derives the address from the title and asks whether it is free", async () => {
    const element = mountDialog();
    void element.open({});
    await settle(element);
    await typeTitle(element, "Reading");

    expect(
      element.querySelector<HTMLElement>(".collection-quick-link-preview")
        ?.textContent,
    ).toContain("/reading");
    expect(
      requests.some(
        (request) =>
          request.url.includes("/api/collections/slug") &&
          request.url.includes("slug=reading"),
      ),
    ).toBe(true);
  });

  it("refuses to save onto an address something else already holds", async () => {
    responses["/api/collections/slug"] = {
      body: { slug: "reading", available: false },
    };
    const element = mountDialog();
    void element.open({});
    await settle(element);
    await typeTitle(element, "Reading");

    expect(element.textContent).toContain(
      "This link is taken. Choose another.",
    );
    expect(findButton(element, "Save")?.disabled).toBe(true);
  });

  it("loads an existing collection, and warns before its link moves", async () => {
    const element = mountDialog();
    void element.open({ collectionId: "col_books" });
    await settle(element);

    expect(element.textContent).toContain("Edit Collection");
    expect(
      element.querySelector<HTMLInputElement>("[data-field='title']")?.value,
    ).toBe("Books");
    const sortSelect = element.querySelector(
      "[data-field='sort']",
    ) as HTMLSelectElement | null;
    expect(sortSelect?.value).toBe("oldest");
    expect(editorContent).toBe("Notes from books");
    expect(element.textContent).not.toContain(
      "Changing the link breaks the old one immediately.",
    );

    findButton(element, "Edit link")?.click();
    await element.updateComplete;
    const slugInput = element.querySelector<HTMLInputElement>(
      "[data-field='slug']",
    );
    if (!slugInput) throw new Error("Expected the link field");
    slugInput.value = "reading";
    slugInput.dispatchEvent(new Event("input", { bubbles: true }));
    await settle(element);

    expect(element.textContent).toContain(
      "Changing the link breaks the old one immediately.",
    );
  });

  it("creates a collection and reports where it landed", async () => {
    const element = mountDialog();
    const result = element.open({});
    await settle(element);
    await typeTitle(element, "Reading");

    findButton(element, "Save")?.click();
    await settle(element);

    const save = requests.find((request) => request.method === "POST");
    expect(save?.url).toContain("/api/collections");
    expect(save?.body).toEqual({
      slug: "reading",
      title: "Reading",
      sortOrder: "newest",
    });
    await expect(result).resolves.toEqual({
      changed: true,
      collection: { id: "col_new", slug: "reading", title: "Reading" },
    });
  });

  it("saves an edit with PUT, and clears a description that was emptied", async () => {
    responses["/api/collections/col_books"] = {
      body: {
        id: "col_books",
        slug: "books",
        title: "Books",
        description: "Notes from books",
        sortOrder: "newest",
      },
    };
    const element = mountDialog();
    void element.open({ collectionId: "col_books" });
    await settle(element);

    findButton(element, "Save")?.click();
    await settle(element);

    const save = requests.find((request) => request.method === "PUT");
    expect(save?.url).toContain("/api/collections/col_books");
    // The stubbed editor round-trips to an empty document, so the edit is
    // clearing the description — which only an explicit null can do.
    expect(save?.body).toEqual({
      slug: "books",
      title: "Books",
      sortOrder: "newest",
      description: null,
    });
  });

  it("keeps a failed save open, with the reason the server gave", async () => {
    responses["/api/collections"] = {
      ok: false,
      body: { error: "That link is reserved." },
    };
    const element = mountDialog();
    void element.open({});
    await settle(element);
    await typeTitle(element, "Reading");

    findButton(element, "Save")?.click();
    await settle(element);

    expect(element.textContent).toContain("That link is reserved.");
    expect(
      element.querySelector<HTMLDialogElement>(".collection-dialog")?.open,
    ).toBe(true);
  });

  it("closes on Escape without saving", async () => {
    const element = mountDialog();
    const result = element.open({});
    await settle(element);
    await typeTitle(element, "Reading");

    element
      .querySelector<HTMLInputElement>("[data-field='title']")
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    await element.updateComplete;

    await expect(result).resolves.toEqual({ changed: false });
    expect(requests.some((request) => request.method === "POST")).toBe(false);
  });
});
