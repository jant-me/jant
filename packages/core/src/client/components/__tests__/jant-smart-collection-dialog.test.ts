// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../toast.js", () => ({
  showToast: vi.fn(),
  showToastWithAction: vi.fn(),
}));

import "../jant-smart-collection-dialog.js";
import type { JantSmartCollectionDialog } from "../jant-smart-collection-dialog.js";
import { setCollectionVocabulary } from "../smart-collection-conditions.js";
import type { SmartCollectionDialogLabels } from "../smart-collection-dialog-types.js";

/**
 * The dialog is the only place a smart collection is written, so the behaviours
 * it has to hold are the ones the design turns on: one row per dimension,
 * conditions that survive a round trip through the shared vocabulary, a live
 * count, and Escape working from inside the fields.
 */

const labels: SmartCollectionDialogLabels = {
  createHeading: "New Smart Collection",
  editHeading: "Edit Smart Collection",
  whatItIs:
    "Conditions choose what belongs here, not you. Posts you write later join on their own.",
  title: "Title",
  link: "Collection link",
  linkHelp: "This is the last part of the collection link.",
  editLink: "Edit link",
  resetLink: "Reset link",
  linkTaken: "This link is taken. Choose another.",
  linkInvalid: "Use lowercase letters, numbers, and hyphens only.",
  linkReserved: "This link is reserved. Choose something else.",
  linkTooLong: "Keep this link under 200 characters.",
  linkMovesWarning: "Changing the link breaks the old one immediately.",
  description: "Description",
  conditionsHeading: "Conditions",
  matchAllHint: "Posts matching all of these",
  noConditions: "No conditions yet. Add one to choose what lands here.",
  addCondition: "Add condition",
  removeCondition: "Remove condition",
  countSummary: "{count} of {total} threads",
  counting: "Counting…",
  displayHeading: "Display",
  orderBy: "Order by",
  layout: "Layout",
  cancel: "Cancel",
  save: "Save",
  saved: "Smart collection saved.",
  saveFailed: "Could not save. Try again.",
  loadFailed: "Could not open this smart collection. Try again.",
  titleAndLinkRequired: "A smart collection needs a title and a link.",
  dimensions: {
    collection: "Collection",
    format: "Format",
    title: "Title",
    year: "Year",
    media: "Media",
    replies: "Replies",
    visibility: "Visibility",
  },
  values: {
    "format.note": "Notes",
    "format.link": "Links",
    "format.quote": "Quotes",
    "title.any": "Titled",
    "title.none": "Untitled",
    "replies.any": "Threads",
    "replies.none": "Single posts",
    "visibility.public": "Public",
    "visibility.featured": "Featured",
    "visibility.hidden": "Hidden from Latest",
    "media.any": "With media",
    "media.none": "Without media",
    "media.image": "Images",
  },
  sortOptions: { newest: "Newest first", oldest: "Oldest first" },
  layoutOptions: { "": "Follow site default", list: "List", grid: "Grid" },
};

/** Responses the dialog's fetches get, keyed by the path they hit. */
let responses: Record<string, unknown>;
let requests: Array<{ url: string; method: string; body: unknown }>;

function mountDialog(): JantSmartCollectionDialog {
  const element = document.createElement(
    "jant-smart-collection-dialog",
  ) as JantSmartCollectionDialog;
  element.labels = labels;
  document.body.appendChild(element);
  return element;
}

/** Let the debounced preview and slug requests fire and settle. */
async function settle(element: JantSmartCollectionDialog) {
  await vi.advanceTimersByTimeAsync(400);
  await element.updateComplete;
}

