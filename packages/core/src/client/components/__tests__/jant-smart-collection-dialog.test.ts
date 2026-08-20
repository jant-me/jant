// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../toast.js", () => ({
  showToast: vi.fn(),
  showToastWithAction: vi.fn(),
}));

const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn() }));
vi.mock("../../confirm.js", () => ({
  showConfirmDialog: confirmMock,
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
  title: "Title",
  address: "Address",
  addressTaken: "This address is taken. Choose another.",
  addressMovesWarning: "Changing the address breaks the old one immediately.",
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
  deleteSmartCollection: "Delete Smart Collection",
  confirmDelete: "Delete this smart collection? Its address stops working.",
  cancel: "Cancel",
  save: "Save",
  saved: "Smart collection saved.",
  deleted: "Smart collection deleted.",
  saveFailed: "Could not save. Try again.",
  loadFailed: "Could not open this smart collection. Try again.",
  titleAndAddressRequired: "A smart collection needs a title and an address.",
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
  confirmMock.mockReset().mockResolvedValue(true);
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

  it("says an address is taken rather than failing on save", async () => {
    responses["/api/smart-collections/slug"] = {
      slug: "books",
      available: false,
    };
    const element = mountDialog();
    void element.open({ prefill: { title: "Books" } });
    await settle(element);

    expect(element.textContent).toContain(
      "This address is taken. Choose another.",
    );
  });

  it("warns before an existing address moves", async () => {
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
      "Changing the address breaks the old one immediately.",
    );

    const slugInput = element.querySelector<HTMLInputElement>(
      "#smart-collection-slug",
    );
    if (slugInput) {
      slugInput.value = "citations";
      slugInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
    await settle(element);

    expect(element.textContent).toContain(
      "Changing the address breaks the old one immediately.",
    );
  });

  it("confirms before deleting, naming what is lost", async () => {
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
    const closed = element.open({ smartCollectionId: "smc_1" });
    await settle(element);

    const remove = [...element.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Delete Smart Collection",
    );
    remove?.click();
    await settle(element);

    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Delete this smart collection? Its address stops working.",
        tone: "danger",
      }),
    );
    await expect(closed).resolves.toBe(true);
  });
});
