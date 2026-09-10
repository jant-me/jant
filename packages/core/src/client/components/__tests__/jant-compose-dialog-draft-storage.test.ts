// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ComposeCollection, ComposeLabels } from "../compose-types.js";
import "../jant-compose-editor.js";
import "../jant-compose-dialog.js";
import type { JantComposeDialog } from "../jant-compose-dialog.js";
import type { JantComposeEditor } from "../jant-compose-editor.js";

const DRAFT_KEY = "jant:compose-draft";

const collections: ComposeCollection[] = [
  { id: "col-books", title: "Books", slug: "books" },
  { id: "col-movies", title: "Movies", slug: "movies" },
];

const labels = {
  draftRestored: "Draft restored.",
  draftStoreFailed: "This browser can't keep a local copy. Save as a draft.",
} as unknown as ComposeLabels;

type Internals = {
  _threadItems: { id: string; format: string }[];
  _collectionIds: string[];
  _visibility: string;
  _saveDraftToStorage: () => void;
};

async function flushUpdates(el?: JantComposeDialog) {
  await Promise.resolve();
  await Promise.resolve();
  if (el) await el.updateComplete;
}

async function createElement(): Promise<JantComposeDialog> {
  const el = document.createElement("jant-compose-dialog") as JantComposeDialog;
  el.collections = collections;
  el.labels = labels;
  const dialog = document.createElement("dialog");
  dialog.appendChild(el);
  document.body.appendChild(dialog);
  await el.updateComplete;
  const editor = el.querySelector<JantComposeEditor>("jant-compose-editor");
  if (editor) await editor.updateComplete;
  return el;
}

/** Park a quote+quote thread in localStorage, the way hitting Publish does. */
async function parkThreadDraft(): Promise<JantComposeDialog> {
  const el = await createElement();
  const internals = el as unknown as Internals;
  internals._threadItems = [
    { id: "t1", format: "quote" },
    { id: "t2", format: "quote" },
  ];
  await flushUpdates(el);
  const editors = Array.from(
    el.querySelectorAll<JantComposeEditor>("jant-compose-editor"),
  );
  for (const editor of editors) await editor.updateComplete;
  editors[0]._quoteText = "First quote body.";
  editors[1]._quoteText = "Second quote body.";
  await flushUpdates(el);
  internals._saveDraftToStorage();
  return el;
}