beforeEach(() => {
  document.body.innerHTML = "";
  vi.useFakeTimers();
  setCollectionVocabulary([{ id: "col_books", slug: "books", title: "Books" }]);

  responses = {
    "/api/smart-collections/preview": { count: 3, baseline: 42 },
    "/api/smart-collections/slug": { slug: "quotes", available: true },
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
      const body = responses[path] ?? { smartCollection: {} };
      return {
        ok: true,
        status: 200,
        json: async () => body,
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

describe("JantSmartCollectionDialog", () => {
  it("opens empty, and says so rather than showing a blank condition list", async () => {
    const element = mountDialog();
    void element.open({});
    await settle(element);

    expect(element.textContent).toContain("New Smart Collection");
    expect(element.textContent).toContain(
      "No conditions yet. Add one to choose what lands here.",
    );
    expect(element.querySelectorAll("[data-condition]")).toHaveLength(0);
  });

  it("offers each dimension once, and stops offering one that is in use", async () => {
    const element = mountDialog();
    void element.open({ prefill: { selection: { format: "quote" } } });
    await settle(element);

    expect(element.querySelectorAll("[data-condition]")).toHaveLength(1);

    const addButton = [...element.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Add condition",
    );
    addButton?.click();
    await element.updateComplete;

    const offered = [...element.querySelectorAll("[role='menuitem']")].map(
      (item) => item.textContent?.trim(),
    );

    // Seven dimensions, one already used.
    expect(offered).toHaveLength(6);
    expect(offered).not.toContain("Format");
    expect(offered).toContain("Year");
  });

  it("dismisses the condition menu on a click elsewhere in the dialog", async () => {
    const element = mountDialog();
    void element.open({});
    await settle(element);

    const trigger =
      element.querySelector<HTMLButtonElement>("[data-add-trigger]");
    trigger?.click();
    await element.updateComplete;
    expect(element.querySelector("[data-add-menu]")).not.toBeNull();

    // Not the backdrop — the panel stops that click, so a menu that only
    // listened to the backdrop would stay open over the fields it covers.
    element.querySelector<HTMLElement>(".collection-dialog-body")?.click();
    await element.updateComplete;

    expect(element.querySelector("[data-add-menu]")).toBeNull();
  });

  it("closes the condition menu on Escape, and leaves the dialog open", async () => {
    const element = mountDialog();
    const closed = element.open({});
    await settle(element);

    element.querySelector<HTMLButtonElement>("[data-add-trigger]")?.click();
    await element.updateComplete;

    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await element.updateComplete;

    expect(element.querySelector("[data-add-menu]")).toBeNull();
    expect(element.querySelector("dialog")?.open).toBe(true);

    // A second Escape, now that the menu is gone, closes the dialog itself.
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await expect(closed).resolves.toBe(false);
  });

  it("walks the condition menu with the arrow keys", async () => {
    const element = mountDialog();
    void element.open({});
    await settle(element);

    element.querySelector<HTMLButtonElement>("[data-add-trigger]")?.click();
    await element.updateComplete;
    await Promise.resolve();

    const items = [
      ...element.querySelectorAll<HTMLButtonElement>(
        "[data-add-menu] [role='menuitem']",
      ),
    ];
    items[0]?.focus();

    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(document.activeElement).toBe(items[1]);

    // Up from the first item wraps to the last rather than falling out.
    items[0]?.focus();
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it("picks a condition on Enter instead of saving", async () => {
    const element = mountDialog();
    void element.open({ prefill: { title: "Quotes" } });
    await settle(element);

    element.querySelector<HTMLButtonElement>("[data-add-trigger]")?.click();
    await element.updateComplete;

    const item = element.querySelector<HTMLButtonElement>(
      "[data-add-menu] [role='menuitem']",
    );
    item?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await settle(element);

    expect(
      requests.some(
        (request) =>
          request.method === "POST" && !request.url.includes("/preview"),
      ),
    ).toBe(false);
  });

  it("saves the conditions it was given, in the shared vocabulary", async () => {
    const element = mountDialog();
    void element.open({
      prefill: {
        title: "Quotes",
        selection: { format: "quote", media: "any", title: false },
      },
    });
    await settle(element);

    const save = [...element.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Save",
    );
    save?.click();
    await settle(element);

    const write = requests.find(
      (request) =>
        request.method === "POST" &&
        request.url.includes("/api/smart-collections") &&
        !request.url.includes("/preview"),
    );
    expect(write?.body).toMatchObject({
      title: "Quotes",
      selection: { format: "quote", media: "any", title: false },
    });
  });

  it("removes a condition, and clears it from what gets saved", async () => {
    const element = mountDialog();
    void element.open({
      prefill: { title: "Quotes", selection: { format: "quote", year: 2024 } },
    });
    await settle(element);
    expect(element.querySelectorAll("[data-condition]")).toHaveLength(2);

    const remove = element
      .querySelector("[data-condition='year']")
      ?.querySelector("button");
    remove?.click();
    await settle(element);

    expect(element.querySelectorAll("[data-condition]")).toHaveLength(1);

    const save = [...element.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Save",
    );
    save?.click();
    await settle(element);

    const write = requests.find(
      (request) =>
        request.method === "POST" && !request.url.includes("/preview"),
    );
    expect(write?.body).toMatchObject({ selection: { format: "quote" } });
    expect(
      (write?.body as { selection: Record<string, unknown> }).selection,
    ).not.toHaveProperty("year");
  });

  it("counts what the conditions gather, against the site total", async () => {
    const element = mountDialog();
    void element.open({ prefill: { selection: { format: "quote" } } });
    await settle(element);

    expect(element.textContent).toContain("3 of 42 threads");

    const preview = requests.find((request) =>
      request.url.includes("/preview"),
    );
    expect(preview?.method).toBe("POST");
    expect(preview?.body).toEqual({ selection: { format: "quote" } });
  });

  it("never offers the one visibility a published page cannot name", async () => {
    const element = mountDialog();
    void element.open({ prefill: { selection: { visibility: "public" } } });
    await settle(element);

    const options = [
      ...element.querySelectorAll("[data-condition='visibility'] option"),
    ].map((option) => (option as globalThis.HTMLOptionElement).value);

    expect(options).toEqual(["public", "featured", "hidden"]);
    expect(options).not.toContain("private");
  });

  it("closes on Escape, from inside a field", async () => {
    const element = mountDialog();
    const closed = element.open({ prefill: { title: "Quotes" } });
    await settle(element);

    const input = element.querySelector<HTMLInputElement>(
      "[data-field='title']",
    );
    // Dispatched on the field, not the dialog: an inner element that swallows
    // keydown is exactly the case the component-level handler exists for.
    input?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await element.updateComplete;

    await expect(closed).resolves.toBe(false);
  });

  it("saves on Enter, but not from inside the description", async () => {
    const element = mountDialog();
    void element.open({ prefill: { title: "Quotes" } });
    await settle(element);

    const textarea = element.querySelector<HTMLTextAreaElement>("textarea");
    textarea?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await settle(element);
    expect(
      requests.some(
        (request) =>
          request.method === "POST" && !request.url.includes("/preview"),
      ),
    ).toBe(false);

    const input = element.querySelector<HTMLInputElement>(
      "[data-field='title']",
    );
    input?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await settle(element);
    expect(
      requests.some(
        (request) =>
          request.method === "POST" && !request.url.includes("/preview"),
      ),
    ).toBe(true);
  });

  it("holds Save shut until there is a title and a free address", async () => {
    const element = mountDialog();
    void element.open({});
    await settle(element);

    const save = () =>
      [...element.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "Save",
      );
    expect(save()?.disabled).toBe(true);

    const input = element.querySelector<HTMLInputElement>(
      "[data-field='title']",
    );
    if (input) {
      input.value = "Quotes";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    await settle(element);

    expect(save()?.disabled).toBe(false);
  });

  it("holds Save shut on an address that is taken", async () => {
    responses["/api/smart-collections/slug"] = {
      slug: "books",
      available: false,
    };
    const element = mountDialog();
    void element.open({ prefill: { title: "Books" } });
    await settle(element);

    const save = [...element.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Save",
    );
    expect(save?.disabled).toBe(true);

    // Enter must not walk around the button it agrees with.
    element
      .querySelector("[data-field='title']")
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    await settle(element);

    expect(
      requests.some(
        (request) =>
          request.method === "POST" && !request.url.includes("/preview"),
      ),
    ).toBe(false);
  });

  it("says why it cannot save when Enter is pressed on an empty form", async () => {
    const element = mountDialog();
    void element.open({});
    await settle(element);

    element
      .querySelector("[data-field='title']")
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    await settle(element);

    // In one line the alert can lay out, not a bare text node in a grid whose
    // first column is zero wide.
    const alert = element.querySelector("[role='alert'] section p");
    expect(alert?.textContent?.trim()).toBe(
      "A smart collection needs a title and a link.",
    );
  });

  it("drops a complaint the author has already answered", async () => {
    const element = mountDialog();
    void element.open({});
    await settle(element);

    element
      .querySelector("[data-field='title']")
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    await settle(element);
    expect(element.querySelector("[role='alert']")).not.toBeNull();

    const input = element.querySelector<HTMLInputElement>(
      "[data-field='title']",
    );
    if (input) {
      input.value = "Quotes";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    await settle(element);

    expect(element.querySelector("[role='alert']")).toBeNull();
  });

  it("shows the whole link, folded away until asked", async () => {
    const element = mountDialog();
    void element.open({ prefill: { title: "Quotes" } });
    await settle(element);

    // Collapsed: the URL and a way in, no second labelled field.
    const preview = element.querySelector(".collection-quick-link-preview");
    expect(preview?.textContent?.trim()).toMatch(/\/quotes$/);
    expect(element.querySelector("[data-field='slug']")).toBeNull();

    const edit = [...element.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Edit link",
    );
    edit?.click();
    await settle(element);

    const input = element.querySelector<HTMLInputElement>(
      "[data-field='slug']",
    );
    expect(input?.value).toBe("quotes");
    expect(element.textContent).toContain("Collection link");
  });

  it("says a link is taken rather than failing on save", async () => {
    responses["/api/smart-collections/slug"] = {
      slug: "books",
      available: false,
    };
    const element = mountDialog();
    void element.open({ prefill: { title: "Books" } });
    await settle(element);

    expect(element.textContent).toContain(
      "This link is taken. Choose another.",
    );
  });

  it("names the real reason a link is refused, not always a collision", async () => {
    const element = mountDialog();
    void element.open({ prefill: { title: "Quotes" } });
    await settle(element);

    [...element.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "Edit link")
      ?.click();
    await settle(element);

    const input = element.querySelector<HTMLInputElement>(
      "[data-field='slug']",
    );
    if (input) {
      input.value = "Not A Slug";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    await settle(element);

    expect(element.textContent).toContain(
      "Use lowercase letters, numbers, and hyphens only.",
    );
    expect(element.textContent).not.toContain("This link is taken");
  });

  it("warns before an existing link moves", async () => {
    responses["/api/smart-collections/smc_1"] = {
      smartCollection: {
        id: "smc_1",
        slug: "quotes",
        title: "Quotes",
        selection: {},
        sort: "newest",
        layout: null,
      },
    };
    const element = mountDialog();
    void element.open({ smartCollectionId: "smc_1" });
    await settle(element);

    expect(element.textContent).not.toContain(
      "Changing the link breaks the old one immediately.",
    );

    [...element.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "Edit link")
      ?.click();
    await settle(element);

    const slugInput = element.querySelector<HTMLInputElement>(
      "[data-field='slug']",
    );
    if (slugInput) {
      slugInput.value = "citations";
      slugInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
    await settle(element);

    expect(element.textContent).toContain(
      "Changing the link breaks the old one immediately.",
    );
  });

  it("says what a smart collection is when creating one, and not when editing", async () => {
    const creating = mountDialog();
    void creating.open({});
    await settle(creating);
    expect(creating.textContent).toContain(
      "Conditions choose what belongs here",
    );

    responses["/api/smart-collections/smc_1"] = {
      smartCollection: {
        id: "smc_1",
        slug: "quotes",
        title: "Quotes",
        selection: {},
        sort: "newest",
        layout: null,
      },
    };
    const editing = mountDialog();
    void editing.open({ smartCollectionId: "smc_1" });
    await settle(editing);
    expect(editing.textContent).not.toContain(
      "Conditions choose what belongs here",
    );
  });

  it("leaves deleting to the menus that open it", async () => {
    responses["/api/smart-collections/smc_1"] = {
      smartCollection: {
        id: "smc_1",
        slug: "quotes",
        title: "Quotes",
        selection: {},
        sort: "newest",
        layout: null,
      },
    };
    const element = mountDialog();
    void element.open({ smartCollectionId: "smc_1" });
    await settle(element);

    // Nothing destructive shares a row with Save.
    expect(element.textContent).not.toContain("Delete");
  });
});
