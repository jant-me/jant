// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from "vitest";
import type {
  PostFormLabels,
  PostFormInitial,
  ThreadCollectionOption,
  PostMediaItem,
  PostSubmitDetail,
} from "../post-form-types.js";
import "../jant-post-form.js";
import type { JantPostForm } from "../jant-post-form.js";

const labels: PostFormLabels = {
  formatLabel: "Format",
  noteOption: "Note",
  linkOption: "Link",
  quoteOption: "Quote",
  titleLabel: "Title",
  titlePlaceholder: "Title...",
  slugLabel: "Slug",
  slugPlaceholder: "auto-generated",
  slugHelp: "Auto-generated from title",
  bodyLabel: "Body",
  bodyPlaceholder: "Body...",
  urlLabel: "URL",
  urlPlaceholder: "https://example.com",
  quoteTextLabel: "Quote Text",
  quoteTextPlaceholder: "Quote...",
  mediaLabel: "Media",
  mediaAddButton: "Add Media",
  mediaRemoveButton: "Remove",
  mediaEmptyLabel: "No media",
  statusLabel: "Status",
  statusPublished: "Published",
  statusDraft: "Draft",
  visibilityLabel: "Visibility",
  visibilityPublic: "Public",
  visibilityHiddenFromLatest: "Hidden from Latest",
  pinnedLabel: "Pinned",
  collectionsLabel: "Collections",
  submitLabel: "Publish",
  cancelLabel: "Cancel",
  mediaDialogTitle: "Select Media",
  mediaDialogDone: "Done",
  mediaDialogLoading: "Loading...",
  submitSuccessMessage: "Saved!",
  submitErrorMessage: "Failed.",
  draftFallbackMessage: "Couldn't publish. Saved as draft.",
};

const initial: PostFormInitial = {
  format: "note",
  title: "",
  slug: "",
  body: "",
  url: "",
  quoteText: "",
  status: "published",
  visibility: "public",
  pinned: false,
  rating: 0,
  collectionIds: [],
  mediaIds: [],
};

const collections: ThreadCollectionOption[] = [
  { id: 1, title: "General" },
  { id: 2, title: "Favorites" },
];

const media: PostMediaItem[] = [
  {
    id: "m1",
    thumbUrl: "https://cdn.example.com/m1.jpg",
    alt: "Media 1",
    mimeType: "image/jpeg",
    originalName: "photo.jpg",
  },
];

async function createElement(
  overrides: Partial<JantPostForm> = {},
): Promise<JantPostForm> {
  const el = document.createElement("jant-post-form") as JantPostForm;
  el.labels = { ...labels };
  el.initial = { ...initial };
  el.collections = [...collections];
  el.media = [...media];
  el.action = "/compose";
  Object.assign(el, overrides);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("JantPostForm", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders base fields and labels", async () => {
    const el = await createElement();
    const select = el.querySelector("select.select");
    expect(select).not.toBeNull();
    const label = el.querySelector(".field .label");
    expect(label?.textContent?.trim()).toBe("Format");
    const submit = el.querySelector<HTMLButtonElement>("button[type=submit]");
    expect(submit?.textContent?.trim()).toContain("Publish");
  });

  it("shows quote textarea when format set to quote", async () => {
    const el = await createElement({
      initial: { ...initial, format: "quote" },
    });
    await el.updateComplete;
    const textarea = el.querySelector<HTMLTextAreaElement>(
      "textarea[placeholder='Quote...']",
    );
    expect(textarea).not.toBeNull();
  });

  it("dispatches jant:post-submit with form data", async () => {
    const el = await createElement();
    const form = el.querySelector("form");
    expect(form).not.toBeNull();
    if (!form) throw new Error("Form element not found");

    const titleInput = el.querySelector<HTMLInputElement>("input.input");
    expect(titleInput).not.toBeNull();
    if (!titleInput) throw new Error("Title input not found");
    titleInput.value = "Sample Post";
    titleInput.dispatchEvent(new Event("input", { bubbles: true }));

    // Set body via Tiptap JSON state (Tiptap editor may not init in happy-dom)
    el._bodyJson = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello world" }] },
      ],
    };
    el._body = JSON.stringify(el._bodyJson);

    // Set visibility to "latest_hidden" via the select dropdown
    const visibilitySelect = el
      .querySelectorAll("select.select")
      .item(2) as unknown as HTMLSelectElement | null; // [0]=format, [1]=status, [2]=visibility
    expect(visibilitySelect).not.toBeNull();
    if (!visibilitySelect) throw new Error("Visibility select not found");
    visibilitySelect.value = "latest_hidden";
    visibilitySelect.dispatchEvent(new Event("change", { bubbles: true }));

    const checkboxList =
      el.querySelectorAll<HTMLInputElement>("input.checkbox");
    expect(checkboxList.length).toBeGreaterThan(0);

    const collectionCheckbox = checkboxList.item(1);
    expect(collectionCheckbox).not.toBeNull();
    if (!collectionCheckbox) throw new Error("Collection checkbox missing");
    collectionCheckbox.checked = true;
    collectionCheckbox.dispatchEvent(new Event("change", { bubbles: true }));

    el.mediaIds = ["m1"];

    let detail: PostSubmitDetail | null = null;
    el.addEventListener("jant:post-submit", (event) => {
      detail = (event as CustomEvent<PostSubmitDetail>).detail;
    });

    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );

    expect(detail).not.toBeNull();
    const d = detail as unknown as PostSubmitDetail;
    expect(d.endpoint).toBe("/compose");
    expect(d.data.title).toBe("Sample Post");
    expect(d.data.body).toContain("Hello world");
    expect(d.data.visibility).toBe("latest_hidden");
    expect(d.data.collectionIds).toEqual([collections[0].id]);
    expect(d.data.mediaIds).toEqual(["m1"]);
  });

  it("updates mediaIds when setter called", async () => {
    const el = await createElement();
    el.mediaIds = ["m1"];
    await el.updateComplete;

    const items = el.querySelectorAll("[data-media-id]");
    expect(items.length).toBe(1);
    expect(items[0].getAttribute("data-media-id")).toBe("m1");
  });
});