describe("compose local draft storage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    globalThis.localStorage.clear();
    if (!HTMLDialogElement.prototype.showModal) {
      HTMLDialogElement.prototype.showModal = function () {
        this.setAttribute("open", "");
      };
    }
    if (!HTMLDialogElement.prototype.close) {
      HTMLDialogElement.prototype.close = function () {
        this.removeAttribute("open");
      };
    }
  });

  it("keeps a parked thread draft when an unrelated reply composer autosaves", async () => {
    // One storage key answers for new posts and for replies, in every tab. A
    // reply composer never restores a new-post draft, so it is always empty
    // from that key's point of view — it must not read that as "discarded".
    await parkThreadDraft();
    expect(globalThis.localStorage.getItem(DRAFT_KEY)).not.toBeNull();

    const replyEl = await createElement();
    vi.spyOn(
      replyEl as unknown as {
        _fetchReplyContext: (id: string) => Promise<void>;
      },
      "_fetchReplyContext",
    ).mockResolvedValue(undefined);
    vi.spyOn(
      replyEl as unknown as {
        _loadReplyParentPosition: (id: string) => Promise<void>;
      },
      "_loadReplyParentPosition",
    ).mockResolvedValue(undefined);

    await replyEl.openReply("pst_unrelated");
    await flushUpdates(replyEl);
    (replyEl as unknown as Internals)._saveDraftToStorage();

    expect(globalThis.localStorage.getItem(DRAFT_KEY)).not.toBeNull();
  });

  it("keeps a parked draft when a composer that restored nothing autosaves", async () => {
    // If a restore bails for any reason, the composer sits there empty. Its
    // own debounced autosave must not then delete the work it failed to show.
    await parkThreadDraft();
    const second = await createElement();
    vi.spyOn(
      second as unknown as { restoreLocalDraft: () => Promise<string> },
      "restoreLocalDraft",
    ).mockResolvedValue("composer-has-content");

    await second.openNew();
    await flushUpdates(second);
    (second as unknown as Internals)._saveDraftToStorage();

    expect(globalThis.localStorage.getItem(DRAFT_KEY)).not.toBeNull();
  });

  it("still drops the draft when the author empties the composer they restored it into", async () => {
    await parkThreadDraft();
    const el = await createElement();
    await el.openNew();
    await flushUpdates(el);

    const editors = Array.from(
      el.querySelectorAll<JantComposeEditor>("jant-compose-editor"),
    );
    expect(editors[0]._quoteText).toBe("First quote body.");

    // The author clears both rows.
    for (const editor of editors) {
      editor._quoteText = "";
      await editor.updateComplete;
    }
    await flushUpdates(el);
    (el as unknown as Internals)._saveDraftToStorage();

    expect(globalThis.localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it("brings back each thread post's rating and toggles", async () => {
    // A single-post draft always kept these; a thread's posts dropped them.
    const parked = await createElement();
    (parked as unknown as Internals)._threadItems = [
      { id: "t1", format: "note" },
      { id: "t2", format: "note" },
    ];
    await flushUpdates(parked);
    const [first, second] = Array.from(
      parked.querySelectorAll<JantComposeEditor>("jant-compose-editor"),
    );
    first._bodyJson = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "One" }] },
      ],
    };
    first._rating = 4;
    first._showRating = true;
    first._showTitle = false;
    second._bodyJson = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Two" }] },
      ],
    };
    // Opened but still empty — the draft puts the field back as it was left.
    second._showTitle = true;
    await flushUpdates(parked);
    (parked as unknown as Internals)._saveDraftToStorage();

    const el = await createElement();
    await el.openNew();
    await flushUpdates(el);

    const [restoredFirst, restoredSecond] = Array.from(
      el.querySelectorAll<JantComposeEditor>("jant-compose-editor"),
    );
    expect(restoredFirst._rating).toBe(4);
    expect(restoredFirst._showRating).toBe(true);
    expect(restoredFirst._showTitle).toBe(false);
    expect(restoredSecond._showTitle).toBe(true);
  });

  it("leaves an unreadable draft in place instead of deleting it", async () => {
    globalThis.localStorage.setItem(DRAFT_KEY, "{not json");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const el = await createElement();
    const outcome = await el.restoreLocalDraft();

    expect(outcome).toBe("unreadable");
    expect(globalThis.localStorage.getItem(DRAFT_KEY)).toBe("{not json");
    expect(warn).toHaveBeenCalled();
  });

  it("leaves an expired draft in place, and does not restore it", async () => {
    const stale = {
      format: "note",
      title: "Old thought",
      bodyJson: null,
      url: "",
      quoteText: "",
      quoteAuthor: "",
      slug: "",
      visibility: "public",
      rating: 0,
      showTitle: false,
      showRating: false,
      collectionIds: [],
      replyToId: null,
      attachedTexts: [],
      savedAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
    };
    globalThis.localStorage.setItem(DRAFT_KEY, JSON.stringify(stale));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const el = await createElement();
    const outcome = await el.restoreLocalDraft();

    expect(outcome).toBe("expired");
    expect(globalThis.localStorage.getItem(DRAFT_KEY)).not.toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("stays quiet when there was simply no draft to restore", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const el = await createElement();

    expect(await el.restoreLocalDraft()).toBe("none");
    expect(warn).not.toHaveBeenCalled();
  });

  it("tells the author once when the draft cannot be written at all", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const el = await createElement();
    await el.openNew();
    const editor = el.querySelector<JantComposeEditor>("jant-compose-editor")!;
    await editor.updateComplete;
    (editor as unknown as { _title: string })._title =
      "Something worth keeping";
    await flushUpdates(el);

    // Storage starts refusing writes only now, so the composer is otherwise set
    // up exactly as it would be when a quota is hit mid-session.
    const setItem = vi
      .spyOn(globalThis.localStorage, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });

    const internals = el as unknown as Internals;
    internals._saveDraftToStorage();
    internals._saveDraftToStorage();
    internals._saveDraftToStorage();

    expect(setItem).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalled();
    // Said once per composer, not once per keystroke.
    expect(document.querySelectorAll(".toast").length).toBe(1);
    expect(document.querySelector(".toast")?.textContent).toContain(
      "can't keep a local copy",
    );

    // The spy replaces an own property on the shared localStorage instance,
    // which outlives this test's mock cleanup — put it back by hand.
    setItem.mockRestore();
  });

  it("keeps a restored draft's own visibility over the collection's default", async () => {
    globalThis.localStorage.setItem(
      "jant:collection-visibility:col-books",
      "private",
    );

    const first = await createElement();
    await first.openNew();
    const editor = first.querySelector<JantComposeEditor>(
      "jant-compose-editor",
    )!;
    await editor.updateComplete;
    (editor as unknown as { _title: string })._title = "A public thought";
    (first as unknown as Internals)._visibility = "public";
    await flushUpdates(first);
    (first as unknown as Internals)._saveDraftToStorage();

    const second = await createElement();
    await second.openNew({ collectionId: "col-books" });
    await flushUpdates(second);

    expect((second as unknown as Internals)._visibility).toBe("public");
  });

  it("still applies the collection's visibility to a genuinely new post", async () => {
    globalThis.localStorage.setItem(
      "jant:collection-visibility:col-books",
      "private",
    );
    const el = await createElement();
    await el.openNew({ collectionId: "col-books" });
    await flushUpdates(el);

    expect((el as unknown as Internals)._visibility).toBe("private");
  });

  it("adds the collection the composer was opened from to a restored draft", async () => {
    // Deliberate: collections are a set, adding is visible in the chips, and
    // opening the composer inside a collection says where the post belongs.
    const first = await createElement();
    await first.openNew({ collectionId: "col-movies" });
    const editor = first.querySelector<JantComposeEditor>(
      "jant-compose-editor",
    )!;
    await editor.updateComplete;
    (editor as unknown as { _title: string })._title = "Half-written thought";
    await flushUpdates(first);
    (first as unknown as Internals)._saveDraftToStorage();

    const second = await createElement();
    await second.openNew({ collectionId: "col-books" });
    await flushUpdates(second);

    expect((second as unknown as Internals)._collectionIds).toEqual([
      "col-books",
      "col-movies",
    ]);
  });
});
