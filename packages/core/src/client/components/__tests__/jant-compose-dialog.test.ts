// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Editor } from "@tiptap/core";
import { MAX_THREAD_POSTS } from "../../../types.js";

import type {
  ComposeFullscreenCloseDetail,
  ComposeFullscreenOpenDetail,
  ComposeLabels,
  ComposeCollection,
  ComposeSubmitDetail,
} from "../compose-types.js";
import "../jant-compose-editor.js";
import "../jant-compose-dialog.js";
import type { JantComposeDialog } from "../jant-compose-dialog.js";
import type { JantComposeEditor } from "../jant-compose-editor.js";

function requireElement<T extends globalThis.Element>(
  element: T | null,
  message: string,
): T {
  if (!element) {
    throw new Error(message);
  }
  return element;
}

function requireEditor(el: JantComposeEditor): Editor {
  const editor = (el as unknown as { _editor?: Editor | null })._editor;
  if (!editor) {
    throw new Error("expected compose editor instance");
  }
  return editor;
}

function keydown(
  element: globalThis.Element,
  key: string,
  init: globalThis.KeyboardEventInit = {},
) {
  element.dispatchEvent(
    new globalThis.KeyboardEvent("keydown", {
      bubbles: true,
      key,
      ...init,
    }),
  );
}

function collectionOptionTitles(root: globalThis.Element): string[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>("[data-popover] [role='option']"),
  ).map(
    (option) =>
      option
        .querySelector(".compose-collection-option-label")
        ?.textContent?.trim() ?? "",
  );
}

async function flushUpdates(el?: JantComposeDialog) {
  await Promise.resolve();
  await Promise.resolve();
  if (el) {
    await el.updateComplete;
  }
}

async function openPublishPanel(el: JantComposeDialog) {
  requireElement(
    el.querySelector<HTMLButtonElement>(".compose-options-trigger"),
    "expected publish settings toggle",
  ).click();
  await flushUpdates(el);
}

/** Options-panel rows are found by their title — the drafts entries moved off
 *  the title bar and into that panel. */
function sheetRow(
  el: JantComposeDialog,
  title: string,
): HTMLButtonElement | null {
  return (
    Array.from(
      el.querySelectorAll<HTMLButtonElement>(
        ".compose-publish-panel .compose-sheet-row",
      ),
    ).find(
      (row) =>
        row.querySelector(".compose-sheet-title")?.textContent?.trim() ===
        title,
    ) ?? null
  );
}

function sheetRowTitles(el: JantComposeDialog): (string | undefined)[] {
  return Array.from(
    el.querySelectorAll<HTMLElement>(
      ".compose-publish-panel .compose-sheet-title",
    ),
  ).map((n) => n.textContent?.trim());
}

function draftsRow(el: JantComposeDialog): HTMLButtonElement | null {
  return sheetRow(el, "Drafts");
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(globalThis, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function mockSlugApi(
  handler: (url: URL) => { status?: number; body: unknown },
): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const url = new URL(raw, "http://localhost");

    if (url.pathname === "/api/posts/slug") {
      const { status = 200, body } = handler(url);
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unexpected fetch: ${url.pathname}${url.search}`);
  });
}

const labels: ComposeLabels = {
  cancel: "Cancel",
  note: "Note",
  link: "Link",
  quote: "Quote",
  saveDraft: "Save as Draft",
  saveAsDraft: "Save as draft",
  discard: "Discard",
  titlePlaceholder: "Title",
  bodyPlaceholder: "What's on your mind...",
  urlPlaceholder: "Paste a URL...",
  urlInvalid: "Enter a valid URL starting with http://, https://, or mailto:.",
  linkUrlRequired: "Add a URL before posting this link.",
  linkTitleRequired: "Add a title before posting this link.",
  linkTitlePlaceholder: "Give it a title...",
  thoughtsPlaceholder: "Your thoughts (optional)",
  quotePlaceholder: "Type the quote...",
  authorPlaceholder: "Author (optional)",
  sourcePlaceholder: "Source link (optional)",
  attachedText: "Attached Text",
  attachedTextPlaceholder: "Paste text...",
  attachedTextHint: "Supplementary content",
  done: "Done",
  media: "Media",
  rate: "Rate",
  emoji: "Emoji",
  title: "Title",
  fullscreen: "Fullscreen",
  exitFullscreen: "Exit fullscreen",
  collection: "Collection",
  searchCollections: "Search...",
  noCollections: "No collections match that search. Try a different name.",
  emptyCollections: "Create a collection to get started.",
  post: "Post",
  addAlt: "+ ALT",
  addAltTitle: "Add alt text",
  altPlaceholder: "Describe this...",
  altHint: "Alt text improves accessibility",
  addMore: "Add",
  removeAttachment: "Remove attachment",
  uploading: "Uploading...",
  loadingPost: "Loading post...",
  loadPostFailed: "Couldn't load this post. Try again.",
  published: "Published!",
  view: "View",
  retryAll: "Tap to retry",
  editPost: "Edit post",
  update: "Done",
  confirmCloseTitle: "Save to drafts?",
  confirmCloseSubtitle: "Save to drafts to edit and post at a later time.",
  confirmCloseSave: "Save",
  confirmCloseCancel: "Cancel",
  confirmCloseDiscard: "Don't save",
  confirmAttachedTitle: "Save text attachment?",
  confirmAttachedSubtitle:
    "Save these changes to the text attachment, discard them, or keep editing.",
  confirmAttachedSave: "Save",
  confirmAttachedDiscard: "Don't save",
  confirmEditTitle: "You have unsaved changes",
  confirmEditSubtitle: "Do you want to publish your changes or discard them?",
  confirmEditPublish: "Publish",
  confirmEditDiscard: "Discard",
  discardChangesConfirm: "Discard changes?",
  drafts: "Drafts",
  draftsEmpty: "No drafts yet. Save a draft to find it here.",
  previewDraft: "Preview",
  draftActions: "Draft actions",
  deleteDraft: "Delete Draft",
  draftDeleted: "Draft deleted.",
  publishFailedDraft: "Couldn't publish. Saved as draft.",
  uploadFailedDraft: "Some uploads failed. Saved as draft.",
  addCollection: "Add Collection",
  collectionCountLabel: "%name% + %count% more",
  draftRestored: "Draft restored.",
  reply: "Reply",
  publishHideFromLatest: "Hide from Latest",
  publishPrivate: "Post as Private",
  publishSettings: "Publish settings",
  languageLabel: "Language",
  languageAuto: "Detect",
  languageAutoHint: "Read from what you write",
  languageAutoDetected: "Read from what you write — looks like {language}",
  languageConfirmTitle: "This looks like {language}",
  languageConfirmSubtitle: "Which language should it publish in?",
  languageConfirmPublishIn: "Publish in {language}",
  translationOf: "Translation of “{title}”",
  translationContext: "Translating",
  translationContextInLanguage: "Translating into {language}",
  translationContextOpen: "Open the original in a new tab",
  translationContextOriginal: "The original",
  translationContextHide: "Hide",
  translationContextHideLong: "Hide the original",
  translationContextShow: "Show",
  translationContextShowLong: "Show the original",
  publishVisibilityLabel: "Visibility",
  publishVisibilityPublic: "Public",
  publishVisibilityPublicHint: "Appears in Latest.",
  publishVisibilityHiddenFromLatest: "Hidden from Latest",
  publishVisibilityHiddenFromLatestHint:
    "Doesn't appear in Latest. Still appears in collections you add it to.",
  publishVisibilityPrivate: "Private",
  publishVisibilityPrivateHint: "Only visible when signed in.",
  publishDateLabel: "Published on",
  publishDateHint:
    "Leave blank to publish now. Use an earlier date when importing older posts.",
  publishDateReset: "Use current date",
  publishDateInvalid: "Enter a valid date.",
  publishDateFutureError:
    "Choose today or an earlier date, or leave it blank to publish now.",
  publishDateSummaryNow: "Now",
  publishDateSummaryAction: "Edit publish date",
  publishSlugLabel: "Custom link",
  publishSlugPlaceholder: "your-post-link",
  publishSlugHint: "Leave blank to generate one automatically.",
  publishSlugAuto: "Generate automatically",
  publishSlugSummaryAuto: "Auto",
  publishSlugSummaryAction: "Edit custom link",
  publishSlugReset: "Reset link",
  publishSlugSuggested: "Suggested link",
  publishSlugGenerating: "Generating a link...",
  publishSlugChecking: "Checking link...",
  publishSlugTaken: "This link is already in use. Choose something else.",
  publishSlugInvalid: "Use lowercase letters, numbers, and hyphens only.",
  publishSlugReserved: "This link is reserved. Choose something else.",
  postHiddenFromLatest: "Post hidden",
  postPrivately: "Post privately",
  quietReplyLabel: "Reply quietly",
  quietReplyHint: "Won't move the thread to the top of latest.",
  threadLimitReached: "Threads can include up to 20 posts.",
  showMore: "Show more",
  showLess: "Show less",
  closeCompose: "Close compose",
  editing: "Editing",
  composeDialogLabel: "Compose",
  slashHint: "Type / for commands",
  tableControls: {
    toolbarLabel: "Table controls",
    addRowAbove: "Add row above",
    addRowBelow: "Add row below",
    addColumnBefore: "Add column before",
    addColumnAfter: "Add column after",
    options: "Table options",
    deleteRow: "Delete row",
    deleteColumn: "Delete column",
    toggleHeaderRow: "Toggle header row",
    deleteTable: "Delete table",
    sizePickerLabel: "Choose table size",
    insertTableSize: "Insert %rows% by %cols% table",
  },
  collectionFormLabels: {
    titleLabel: "Title",
    titlePlaceholder: "My Collection",
    slugLabel: "Collection link",
    slugHelp: "This is the last part of the collection link.",
    slugInvalidHelp: "Use lowercase letters, numbers, and hyphens only.",
    slugReservedHelp: "This link is reserved. Choose something else.",
    editSlugLabel: "Edit link",
    resetSlugLabel: "Reset link",
    quickHint: "More options are available after you create it.",
    quickSubmitLabel: "Done",
    createdLabel: "Collection created.",
    descriptionLabel: "Description (optional)",
    descriptionPlaceholder: "What's this collection about?",
    sortOrderLabel: "Sort Order",
    sortNewest: "Newest first",
    sortOldest: "Oldest first",
    sortRatingDesc: "Highest rated",
    submitLabel: "Save",
    cancelLabel: "Cancel",
  },
};

const collections: ComposeCollection[] = [
  { id: "col-1", title: "Books", slug: "books" },
  { id: "col-2", title: "Movies", slug: "movies" },
];

/**
 * Date and permalink hang off the post itself, not the publish panel. Both
 * fields are open as soon as the panel is, so there is nothing further to
 * expand. Idempotent.
 */
async function openPostMeta(el: JantComposeDialog, index = 0) {
  const pill = el.querySelectorAll<HTMLButtonElement>(
    "[data-compose-post-meta-pill]",
  )[index];
  if (pill && pill.getAttribute("aria-expanded") !== "true") pill.click();
  // The slug suggestion is fetched when the panel opens; let it settle.
  await flushUpdates(el);
  await flushUpdates(el);
}

/** The date or permalink as the post's own pill states it. */
function pillValue(
  el: JantComposeDialog,
  kind: "date" | "slug",
  index = 0,
): string | undefined {
  const pill = el.querySelectorAll("[data-compose-post-meta-pill]")[index];
  const selector =
    kind === "date"
      ? ".compose-post-meta-value:not(.compose-post-meta-value-slug)"
      : ".compose-post-meta-value-slug";
  return pill?.querySelector(selector)?.textContent?.trim();
}

async function createElement(
  cols: ComposeCollection[] = collections,
): Promise<JantComposeDialog> {
  const el = document.createElement("jant-compose-dialog") as JantComposeDialog;
  el.collections = cols;
  el.labels = labels;
  document.body.appendChild(el);
  await el.updateComplete;
  // Wait for nested editor to also render
  const editor = el.querySelector<JantComposeEditor>("jant-compose-editor");
  if (editor) await editor.updateComplete;
  return el;
}

describe("JantComposeDialog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    globalThis.localStorage.clear();
    delete document.documentElement.dataset.sitePathPrefix;
    Object.defineProperty(globalThis, "matchMedia", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    Object.defineProperty(globalThis, "visualViewport", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    (
      customElements.get("jant-compose-dialog") as typeof HTMLElement & {
        _lastNewPostVisibility: string;
      }
    )._lastNewPostVisibility = "public";

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

  it("renders with collections and labels", async () => {
    const el = await createElement();

    // No title bar: the composer opens straight onto the post header row. A new
    // post gets no marker either — an empty composer already says that much.
    expect(el.querySelector(".compose-dialog-header")).toBeNull();
    expect(el.querySelector(".compose-thread-post-header")).not.toBeNull();
    expect(el.querySelector(".compose-post-badge")).toBeNull();

    // Format buttons present
    const segmentedItems = el.querySelectorAll(".compose-segmented-item");
    expect(segmentedItems.length).toBe(3);
    expect(segmentedItems[0].textContent?.trim()).toBe("Note");
    expect(segmentedItems[1].textContent?.trim()).toBe("Link");
    expect(segmentedItems[2].textContent?.trim()).toBe("Quote");

    // Post button present (split button with visibility dropdown)
    const postBtn = requireElement(
      el.querySelector<HTMLButtonElement>(".compose-publish-main"),
      "expected post button",
    );
    expect(postBtn.textContent?.trim()).toBe("Post");
    expect(postBtn.disabled).toBe(true);
    expect(
      requireElement(
        el.querySelector<HTMLButtonElement>(".compose-options-trigger"),
        "expected publish settings toggle",
      ).disabled,
    ).toBe(false);
    expect(
      el.querySelector<HTMLButtonElement>(
        '.compose-tool-btn-view[aria-label="Fullscreen"]',
      ),
    ).not.toBeNull();
  });

  it("restores the editor selection after fullscreen closes", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    const focusSpy = vi.spyOn(editor, "focusSelection");

    document.dispatchEvent(
      new CustomEvent("jant:fullscreen-close", {
        detail: {
          json: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Hello" }],
              },
            ],
          },
          title: "",
          selection: { from: 3, to: 3 },
          replyExpanded: false,
        },
      }),
    );

    await flushUpdates(el);
    await flushUpdates(el);

    expect(focusSpy).toHaveBeenCalledWith({ from: 3, to: 3 });
  });

  it("opens edit mode without auto-focusing the editor body", async () => {
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "pst_123",
          format: "note",
          title: "Long draft",
          body: JSON.stringify({
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Long body text" }],
              },
            ],
          }),
          mediaAttachments: [],
        }),
        {
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const compose = await createElement();
    const editor = requireElement(
      compose.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    const shell = requireElement(
      compose.querySelector<HTMLElement>(".compose-dialog-inner"),
      "expected compose dialog shell",
    );
    const shellFocusSpy = vi.spyOn(shell, "focus");
    const focusSpy = vi.spyOn(editor, "focusInput");

    await compose.openEdit("pst_123");
    await flushUpdates(compose);
    await flushUpdates(compose);

    expect(focusSpy).not.toHaveBeenCalled();
    expect(shellFocusSpy).toHaveBeenCalled();
  });

  it("shows a loading state while edit data is still loading", async () => {
    const postResponse = deferred<Response>();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => postResponse.promise,
    );

    const compose = await createElement();
    const opening = compose.openEdit("pst_123");
    await flushUpdates(compose);

    expect(compose.textContent).toContain("Loading post...");
    expect(compose.querySelector("jant-compose-editor")).toBeNull();

    postResponse.resolve(
      new Response(
        JSON.stringify({
          id: "pst_123",
          format: "note",
          title: "Loaded later",
          body: JSON.stringify({
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Loaded body text" }],
              },
            ],
          }),
          mediaAttachments: [],
        }),
        {
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await opening;
    await flushUpdates(compose);

    expect(compose.textContent).not.toContain("Loading post...");
    expect(compose.querySelector("jant-compose-editor")).not.toBeNull();
  });

  it("opens publish settings even when publish is disabled", async () => {
    const el = await createElement();

    requireElement(
      el.querySelector<HTMLButtonElement>(".compose-options-trigger"),
      "expected publish settings toggle",
    ).click();
    await el.updateComplete;

    expect(el.querySelector(".compose-publish-panel")).not.toBeNull();
  });

  it("offers saving separately from browsing once there is something to save", async () => {
    const el = await createElement();
    await openPublishPanel(el);

    // Nothing written yet, so there is only a place to go.
    expect(sheetRowTitles(el)).toContain("Drafts");
    expect(sheetRowTitles(el)).not.toContain("Save as draft");

    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    editor._bodyJson = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello world" }] },
      ],
    };
    await editor.updateComplete;
    await flushUpdates(el);

    // Now both: an action on this post, and the list. Neither label lies about
    // what its row does.
    const titles = sheetRowTitles(el);
    expect(titles).toContain("Save as draft");
    expect(titles).toContain("Drafts");
    expect(titles.indexOf("Save as draft")).toBeLessThan(
      titles.indexOf("Drafts"),
    );
  });

  it("saves straight to a draft from its own row, with no prompt in the way", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    editor._bodyJson = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello world" }] },
      ],
    };
    await editor.updateComplete;
    await flushUpdates(el);

    let detail: ComposeSubmitDetail | null = null;
    el.addEventListener("jant:compose-submit-deferred", (event) => {
      detail = (event as CustomEvent<ComposeSubmitDetail>).detail;
    });

    await openPublishPanel(el);
    requireElement(
      sheetRow(el, "Save as draft"),
      "expected save-as-draft row",
    ).click();
    await flushUpdates(el);

    expect(el._confirmPanelOpen).toBe(false);
    expect(el._draftsPanelOpen).toBe(false);
    expect(detail).not.toBeNull();
    expect(detail!.status).toBe("draft");
  });

  it("opens options from its own button, not a chevron on Publish", async () => {
    const el = await createElement();

    // The split button is gone: Publish is one button, options is another.
    expect(el.querySelector(".compose-publish-toggle")).toBeNull();

    const trigger = requireElement(
      el.querySelector<HTMLButtonElement>(".compose-options-trigger"),
      "expected options trigger",
    );
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(el.querySelector(".compose-sheet")).toBeNull();

    trigger.click();
    await flushUpdates(el);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(el.querySelector(".compose-sheet")).not.toBeNull();
  });

  describe("language", () => {
    async function openPublishPanel(el: JantComposeDialog) {
      requireElement(
        el.querySelector<HTMLButtonElement>(".compose-options-trigger"),
        "expected options trigger",
      ).click();
      await flushUpdates(el);
    }

    function languageRowTitles(el: JantComposeDialog): string[] {
      const group = el.querySelector("[role='radiogroup']");
      return Array.from(
        group?.querySelectorAll(".compose-sheet-title") ?? [],
      ).map((node) => node.textContent?.trim() ?? "");
    }

    it("shows nothing on a site that publishes one language", async () => {
      // The whole feature is opt-in: an author who never turned it on should
      // not meet a language control.
      const el = await createElement();
      await openPublishPanel(el);

      expect(languageRowTitles(el)).not.toContain("English");
      expect(el.textContent).not.toContain("Detect");
    });

    it("offers Detect plus each language once the site is multilingual", async () => {
      const el = await createElement();
      el.languages = [
        { tag: "zh-Hans", label: "简体中文" },
        { tag: "en", label: "English" },
      ];
      await flushUpdates(el);
      await openPublishPanel(el);

      expect(languageRowTitles(el)).toEqual(["Detect", "简体中文", "English"]);
    });

    /**
     * Open the composer on a translation of `post`. The composer asks for two
     * things: the post's fields, to seed from, and its server-rendered markup,
     * to show.
     */
    async function openTranslationOf(
      el: JantComposeDialog,
      post: Record<string, unknown>,
      options: { language?: string; previewHtml?: string | null } = {},
    ) {
      const { language = "en", previewHtml = null } = options;
      vi.spyOn(globalThis, "fetch").mockImplementation((input: unknown) => {
        if (String(input).includes("/_/post-preview/")) {
          return Promise.resolve({
            ok: previewHtml !== null,
            text: async () => previewHtml ?? "",
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: async () => post,
        } as Response);
      });

      await el.openTranslation((post.id as string) ?? "pst_source", language);
      await flushUpdates(el);
      await flushUpdates(el);
      await flushUpdates(el);
      return el;
    }

    async function multilingualElement() {
      const el = await createElement();
      el.languages = [
        { tag: "zh-Hans", label: "简体中文" },
        { tag: "en", label: "English" },
      ];
      await flushUpdates(el);
      return el;
    }

    const PREVIEW_HTML =
      '<article class="h-entry post-menu-target" data-post data-post-id="pst_source" data-page="post">' +
      '<h1 class="post-detail-title">咖啡笔记</h1>' +
      '<div class="post-header-meta-row"><a href="/coffee" class="post-header-meta-link">Aug 8, 2026</a></div>' +
      '<div class="e-content prose post-detail-body"><h2>耶加雪菲</h2>' +
      '<p>今天试了一支，<a href="https://example.com/beans">花香</a>很明显。</p></div>' +
      "</article>";

    it("says what it was opened to translate, before anything is typed", async () => {
      // Opened from a post, so the composer should carry that context above the
      // editor — not two panels down in the publish sheet.
      const el = await multilingualElement();
      await openTranslationOf(
        el,
        {
          id: "pst_source",
          format: "note",
          displayTitle: "咖啡笔记",
          slug: "coffee",
        },
        { previewHtml: PREVIEW_HTML },
      );

      const banner = requireElement(
        el.querySelector(".compose-translation-context"),
        "expected the translation context",
      );
      // The language sits on the seam between the two posts, not above both:
      // it reads as "…and below is that, in English".
      expect(
        banner
          .querySelector(".compose-translation-seam-label")
          ?.textContent?.trim(),
      ).toBe("Translating into English");
    });

    it("shows the original as the site renders it, inside a frame to scroll", async () => {
      // Server-rendered rather than rebuilt here, so a Quote arrives with its
      // attribution and a Link with its card. The frame is fixed because an
      // original handed its full height pushes the editor off the screen
      // exactly when both need to be visible.
      const el = await multilingualElement();
      await openTranslationOf(
        el,
        {
          id: "pst_source",
          format: "note",
          displayTitle: "咖啡笔记",
          slug: "coffee",
        },
        { previewHtml: PREVIEW_HTML },
      );

      const original = requireElement(
        el.querySelector(".compose-translation-original"),
        "expected the original's frame",
      );
      // Keyboard users have to be able to scroll it, and a screen reader has to
      // be able to name it.
      expect(original.getAttribute("tabindex")).toBe("0");
      expect(original.getAttribute("role")).toBe("region");
      expect(original.getAttribute("aria-label")).toBe("The original");
      // Structure is part of what is being translated, so it survives intact.
      expect(original.querySelector("h1")?.textContent).toBe("咖啡笔记");
      expect(original.querySelector("h2")?.textContent).toBe("耶加雪菲");

      // Nothing left of the expand-in-place preview it replaced, and no bolted
      // on external-link glyph — that made the card read as a Link post.
      expect(el.querySelector(".compose-translation-toggle")).toBeNull();
      expect(el.querySelector(".compose-translation-source-icon")).toBeNull();
    });

    it("folds the original away and back, keeping the seam either way", async () => {
      // The frame costs vertical room the editor may want back mid-draft. What
      // it is being translated into stays on screen while it is folded — that
      // is about the two posts, not about how much of one is showing.
      const el = await multilingualElement();
      await openTranslationOf(
        el,
        {
          id: "pst_source",
          format: "note",
          displayTitle: "咖啡笔记",
          slug: "coffee",
        },
        { previewHtml: PREVIEW_HTML },
      );

      const toggle = () =>
        requireElement(
          el.querySelector<HTMLButtonElement>(
            ".compose-translation-seam-toggle",
          ),
          "expected the fold toggle",
        );

      expect(el.querySelector(".compose-translation-original")).not.toBeNull();
      expect(toggle().getAttribute("aria-expanded")).toBe("true");
      expect(toggle().textContent?.trim()).toBe("Hide");

      toggle().click();
      await flushUpdates(el);

      expect(el.querySelector(".compose-translation-original")).toBeNull();
      expect(toggle().getAttribute("aria-expanded")).toBe("false");
      expect(toggle().textContent?.trim()).toBe("Show");
      expect(toggle().getAttribute("aria-label")).toBe("Show the original");
      expect(
        el
          .querySelector(".compose-translation-seam-label")
          ?.textContent?.trim(),
      ).toBe("Translating into English");

      toggle().click();
      await flushUpdates(el);

      // Unfolding re-creates the markup, so the links have to be sent to a new
      // tab again — the adopt pass runs on every update, not just the first.
      const link = requireElement(
        el.querySelector<HTMLAnchorElement>(
          ".compose-translation-preview a[href]",
        ),
        "expected the original back",
      );
      expect(link.getAttribute("target")).toBe("_blank");
    });

    it("sends every link in the original to a new tab", async () => {
      // A link followed in place navigates the composer away and takes the
      // unsaved translation with it.
      const el = await multilingualElement();
      await openTranslationOf(
        el,
        {
          id: "pst_source",
          format: "note",
          displayTitle: "咖啡笔记",
          slug: "coffee",
        },
        { previewHtml: PREVIEW_HTML },
      );

      const links = Array.from(
        el.querySelectorAll<HTMLAnchorElement>(
          ".compose-translation-preview a[href]",
        ),
      );
      expect(links.length).toBe(2);
      for (const link of links) {
        expect(link.getAttribute("target")).toBe("_blank");
        expect(link.getAttribute("rel")).toBe("noopener noreferrer");
      }
    });

    it("strips the original's identity so nothing else can act on it", async () => {
      // `data-post-id` is how the post menu, the keyboard shortcuts and
      // `refreshArticleView` find a post. A second copy of the original's id in
      // the DOM lets any of them act on the preview believing it is the card.
      const el = await multilingualElement();
      await openTranslationOf(
        el,
        {
          id: "pst_source",
          format: "note",
          displayTitle: "咖啡笔记",
          slug: "coffee",
        },
        { previewHtml: PREVIEW_HTML },
      );

      const preview = requireElement(
        el.querySelector(".compose-translation-preview"),
        "expected the preview",
      );
      expect(preview.querySelector("[data-post-id]")).toBeNull();
      expect(preview.querySelector(".post-menu-target")).toBeNull();
      expect(
        document.querySelectorAll('[data-post-id="pst_source"]').length,
      ).toBe(0);
    });

    it("falls back to a plain link when the rendering cannot be fetched", async () => {
      const el = await multilingualElement();
      await openTranslationOf(
        el,
        {
          id: "pst_source",
          format: "note",
          displayTitle: "咖啡笔记",
          slug: "coffee",
        },
        { previewHtml: null },
      );

      expect(el.querySelector(".compose-translation-original")).toBeNull();
      const link = requireElement(
        el.querySelector<HTMLAnchorElement>(".compose-translation-fallback a"),
        "expected a fallback link to the original",
      );
      expect(link.textContent?.trim()).toBe("咖啡笔记");
      expect(link.getAttribute("href")).toBe("/coffee");
      expect(link.getAttribute("target")).toBe("_blank");
      // The seam still names the language: it is about the two posts, not about
      // how much of one of them could be shown.
      expect(
        el
          .querySelector(".compose-translation-seam-label")
          ?.textContent?.trim(),
      ).toBe("Translating into English");
    });

    it("starts a translation in the original's shape, down to its meta", async () => {
      // Everything that describes the post's subject or its place travels:
      // format, citation, collections, visibility, rating. Only the words are
      // language-specific, so only the words start empty.
      const el = await multilingualElement();
      await openTranslationOf(el, {
        id: "pst_source",
        format: "quote",
        displayTitle: "关于专注",
        slug: "focus",
        quoteText: "专注是一种拒绝。",
        sourceName: "Some Author",
        sourceUrl: "https://example.com/focus",
        collectionIds: ["col_reading", "col_notes"],
        visibility: "latest_hidden",
        rating: 4,
      });

      const editor = requireElement(
        el.querySelector<JantComposeEditor>("jant-compose-editor"),
        "expected the editor",
      );
      expect(editor.format).toBe("quote");
      const data = editor.getData();
      expect(data.url).toBe("https://example.com/focus");
      expect(data.quoteAuthor).toBe("Some Author");
      expect(data.rating).toBe(4);
      // The prose is the part the author is here to write.
      expect(data.quoteText).toBe("");

      const internals = el as unknown as {
        _collectionIds: string[];
        _visibility: string;
        _hasUnsavedChanges: () => boolean;
      };
      expect(internals._collectionIds).toEqual(["col_reading", "col_notes"]);
      expect(internals._visibility).toBe("latest_hidden");

      // None of that counts as something to discard: the author typed nothing.
      expect(internals._hasUnsavedChanges()).toBe(false);
    });

    it("closes a seeded translation without offering to save it", async () => {
      // The citation arrived from the original, not from the author. Being
      // asked to save a draft of a URL you never typed is worse than the
      // prompt is worth — but the moment anything is written, it comes back.
      const el = await multilingualElement();
      await openTranslationOf(el, {
        id: "pst_source",
        format: "quote",
        displayTitle: "关于专注",
        slug: "focus",
        sourceUrl: "https://example.com/focus",
      });
      const internals = el as unknown as {
        _confirmPanelOpen: boolean;
        _hasContent: () => boolean;
      };

      el.requestClose();
      await flushUpdates(el);
      expect(internals._confirmPanelOpen).toBe(false);

      await openTranslationOf(el, {
        id: "pst_source",
        format: "quote",
        displayTitle: "关于专注",
        slug: "focus",
        sourceUrl: "https://example.com/focus",
      });
      const editor = requireElement(
        el.querySelector<JantComposeEditor>("jant-compose-editor"),
        "expected the editor",
      );
      editor._quoteText = "Focus is about saying no.";
      await flushUpdates(el);

      el.requestClose();
      await flushUpdates(el);
      expect(internals._confirmPanelOpen).toBe(true);
    });

    it("leaves the format alone once the author has started writing", async () => {
      // The fetch lands after the composer opens. Overwriting a first sentence
      // to save a format click is a bad trade.
      const el = await multilingualElement();
      vi.spyOn(
        el as unknown as { _hasContent: () => boolean },
        "_hasContent",
      ).mockReturnValue(true);

      await openTranslationOf(el, {
        id: "pst_source",
        format: "quote",
        displayTitle: "关于专注",
        slug: "focus",
        sourceUrl: "https://example.com/focus",
      });

      const editor = requireElement(
        el.querySelector<JantComposeEditor>("jant-compose-editor"),
        "expected the editor",
      );
      expect(editor.format).toBe("note");
      expect(editor.getData().url).toBe("");
      // The context still shows — it is the one thing that never fights the
      // author for the page.
      expect(el.querySelector(".compose-translation-context")).not.toBeNull();
    });

    it("sends the chosen language, and the page's language on Detect", async () => {
      const el = await createElement();
      el.languages = [
        { tag: "zh-Hans", label: "简体中文" },
        { tag: "en", label: "English" },
      ];
      el.contextLanguage = "en";
      await flushUpdates(el);
      await openPublishPanel(el);

      const build = (
        el as unknown as {
          _buildSubmitDetail: (
            status: "published" | "draft",
          ) => ComposeSubmitDetail | null;
        }
      )._buildSubmitDetail.bind(el);

      // Left on Detect with no text signal: the post belongs to the page it
      // was written from, so the page's language goes out explicitly.
      expect(build("published")?.language).toBe("en");

      const rows = Array.from(
        el.querySelectorAll<HTMLButtonElement>(
          "[role='radiogroup'] .compose-sheet-row",
        ),
      );
      requireElement(rows[1] ?? null, "expected the 简体中文 row").click();
      await flushUpdates(el);

      expect(build("published")?.language).toBe("zh-Hans");
    });

    it("falls back to the primary language when the page has none", async () => {
      const el = await createElement();
      el.languages = [
        { tag: "zh-Hans", label: "简体中文" },
        { tag: "en", label: "English" },
      ];
      await flushUpdates(el);

      const build = (
        el as unknown as {
          _buildSubmitDetail: (
            status: "published" | "draft",
          ) => ComposeSubmitDetail | null;
        }
      )._buildSubmitDetail.bind(el);

      expect(build("published")?.language).toBe("zh-Hans");
    });

    describe("publish-time check", () => {
      async function createMismatch(overrides?: {
        contextLanguage?: string;
        text?: string;
      }) {
        const el = await createElement();
        el.languages = [
          { tag: "zh-Hans", label: "简体中文" },
          { tag: "ja", label: "日本語" },
        ];
        el.contextLanguage = overrides?.contextLanguage ?? "zh-Hans";
        await flushUpdates(el);

        const editor = requireElement(
          el.querySelector<JantComposeEditor>("jant-compose-editor"),
          "expected compose editor",
        );
        editor._bodyJson = {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: overrides?.text ?? "これはテストです" },
              ],
            },
          ],
        };
        await editor.updateComplete;

        const details: ComposeSubmitDetail[] = [];
        el.addEventListener("jant:compose-submit-deferred", (event) => {
          details.push((event as CustomEvent<ComposeSubmitDetail>).detail);
        });
        return { el, details };
      }

      function clickPublish(el: JantComposeDialog) {
        requireElement(
          el.querySelector<HTMLButtonElement>(".compose-publish-main"),
          "expected post button",
        ).click();
      }

      it("holds the publish when detection disagrees with the page", async () => {
        const { el, details } = await createMismatch();

        clickPublish(el);
        await flushUpdates(el);

        // Nothing published yet — the sheet is asking.
        expect(details).toHaveLength(0);
        const sheet = el.querySelector("[data-lang-confirm]");
        expect(sheet).not.toBeNull();
        expect(sheet?.textContent).toContain("日本語");

        el.querySelector<HTMLButtonElement>(
          "[data-lang-confirm-primary]",
        )?.click();
        await flushUpdates(el);

        expect(details).toHaveLength(1);
        expect(details[0]?.language).toBe("ja");
        expect(el.querySelector("[data-lang-confirm]")).toBeNull();
      });

      it("keeps the page's language when the author says so", async () => {
        const { el, details } = await createMismatch();

        clickPublish(el);
        await flushUpdates(el);

        // The second action is the page's language.
        const actions = Array.from(
          el.querySelectorAll<HTMLButtonElement>(
            "[data-lang-confirm] .compose-confirm-action",
          ),
        );
        actions[1]?.click();
        await flushUpdates(el);

        expect(details).toHaveLength(1);
        expect(details[0]?.language).toBe("zh-Hans");
      });

      it("cancels back into the editor on Escape", async () => {
        const { el, details } = await createMismatch();

        clickPublish(el);
        await flushUpdates(el);
        expect(el.querySelector("[data-lang-confirm]")).not.toBeNull();

        el.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
        await flushUpdates(el);

        expect(el.querySelector("[data-lang-confirm]")).toBeNull();
        expect(details).toHaveLength(0);
      });

      it("publishes without asking when detection agrees", async () => {
        const { el, details } = await createMismatch({ contextLanguage: "ja" });

        clickPublish(el);
        await flushUpdates(el);

        expect(el.querySelector("[data-lang-confirm]")).toBeNull();
        expect(details).toHaveLength(1);
        expect(details[0]?.language).toBe("ja");
      });

      it("never second-guesses an explicit choice", async () => {
        const { el, details } = await createMismatch();
        // The author picked 简体中文 themselves; the Japanese text is theirs
        // to own — a quote, perhaps.
        (el as unknown as { _language: string | null })._language = "zh-Hans";
        await flushUpdates(el);

        clickPublish(el);
        await flushUpdates(el);

        expect(el.querySelector("[data-lang-confirm]")).toBeNull();
        expect(details).toHaveLength(1);
        expect(details[0]?.language).toBe("zh-Hans");
      });
    });
  });

  it("keeps date and permalink on the post, not in the publish panel", async () => {
    const el = await createElement();

    // They describe one post, so they hang off the post — not the publish
    // panel, which speaks for the whole submission.
    requireElement(
      el.querySelector<HTMLButtonElement>(".compose-options-trigger"),
      "expected options trigger",
    ).click();
    await flushUpdates(el);
    expect(el.querySelector(".compose-publish-date-input")).toBeNull();
    expect(el.querySelector(".compose-publish-slug-input")).toBeNull();

    // The pill states both values while the panel is shut.
    expect(pillValue(el, "date")).toBe("Now");
    expect(pillValue(el, "slug")).toBe("Auto");

    // Two settings is not a list to drill through: opening the pill opens both
    // fields at once, with focus on the panel so Tab lands in them.
    await openPostMeta(el);
    expect(el.querySelector(".compose-publish-date-input")).not.toBeNull();
    expect(el.querySelector(".compose-publish-slug-input")).not.toBeNull();
    expect(el.querySelector("[data-compose-post-meta-panel]")).toBe(
      document.activeElement,
    );
  });

  it("pins the date panel to its pill instead of inside the scroller", async () => {
    const el = await createElement();

    // The pill lives in `.compose-scroll`, which clips and scrolls. An
    // absolutely positioned panel is taller than that box on an empty post, so
    // it lost its footer, and focusing it scrolled the format switcher off the
    // top to bring it into view. Fixed positioning leaves the scroller behind,
    // which makes placing the panel our job.
    const focusCalls: Array<{
      target: unknown;
      options?: globalThis.FocusOptions;
    }> = [];
    const nativeFocus = globalThis.HTMLElement.prototype.focus;
    globalThis.HTMLElement.prototype.focus = function (
      this: globalThis.HTMLElement,
      options?: globalThis.FocusOptions,
    ) {
      focusCalls.push({ target: this, options });
      return nativeFocus.call(this, options);
    };

    try {
      await openPostMeta(el);
    } finally {
      globalThis.HTMLElement.prototype.focus = nativeFocus;
    }

    const panel = requireElement(
      el.querySelector<globalThis.HTMLElement>(
        "[data-compose-post-meta-panel]",
      ),
      "expected post meta panel",
    );

    expect(focusCalls.find((call) => call.target === panel)?.options).toEqual({
      preventScroll: true,
    });

    // Placed under the pill, and capped at the room the viewport actually has
    // so a short window scrolls the panel rather than cropping it.
    expect(panel.style.top).toBe("6px");
    expect(panel.style.left).not.toBe("");
    expect(
      panel.style.getPropertyValue("--compose-post-meta-panel-max-height"),
    ).toBe(`${globalThis.innerHeight - 12 - 6}px`);

    // Inline coordinates only mean anything if the panel is out of the
    // scroller — `position: absolute` here is the bug, not a style choice.
    const css = readFileSync(resolve("src/styles/ui.css"), "utf8");
    expect(css).toMatch(
      /\.compose-post-meta-panel\s*\{\s*position:\s*fixed;[\s\S]*max-height:\s*var\(--compose-post-meta-panel-max-height,\s*none\);\s*overflow-y:\s*auto;/,
    );
  });

  it("keeps the date panel on its pill when the composer scrolls", async () => {
    const el = await createElement();
    await openPostMeta(el);

    const panel = requireElement(
      el.querySelector<globalThis.HTMLElement>(
        "[data-compose-post-meta-panel]",
      ),
      "expected post meta panel",
    );
    const pill = requireElement(
      el.querySelector<globalThis.HTMLElement>("[data-compose-post-meta-pill]"),
      "expected post meta pill",
    );
    pill.getBoundingClientRect = () =>
      ({
        top: 100,
        bottom: 130,
        left: 300,
        right: 400,
        width: 100,
        height: 30,
      }) as globalThis.DOMRect;

    // A `scroll` event on the composer's own box never reaches `window` — it
    // doesn't bubble — so a pinned panel would hang in place while the pill it
    // belongs to slid away underneath it.
    const scroller = requireElement(
      el.querySelector(".compose-scroll"),
      "expected compose scroller",
    );
    scroller.dispatchEvent(new globalThis.Event("scroll"));

    expect(panel.style.top).toBe("136px");
    expect(panel.style.left).toBe("400px");
  });

  it("opens the calendar from its own button, not the UA glyph", async () => {
    const el = await createElement();
    await openPostMeta(el);

    const input = requireElement(
      el.querySelector<HTMLInputElement>(".compose-publish-date-input"),
      "expected publish date input",
    );
    // Chrome only opens the picker from its ~13px indicator, which is hidden
    // here — the button has to drive the same picker itself.
    const showPicker = vi.fn();
    (input as HTMLInputElement & { showPicker: () => void }).showPicker =
      showPicker;

    requireElement(
      el.querySelector<HTMLButtonElement>("[data-compose-date-picker]"),
      "expected date picker button",
    ).click();
    await flushUpdates(el);

    expect(showPicker).toHaveBeenCalledTimes(1);
    expect(input).toBe(document.activeElement);
  });

  it("keeps the date field usable when showPicker is unsupported", async () => {
    const el = await createElement();
    await openPostMeta(el);

    const input = requireElement(
      el.querySelector<HTMLInputElement>(".compose-publish-date-input"),
      "expected publish date input",
    );
    // Engines without `showPicker` must still get a focused, typable field
    // rather than an uncaught TypeError from the button.
    expect(
      (input as HTMLInputElement & { showPicker?: () => void }).showPicker,
    ).toBeUndefined();

    expect(() =>
      requireElement(
        el.querySelector<HTMLButtonElement>("[data-compose-date-picker]"),
        "expected date picker button",
      ).click(),
    ).not.toThrow();
    await flushUpdates(el);

    expect(input).toBe(document.activeElement);
  });

  it("closes the date panel from its Done button", async () => {
    const el = await createElement();
    await openPostMeta(el);

    // Escape and an outside click both close it, but neither announces itself,
    // and touch has no Escape key at all.
    requireElement(
      el.querySelector<HTMLButtonElement>("[data-compose-post-meta-done]"),
      "expected Done button",
    ).click();
    await flushUpdates(el);

    expect(el.querySelector("[data-compose-post-meta-panel]")).toBeNull();
    expect(el.querySelector(".compose-publish-date-input")).toBeNull();
  });

  it("hands focus back to the post when the date panel closes", async () => {
    const el = await createElement();
    await openPostMeta(el);
    expect(el.querySelector("[data-compose-post-meta-panel]")).toBe(
      document.activeElement,
    );

    // The panel holds focus while it is open, so it would take focus out of the
    // document with it on the way out. The pill is only visible on hover, focus
    // or a non-default value — and on touch there is no hover — so losing focus
    // to `<body>` hides the only way back in.
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected editor",
    );
    const focusInput = vi.spyOn(editor, "focusInput");

    requireElement(
      el.querySelector<HTMLButtonElement>("[data-compose-post-meta-pill]"),
      "expected post meta pill",
    ).click();
    await flushUpdates(el);

    expect(el.querySelector("[data-compose-post-meta-panel]")).toBeNull();
    expect(focusInput).toHaveBeenCalled();
  });

  it("explains every visibility option and checks the selected one", async () => {
    const el = await createElement();

    requireElement(
      el.querySelector<HTMLButtonElement>(".compose-options-trigger"),
      "expected publish settings toggle",
    ).click();
    await el.updateComplete;

    // Each row carries its own hint, so the options can be compared before
    // one is picked — a single hint under a chip group could not do that.
    expect(el.textContent).toContain("Appears in Latest.");
    expect(el.textContent).toContain("Only visible when signed in.");

    const rows = el.querySelectorAll<HTMLButtonElement>(
      ".compose-sheet-row[role='radio']",
    );
    expect(rows).toHaveLength(3);
    expect(rows[0].getAttribute("aria-checked")).toBe("true");
    expect(rows[0].querySelector(".compose-sheet-check")).not.toBeNull();
    expect(rows[2].querySelector(".compose-sheet-check")).toBeNull();

    rows[2].click();
    await flushUpdates(el);

    // Picking is the whole job of this panel, so it dismisses itself — no
    // Done button to confirm a radio selection.
    expect(el._visibility).toBe("private");
    expect(el.querySelector(".compose-sheet")).toBeNull();
    expect(el.querySelector(".compose-publish-done")).toBeNull();

    // Reopening shows the new choice checked.
    requireElement(
      el.querySelector<HTMLButtonElement>(".compose-options-trigger"),
      "expected publish settings toggle",
    ).click();
    await flushUpdates(el);
    const updated = el.querySelectorAll<HTMLButtonElement>(
      ".compose-sheet-row[role='radio']",
    );
    expect(updated[2].getAttribute("aria-checked")).toBe("true");
    expect(updated[2].querySelector(".compose-sheet-check")).not.toBeNull();
    expect(updated[0].querySelector(".compose-sheet-check")).toBeNull();
  });

  it("format switching updates active state", async () => {
    const el = await createElement();

    // Note is active by default
    const noteBtn = el.querySelectorAll<HTMLButtonElement>(
      ".compose-segmented-item",
    )[0];
    expect(noteBtn.classList.contains("compose-segmented-item-active")).toBe(
      true,
    );

    // Click link
    const linkBtn = el.querySelectorAll<HTMLButtonElement>(
      ".compose-segmented-item",
    )[1];
    linkBtn.click();
    await el.updateComplete;

    expect(el._format).toBe("link");
    expect(linkBtn.classList.contains("compose-segmented-item-active")).toBe(
      true,
    );
    expect(noteBtn.classList.contains("compose-segmented-item-active")).toBe(
      false,
    );
    expect(
      el.querySelector('.compose-tool-btn-view[aria-label="Fullscreen"]'),
    ).toBeNull();
  });

  it("autofocuses the primary field on desktop format switches", async () => {
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    const focusSpy = vi.spyOn(editor, "focusInput");

    const linkBtn = el.querySelectorAll<HTMLButtonElement>(
      ".compose-segmented-item",
    )[1];
    linkBtn.click();
    await flushUpdates(el);

    expect(focusSpy).toHaveBeenCalledTimes(1);
  });

  it("does not autofocus the primary field on touch format switches", async () => {
    mockMatchMedia(true);
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    const focusSpy = vi.spyOn(editor, "focusInput");

    const linkBtn = el.querySelectorAll<HTMLButtonElement>(
      ".compose-segmented-item",
    )[1];
    linkBtn.click();
    await flushUpdates(el);

    expect(focusSpy).not.toHaveBeenCalled();
  });

  function mockEditPost(post: Record<string, unknown>) {
    return vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "pst_123", ...post }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
  }

  it("shows the format switcher above the post while editing", async () => {
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    mockEditPost({ format: "note", title: "Hello", body: null });

    const el = await createElement();
    await el.openEdit("pst_123");
    await flushUpdates(el);

    // The switcher has exactly one home: above its own post. Editing says so
    // through the submit label and a marker in the header row, not a title bar.
    expect(el.querySelector(".compose-thread-post-header")).toBeTruthy();
    expect(el.querySelector(".compose-dialog-header")).toBeNull();
    expect(
      el
        .querySelector(".compose-thread-post-header .compose-post-badge")
        ?.textContent?.trim(),
    ).toBe(labels.editing);
    expect(el.querySelector(".compose-publish-main")?.textContent?.trim()).toBe(
      labels.update,
    );
  });

  it("shows the format selector above the post when replying", async () => {
    const el = await createElement();
    await el.openReply("019ce8ce-d6d8-7fda-a5df-c2da2bef5ade", {
      contentHtml: "<p>Parent</p>",
      dateText: "Mar 14",
    });
    await flushUpdates(el);

    expect(el.querySelector(".compose-dialog-header")).toBeNull();
    // The selector sits inline above the reply editor.
    expect(el.querySelector(".compose-thread-post-header")).not.toBeNull();
    expect(
      el.querySelector(".compose-thread-layout.compose-reply-compose-layout"),
    ).not.toBeNull();
    expect(el.querySelector(".compose-collection-trigger")).toBeNull();
    expect(
      el.querySelector(".compose-action-row-without-collection"),
    ).not.toBeNull();
    expect(el.querySelector(".compose-publish-main")).not.toBeNull();
  });

  it("puts a reply's add-to-thread row on the rail with the other posts", async () => {
    const el = await createElement();
    await el.openReply("019ce8ce-d6d8-7fda-a5df-c2da2bef5ade", {
      contentHtml: "<p>Parent</p>",
      dateText: "Mar 14",
    });
    await flushUpdates(el);

    // Inside the layout, not a sibling of it: out there it misses the rail's
    // indent and lands a rail's width left of everything above it.
    const layout = el.querySelector(
      ".compose-thread-layout.compose-reply-compose-layout",
    );
    const addRow = layout?.querySelector(":scope > .compose-thread-add-row");
    expect(addRow).not.toBeNull();
    expect(el.querySelector(".compose-add-thread-trigger")).toBeNull();
    // The dashed dot marks where the next post lands, as in thread compose.
    expect(addRow?.querySelector(".compose-thread-add-dot")).not.toBeNull();
    // ...and it stays the last row, so the rail still stops at the reply.
    expect(layout?.lastElementChild).toBe(addRow);
  });

  it("keeps a single post's add-to-thread row off the rail", async () => {
    const el = await createElement();
    await flushUpdates(el);

    // No rail to join, so no dot: the row's position says "next slot" alone.
    const trigger = el.querySelector(".compose-add-thread-trigger");
    expect(trigger).not.toBeNull();
    expect(el.querySelector(".compose-thread-add-dot")).toBeNull();
    expect(trigger?.querySelector(".compose-thread-add-btn")).not.toBeNull();
  });

  it("shows an Edit title with the format selector above the post when editing a reply", async () => {
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    const parentId = "019ce8ce-d6d8-7fda-a5df-c2da2bef5ade";
    // A fresh Response per call: openEdit reads the edited post, then
    // _fetchReplyContext reads the parent — a single shared Response body can
    // only be consumed once.
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      const json = url.includes(parentId)
        ? { id: parentId, bodyHtml: "<p>Parent</p>", format: "note" }
        : {
            id: "pst_123",
            format: "note",
            title: "Hello",
            body: null,
            replyToId: parentId,
            collectionIds: ["col-thread"],
          };
      return Promise.resolve(
        new Response(JSON.stringify(json), {
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    const el = await createElement();
    await el.openEdit("pst_123");
    await flushUpdates(el);

    expect(el.querySelector(".compose-publish-main")?.textContent?.trim()).toBe(
      labels.update,
    );
    expect(el.querySelector(".compose-dialog-header")).toBeNull();
    expect(el.querySelector(".compose-thread-post-header")).not.toBeNull();
    expect(el._collectionIds).toEqual([]);
    expect(el.querySelector(".compose-collection-trigger")).toBeNull();
  });

  it("keeps the format selector above the post in single-post mode", async () => {
    const el = await createElement();
    await flushUpdates(el);

    // One selector, one place — above its own post.
    const items = el.querySelectorAll<HTMLButtonElement>(
      ".compose-thread-post-header .compose-segmented-item",
    );
    expect(items.length).toBe(3);

    items[1].click(); // link
    await flushUpdates(el);
    expect(el._format).toBe("link");

    // A single post has no "which one", so no position marker.
    expect(el.querySelector(".compose-post-position")).toBeNull();
  });

  it("gives every thread post its own date and permalink control", async () => {
    const el = await createElement();
    el._threadItems = [
      { id: "thread-1", format: "note" },
      { id: "thread-2", format: "note" },
    ];
    await flushUpdates(el);

    // Every post is separately addressable (`path_registry` has a row each),
    // so every post gets both controls — not just the root.
    const pills = el.querySelectorAll("[data-compose-post-meta-pill]");
    expect(pills).toHaveLength(2);
    for (const pill of pills) {
      expect(
        pill.querySelector(".compose-post-meta-value-slug"),
      ).not.toBeNull();
    }
  });

  it("sends a reply's own permalink and blocks an invalid one", async () => {
    const el = await createElement();
    el._threadItems = [
      { id: "thread-1", format: "note" },
      { id: "thread-2", format: "note", slug: "part-two" },
    ];
    await flushUpdates(el);

    const build = (
      el as unknown as {
        _buildEditorPostDetail: (
          editor: JantComposeEditor,
          format: string,
          index: number,
          status: string,
        ) => ComposeSubmitDetail;
      }
    )._buildEditorPostDetail;
    const editors = el.querySelectorAll<JantComposeEditor>(
      "jant-compose-editor",
    );

    expect(build.call(el, editors[1], "note", 1, "published").slug).toBe(
      "part-two",
    );
    expect(build.call(el, editors[0], "note", 0, "published").slug).toBe(
      undefined,
    );

    // A reply's bad slug blocks publish just like the root's would.
    el._threadItems = [
      { id: "thread-1", format: "note" },
      { id: "thread-2", format: "note", slug: "not a slug!" },
    ];
    await flushUpdates(el);
    expect(
      (el as unknown as { _canPublish: () => boolean })._canPublish(),
    ).toBe(false);
  });

  it("sends a reply's own date and leaves the rest for the server to inherit", async () => {
    const el = await createElement();
    el._threadItems = [
      { id: "thread-1", format: "note" },
      { id: "thread-2", format: "note", publishedAtInput: "2024-03-09" },
      { id: "thread-3", format: "note" },
    ];
    await flushUpdates(el);

    const detail = (
      el as unknown as {
        _buildEditorPostDetail: (
          editor: JantComposeEditor,
          format: string,
          index: number,
          status: string,
        ) => ComposeSubmitDetail;
      }
    )._buildEditorPostDetail;
    const editors = el.querySelectorAll<JantComposeEditor>(
      "jant-compose-editor",
    );

    const second = detail.call(el, editors[1], "note", 1, "published");
    const third = detail.call(el, editors[2], "note", 2, "published");

    expect(second.publishedAt).toBeGreaterThan(0);
    // Undefined, not "now" — the server fills it from the root.
    expect(third.publishedAt).toBeUndefined();
  });

  it("blocks publishing when any thread post has a future date", async () => {
    const el = await createElement();
    const future = new Date(Date.now() + 86400000 * 3)
      .toISOString()
      .slice(0, 10);
    el._threadItems = [
      { id: "thread-1", format: "note" },
      { id: "thread-2", format: "note", publishedAtInput: future },
    ];
    await flushUpdates(el);

    expect(
      (el as unknown as { _canPublish: () => boolean })._canPublish(),
    ).toBe(false);
  });

  /**
   * Publish reads each row's own answer, so a row that has been removed stops
   * being asked. These used to fail: the button was computed during render from
   * the editors still in the DOM — including the one that render was about to
   * remove.
   */
  describe("publish reflects the rows that are left", () => {
    const publishButton = (el: JantComposeDialog) =>
      requireElement(
        el.querySelector<HTMLButtonElement>(".compose-publish-main"),
        "expected publish button",
      );

    async function typeInto(
      el: JantComposeDialog,
      index: number,
      text: string,
    ) {
      const editor = el.querySelectorAll<JantComposeEditor>(
        "jant-compose-editor",
      )[index];
      requireEditor(
        requireElement(editor, `expected editor ${index}`),
      ).commands.insertContent(text);
      await flushUpdates(el);
    }

    async function addPost(el: JantComposeDialog) {
      requireElement(
        el.querySelector<HTMLButtonElement>(".compose-thread-add-btn"),
        "expected add-to-thread button",
      ).click();
      await flushUpdates(el);
      await flushUpdates(el);
    }

    async function removePost(el: JantComposeDialog, index: number) {
      requireElement(
        el.querySelectorAll<HTMLButtonElement>(".compose-thread-post-remove")[
          index
        ],
        `expected remove button ${index}`,
      ).click();
      await flushUpdates(el);
      await flushUpdates(el);
    }

    it("re-enables publish when the empty last post is removed", async () => {
      const el = await createElement();
      await typeInto(el, 0, "one");
      await addPost(el);
      await typeInto(el, 1, "two");
      await addPost(el);

      expect(publishButton(el).disabled).toBe(true);

      await removePost(el, 2);

      expect(publishButton(el).disabled).toBe(false);
    });

    it("re-enables publish when the emptied post is the first of two", async () => {
      const el = await createElement();
      await typeInto(el, 0, "one");
      await addPost(el);
      await typeInto(el, 1, "two");

      requireEditor(
        el.querySelectorAll<JantComposeEditor>("jant-compose-editor")[0],
      ).commands.clearContent();
      await flushUpdates(el);
      expect(publishButton(el).disabled).toBe(true);

      await removePost(el, 0);

      expect(publishButton(el).disabled).toBe(false);
    });

    it("keeps each post's own text when the middle post is removed", async () => {
      const el = await createElement();
      await typeInto(el, 0, "AAA");
      await addPost(el);
      await typeInto(el, 1, "BBB");
      await addPost(el);
      await typeInto(el, 2, "CCC");

      await removePost(el, 1);

      const text = Array.from(
        el.querySelectorAll<JantComposeEditor>("jant-compose-editor"),
      ).map((editor) => requireEditor(editor).getText());
      expect(text).toEqual(["AAA", "CCC"]);
    });
  });

  it("numbers each post in a thread", async () => {
    const el = await createElement();
    el._threadItems = [
      { id: "thread-1", format: "note" },
      { id: "thread-2", format: "note" },
    ];
    await flushUpdates(el);

    const positions = () =>
      Array.from(el.querySelectorAll(".compose-post-position")).map((n) =>
        n.textContent?.trim(),
      );
    expect(positions()).toEqual(["1/2", "2/2"]);

    (el as unknown as { _addThreadItem: () => void })._addThreadItem();
    await flushUpdates(el);

    // The total re-renders on every post, not just the new one.
    expect(positions()).toEqual(["1/3", "2/3", "3/3"]);
  });

  const positionsIn = (el: JantComposeDialog) =>
    Array.from(el.querySelectorAll(".compose-post-position")).map((n) =>
      n.textContent?.trim(),
    );

  it("numbers a reply from the end of the thread it continues", async () => {
    // The parent is the second post of a thread, so the reply is the third —
    // not the first, and not the second.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "pst_parent", threadPosition: 2 }), {
        headers: { "Content-Type": "application/json" },
      }),
    );

    const el = await createElement();
    await el.openReply("pst_parent", {
      contentHtml: "<p>Parent</p>",
      dateText: "Mar 14",
    });
    await flushUpdates(el);
    await flushUpdates(el);

    expect(positionsIn(el)).toEqual(["3/3"]);

    (el as unknown as { _addThreadItem: () => void })._addThreadItem();
    await flushUpdates(el);

    expect(positionsIn(el)).toEqual(["3/4", "4/4"]);
  });

  it("shows no number for a reply until the parent's position is known", async () => {
    // Counting from 1 and then correcting to 3 is worse than arriving late, so
    // the marker stays away while the lookup is in flight — and stays away for
    // good if it fails.
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

    const el = await createElement();
    await el.openReply("pst_parent", {
      contentHtml: "<p>Parent</p>",
      dateText: "Mar 14",
    });
    await flushUpdates(el);
    await flushUpdates(el);

    expect(positionsIn(el)).toEqual([]);
  });

  it("leaves a lone new post unnumbered — there is no chain to place it in", async () => {
    const el = await createElement();
    await flushUpdates(el);

    expect(el.querySelector(".compose-post-position")).toBeNull();
  });

  it("switches format from the inline selector when replying", async () => {
    const el = await createElement();
    await el.openReply("019ce8ce-d6d8-7fda-a5df-c2da2bef5ade", {
      contentHtml: "<p>Parent</p>",
      dateText: "Mar 14",
    });
    await flushUpdates(el);

    const items = el.querySelectorAll<HTMLButtonElement>(
      ".compose-thread-post-header .compose-segmented-item",
    );
    // note / link / quote
    expect(items.length).toBe(3);
    items[1].click(); // link
    await flushUpdates(el);

    expect(el._format).toBe("link");
  });

  it("edit-mode format switch folds quote fields into the body", async () => {
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    mockEditPost({
      format: "quote",
      quoteText: "Stay hungry",
      sourceName: "Jobs",
      body: null,
    });

    const el = await createElement();
    await el.openEdit("pst_123");
    await flushUpdates(el);

    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    expect(editor._quoteText).toBe("Stay hungry");

    // Click the Note segmented button.
    el.querySelectorAll<HTMLButtonElement>(
      ".compose-segmented-item",
    )[0].click();
    await flushUpdates(el);

    expect(el._format).toBe("note");
    expect(editor._quoteText).toBe("");
    expect(editor._quoteAuthor).toBe("");
    expect(editor._bodyJson?.content?.[0]?.type).toBe("blockquote");
  });

  it("edit-mode format switch marks the post as having unsaved changes", async () => {
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    mockEditPost({ format: "note", title: "Hello", body: null });

    const el = await createElement();
    await el.openEdit("pst_123");
    await flushUpdates(el);

    const hasUnsaved = (el as unknown as { _hasUnsavedChanges(): boolean })
      ._hasUnsavedChanges;
    expect(hasUnsaved.call(el)).toBe(false);

    el.querySelectorAll<HTMLButtonElement>(
      ".compose-segmented-item",
    )[2].click();
    await flushUpdates(el);

    expect(el._format).toBe("quote");
    expect(hasUnsaved.call(el)).toBe(true);
  });

  it("edit-mode autosave writes to the edit-specific draft key", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
        cb(0);
        return 1;
      });
      mockEditPost({ format: "note", title: "Hello", body: null });

      const el = await createElement();
      await el.openEdit("pst_123");
      await el.updateComplete;

      const editor = requireElement(
        el.querySelector<JantComposeEditor>("jant-compose-editor"),
        "expected compose editor",
      );
      editor._bodyJson = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Edited body" }],
          },
        ],
      };
      await editor.updateComplete;

      vi.advanceTimersByTime(1000);

      expect(
        globalThis.localStorage.getItem("jant:compose-edit:pst_123"),
      ).not.toBeNull();
      expect(globalThis.localStorage.getItem("jant:compose-draft")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("autosaves only on a real edit, not on open or a bare format switch", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
        cb(0);
        return 1;
      });
      mockEditPost({
        format: "note",
        title: null,
        body: JSON.stringify({
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "hi" }] },
          ],
        }),
      });

      const el = await createElement();
      await el.openEdit("pst_123");
      await el.updateComplete;
      const editor = requireElement(
        el.querySelector<JantComposeEditor>("jant-compose-editor"),
        "expected compose editor",
      );
      await editor.updateComplete;

      // Opening a post for edit must not persist a local draft on its own.
      vi.advanceTimersByTime(1000);
      expect(
        globalThis.localStorage.getItem("jant:compose-edit:pst_123"),
      ).toBeNull();

      // Switching format only must not persist either.
      el.querySelectorAll<HTMLButtonElement>(
        ".compose-segmented-item",
      )[2].click();
      await el.updateComplete;
      await editor.updateComplete;
      vi.advanceTimersByTime(1000);
      expect(
        globalThis.localStorage.getItem("jant:compose-edit:pst_123"),
      ).toBeNull();

      // A real edit afterwards persists as usual, with the switched format.
      editor._quoteText = "now editing";
      await editor.updateComplete;
      vi.advanceTimersByTime(1000);

      const saved = globalThis.localStorage.getItem(
        "jant:compose-edit:pst_123",
      );
      expect(saved).not.toBeNull();
      expect(JSON.parse(saved as string).format).toBe("quote");
    } finally {
      vi.useRealTimers();
    }
  });

  it("enables the publish button right after an edit-mode switch to quote", async () => {
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    // A note whose body is a blockquote + paragraph — switching to quote
    // extracts the blockquote into the quote-text field.
    mockEditPost({
      format: "note",
      title: null,
      body: JSON.stringify({
        type: "doc",
        content: [
          {
            type: "blockquote",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "quote2233" }],
              },
              {
                type: "paragraph",
                content: [{ type: "text", text: "— author1" }],
              },
            ],
          },
          { type: "paragraph", content: [{ type: "text", text: "这个22" }] },
        ],
      }),
    });

    const el = await createElement();
    await el.openEdit("pst_123");
    await flushUpdates(el);

    el.querySelectorAll<HTMLButtonElement>(
      ".compose-segmented-item",
    )[2].click();
    await flushUpdates(el);

    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    expect(el._format).toBe("quote");
    expect(editor._quoteText).toBe("quote2233");
    // The submit button must reflect the now-valid quote, not the stale
    // pre-switch format.
    expect(
      el.querySelector<HTMLButtonElement>(".compose-publish-main")?.disabled,
    ).toBe(false);
  });

  it("submit dispatches jant:compose-submit-deferred with correct payload", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    editor._bodyJson = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello world" }] },
      ],
    };
    await editor.updateComplete;

    let receivedDetail:
      | (ComposeSubmitDetail & { pendingAttachments: unknown[] })
      | null = null;
    el.addEventListener("jant:compose-submit-deferred", (event) => {
      const customEvent = event as CustomEvent<
        ComposeSubmitDetail & { pendingAttachments: unknown[] }
      >;
      receivedDetail = customEvent.detail;
    });

    // Click post button
    requireElement(
      el.querySelector<HTMLButtonElement>(".compose-publish-main"),
      "expected post button",
    ).click();

    expect(receivedDetail).not.toBeNull();
    const detail = receivedDetail as unknown as ComposeSubmitDetail & {
      pendingAttachments: unknown[];
    };
    expect(detail.format).toBe("note");
    expect(detail.body).toContain("Hello world");
    expect(detail.status).toBe("published");
    expect(detail.visibility).toBe("public");
    expect(detail.collectionIds).toEqual([]);
    expect(detail.attachments).toEqual([]);
    expect(detail.pendingAttachments).toEqual([]);
  });

  it("submit omits a hidden rating while keeping the compose body", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    editor._bodyJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Post without visible rating" }],
        },
      ],
    };
    editor._rating = 3;
    editor._showRating = false;
    await editor.updateComplete;

    let receivedDetail: ComposeSubmitDetail | null = null;
    el.addEventListener("jant:compose-submit-deferred", (event) => {
      receivedDetail = (event as CustomEvent<ComposeSubmitDetail>).detail;
    });

    requireElement(
      el.querySelector<HTMLButtonElement>(".compose-publish-main"),
      "expected post button",
    ).click();

    expect(receivedDetail).not.toBeNull();
    const detail = receivedDetail as unknown as ComposeSubmitDetail;
    expect(detail.rating).toBe(0);
    expect(detail.body).toContain("Post without visible rating");
  });

  it("includes publish settings in the submit payload", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    editor._bodyJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Configured post" }],
        },
      ],
    };
    await editor.updateComplete;

    requireElement(
      el.querySelector<HTMLButtonElement>(".compose-options-trigger"),
      "expected publish settings toggle",
    ).click();
    await el.updateComplete;

    const options = el.querySelectorAll<HTMLButtonElement>(
      ".compose-sheet-row[role='radio']",
    );
    expect(options).toHaveLength(3);
    options[1]?.click();
    await el.updateComplete;

    expect(
      requireElement(
        el.querySelector<HTMLButtonElement>(".compose-publish-main"),
        "expected publish button",
      ).textContent?.trim(),
    ).toBe("Post hidden");

    let receivedDetail: ComposeSubmitDetail | null = null;
    el.addEventListener("jant:compose-submit-deferred", (event) => {
      receivedDetail = (event as CustomEvent<ComposeSubmitDetail>).detail;
    });

    requireElement(
      el.querySelector<HTMLButtonElement>(".compose-publish-main"),
      "expected publish button",
    ).click();

    expect(receivedDetail).not.toBeNull();
    expect((receivedDetail as unknown as ComposeSubmitDetail).visibility).toBe(
      "latest_hidden",
    );
    expect(
      (receivedDetail as unknown as ComposeSubmitDetail).slug,
    ).toBeUndefined();
  });

  it("includes a past publish date in the submit payload", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-28T12:34:00Z"));

    try {
      const el = await createElement();
      const editor = requireElement(
        el.querySelector<JantComposeEditor>("jant-compose-editor"),
        "expected compose editor",
      );
      editor._bodyJson = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Backdated post" }],
          },
        ],
      };
      await editor.updateComplete;

      requireElement(
        el.querySelector<HTMLButtonElement>(".compose-options-trigger"),
        "expected publish settings toggle",
      ).click();
      await el.updateComplete;

      await openPostMeta(el);
      const publishedAtInput = requireElement(
        el.querySelector<HTMLInputElement>(".compose-publish-date-input"),
        "expected publish date input",
      );
      publishedAtInput.value = "2024-01-15";
      publishedAtInput.dispatchEvent(new Event("input", { bubbles: true }));
      await el.updateComplete;

      let receivedDetail: ComposeSubmitDetail | null = null;
      el.addEventListener("jant:compose-submit-deferred", (event) => {
        receivedDetail = (event as CustomEvent<ComposeSubmitDetail>).detail;
      });

      requireElement(
        el.querySelector<HTMLButtonElement>(".compose-publish-main"),
        "expected publish button",
      ).click();

      expect(receivedDetail).not.toBeNull();
      const now = new Date();
      expect(
        (receivedDetail as unknown as ComposeSubmitDetail).publishedAt,
      ).toBe(
        Math.floor(
          new Date(
            2024,
            0,
            15,
            now.getHours(),
            now.getMinutes(),
            0,
            0,
          ).getTime() / 1000,
        ),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the chosen publish date readable on the post's pill", async () => {
    const el = await createElement();

    const publishToggle = requireElement(
      el.querySelector<HTMLButtonElement>(".compose-options-trigger"),
      "expected publish settings toggle",
    );
    publishToggle.click();
    await el.updateComplete;

    await openPostMeta(el);
    const publishedAtInput = requireElement(
      el.querySelector<HTMLInputElement>(".compose-publish-date-input"),
      "expected publish date input",
    );
    publishedAtInput.value = "2024-01-15";
    publishedAtInput.dispatchEvent(new Event("input", { bubbles: true }));
    await el.updateComplete;

    // Close the panel: the chosen date stays readable on the pill.
    requireElement(
      el.querySelector<HTMLButtonElement>("[data-compose-post-meta-pill]"),
      "expected post meta pill",
    ).click();
    await flushUpdates(el);
    expect(el.querySelector(".compose-publish-date-input")).toBeNull();
    expect(pillValue(el, "date")).toContain("2024");

    await openPostMeta(el);
    expect(
      requireElement(
        el.querySelector<HTMLInputElement>(".compose-publish-date-input"),
        "expected publish date input after reopening publish settings",
      ).value,
    ).toBe("2024-01-15");
  });

  it("shows the existing publish date on the post pill while editing a post", async () => {
    const el = await createElement();
    (
      el as unknown as {
        _editPostId: string | null;
        _initialPublishedAtInput: string;
        _publishedAtInput: string;
      }
    )._editPostId = "pst_existing";
    (
      el as unknown as {
        _editPostId: string | null;
        _initialPublishedAtInput: string;
        _publishedAtInput: string;
      }
    )._initialPublishedAtInput = "2024-01-15";
    (
      el as unknown as {
        _editPostId: string | null;
        _initialPublishedAtInput: string;
        _publishedAtInput: string;
      }
    )._publishedAtInput = "2024-01-15";
    el.requestUpdate();
    await el.updateComplete;

    await openPostMeta(el);

    expect(pillValue(el, "date")).toContain("2024");
  });

  it("shows Now on the post date control after clearing the date while editing", async () => {
    const el = await createElement();
    (
      el as unknown as {
        _editPostId: string | null;
        _initialPublishedAtInput: string;
        _publishedAtInput: string;
      }
    )._editPostId = "pst_existing";
    (
      el as unknown as {
        _editPostId: string | null;
        _initialPublishedAtInput: string;
        _publishedAtInput: string;
      }
    )._initialPublishedAtInput = "2024-01-15";
    (
      el as unknown as {
        _editPostId: string | null;
        _initialPublishedAtInput: string;
        _publishedAtInput: string;
      }
    )._publishedAtInput = "";
    el.requestUpdate();
    await el.updateComplete;

    await openPostMeta(el);

    expect(pillValue(el, "date")).toBe("Now");
  });

  it("keeps the custom link readable on the post's pill", async () => {
    mockSlugApi((url) => {
      if (url.searchParams.get("mode") === "suggest") {
        return { body: { slug: "configured-post" } };
      }
      if (url.searchParams.get("mode") === "check") {
        return { body: { slug: "reading-notes", available: true } };
      }
      throw new Error(`Unexpected slug mode: ${url.search}`);
    });

    const el = await createElement();
    const publishToggle = requireElement(
      el.querySelector<HTMLButtonElement>(".compose-options-trigger"),
      "expected publish settings toggle",
    );

    publishToggle.click();
    await el.updateComplete;
    await flushUpdates(el);

    await openPostMeta(el);
    const slugInput = requireElement(
      el.querySelector<HTMLInputElement>(".compose-publish-slug-input"),
      "expected custom link input",
    );
    slugInput.value = "reading-notes";
    slugInput.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    await el.updateComplete;

    // Close the panel: the custom link stays readable on the pill.
    requireElement(
      el.querySelector<HTMLButtonElement>("[data-compose-post-meta-pill]"),
      "expected post meta pill",
    ).click();
    await flushUpdates(el);
    expect(el.querySelector(".compose-publish-slug-input")).toBeNull();
    expect(pillValue(el, "slug")).toBe("/reading-notes");

    await openPostMeta(el);
    expect(
      requireElement(
        el.querySelector<HTMLInputElement>(".compose-publish-slug-input"),
        "expected custom link input after reopening publish settings",
      ).value,
    ).toBe("reading-notes");
  });

  it("shows the existing custom link on the post pill while editing a post", async () => {
    const el = await createElement();
    (
      el as unknown as {
        _editPostId: string | null;
        _initialSlug: string;
        _slug: string;
      }
    )._editPostId = "pst_existing";
    (
      el as unknown as {
        _editPostId: string | null;
        _initialSlug: string;
        _slug: string;
      }
    )._initialSlug = "reading-notes";
    (
      el as unknown as {
        _editPostId: string | null;
        _initialSlug: string;
        _slug: string;
      }
    )._slug = "reading-notes";
    el.requestUpdate();
    await el.updateComplete;

    await openPostMeta(el);

    expect(pillValue(el, "slug")).toBe("/reading-notes");
  });

  it("shows Auto on the post permalink pill after clearing the link while editing", async () => {
    const el = await createElement();
    (
      el as unknown as {
        _editPostId: string | null;
        _initialSlug: string;
        _slug: string;
      }
    )._editPostId = "pst_existing";
    (
      el as unknown as {
        _editPostId: string | null;
        _initialSlug: string;
        _slug: string;
      }
    )._initialSlug = "reading-notes";
    (
      el as unknown as {
        _editPostId: string | null;
        _initialSlug: string;
        _slug: string;
      }
    )._slug = "";
    el.requestUpdate();
    await el.updateComplete;

    await openPostMeta(el);

    expect(pillValue(el, "slug")).toBe("Auto");
  });

  it("blocks publishing with a future publish date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-28T12:34:00Z"));

    try {
      const el = await createElement();
      const editor = requireElement(
        el.querySelector<JantComposeEditor>("jant-compose-editor"),
        "expected compose editor",
      );
      editor._bodyJson = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Future post" }],
          },
        ],
      };
      await editor.updateComplete;

      requireElement(
        el.querySelector<HTMLButtonElement>(".compose-options-trigger"),
        "expected publish settings toggle",
      ).click();
      await el.updateComplete;

      await openPostMeta(el);
      const publishedAtInput = requireElement(
        el.querySelector<HTMLInputElement>(".compose-publish-date-input"),
        "expected publish date input",
      );
      publishedAtInput.value = "2099-01-01";
      publishedAtInput.dispatchEvent(new Event("input", { bubbles: true }));
      await el.updateComplete;

      expect(
        requireElement(
          el.querySelector<HTMLButtonElement>(".compose-publish-main"),
          "expected publish button",
        ).disabled,
      ).toBe(true);
      expect(el.textContent).toContain(
        "Choose today or an earlier date, or leave it blank to publish now.",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("updates the publish button label for private visibility", async () => {
    const el = await createElement();

    requireElement(
      el.querySelector<HTMLButtonElement>(".compose-options-trigger"),
      "expected publish settings toggle",
    ).click();
    await el.updateComplete;

    const options = el.querySelectorAll<HTMLButtonElement>(
      ".compose-sheet-row[role='radio']",
    );
    expect(options).toHaveLength(3);
    options[2]?.click();
    await el.updateComplete;

    expect(
      requireElement(
        el.querySelector<HTMLButtonElement>(".compose-publish-main"),
        "expected publish button",
      ).textContent?.trim(),
    ).toBe("Post privately");
  });

  it("updates the publish button label for hidden visibility", async () => {
    const el = await createElement();

    requireElement(
      el.querySelector<HTMLButtonElement>(".compose-options-trigger"),
      "expected publish settings toggle",
    ).click();
    await el.updateComplete;

    const options = el.querySelectorAll<HTMLButtonElement>(
      ".compose-sheet-row[role='radio']",
    );
    expect(options).toHaveLength(3);
    options[1]?.click();
    await el.updateComplete;

    expect(
      requireElement(
        el.querySelector<HTMLButtonElement>(".compose-publish-main"),
        "expected publish button",
      ).textContent?.trim(),
    ).toBe("Post hidden");
  });

  it("flips visibility from the Hide from Latest shortcut", async () => {
    const el = await createElement();

    const toggle = requireElement(
      el.querySelector<HTMLInputElement>(
        ".compose-quick-actions-row .compose-publish-quick-toggle-input",
      ),
      "expected hide-from-latest shortcut",
    );
    expect(toggle.checked).toBe(false);

    toggle.checked = true;
    toggle.dispatchEvent(new globalThis.Event("change"));
    await el.updateComplete;
    expect(el._visibility).toBe("latest_hidden");

    toggle.checked = false;
    toggle.dispatchEvent(new globalThis.Event("change"));
    await el.updateComplete;
    expect(el._visibility).toBe("public");
  });

  it("drops the Hide from Latest shortcut once the post is private", async () => {
    const el = await createElement();

    requireElement(
      el.querySelector<HTMLButtonElement>(".compose-options-trigger"),
      "expected publish settings toggle",
    ).click();
    await el.updateComplete;

    // A checkbox cannot speak for a third state, so it steps aside.
    el.querySelectorAll<HTMLButtonElement>(
      ".compose-sheet-row[role='radio']",
    )[2]?.click();
    await el.updateComplete;

    expect(el._visibility).toBe("private");
    expect(el.querySelector(".compose-quick-actions-row")).toBeNull();
  });

  it("offers the quiet reply shortcut on a reply, in place of visibility", async () => {
    const el = await createElement();

    await el.openReply("019ce8ce-d6d8-7fda-a5df-c2da2bef5ade", {
      contentHtml: "<p>Parent</p>",
      dateText: "Mar 14",
    });
    await flushUpdates(el);

    const toggles = el.querySelectorAll<HTMLInputElement>(
      ".compose-quick-actions-row .compose-publish-quick-toggle-input",
    );
    // A reply inherits the root's visibility, so only quiet reply is offered.
    expect(toggles).toHaveLength(1);

    const toggle = requireElement(
      toggles.item(0),
      "expected quiet reply shortcut",
    );
    toggle.checked = true;
    toggle.dispatchEvent(new globalThis.Event("change"));
    await el.updateComplete;

    expect(el._quietReply).toBe(true);
    expect(
      requireElement(
        el.querySelector<HTMLButtonElement>(".compose-publish-main"),
        "expected publish button",
      ).textContent?.trim(),
    ).toBe("Reply quietly");
  });

  it("drops the quiet reply switch when editing an existing reply", async () => {
    const parentId = "019ce8ce-d6d8-7fda-a5df-c2da2bef5ade";
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      const json = url.includes(parentId)
        ? { id: parentId, bodyHtml: "<p>Parent</p>", format: "note" }
        : {
            id: "pst_123",
            format: "note",
            title: null,
            body: null,
            replyToId: parentId,
          };
      return Promise.resolve(
        new Response(JSON.stringify(json), {
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    const el = await createElement();
    await el.openEdit("pst_123");
    await flushUpdates(el);

    // Saving an edit goes through the update path, which has no create-time
    // thread bump to skip — so the switch is gone rather than dead.
    expect(el.querySelector(".compose-quick-actions-row")).toBeNull();

    el._showPublishPanel = true;
    await flushUpdates(el);
    expect(
      Array.from(el.querySelectorAll(".compose-sheet-title")).some(
        (row) => row.textContent?.trim() === labels.quietReplyLabel,
      ),
    ).toBe(false);
  });

  it("keeps the quiet reply switch on a thread draft, which saves by recreating", async () => {
    const el = await createElement();
    await el.openReply("019ce8ce-d6d8-7fda-a5df-c2da2bef5ade", {
      contentHtml: "<p>Parent</p>",
      dateText: "Mar 14",
    });
    (el as unknown as { _addThreadItem: () => void })._addThreadItem();
    // Re-editing a saved thread draft deletes and recreates every post, so the
    // create-time flag still lands.
    el._draftSourceId = "pst_draft";
    await flushUpdates(el);

    expect(
      el.querySelectorAll(
        ".compose-quick-actions-row .compose-publish-quick-toggle-input",
      ),
    ).toHaveLength(1);
  });

  it("opens a new post with the requested collection and keeps the last visibility until refresh", async () => {
    const el = await createElement();

    await el.openNew({ collectionId: "col-2", restoreDraft: false });
    await el.updateComplete;

    expect(el._collectionIds).toEqual(["col-2"]);
    expect(el._visibility).toBe("public");

    requireElement(
      el.querySelector<HTMLButtonElement>(".compose-options-trigger"),
      "expected publish settings toggle",
    ).click();
    await el.updateComplete;

    const options = el.querySelectorAll<HTMLButtonElement>(
      ".compose-sheet-row[role='radio']",
    );
    options[1]?.click();
    await el.updateComplete;

    expect(el._visibility).toBe("latest_hidden");

    el.reset();
    await el.updateComplete;

    expect(el._visibility).toBe("latest_hidden");

    await el.openNew({ collectionId: "col-1", restoreDraft: false });
    await el.updateComplete;

    expect(el._collectionIds).toEqual(["col-1"]);
    expect(el._visibility).toBe("latest_hidden");
  });

  it("prepends the requested collection even when a local draft is restored", async () => {
    const el = await createElement();

    globalThis.localStorage.setItem(
      "jant:compose-draft",
      JSON.stringify({
        format: "note",
        title: "",
        bodyJson: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Draft body" }],
            },
          ],
        },
        url: "",
        quoteText: "",
        quoteAuthor: "",
        slug: "",
        visibility: "public",
        rating: 0,
        showRating: false,
        collectionIds: ["col-1"],
        attachedTexts: [],
        attachmentOrder: [],
        savedAt: Date.now(),
      }),
    );

    await el.openNew({ collectionId: "col-2" });
    await flushUpdates(el);

    expect(el._collectionIds).toEqual(["col-2", "col-1"]);
  });

  function seedDraftWithMedia() {
    globalThis.localStorage.setItem(
      "jant:compose-draft",
      JSON.stringify({
        format: "note",
        title: "",
        bodyJson: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Draft with images" }],
            },
          ],
        },
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
        attachmentOrder: ["client-a", "client-b"],
        mediaAttachments: [
          {
            clientId: "client-a",
            mediaId: "med_aaa",
            url: "/media/aaa.jpg",
            mimeType: "image/jpeg",
            name: "aaa.jpg",
            alt: "first",
          },
        ],
        savedAt: Date.now(),
      }),
    );
  }

  it("restores uploaded media from the draft snapshot plus bridge-supplied uploads", async () => {
    const el = await createElement();
    seedDraftWithMedia();

    // client-b's upload finished after the dialog closed — only the bridge
    // knows about it, so it arrives via restoreMedia instead of the snapshot.
    await el.openNew({
      restoreDraft: true,
      restoreToast: false,
      restoreMedia: [
        {
          clientId: "client-b",
          mediaId: "med_bbb",
          url: "/media/bbb.png",
          mimeType: "image/png",
          name: "bbb.png",
        },
      ],
    });
    await flushUpdates(el);

    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    const attachments = editor._attachments;
    expect(attachments.map((a) => a.clientId)).toEqual([
      "client-a",
      "client-b",
    ]);
    expect(attachments.map((a) => a.mediaId)).toEqual(["med_aaa", "med_bbb"]);
    expect(attachments.every((a) => a.status === "done")).toBe(true);
    expect(attachments[0].remoteUrl).toBe("/media/aaa.jpg");
    expect(attachments[0].alt).toBe("first");
    expect(editor._attachmentOrder).toEqual(["client-a", "client-b"]);
  });

  it("suppresses the draft-restored toast when restoreToast is false", async () => {
    const container = document.createElement("div");
    container.id = "toast-container";
    document.body.appendChild(container);
    const el = await createElement();
    seedDraftWithMedia();

    await el.openNew({ restoreDraft: true, restoreToast: false });
    await flushUpdates(el);
    expect(container.querySelector(".toast")).toBeNull();

    el.reset();
    await el.openNew({ restoreDraft: true });
    await flushUpdates(el);
    expect(container.querySelector(".toast span")?.textContent).toBe(
      "Draft restored.",
    );
  });

  const NOTE_TITLE_KEY = "jant:compose-note-title";

  function titleToggle(el: JantComposeDialog, index = 0): HTMLButtonElement {
    return requireElement(
      el.querySelectorAll<HTMLButtonElement>(
        '.compose-tool-btn[title="Title"]',
      )[index] ?? null,
      "expected title toggle",
    );
  }

  it("remembers a note's title toggle for the next new post", async () => {
    const el = await createElement();
    await el.openNew({ restoreDraft: false });
    await flushUpdates(el);

    expect(el.querySelector(".compose-note-title")).not.toBeNull();

    titleToggle(el).click();
    await flushUpdates(el);

    expect(globalThis.localStorage.getItem(NOTE_TITLE_KEY)).toBe("0");
    expect(el.querySelector(".compose-note-title")).toBeNull();

    await el.openNew({ restoreDraft: false });
    await flushUpdates(el);

    expect(el.querySelector(".compose-note-title")).toBeNull();

    titleToggle(el).click();
    await flushUpdates(el);

    expect(globalThis.localStorage.getItem(NOTE_TITLE_KEY)).toBe("1");

    await el.openNew({ restoreDraft: false });
    await flushUpdates(el);

    expect(el.querySelector(".compose-note-title")).not.toBeNull();
  });

  it("opens a fresh composer without the title field when it was last turned off", async () => {
    globalThis.localStorage.setItem(NOTE_TITLE_KEY, "0");

    const el = await createElement();

    expect(el.querySelector(".compose-note-title")).toBeNull();
  });

  it("does not remember the title toggle from an edit", async () => {
    mockEditPost({ format: "note", title: "Hello", body: null });

    const el = await createElement();
    await el.openEdit("pst_123");
    await flushUpdates(el);

    titleToggle(el).click();
    await flushUpdates(el);

    // Dropping this post's title says nothing about the next post's.
    expect(globalThis.localStorage.getItem(NOTE_TITLE_KEY)).toBeNull();
  });

  it("does not remember the title toggle from a reply", async () => {
    const el = await createElement();
    await el.openReply("019ce8ce-d6d8-7fda-a5df-c2da2bef5ade", {
      contentHtml: "<p>Parent</p>",
      dateText: "Mar 14",
    });
    await flushUpdates(el);

    titleToggle(el).click();
    await flushUpdates(el);

    expect(el.querySelector(".compose-note-title")).not.toBeNull();
    expect(globalThis.localStorage.getItem(NOTE_TITLE_KEY)).toBeNull();
  });

  it("does not remember the title toggle from a thread post", async () => {
    const el = await createElement();
    (el as unknown as { _addThreadItem: () => void })._addThreadItem();
    await flushUpdates(el);

    titleToggle(el).click();
    await flushUpdates(el);

    expect(globalThis.localStorage.getItem(NOTE_TITLE_KEY)).toBeNull();
  });

  it("does not remember a title the editor reveals on its own", async () => {
    const el = await createElement();
    await el.openNew({ restoreDraft: false });
    await flushUpdates(el);

    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    // The fullscreen and H1-promotion paths land here. Neither is the author
    // stating a habit, so neither writes one down.
    editor.setEditorState(null, "Promoted", true);
    await flushUpdates(el);

    expect(el.querySelector(".compose-note-title")).not.toBeNull();
    expect(globalThis.localStorage.getItem(NOTE_TITLE_KEY)).toBeNull();
  });

  it("lets a restored draft's title state win over the remembered default", async () => {
    globalThis.localStorage.setItem(NOTE_TITLE_KEY, "0");
    globalThis.localStorage.setItem(
      "jant:compose-draft",
      JSON.stringify({
        format: "note",
        title: "Draft title",
        showTitle: true,
        bodyJson: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Draft body" }],
            },
          ],
        },
        url: "",
        quoteText: "",
        quoteAuthor: "",
        slug: "",
        visibility: "public",
        rating: 0,
        showRating: false,
        collectionIds: [],
        attachedTexts: [],
        attachmentOrder: [],
        savedAt: Date.now(),
      }),
    );

    const el = await createElement();
    await el.openNew();
    await flushUpdates(el);

    expect(
      el.querySelector<HTMLInputElement>(".compose-note-title")?.value,
    ).toBe("Draft title");
  });

  it("includes a custom slug from the publish settings panel in the submit payload", async () => {
    mockSlugApi((url) => {
      if (url.searchParams.get("mode") === "suggest") {
        return { body: { slug: "configured-post" } };
      }
      if (url.searchParams.get("mode") === "check") {
        return { body: { slug: "custom-link", available: true } };
      }
      throw new Error(`Unexpected slug mode: ${url.search}`);
    });

    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    editor._bodyJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Configured post" }],
        },
      ],
    };
    await editor.updateComplete;

    const publishToggle = requireElement(
      el.querySelector<HTMLButtonElement>(".compose-options-trigger"),
      "expected publish settings toggle",
    );
    publishToggle.click();
    await el.updateComplete;
    await flushUpdates(el);

    await openPostMeta(el);
    const slugInput = requireElement(
      el.querySelector<HTMLInputElement>(".compose-publish-slug-input"),
      "expected custom link input",
    );
    slugInput.value = "custom-link";
    slugInput.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    await el.updateComplete;

    let receivedDetail: ComposeSubmitDetail | null = null;
    el.addEventListener("jant:compose-submit-deferred", (event) => {
      receivedDetail = (event as CustomEvent<ComposeSubmitDetail>).detail;
    });

    requireElement(
      el.querySelector<HTMLButtonElement>(".compose-publish-main"),
      "expected publish button",
    ).click();

    expect(receivedDetail).not.toBeNull();
    expect((receivedDetail as unknown as ComposeSubmitDetail).slug).toBe(
      "custom-link",
    );
  });

  it("reopens the publish settings panel with the custom link field intact", async () => {
    mockSlugApi((url) => {
      if (url.searchParams.get("mode") === "suggest") {
        return { body: { slug: "reading-notes" } };
      }
      if (url.searchParams.get("mode") === "check") {
        return { body: { slug: "reading-notes", available: true } };
      }
      throw new Error(`Unexpected slug mode: ${url.search}`);
    });

    const el = await createElement();

    const publishToggle = requireElement(
      el.querySelector<HTMLButtonElement>(".compose-options-trigger"),
      "expected publish settings toggle",
    );

    publishToggle.click();
    await el.updateComplete;
    await flushUpdates(el);

    await openPostMeta(el);
    const slugInput = requireElement(
      el.querySelector<HTMLInputElement>(".compose-publish-slug-input"),
      "expected custom link input",
    );
    slugInput.value = "reading-notes";
    slugInput.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    await el.updateComplete;

    publishToggle.click();
    await el.updateComplete;
    publishToggle.click();
    await el.updateComplete;

    await openPostMeta(el);
    expect(el.querySelector(".compose-publish-slug-input")).not.toBeNull();
  });

  it("keeps the desktop publish settings panel attached to the publish button when space below is tight", async () => {
    const el = await createElement();
    Object.defineProperty(globalThis, "visualViewport", {
      configurable: true,
      writable: true,
      value: {
        offsetLeft: 0,
        offsetTop: 0,
        width: 500,
        height: 420,
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    });
    (
      el as unknown as {
        _dialogEl: Pick<
          HTMLDialogElement,
          "addEventListener" | "getBoundingClientRect" | "removeEventListener"
        > | null;
      }
    )._dialogEl = {
      addEventListener: () => {},
      getBoundingClientRect: () =>
        ({
          x: 0,
          y: 80,
          width: 480,
          height: 340,
          top: 80,
          right: 480,
          bottom: 420,
          left: 0,
          toJSON: () => ({}),
        }) as never,
      removeEventListener: () => {},
    };

    const publishGroup = requireElement(
      el.querySelector<HTMLElement>(".compose-publish-group"),
      "expected publish button group",
    );
    vi.spyOn(publishGroup, "getBoundingClientRect").mockReturnValue({
      x: 320,
      y: 340,
      width: 120,
      height: 40,
      top: 340,
      right: 440,
      bottom: 380,
      left: 320,
      toJSON: () => ({}),
    } as never);

    requireElement(
      el.querySelector<HTMLButtonElement>(".compose-options-trigger"),
      "expected publish settings toggle",
    ).click();
    await el.updateComplete;

    const panel = requireElement(
      el.querySelector<HTMLElement>("[data-compose-publish-panel-desktop]"),
      "expected publish settings panel",
    );
    expect(panel.dataset.position).toBe("up");
    expect(publishGroup.contains(panel)).toBe(true);
    expect(
      panel.style.getPropertyValue("--compose-publish-panel-max-height"),
    ).toBe("318px");
  });

  it("opens the desktop publish settings panel below the publish button when the viewport has room", async () => {
    const el = await createElement();
    Object.defineProperty(globalThis, "visualViewport", {
      configurable: true,
      writable: true,
      value: {
        offsetLeft: 0,
        offsetTop: 0,
        width: 500,
        height: 420,
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    });
    (
      el as unknown as {
        _dialogEl: Pick<
          HTMLDialogElement,
          "addEventListener" | "getBoundingClientRect" | "removeEventListener"
        > | null;
      }
    )._dialogEl = {
      addEventListener: () => {},
      getBoundingClientRect: () =>
        ({
          x: 0,
          y: 80,
          width: 480,
          height: 340,
          top: 80,
          right: 480,
          bottom: 420,
          left: 0,
          toJSON: () => ({}),
        }) as never,
      removeEventListener: () => {},
    };

    const publishGroup = requireElement(
      el.querySelector<HTMLElement>(".compose-publish-group"),
      "expected publish button group",
    );
    vi.spyOn(publishGroup, "getBoundingClientRect").mockReturnValue({
      x: 320,
      y: 130,
      width: 120,
      height: 40,
      top: 130,
      right: 440,
      bottom: 170,
      left: 320,
      toJSON: () => ({}),
    } as never);

    requireElement(
      el.querySelector<HTMLButtonElement>(".compose-options-trigger"),
      "expected publish settings toggle",
    ).click();
    await el.updateComplete;

    const panel = requireElement(
      el.querySelector<HTMLElement>("[data-compose-publish-panel-desktop]"),
      "expected publish settings panel",
    );
    expect(panel.dataset.position).toBe("down");
    expect(publishGroup.contains(panel)).toBe(true);
    expect(
      panel.style.getPropertyValue("--compose-publish-panel-max-height"),
    ).toBe("228px");
  });

  it("renders publish settings as a fullscreen subview on compact viewports", async () => {
    mockMatchMedia(true);

    const el = await createElement();

    requireElement(
      el.querySelector<HTMLButtonElement>(".compose-options-trigger"),
      "expected publish settings toggle",
    ).click();
    await el.updateComplete;

    expect(el.querySelector("[data-compose-publish-panel-desktop]")).toBeNull();
    expect(
      el.querySelector("[data-compose-publish-panel-mobile]"),
    ).not.toBeNull();
  });

  it("shows a slug error and blocks publish when the custom link is invalid", async () => {
    mockSlugApi(() => ({ body: { slug: "hello-world" } }));

    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    editor._bodyJson = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello world" }] },
      ],
    };
    await editor.updateComplete;

    const publishToggle = requireElement(
      el.querySelector<HTMLButtonElement>(".compose-options-trigger"),
      "expected publish settings toggle",
    );
    publishToggle.click();
    await el.updateComplete;
    await flushUpdates(el);

    await openPostMeta(el);
    const slugInput = requireElement(
      el.querySelector<HTMLInputElement>(".compose-publish-slug-input"),
      "expected custom link input",
    );
    slugInput.value = "bad/slug";
    slugInput.dispatchEvent(new Event("input", { bubbles: true }));
    await el.updateComplete;

    expect(
      requireElement(
        el.querySelector<HTMLButtonElement>(".compose-publish-main"),
        "expected publish button",
      ).disabled,
    ).toBe(true);
    expect(
      el.querySelector("[data-compose-slug-error]")?.textContent?.trim(),
    ).toBe("Use lowercase letters, numbers, and hyphens only.");

    let receivedDetail: ComposeSubmitDetail | null = null;
    el.addEventListener("jant:compose-submit-deferred", (event) => {
      receivedDetail = (event as CustomEvent<ComposeSubmitDetail>).detail;
    });

    requireElement(
      el.querySelector<HTMLButtonElement>(".compose-publish-main"),
      "expected publish button",
    ).click();

    expect(receivedDetail).toBeNull();
  });

  it("shows a suggested slug without submitting it by default", async () => {
    mockSlugApi((url) => {
      if (url.searchParams.get("mode") === "suggest") {
        return { body: { slug: "hello-world" } };
      }
      throw new Error(`Unexpected slug mode: ${url.search}`);
    });

    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    editor._title = "Hello World";
    editor._bodyJson = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello world" }] },
      ],
    };
    await editor.updateComplete;

    const publishToggle = requireElement(
      el.querySelector<HTMLButtonElement>(".compose-options-trigger"),
      "expected publish settings toggle",
    );
    publishToggle.click();
    await el.updateComplete;
    await flushUpdates(el);

    await openPostMeta(el);
    expect(
      el.querySelector(".compose-slug-suggestion-value")?.textContent?.trim(),
    ).toBe("/hello-world");

    let receivedDetail: ComposeSubmitDetail | null = null;
    el.addEventListener("jant:compose-submit-deferred", (event) => {
      receivedDetail = (event as CustomEvent<ComposeSubmitDetail>).detail;
    });

    requireElement(
      el.querySelector<HTMLButtonElement>(".compose-publish-main"),
      "expected publish button",
    ).click();

    expect(receivedDetail).not.toBeNull();
    expect(
      (receivedDetail as unknown as ComposeSubmitDetail).slug,
    ).toBeUndefined();
  });

  it("keeps the publish panel to whole-submission settings", async () => {
    const el = await createElement();

    const publishToggle = requireElement(
      el.querySelector<HTMLButtonElement>(".compose-options-trigger"),
      "expected publish settings toggle",
    );
    publishToggle.click();
    await el.updateComplete;

    const panel = requireElement(
      el.querySelector<HTMLElement>("[data-compose-publish-panel]"),
      "expected publish settings panel",
    );
    expect(panel.textContent).not.toContain("Publish settings");
    expect(panel.textContent).toContain("Visibility");
    expect(panel.textContent).not.toContain("Save as draft");
    expect(panel.textContent).not.toContain("Discard");
    // Post-scoped settings are not in here — they live on the post.
    expect(panel.textContent).not.toContain("Published on");
    expect(panel.textContent).not.toContain("Custom link");

    await openPostMeta(el);
    expect(el.querySelector(".compose-publish-date-input")).not.toBeNull();
    await openPostMeta(el);
    expect(el.querySelector(".compose-publish-slug-input")).not.toBeNull();
  });

  it("clears the custom slug with the reset action", async () => {
    mockSlugApi((url) => {
      if (url.searchParams.get("mode") === "suggest") {
        return { body: { slug: "hello-world" } };
      }
      if (url.searchParams.get("mode") === "check") {
        return { body: { slug: "manual-link", available: true } };
      }
      throw new Error(`Unexpected slug mode: ${url.search}`);
    });

    const el = await createElement();
    const publishToggle = requireElement(
      el.querySelector<HTMLButtonElement>(".compose-options-trigger"),
      "expected publish settings toggle",
    );
    publishToggle.click();
    await el.updateComplete;
    await flushUpdates(el);

    await openPostMeta(el);
    const slugInput = requireElement(
      el.querySelector<HTMLInputElement>(".compose-publish-slug-input"),
      "expected custom link input",
    );
    slugInput.value = "manual-link";
    slugInput.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    await el.updateComplete;

    requireElement(
      Array.from(
        el.querySelectorAll<HTMLButtonElement>(
          ".compose-publish-section-action",
        ),
      ).find((button) => button.textContent?.includes("Reset link")) ?? null,
      "expected reset action",
    ).click();
    await flushUpdates(el);

    await openPostMeta(el);
    expect(
      requireElement(
        el.querySelector<HTMLInputElement>(".compose-publish-slug-input"),
        "expected custom link input",
      ).value,
    ).toBe("");
  });

  it("does not request or show a suggested slug when no title is available", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => {
        throw new Error(
          "slug suggestion should not be requested without a title",
        );
      });

    const el = await createElement();
    el._format = "quote";
    await el.updateComplete;

    const publishToggle = requireElement(
      el.querySelector<HTMLButtonElement>(".compose-options-trigger"),
      "expected publish settings toggle",
    );
    publishToggle.click();
    await el.updateComplete;
    await flushUpdates(el);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(el.querySelector(".compose-slug-suggestion")).toBeNull();
    expect(el.querySelector(".compose-publish-slug-status")).toBeNull();
  });

  it("refreshes the suggested slug when the title changes", async () => {
    vi.useFakeTimers();
    mockSlugApi((url) => {
      if (url.searchParams.get("mode") === "suggest") {
        const title = url.searchParams.get("title");
        return {
          body: {
            slug: title === "Updated Title" ? "updated-title" : "hello-world",
          },
        };
      }
      throw new Error(`Unexpected slug mode: ${url.search}`);
    });

    try {
      const el = await createElement();
      const editor = requireElement(
        el.querySelector<JantComposeEditor>("jant-compose-editor"),
        "expected compose editor",
      );
      editor._title = "Hello World";
      await editor.updateComplete;

      const publishToggle = requireElement(
        el.querySelector<HTMLButtonElement>(".compose-options-trigger"),
        "expected publish settings toggle",
      );
      publishToggle.click();
      await el.updateComplete;
      await flushUpdates(el);

      await openPostMeta(el);
      expect(
        el.querySelector(".compose-slug-suggestion-value")?.textContent?.trim(),
      ).toBe("/hello-world");

      editor._title = "Updated Title";
      el.dispatchEvent(
        new CustomEvent("jant:compose-content-changed", { bubbles: true }),
      );
      await vi.runAllTimersAsync();
      await flushUpdates(el);

      expect(
        el.querySelector(".compose-slug-suggestion-value")?.textContent?.trim(),
      ).toBe("/updated-title");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows an async error when the manual custom link is already taken", async () => {
    vi.useFakeTimers();
    mockSlugApi((url) => {
      if (url.searchParams.get("mode") === "suggest") {
        return { body: { slug: "hello-world" } };
      }
      if (url.searchParams.get("mode") === "check") {
        return { body: { slug: "taken-link", available: false } };
      }
      throw new Error(`Unexpected slug mode: ${url.search}`);
    });

    try {
      const el = await createElement();
      const editor = requireElement(
        el.querySelector<JantComposeEditor>("jant-compose-editor"),
        "expected compose editor",
      );
      editor._bodyJson = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Configured post" }],
          },
        ],
      };
      await editor.updateComplete;

      const publishToggle = requireElement(
        el.querySelector<HTMLButtonElement>(".compose-options-trigger"),
        "expected publish settings toggle",
      );
      publishToggle.click();
      await el.updateComplete;
      await flushUpdates(el);

      await openPostMeta(el);
      const slugInput = requireElement(
        el.querySelector<HTMLInputElement>(".compose-publish-slug-input"),
        "expected custom link input",
      );
      slugInput.value = "taken-link";
      slugInput.dispatchEvent(new Event("input", { bubbles: true }));
      await vi.runAllTimersAsync();
      await el.updateComplete;

      expect(
        el.querySelector("[data-compose-slug-error]")?.textContent?.trim(),
      ).toBe("This link is already in use. Choose something else.");
      expect(
        requireElement(
          el.querySelector<HTMLButtonElement>(".compose-publish-main"),
          "expected publish button",
        ).disabled,
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps publish enabled and hides checking status while the custom link check is pending", async () => {
    vi.useFakeTimers();
    mockSlugApi((url) => {
      if (url.searchParams.get("mode") === "check") {
        return { body: { slug: "pending-link", available: true } };
      }
      throw new Error(`Unexpected slug mode: ${url.search}`);
    });

    try {
      const el = await createElement();
      const editor = requireElement(
        el.querySelector<JantComposeEditor>("jant-compose-editor"),
        "expected compose editor",
      );
      editor._bodyJson = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Configured post" }],
          },
        ],
      };
      await editor.updateComplete;

      requireElement(
        el.querySelector<HTMLButtonElement>(".compose-options-trigger"),
        "expected publish settings toggle",
      ).click();
      await el.updateComplete;

      await openPostMeta(el);
      const slugInput = requireElement(
        el.querySelector<HTMLInputElement>(".compose-publish-slug-input"),
        "expected custom link input",
      );
      slugInput.value = "pending-link";
      slugInput.dispatchEvent(new Event("input", { bubbles: true }));
      await el.updateComplete;

      expect(el._slugCheckLoading).toBe(true);
      expect(
        requireElement(
          el.querySelector<HTMLButtonElement>(".compose-publish-main"),
          "expected publish button",
        ).disabled,
      ).toBe(false);
      expect(el.textContent).not.toContain("Checking link...");
      expect(el.querySelector("[data-compose-slug-error]")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the final post link preview while editing a valid custom link", async () => {
    mockSlugApi((url) => {
      if (url.searchParams.get("mode") === "check") {
        return { body: { slug: "final-link", available: true } };
      }
      throw new Error(`Unexpected slug mode: ${url.search}`);
    });

    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    editor._bodyJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Configured post" }],
        },
      ],
    };
    await editor.updateComplete;

    requireElement(
      el.querySelector<HTMLButtonElement>(".compose-options-trigger"),
      "expected publish settings toggle",
    ).click();
    await el.updateComplete;

    await openPostMeta(el);
    const slugInput = requireElement(
      el.querySelector<HTMLInputElement>(".compose-publish-slug-input"),
      "expected custom link input",
    );
    slugInput.value = "final-link";
    slugInput.dispatchEvent(new Event("input", { bubbles: true }));
    await el.updateComplete;

    expect(
      el.querySelector("[data-compose-slug-preview]")?.textContent?.trim(),
    ).toBe(`${globalThis.location.origin}/final-link`);
  });

  it("includes the thread root id when replying", async () => {
    const el = await createElement();
    await el.openReply(
      "019ce8ce-d6d8-7fda-a5df-c2da2bef5ade",
      {
        contentHtml: "<p>Parent</p>",
        dateText: "Mar 14",
      },
      "019ce8cf-19a1-7d16-9a75-017a9ac7299d",
      {
        kind: "timeline-item",
        id: "019ce8cf-19a1-7d16-9a75-017a9ac7299d",
      },
    );

    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    editor._bodyJson = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Reply body" }] },
      ],
    };
    await editor.updateComplete;
    await el.updateComplete;

    let receivedDetail:
      | (ComposeSubmitDetail & { pendingAttachments: unknown[] })
      | null = null;
    el.addEventListener("jant:compose-submit-deferred", (event) => {
      const customEvent = event as CustomEvent<
        ComposeSubmitDetail & { pendingAttachments: unknown[] }
      >;
      receivedDetail = customEvent.detail;
    });

    requireElement(
      el.querySelector<HTMLButtonElement>(".compose-publish-main"),
      "expected reply button",
    ).click();

    expect(receivedDetail).not.toBeNull();
    const detail = receivedDetail as unknown as ComposeSubmitDetail & {
      pendingAttachments: unknown[];
    };
    expect(detail.replyToId).toBe("019ce8ce-d6d8-7fda-a5df-c2da2bef5ade");
    expect(detail.replyThreadRootId).toBe(
      "019ce8cf-19a1-7d16-9a75-017a9ac7299d",
    );
    expect(detail.replyRefreshKind).toBe("timeline-item");
    expect(detail.replyRefreshId).toBe("019ce8cf-19a1-7d16-9a75-017a9ac7299d");
  });

  it("honors an explicit initialFormat option when opening a reply", async () => {
    const el = await createElement();

    await el.openReply(
      "019ce8ce-d6d8-7fda-a5df-c2da2bef5ade",
      {
        contentHtml: "<p>Parent</p>",
        dateText: "Mar 14",
      },
      undefined,
      undefined,
      { initialFormat: "quote" },
    );
    await flushUpdates(el);

    expect(el._format).toBe("quote");
  });

  it("restores a matching local reply draft when reopening reply compose", async () => {
    const el = await createElement();
    const replyToId = "019ce8ce-d6d8-7fda-a5df-c2da2bef5ade";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 404 }),
    );

    globalThis.localStorage.setItem(
      "jant:compose-draft",
      JSON.stringify({
        format: "note",
        title: "",
        bodyJson: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Recovered reply draft" }],
            },
          ],
        },
        url: "",
        quoteText: "",
        quoteAuthor: "",
        slug: "",
        visibility: "public",
        rating: 0,
        showRating: false,
        collectionIds: ["col-stale"],
        replyToId,
        attachedTexts: [],
        attachmentOrder: [],
        savedAt: Date.now(),
      }),
    );

    await el.openReply(replyToId, {
      contentHtml: "<p>Parent</p>",
      dateText: "Mar 14",
    });
    await flushUpdates(el);

    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    expect(el._replyToId).toBe(replyToId);
    expect(el._collectionIds).toEqual([]);
    expect(el.querySelector(".compose-collection-trigger")).toBeNull();
    expect(editor.getData().body).toContain("Recovered reply draft");
  });

  it("keeps the local reply draft when submit is dispatched", async () => {
    const el = await createElement();
    const replyToId = "019ce8ce-d6d8-7fda-a5df-c2da2bef5ade";

    await el.openReply(replyToId, {
      contentHtml: "<p>Parent</p>",
      dateText: "Mar 14",
    });

    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    editor._bodyJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Persist me before submit" }],
        },
      ],
    };
    await editor.updateComplete;
    await el.updateComplete;

    requireElement(
      el.querySelector<HTMLButtonElement>(".compose-publish-main"),
      "expected reply button",
    ).click();

    const savedDraftRaw = globalThis.localStorage.getItem("jant:compose-draft");
    if (!savedDraftRaw) {
      throw new Error("expected local compose draft");
    }
    const savedDraft = JSON.parse(savedDraftRaw) as {
      replyToId: string;
      bodyJson: { content: Array<{ content: Array<{ text: string }> }> };
    };

    expect(savedDraft.replyToId).toBe(replyToId);
    expect(savedDraft.bodyJson.content[0]?.content[0]?.text).toBe(
      "Persist me before submit",
    );
  });

  it("includes quiet reply intent when submitting multiple reply posts", async () => {
    const el = await createElement();
    await el.openReply("019ce8ce-d6d8-7fda-a5df-c2da2bef5ade", {
      contentHtml: "<p>Parent</p>",
      dateText: "Mar 14",
    });

    (
      el as unknown as {
        _addThreadItem: () => void;
      }
    )._addThreadItem();
    await flushUpdates(el);

    el._quietReply = true;
    const editors = Array.from(
      el.querySelectorAll<JantComposeEditor>("jant-compose-editor"),
    );
    expect(editors).toHaveLength(2);

    editors.forEach((editor, index) => {
      editor._bodyJson = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: `Quiet reply ${index + 1}` }],
          },
        ],
      };
    });
    await Promise.all(editors.map((editor) => editor.updateComplete));
    await el.updateComplete;

    let receivedDetail: ComposeSubmitDetail | null = null;
    el.addEventListener("jant:compose-submit-deferred", (event) => {
      receivedDetail = (event as CustomEvent<ComposeSubmitDetail>).detail;
    });

    requireElement(
      el.querySelector<HTMLButtonElement>(".compose-publish-main"),
      "expected reply button",
    ).click();

    expect(receivedDetail).not.toBeNull();
    const detail = receivedDetail as unknown as ComposeSubmitDetail;
    expect(detail.quietReply).toBe(true);
    expect(detail.threadPosts?.[0]?.quietReply).toBe(true);
  });

  it("does not add more thread items than the shared limit", async () => {
    const el = await createElement();
    el._threadItems = Array.from({ length: MAX_THREAD_POSTS }, (_, index) => ({
      id: `thread-${index}`,
      format: "note",
    }));

    (
      el as unknown as {
        _addThreadItem: () => void;
      }
    )._addThreadItem();

    expect(el._threadItems).toHaveLength(MAX_THREAD_POSTS);
  });

  it("scrolls the thread composer to the bottom after adding an item", async () => {
    const el = await createElement();
    el._threadItems = [
      { id: "thread-1", format: "note" },
      { id: "thread-2", format: "note" },
    ];
    await el.updateComplete;

    const scroller = requireElement(
      el.querySelector<HTMLElement>(".compose-scroll"),
      "expected compose scroll region",
    );
    Object.defineProperty(scroller, "scrollHeight", {
      configurable: true,
      value: 640,
    });
    scroller.scrollTop = 120;

    (
      el as unknown as {
        _addThreadItem: () => void;
      }
    )._addThreadItem();
    await flushUpdates(el);

    expect(scroller.scrollTop).toBe(640);
  });

  it("omits visibility from locked edit submissions", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );

    el._editPostId = "post-123";
    el._visibilityLocked = true;
    el._slug = "reply-note";
    editor._bodyJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Edited reply" }],
        },
      ],
    };
    await editor.updateComplete;
    await el.updateComplete;

    let receivedDetail: ComposeSubmitDetail | null = null;
    el.addEventListener("jant:compose-submit-deferred", (event) => {
      receivedDetail = (event as CustomEvent<ComposeSubmitDetail>).detail;
    });

    requireElement(
      el.querySelector<HTMLButtonElement>(".compose-publish-main"),
      "expected publish button",
    ).click();

    expect(receivedDetail).not.toBeNull();
    expect(
      (receivedDetail as unknown as ComposeSubmitDetail).visibility,
    ).toBeUndefined();
    expect((receivedDetail as unknown as ComposeSubmitDetail).slug).toBe(
      "reply-note",
    );
  });

  it("gives the collection trigger one glyph and no chevron", async () => {
    const el = await createElement();
    const trigger = requireElement(
      el.querySelector<HTMLButtonElement>(".compose-collection-trigger"),
      "expected collection trigger",
    );

    expect(trigger.querySelectorAll("svg").length).toBe(1);
    expect(
      trigger.querySelector(".compose-collection-trigger-svg"),
    ).not.toBeNull();
    expect(trigger.querySelector(".compose-collection-chevron")).toBeNull();
  });

  it("collection selector toggles IDs", async () => {
    const el = await createElement();

    // Open collection combobox
    const trigger = requireElement(
      el.querySelector<HTMLButtonElement>(".compose-collection-trigger"),
      "expected collection trigger",
    );
    trigger.click();
    await el.updateComplete;

    const options = el.querySelectorAll<HTMLElement>(
      "[data-popover] [role='option']",
    );
    expect(options.length).toBe(2);

    // Select first collection
    options[0].click();
    await el.updateComplete;
    expect(el._collectionIds).toEqual(["col-1"]);
    expect(
      el.querySelector(".compose-collection-label")?.textContent?.trim(),
    ).toBe("Books");
    expect(
      options[0]?.querySelector(".compose-collection-option-label"),
    ).not.toBeNull();

    // Select second collection
    options[1].click();
    await el.updateComplete;
    expect(el._collectionIds).toEqual(["col-1", "col-2"]);

    // Deselect first
    options[0].click();
    await el.updateComplete;
    expect(el._collectionIds).toEqual(["col-2"]);
  });

  it("moves collection focus with arrow keys and toggles with Space", async () => {
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    const el = await createElement();

    requireElement(
      el.querySelector<HTMLButtonElement>(".compose-collection-trigger"),
      "expected collection trigger",
    ).click();
    await flushUpdates(el);

    const searchInput = requireElement(
      el.querySelector<HTMLInputElement>(".compose-collection-search-input"),
      "expected collection search input",
    );
    expect(document.activeElement).toBe(searchInput);

    keydown(searchInput, "ArrowDown");
    await flushUpdates(el);

    let options = Array.from(
      el.querySelectorAll<HTMLButtonElement>("[data-popover] [role='option']"),
    );
    expect(document.activeElement).toBe(options[0]);

    keydown(
      requireElement(options[0] ?? null, "expected first option"),
      "ArrowDown",
    );
    await flushUpdates(el);
    options = Array.from(
      el.querySelectorAll<HTMLButtonElement>("[data-popover] [role='option']"),
    );
    expect(document.activeElement).toBe(options[1]);

    keydown(
      requireElement(options[1] ?? null, "expected second option"),
      "ArrowUp",
    );
    await flushUpdates(el);
    options = Array.from(
      el.querySelectorAll<HTMLButtonElement>("[data-popover] [role='option']"),
    );
    expect(document.activeElement).toBe(options[0]);

    keydown(requireElement(options[0] ?? null, "expected first option"), " ");
    await flushUpdates(el);
    expect(el._collectionIds).toEqual(["col-1"]);

    options = Array.from(
      el.querySelectorAll<HTMLButtonElement>("[data-popover] [role='option']"),
    );
    expect(document.activeElement).toBe(options[0]);

    keydown(
      requireElement(options[0] ?? null, "expected first option"),
      "ArrowUp",
    );
    await flushUpdates(el);
    expect(document.activeElement).toBe(searchInput);
  });

  it("closes the collection picker from the search input on Enter", async () => {
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    const el = await createElement();

    const trigger = requireElement(
      el.querySelector<HTMLButtonElement>(".compose-collection-trigger"),
      "expected collection trigger",
    );
    trigger.click();
    await flushUpdates(el);

    const searchInput = requireElement(
      el.querySelector<HTMLInputElement>(".compose-collection-search-input"),
      "expected collection search input",
    );
    expect(document.activeElement).toBe(searchInput);

    keydown(searchInput, "Enter");
    await flushUpdates(el);

    expect(el._showCollection).toBe(false);
    expect(el._collectionSearch).toBe("");
    expect(document.activeElement).toBe(trigger);
  });

  it("closes the collection picker from an option on Enter without toggling", async () => {
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    const el = await createElement();

    const trigger = requireElement(
      el.querySelector<HTMLButtonElement>(".compose-collection-trigger"),
      "expected collection trigger",
    );
    trigger.click();
    await flushUpdates(el);

    const firstOption = requireElement(
      el.querySelector<HTMLButtonElement>("[data-popover] [role='option']"),
      "expected first collection option",
    );
    firstOption.focus();

    keydown(firstOption, "Enter");
    await flushUpdates(el);

    expect(el._collectionIds).toEqual([]);
    expect(el._showCollection).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("does not autofocus collection search on coarse pointer devices", async () => {
    Object.defineProperty(globalThis, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === "(hover: none) and (pointer: coarse)",
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });

    const el = await createElement();
    const trigger = requireElement(
      el.querySelector<HTMLButtonElement>(".compose-collection-trigger"),
      "expected collection trigger",
    );
    trigger.focus();
    trigger.click();
    await flushUpdates(el);

    const searchInput = requireElement(
      el.querySelector<HTMLInputElement>(".compose-collection-search-input"),
      "expected collection search input",
    );
    expect(document.activeElement).not.toBe(searchInput);
  });

  it("moves trigger keyboard input into the collection search when the picker is open", async () => {
    Object.defineProperty(globalThis, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === "(hover: none) and (pointer: coarse)",
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });

    const el = await createElement();
    const trigger = requireElement(
      el.querySelector<HTMLButtonElement>(".compose-collection-trigger"),
      "expected collection trigger",
    );
    trigger.focus();
    trigger.click();
    await flushUpdates(el);

    keydown(trigger, "m");
    await flushUpdates(el);

    const searchInput = requireElement(
      el.querySelector<HTMLInputElement>(".compose-collection-search-input"),
      "expected collection search input",
    );
    expect(document.activeElement).toBe(searchInput);
    expect(el._collectionSearch).toBe("m");
  });

  it("keeps selected collections first when opening and after reopening", async () => {
    const el = await createElement([
      { id: "col-1", title: "Books", slug: "books" },
      { id: "col-2", title: "Movies", slug: "movies" },
      { id: "col-3", title: "Travel", slug: "travel" },
    ]);
    el._collectionIds = ["col-2"];
    await el.updateComplete;

    const trigger = requireElement(
      el.querySelector<HTMLButtonElement>(".compose-collection-trigger"),
      "expected collection trigger",
    );

    trigger.click();
    await el.updateComplete;

    expect(collectionOptionTitles(el)).toEqual(["Movies", "Books", "Travel"]);

    const options = el.querySelectorAll<HTMLButtonElement>(
      "[data-popover] [role='option']",
    );
    options[2]?.click();
    await el.updateComplete;

    expect(el._collectionIds).toEqual(["col-2", "col-3"]);
    expect(collectionOptionTitles(el)).toEqual(["Movies", "Books", "Travel"]);

    trigger.click();
    await el.updateComplete;
    trigger.click();
    await el.updateComplete;

    expect(collectionOptionTitles(el)).toEqual(["Movies", "Travel", "Books"]);
  });

  it("reset restores initial state", async () => {
    const el = await createElement();
    el._format = "link";
    el._collectionIds = ["col-1", "col-2"];
    el._loading = true;
    el._draftSourceId = "abc123";

    el.reset();

    expect(el._format).toBe("note");
    expect(el._collectionIds).toEqual([]);
    expect(el._loading).toBe(false);
    expect(el._draftSourceId).toBeNull();
  });

  it("loading state disables submit button", async () => {
    const el = await createElement();
    el._loading = true;
    await el.updateComplete;

    const postBtn = requireElement(
      el.querySelector<HTMLButtonElement>(".compose-publish-main"),
      "expected post button",
    );
    expect(postBtn.disabled).toBe(true);
  });

  it("renders collection selector even without collections", async () => {
    const el = await createElement([]);

    // Collection trigger is still shown so users can create new collections
    expect(el.querySelector(".compose-collection-trigger")).not.toBeNull();
    const actionRow = el.querySelector(".compose-action-row");
    expect(actionRow).not.toBeNull();
  });

  it("refreshes collections from the compose-sorted endpoint", async () => {
    const el = await createElement([
      { id: "col-1", title: "Books", slug: "books" },
    ]);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          collections: [
            { id: "col-2", title: "Movies", slug: "movies" },
            { id: "col-1", title: "Books", slug: "books" },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const refreshed = await el.refreshCollections();

    expect(refreshed).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith("/api/collections?view=compose", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    expect(el.collections).toEqual([
      { id: "col-2", title: "Movies", slug: "movies" },
      { id: "col-1", title: "Books", slug: "books" },
    ]);
  });

  it("opens a quick collection dialog from the collection selector", async () => {
    const el = await createElement();
    const trigger = requireElement(
      el.querySelector<HTMLButtonElement>(".compose-collection-trigger"),
      "expected collection trigger",
    );

    trigger.click();
    await el.updateComplete;

    const addAction = requireElement(
      el.querySelector<HTMLElement>(".compose-collection-add-action"),
      "expected add collection action",
    );
    addAction.click();
    await el.updateComplete;

    const composeInner = requireElement(
      el.querySelector<HTMLElement>(".compose-dialog-inner"),
      "expected compose dialog inner",
    );
    expect(el.querySelector("[data-collection-quick-dialog]")).not.toBeNull();
    expect(
      composeInner.classList.contains("compose-dialog-inner-suspended"),
    ).toBe(true);
    expect(composeInner.getAttribute("aria-hidden")).toBe("true");
    expect(
      el.querySelector("[data-collection-quick-dialog] textarea"),
    ).toBeNull();
    expect(
      el.querySelector("[data-collection-quick-dialog] select"),
    ).toBeNull();
    expect(
      el.querySelector("[data-collection-quick-dialog] [data-icon-trigger]"),
    ).toBeNull();
    expect(
      el.querySelector(
        "[data-collection-quick-dialog] [data-collection-slug-input]",
      ),
    ).toBeNull();
    expect(
      el.querySelector(
        "[data-collection-quick-dialog] .collection-quick-dialog-cancel",
      )?.textContent,
    ).toContain("Cancel");
    expect(
      el.querySelector(
        "[data-collection-quick-dialog] .collection-quick-dialog-submit",
      )?.textContent,
    ).toContain("Done");
    expect(el.textContent).toContain(
      "More options are available after you create it.",
    );

    requireElement(
      el.querySelector<HTMLButtonElement>(
        "[data-collection-quick-dialog] .collection-quick-dialog-cancel",
      ),
      "expected quick dialog cancel button",
    ).click();
    await flushUpdates(el);

    expect(el.querySelector("[data-collection-quick-dialog]")).toBeNull();
    expect(
      composeInner.classList.contains("compose-dialog-inner-suspended"),
    ).toBe(false);
    expect(composeInner.getAttribute("aria-hidden")).toBe("false");
  });

  it("restores compose after creating a collection from the quick dialog", async () => {
    const el = await createElement();
    const trigger = requireElement(
      el.querySelector<HTMLButtonElement>(".compose-collection-trigger"),
      "expected collection trigger",
    );

    trigger.click();
    await el.updateComplete;

    requireElement(
      el.querySelector<HTMLElement>(".compose-collection-add-action"),
      "expected add collection action",
    ).click();
    await el.updateComplete;

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const raw =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        const url = new URL(raw, "http://localhost");
        const method =
          init?.method ??
          (typeof input === "string" || input instanceof URL
            ? "GET"
            : input.method);

        if (url.pathname === "/api/collections" && method === "POST") {
          return new Response(
            JSON.stringify({ id: "col-3", title: "Travel", slug: "travel" }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        if (
          url.pathname === "/api/collections" &&
          url.searchParams.get("view") === "compose"
        ) {
          return new Response(
            JSON.stringify({
              collections: [
                { id: "col-3", title: "Travel", slug: "travel" },
                { id: "col-1", title: "Books", slug: "books" },
                { id: "col-2", title: "Movies", slug: "movies" },
              ],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        throw new Error(`Unexpected fetch: ${url.pathname}${url.search}`);
      });

    const form = requireElement(
      el.querySelector<HTMLElement>(
        "[data-collection-quick-dialog] jant-collection-form",
      ),
      "expected quick collection form",
    );
    form.dispatchEvent(
      new CustomEvent("jant:collection-submit", {
        bubbles: true,
        detail: {
          data: {
            title: "Travel",
            slug: "travel",
            description: "",
            sortOrder: "newest",
            icon: "",
          },
        },
      }),
    );

    await vi.waitFor(() => {
      expect(el.querySelector("[data-collection-quick-dialog]")).toBeNull();
    });

    const composeInner = requireElement(
      el.querySelector<HTMLElement>(".compose-dialog-inner"),
      "expected compose dialog inner",
    );
    expect(fetchSpy).toHaveBeenCalled();
    expect(el.querySelector("[data-collection-quick-dialog]")).toBeNull();
    expect(
      composeInner.classList.contains("compose-dialog-inner-suspended"),
    ).toBe(false);
    expect(el._collectionIds).toContain("col-3");
    expect(el.collections).toEqual([
      { id: "col-3", title: "Travel", slug: "travel" },
      { id: "col-1", title: "Books", slug: "books" },
      { id: "col-2", title: "Movies", slug: "movies" },
    ]);
  });

  it("draft button with content shows confirm panel", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    editor._bodyJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Draft content" }],
        },
      ],
    };
    await editor.updateComplete;

    // Click the drafts row in the options panel — should show confirm panel
    await openPublishPanel(el);
    requireElement(draftsRow(el), "expected drafts row").click();
    await flushUpdates(el);

    expect(el._confirmPanelOpen).toBe(true);
    expect(el.querySelector(".compose-confirm-panel")).not.toBeNull();
  });

  it("draft button without content opens drafts panel", async () => {
    const el = await createElement();

    // Mock fetch for drafts list
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ posts: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // Click the drafts row in the options panel — should open drafts panel
    await openPublishPanel(el);
    requireElement(draftsRow(el), "expected drafts row").click();
    await flushUpdates(el);

    expect(el._draftsPanelOpen).toBe(true);

    // Wait for fetch to resolve
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    expect(el._draftsLoading).toBe(false);
    expect(el.querySelector(".compose-drafts-panel")).not.toBeNull();

    fetchSpy.mockRestore();
  });

  it("opens a prefixed draft preview from the overflow menu without loading the editor", async () => {
    document.documentElement.dataset.sitePathPrefix = "/blog";
    const el = await createElement();
    el._draftsPanelOpen = true;
    el._draftsLoading = false;
    el._drafts = [
      {
        id: "pst_draft",
        slug: "draft-slug",
        format: "note",
        title: "Preview me",
        bodyText: "Draft body",
        bodyHtml: "<p>Draft body</p>",
        url: null,
        quoteText: null,
        replyToId: null,
        updatedAt: 0,
        mediaAttachments: [],
      },
    ];
    await el.updateComplete;

    const trigger = requireElement(
      el.querySelector<HTMLButtonElement>(".compose-draft-more"),
      "expected draft actions trigger",
    );
    expect(trigger.getAttribute("aria-label")).toBe("Draft actions");
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    trigger.click();
    await el.updateComplete;

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const menu = requireElement(
      el.querySelector<HTMLElement>('[role="menu"]'),
      "expected draft actions menu",
    );
    const items = menu.querySelectorAll<HTMLElement>('[role="menuitem"]');
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent?.trim()).toBe("Preview");
    expect(items[1]?.textContent?.trim()).toBe("Delete Draft");

    const previewLink = requireElement(
      menu.querySelector<HTMLAnchorElement>('a[role="menuitem"]'),
      "expected preview link",
    );
    expect(previewLink.getAttribute("href")).toBe("/blog/preview/draft-slug");
    expect(previewLink.target).toBe("_blank");
    expect(previewLink.rel).toBe("noopener noreferrer");

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    previewLink.addEventListener("click", (event) => event.preventDefault());
    previewLink.click();
    await el.updateComplete;

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(el._draftsPanelOpen).toBe(true);
    expect(el._draftMenuOpenId).toBeNull();
  });

  it("uses title or quote text for draft previews and identifies each format", async () => {
    const el = await createElement();
    el._draftsPanelOpen = true;
    el._draftsLoading = false;
    el._drafts = [
      {
        id: "pst_note",
        slug: "note-draft",
        format: "note",
        title: "A titled note",
        bodyText: "This body should not be the preview",
        bodyHtml: "<p>This body should not be the preview</p>",
        url: null,
        quoteText: null,
        replyToId: null,
        updatedAt: 0,
        mediaAttachments: [],
      },
      {
        id: "pst_quote",
        slug: "quote-draft",
        format: "quote",
        title: "Quote title",
        bodyText: "Supporting note",
        bodyHtml: "<p>Supporting note</p>",
        url: null,
        quoteText: "The quoted words come first.",
        replyToId: null,
        updatedAt: 0,
        mediaAttachments: [],
      },
      {
        id: "pst_link",
        slug: "link-draft",
        format: "link",
        title: null,
        bodyText: "A link note",
        bodyHtml: "<p>A link note</p>",
        url: "https://example.com",
        quoteText: null,
        replyToId: null,
        updatedAt: 0,
        mediaAttachments: [],
      },
    ];
    await el.updateComplete;

    const rows = el.querySelectorAll<HTMLElement>(".compose-draft-item");
    expect(rows).toHaveLength(3);
    expect(rows[0]?.querySelector(".compose-draft-preview")?.textContent).toBe(
      "A titled note",
    );
    expect(rows[1]?.querySelector(".compose-draft-preview")?.textContent).toBe(
      "The quoted words come first.",
    );
    expect(rows[2]?.querySelector(".compose-draft-preview")?.textContent).toBe(
      "A link note",
    );
    expect(
      Array.from(el.querySelectorAll(".compose-draft-format")).map(
        (format) => format.textContent,
      ),
    ).toEqual(["Note", "Quote", "Link"]);
  });

  it("does not dispatch submit when loading", async () => {
    const el = await createElement();
    el._loading = true;
    await el.updateComplete;

    let dispatched = false;
    el.addEventListener("jant:compose-submit-deferred", () => {
      dispatched = true;
    });

    const postBtn = requireElement(
      el.querySelector<HTMLButtonElement>(".compose-publish-main"),
      "expected post button",
    );
    postBtn.click();

    expect(dispatched).toBe(false);
  });

  it("loading state shows spinner in submit button", async () => {
    const el = await createElement();
    el._loading = true;
    await el.updateComplete;

    const spinner = el.querySelector(".compose-publish-main .animate-spin");
    expect(spinner).not.toBeNull();
  });

  it("no old media picker dialog is rendered", async () => {
    const el = await createElement();

    expect(el.querySelector("#compose-media-picker")).toBeNull();
    expect(el.querySelector(".compose-media-picker")).toBeNull();
  });

  it("editor renders attachments when present", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );

    // Simulate adding an attachment
    const blob = new Blob(["fake-image"], { type: "image/png" });
    const file = new File([blob], "test.png", { type: "image/png" });
    const previewUrl = URL.createObjectURL(blob);

    editor._attachments = [
      {
        clientId: "test-id-1",
        file,
        previewUrl,
        status: "done",
        progress: null,
        mediaId: "media-1",
        alt: "",
        error: null,
        posterUrl: null,
        remoteUrl: null,
        summary: null,
        chars: null,
      },
    ];
    editor._attachmentOrder = ["test-id-1"];
    await editor.updateComplete;

    // Thumbnail strip should be visible
    expect(editor.querySelector(".compose-attachments")).not.toBeNull();
    expect(editor.querySelector(".compose-attachment-thumb")).not.toBeNull();
    // ALT button should be visible
    expect(editor.querySelector(".compose-attachment-alt")).not.toBeNull();
    // Media tool button should show inline "Add" label
    const mediaBtn =
      editor.querySelector<HTMLButtonElement>(".compose-tool-btn");
    expect(mediaBtn?.querySelector(".compose-tool-label")?.textContent).toBe(
      "Add",
    );

    URL.revokeObjectURL(previewUrl);
  });

  it("puts the single-post editor straight inside the one scroll region", async () => {
    const el = await createElement();

    const scroller = requireElement(
      el.querySelector<HTMLElement>(".compose-scroll"),
      "expected compose scroll region",
    );
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );

    // The rules that lay the editor out are keyed on
    // `.compose-scroll > jant-compose-editor`. Any wrapper breaks them —
    // including a `display: contents` one, which drops the box but not the DOM
    // parentage the selector matches on.
    expect(editor.parentElement).toBe(scroller);
    // The action row is the composer's pinned floor; it must stay outside.
    expect(scroller.querySelector(".compose-action-row")).toBeNull();
    expect(el.querySelector(".compose-action-row")).not.toBeNull();
  });

  it("scrolls in exactly one place across every compose mode", async () => {
    const css = readFileSync(resolve("src/styles/ui.css"), "utf8");

    // `.compose-scroll` owns the scrolling for single-post, reply and thread
    // alike. Anything nested inside it that scrolls on its own is the bug this
    // replaced: three stacked scrollers, and previews shrunk to fit them.
    expect(css).toMatch(
      /\.compose-scroll\s*\{[\s\S]*flex:\s*1;[\s\S]*min-height:\s*0;[\s\S]*overflow-y:\s*auto;/,
    );
    expect(css).not.toMatch(/\.compose-body\s*\{[^}]*overflow-y:\s*auto;/);
    expect(css).not.toMatch(
      /\.compose-thread-compose-layout\s*\{[^}]*overflow-y:\s*auto;/,
    );
    expect(css).not.toMatch(
      /\.compose-editor-row\s+\.compose-attachments-dock\s*\{[^}]*overflow-y:\s*auto;/,
    );

    // Nothing between the scroll region and the text may clip or claim a fixed
    // share of the height — every block is sized by its own content.
    expect(css).not.toMatch(
      /\.compose-editor-row\s*\{[^}]*overflow:\s*hidden;/,
    );
    expect(css).not.toMatch(
      /\.compose-thread-layout\s*\{[^}]*overflow:\s*hidden;/,
    );
  });

  it("lets attachment previews take the room the pinned toolbar used to need", () => {
    const css = readFileSync(resolve("src/styles/ui.css"), "utf8");

    expect(css).toMatch(
      /\.compose-attachment-img\s*\{[\s\S]*max-height:\s*min\(420px,\s*46dvh\);/,
    );
    expect(css).toMatch(
      /\.compose-attachment:only-child\s+\.compose-attachment-img\s*\{[\s\S]*max-height:\s*min\(460px,\s*52dvh\);/,
    );
    expect(css).toMatch(
      /\.compose-attachment:not\(:only-child\)\s+\.compose-attachment-img\s*\{[\s\S]*height:\s*min\(340px,\s*40dvh\);/,
    );
    // Reply compose no longer shrinks its previews to 96×72 to spare the
    // toolbar — one preview size everywhere.
    expect(css).not.toMatch(/--compose-reply-attachment-width/);
  });

  it("routes a format change straight off the single-post editor", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );

    editor.dispatchEvent(
      new CustomEvent("jant:format-change", {
        detail: { format: "quote" },
        bubbles: true,
      }),
    );
    await flushUpdates(el);

    expect(el._format).toBe("quote");
  });

  it("shows the replied-to post at the same scale as the reply", () => {
    const css = readFileSync(resolve("src/styles/ui.css"), "utf8");

    // Same ceiling as the composer's own previews — the parent is not a
    // thumbnail strip.
    expect(css).toMatch(
      /\.compose-reply-context-body img,[\s\S]*?video\s*\{[\s\S]*?max-height:\s*min\(420px,\s*46dvh\);/,
    );
    // One rule governs every picture in the context. A second one keyed on
    // `.compose-reply-context-media-img` would sit at lower specificity than
    // the `…-body img` rule above it and never apply — the media strip is
    // inside the body.
    expect(css).not.toMatch(/\.compose-reply-context-media-img\s*\{/);

    // Expanding hands the post its full height; a capped, separately scrolling
    // box is what left no room for full-size pictures.
    expect(css).toMatch(
      /\.compose-reply-context\.expanded\s*\{\s*max-height:\s*none;\s*overflow:\s*visible;/,
    );
    // Fullscreen's collapsed cap must not outrank that.
    expect(css).toMatch(
      /\.compose-fullscreen-thread-layout\s+\.compose-reply-context:not\(\.expanded\)\s*\{\s*max-height:\s*140px;/,
    );
  });

  it("keeps reply compose tools inside the editor's text column", () => {
    const css = readFileSync(resolve("src/styles/ui.css"), "utf8");

    // `flex: 1` on the editor is horizontal — it claims the width the rail dot
    // leaves. Height comes from content.
    expect(css).toMatch(
      /\.compose-editor-row\s*>\s*jant-compose-editor\s*\{[\s\S]*flex:\s*1;[\s\S]*min-width:\s*0;/,
    );
    expect(css).toMatch(
      /\.compose-reply-compose-layout\s+\.compose-thread-post-header\s*\+\s*\.compose-body\s*\{[\s\S]*padding-top:\s*12px;/,
    );
    expect(css).toMatch(
      /@media \(max-width:\s*760px\),\s*\(hover:\s*none\) and \(pointer:\s*coarse\)\s*\{[\s\S]*\.compose-thread-layout\s*\{[\s\S]*padding-top:\s*0\.75rem;/,
    );
    expect(css).toMatch(
      /\.compose-dialog,[\s\S]*\.compose-page-shell\s*>\s*jant-compose-dialog\s*\{[\s\S]*--compose-quote-input-size:\s*var\(--type-content-subtitle\);[\s\S]*--compose-quote-input-leading:\s*1\.32;/,
    );
    // On the page the card's own padding is the text column, so every row
    // inside it reads a zero gutter and only restates its right.
    expect(css).toMatch(
      /\.compose-page-shell\s+\.compose-dialog-inner-page\s*\{[\s\S]*--compose-gutter:\s*0px;/,
    );
    expect(css).toMatch(
      /\.compose-page-shell\s+\.compose-dialog-inner-page\s+\.compose-thread-post-header\s*\{\s*padding-inline-end:\s*0;/,
    );
    expect(css).toMatch(
      /\.compose-quote-text\s*\{[\s\S]*font-size:\s*var\(--compose-quote-input-size\);[\s\S]*line-height:\s*var\(--compose-quote-input-leading\);/,
    );
    expect(css).toMatch(
      /\.compose-reply-compose-layout\s*\{[\s\S]*--compose-title-input-size:\s*calc\(var\(--type-content-body\) \* 1\.2\);[\s\S]*--compose-quote-input-size:\s*calc\(var\(--type-content-body\) \* 1\.06\);[\s\S]*--compose-quote-input-leading:\s*1\.42;[\s\S]*--compose-inline-input-size:\s*var\(--type-base\);/,
    );
    expect(css).toMatch(
      /\.compose-reply-compose-layout\s+\.compose-quote-wrap\s*\{[\s\S]*margin-top:\s*0\.4rem;[\s\S]*padding:\s*24px 18px 18px;[\s\S]*border-radius:\s*0\.95rem;/,
    );
    expect(css).toMatch(
      /\.compose-reply-compose-layout\s+\.compose-link-url-wrap\s*\{[\s\S]*margin-top:\s*0\.4rem;/,
    );
    // The reply layout tunes only the lead-in. Height is the shared four-line
    // floor, which reads this layout's own leading and type size, so a
    // `min-height` here would just restate what the base rule already knows.
    expect(css).toMatch(
      /\.compose-reply-compose-layout\s+\.compose-quote-text\s*\{\s*padding-top:\s*0\.35rem;\s*\}/,
    );
    expect(css).not.toMatch(
      /\.compose-reply-compose-layout\s+\.compose-quote-text\s*\{[^}]*min-height:/,
    );
    expect(css).toMatch(
      /\.compose-reply-compose-layout\s+\.compose-tiptap-body\s+\.tiptap\s*\{[\s\S]*font-size:\s*var\(--type-content-body\);/,
    );
  });

  it("opens every compose text surface at a floor stated in lines", () => {
    const css = readFileSync(resolve("src/styles/ui.css"), "utf8");

    // Two lines for the editor, four for the quote — as multiples of the
    // leading, not pixels, so the floor follows the type instead of going
    // stale next to it.
    expect(css).toMatch(
      /\.compose-tiptap-body \.tiptap\s*\{[\s\S]*min-height:\s*calc\(var\(--type-body-leading\) \* 2em\);/,
    );
    expect(css).toMatch(
      /\.compose-quote-text\s*\{[\s\S]*min-height:\s*calc\(var\(--compose-quote-input-leading\) \* 4em\);/,
    );

    // One floor for every editor: a note's body and the "thoughts" under a
    // link or a quote all open the same way.
    expect(css).not.toMatch(/\.compose-tiptap-thoughts/);
  });

  it("runs the thread rail from the first dot to the last post's, and no further", () => {
    const css = readFileSync(resolve("src/styles/ui.css"), "utf8");

    // Drawn per row rather than as one strip down the layout, which is what
    // lets both ends be trimmed back to a dot.
    expect(css).not.toMatch(/\.compose-thread-layout::before\s*\{/);
    expect(css).toMatch(
      /\.compose-thread-layout > \*::before\s*\{[\s\S]*top:\s*0;[\s\S]*bottom:\s*0;/,
    );
    expect(css).toMatch(
      /\.compose-thread-layout > :first-child::before\s*\{\s*top:\s*var\(--compose-thread-dot-center\);/,
    );
    expect(css).toMatch(
      /\.compose-editor-row:not\(:has\(~ \.compose-editor-row\)\)::before\s*\{\s*bottom:\s*auto;\s*height:\s*var\(--compose-thread-dot-center\);/,
    );
    // The "add" row is a placeholder, not a post — the rail stops before it.
    expect(css).toMatch(
      /\.compose-thread-layout > \.compose-thread-add-row::before\s*\{\s*display:\s*none;/,
    );

    // The dot reads its offset off the same centre the rail is trimmed to, so
    // resizing the marker cannot leave the line pointing past it.
    expect(css).toMatch(
      /\.compose-thread-dot\s*\{[\s\S]*margin-top:\s*calc\(\s*var\(--compose-thread-dot-center\) -\s*var\(--compose-thread-row-padding-top\) -\s*var\(--site-thread-marker-size\) \/ 2\s*\);/,
    );
  });

  it("starts every compose row's ink on one text column", () => {
    const css = readFileSync(resolve("src/styles/ui.css"), "utf8");

    // One knob for the column itself, read by every row rather than restated
    // as a literal per row.
    expect(css).toMatch(
      /\.compose-dialog,\s*\.compose-page-shell\s*>\s*jant-compose-dialog\s*\{[\s\S]*--compose-gutter:\s*20px;/,
    );
    expect(css).toMatch(
      /@media \(min-width:\s*700px\)\s*\{[\s\S]*--compose-gutter:\s*24px;/,
    );
    // Zero wherever the indent already comes from outside the editor.
    expect(css).toMatch(
      /\.compose-editor-row\s*\{\s*\/\*[\s\S]*?\*\/\s*--compose-gutter:\s*0px;/,
    );

    for (const rule of [
      /\.compose-body\s*\{[^}]*padding:\s*16px 20px 12px var\(--compose-gutter\);/,
      /\.compose-tools-row\s*\{[\s\S]*padding:\s*6px 10px 6px var\(--compose-gutter\);/,
      /\.compose-attachments-dock\s*\{\s*padding:\s*8px 20px 4px var\(--compose-gutter\);/,
      /\.compose-thread-post-header\s*\{[\s\S]*padding:\s*10px 16px 2px var\(--compose-gutter\);/,
      /\.compose-add-thread-trigger\s*\{\s*padding:\s*1px 10px 4px var\(--compose-gutter\);/,
      /\.compose-action-row\s*\{\s*padding:\s*10px 12px 14px var\(--compose-gutter\);/,
    ]) {
      expect(css).toMatch(rule);
    }

    // Each control hangs its box back out of the column by its own optical
    // inset, so the glyph or the label lands on the edge and not the box.
    expect(css).toMatch(
      /\.compose-tools-row\s*\{[\s\S]*--compose-tool-hang:\s*12px;/,
    );
    expect(css).toMatch(
      /\.compose-tools-row > :first-child\s*\{\s*margin-inline-start:\s*calc\(-1 \* var\(--compose-tool-hang\)\);/,
    );
    expect(css).toMatch(
      /\.compose-thread-add-btn\s*\{[\s\S]*padding:\s*5px var\(--compose-add-hang\);\s*margin-inline-start:\s*calc\(-1 \* var\(--compose-add-hang\)\);/,
    );
    expect(css).toMatch(
      /\.compose-collection-select\s*\{[\s\S]*margin-inline-start:\s*calc\(\s*-1 \* \(var\(--compose-collection-pad-icon\) \+ 1px\)\s*\);/,
    );

    // The ad-hoc thread-only indents these replaced are gone — they were what
    // let each mode drift to its own edge in the first place.
    expect(css).not.toMatch(/margin-inline-start:\s*-10px;/);
    expect(css).not.toMatch(/\.compose-thread-layout \.compose-tools-row\s*\{/);
    // One "Add to thread" button, not two rule sets that have to stay in step.
    expect(css).not.toMatch(/\.compose-add-thread-btn/);
  });

  it("declares one marker vocabulary for the compose and reading rails", () => {
    const css = readFileSync(resolve("src/styles/ui.css"), "utf8");

    // Both rails draw the same dot; only the surface behind it differs.
    // `[^}]*` rather than `[\s\S]*` throughout: a greedy any-char run walks past
    // the rule's closing brace and happily matches a later rule's declaration.
    expect(css).toMatch(
      /\.thread-group,\s*\.compose-thread-layout\s*\{\s*--site-thread-marker-size:\s*7px;[^}]*--site-thread-marker-gap:\s*9px;/,
    );
    expect(css).toMatch(
      /\.compose-thread-layout\s*\{\s*--site-thread-marker-surface:\s*var\(--compose-paper-bg\);\s*\}/,
    );
    // 7:1.5 marker-to-rail on both, from one token — compose used to hardcode
    // its own 1.5px while reading ran a 1px hairline under the same 7px dot.
    expect(css).toMatch(/--site-thread-rail-line-width:\s*1\.5px;/);
    expect(css).not.toMatch(
      /\.thread-group-preview,\s*\.thread-group-detail\s*\{[^}]*--site-thread-rail-line-width:/,
    );
    expect(css).toMatch(
      /\.compose-thread-layout > \*::before\s*\{[^}]*width:\s*var\(--site-thread-rail-line-width\);\s*margin-left:\s*calc\(var\(--site-thread-rail-line-width\) \/ -2\);/,
    );
    // The reading rail's fade-in gradient stays — it softens where collapsed
    // ancestor context begins, which compose solves by trimming per row.
    expect(css).toMatch(
      /\.thread-group-preview::before,\s*\.thread-group-detail::before\s*\{\s*background:\s*linear-gradient\(/,
    );
    // Both rails now stop at the last dot. Reading masks its group-wide line
    // from that dot down; `> ` keeps the mask off the last ancestor inside
    // `.thread-context-shell`, which the rail must run straight through.
    expect(css).toMatch(
      /\.thread-group > \.thread-item:last-child::after\s*\{[^}]*top:\s*50%;\s*bottom:\s*0;\s*width:\s*var\(--site-thread-rail-line-width\);\s*background-color:\s*var\(--site-thread-marker-surface\);/,
    );
    expect(css).not.toMatch(/\.thread-group \.thread-item:last-child::after/);
    // The ring is reading's alone: the token is declared on `.thread-group`, and
    // compose's dot rule never reads it. The compose rail is quiet by design —
    // it already has a card edge, a format switcher and a "1/3" per row.
    expect(css).toMatch(
      /\.thread-group\s*\{[^}]*--site-thread-marker-ring-inset:\s*2px;\s*--site-thread-marker-ring-width:\s*2px;/,
    );
    expect(css).not.toMatch(
      /\.compose-thread-layout\s*\{[^}]*--site-thread-marker-ring/,
    );
    expect(css).not.toMatch(
      /\.compose-thread-dot::before\s*\{[^}]*--site-thread-(dot-ring|marker-ring)/,
    );
    // The per-dot border and the size-based hero markers stay gone: a border
    // eats into the fill instead of sitting outside it, and a bigger dot
    // repeats what the full card beside it already says.
    for (const dead of [
      "--site-thread-marker-border-width",
      "--site-thread-marker-hero-size",
      "--site-thread-marker-hero-border-width",
    ]) {
      expect(css).not.toContain(dead);
    }
    expect(css).not.toMatch(/\.compose-thread-dot(::before)?\s*\{[^}]*border:/);
  });

  it("punches the dot's gap with the surface colour on both rails", () => {
    const css = readFileSync(resolve("src/styles/ui.css"), "utf8");

    // Compose stops at the punch-out; reading layers its ring inside the same
    // radius, so the outermost layer — the one that breaks the rail line — is
    // still the gap at its full size on both rails.
    const punchOut =
      /0 0 0 var\(--site-thread-marker-gap\)\s*var\(--site-thread-marker-surface\);/;
    expect(css).toMatch(
      new RegExp(
        `\\.compose-thread-dot::before\\s*\\{[^}]*box-shadow:\\s*${punchOut.source}`,
      ),
    );
    expect(css).toMatch(
      new RegExp(`\\.thread-item::before\\s*\\{[^}]*${punchOut.source}`),
    );
    // Reading's ring: a band of surface, then the accent tint, both drawn as
    // spread inside the punch. A border would eat the fill instead.
    expect(css).toMatch(
      /\.thread-item::before\s*\{[^}]*box-shadow:\s*0 0 0 var\(--site-thread-marker-ring-inset\)\s*var\(--site-thread-marker-surface\),\s*0 0 0\s*calc\(\s*var\(--site-thread-marker-ring-inset\) \+\s*var\(--site-thread-marker-ring-width\)\s*\)\s*var\(--site-thread-dot-ring\),/,
    );
    expect(css).not.toMatch(/\.thread-item::before\s*\{[^}]*border:\s/);
  });

  it("marks the post a view is about with an accent fill, not a bigger dot", () => {
    const css = readFileSync(resolve("src/styles/ui.css"), "utf8");

    // Feed hero, curated highlight and the opened detail post share one rule,
    // matching compose's `.is-current`. Size is not a second signal.
    expect(css).toMatch(
      /\.thread-item-hero::before,\s*\.thread-item-curated::before,\s*\.thread-item-current::before\s*\{\s*background-color:\s*var\(--site-thread-marker-current\);\s*\}/,
    );
    // Both rails take the current-post colour from one token, and that token is
    // a tint — the raw accent made a 7px dot the loudest thing on the page.
    expect(css).toMatch(
      /\.compose-editor-row\.is-current \.compose-thread-dot::before\s*\{\s*background-color:\s*var\(--site-thread-marker-current\);/,
    );
    expect(css).toMatch(
      /--site-thread-marker-current:\s*color-mix\(\s*in srgb,\s*var\(--site-accent\) 90%,\s*var\(--site-threadline\)\s*\);/,
    );
    expect(css).not.toMatch(
      /\.thread-item-current::before\s*\{[^}]*var\(--site-accent\)[^-]/,
    );
    // Every dot's geometry now derives from the shared token.
    expect(css).toMatch(
      /\.thread-item::before\s*\{[^}]*width:\s*var\(--site-thread-marker-size\);/,
    );
    expect(css).not.toMatch(/\.thread-item::before\s*\{[^}]*width:\s*\d+px;/);
  });

  it("centres every rail child on the line by giving them a shared track", () => {
    const css = readFileSync(resolve("src/styles/ui.css"), "utf8");

    // The line's x is derived from the track, never from a dot's own size — a
    // hardcoded half-marker is what put the line down the dot's edge before.
    expect(css).toMatch(
      /--compose-thread-rail-left:\s*calc\(\s*var\(--compose-thread-padding-left\) \+ var\(--compose-thread-rail-width\) \/ 2\s*\);/,
    );
    expect(css).not.toMatch(/--compose-thread-rail-left:[^;]*\+ \d/);

    // Post dot: fills the track, centres the circle in it.
    expect(css).toMatch(
      /\.compose-thread-dot\s*\{[\s\S]*justify-content:\s*center;[\s\S]*width:\s*var\(--compose-thread-rail-width\);/,
    );
    // "Add to thread" placeholder: fills the track outright, so no offset.
    expect(css).toMatch(
      /\.compose-thread-add-dot\s*\{[\s\S]*width:\s*var\(--compose-thread-rail-width\);[\s\S]*height:\s*var\(--compose-thread-rail-width\);/,
    );
    expect(css).not.toMatch(/\.compose-thread-add-dot\s*\{[^}]*margin-left:/);
    // Reply meta hangs off the same track as the rows above it.
    expect(css).toMatch(
      /\.compose-reply-meta\s*\{[\s\S]*var\(--compose-thread-gap\) \+\s*var\(--compose-thread-rail-width\)/,
    );
  });

  it("accents the dot of the post holding the cursor, not every editor row", () => {
    const css = readFileSync(resolve("src/styles/ui.css"), "utf8");

    // Which selector carries the highlight — the colour itself is pinned by
    // "marks the post a view is about…", so this stays token-agnostic.
    expect(css).toMatch(
      /\.compose-editor-row\.is-current \.compose-thread-dot::before\s*\{\s*background-color:/,
    );
    // The old rule lit every post in a thread at once.
    expect(css).not.toMatch(
      /\.compose-editor-row \.compose-thread-dot\s*\{\s*background-color:/,
    );
  });

  it("moves the current-post marker as focus moves between thread posts", async () => {
    const el = await createElement();
    el._threadItems = [
      { id: "thread-1", format: "note" },
      { id: "thread-2", format: "note" },
      { id: "thread-3", format: "note" },
    ];
    await flushUpdates(el);

    const currentIndexes = () =>
      Array.from(el.querySelectorAll<HTMLElement>(".compose-thread-post"))
        .map((row, index) =>
          row.classList.contains("is-current") ? index : -1,
        )
        .filter((index) => index >= 0);

    // Exactly one at a time — the old rule accented all three.
    expect(currentIndexes()).toEqual([0]);

    const second = requireElement(
      el.querySelector<HTMLElement>(
        '.compose-thread-post[data-thread-index="1"]',
      ),
      "expected the second thread post",
    );
    second.dispatchEvent(new Event("focusin", { bubbles: true }));
    await flushUpdates(el);

    expect(currentIndexes()).toEqual([1]);
  });

  it("keeps passive footnote references quiet until the editor selects them", () => {
    const css = readFileSync(resolve("src/styles/ui.css"), "utf8");

    expect(css).toMatch(
      /\.compose-tiptap-body \.tiptap \.tiptap-footnote-reference\s*\{[^}]*color:\s*var\(--site-footnote-marker\);/,
    );
    expect(css).toMatch(
      /\.tiptap-footnote-reference\.ProseMirror-selectednode\s*\{[^}]*color:\s*var\(--site-accent\);[^}]*outline:\s*1px solid var\(--site-accent\);/,
    );
  });

  it("remove button clears attachment", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );

    const blob = new Blob(["fake-image"], { type: "image/png" });
    const file = new File([blob], "test.png", { type: "image/png" });
    const previewUrl = URL.createObjectURL(blob);

    editor._attachments = [
      {
        clientId: "test-id-1",
        file,
        previewUrl,
        status: "done",
        progress: null,
        mediaId: "media-1",
        alt: "",
        error: null,
        posterUrl: null,
        remoteUrl: null,
        summary: null,
        chars: null,
      },
    ];
    editor._attachmentOrder = ["test-id-1"];
    await editor.updateComplete;

    // Click remove button
    const removeBtn = requireElement(
      editor.querySelector<HTMLButtonElement>(".compose-attachment-remove"),
      "expected remove button",
    );
    removeBtn.click();
    await editor.updateComplete;

    // Attachment strip should be gone (no attachments)
    expect(editor.querySelector(".compose-attachments")).toBeNull();
    expect(editor._attachments.length).toBe(0);
  });

  it("alt panel opens and closes", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );

    const blob = new Blob(["fake-image"], { type: "image/png" });
    const file = new File([blob], "test.png", { type: "image/png" });
    const previewUrl = URL.createObjectURL(blob);

    editor._attachments = [
      {
        clientId: "test-id-1",
        file,
        previewUrl,
        status: "done",
        progress: null,
        mediaId: "media-1",
        alt: "",
        error: null,
        posterUrl: null,
        remoteUrl: null,
        summary: null,
        chars: null,
      },
    ];
    editor._attachmentOrder = ["test-id-1"];
    await editor.updateComplete;

    // Click ALT button
    const altBtn = requireElement(
      editor.querySelector<HTMLButtonElement>(".compose-attachment-alt"),
      "expected alt button",
    );
    altBtn.click();
    await editor.updateComplete;
    await el.updateComplete;

    // Alt panel should be visible in the dialog (covers entire dialog)
    expect(el.querySelector(".compose-alt-panel")).not.toBeNull();
    expect(editor._showAltPanel).toBe(true);

    // Click done to close
    const doneBtn = el.querySelector<HTMLButtonElement>(
      ".compose-alt-panel .compose-post-btn",
    );
    doneBtn?.click();
    await el.updateComplete;

    expect(editor._showAltPanel).toBe(true); // Editor still tracks its own state
    expect(el.querySelector(".compose-alt-panel")).toBeNull();

    URL.revokeObjectURL(previewUrl);
  });

  it("submit includes ordered attachment inputs from completed attachments", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );

    const blob = new Blob(["fake-image"], { type: "image/png" });
    const file = new File([blob], "test.png", { type: "image/png" });
    const previewUrl = URL.createObjectURL(blob);

    editor._attachments = [
      {
        clientId: "test-id-1",
        file,
        previewUrl,
        status: "done",
        progress: null,
        mediaId: "media-1",
        alt: "A test image",
        error: null,
        posterUrl: null,
        remoteUrl: null,
        summary: null,
        chars: null,
      },
    ];
    editor._attachmentOrder = ["test-id-1"];
    editor._bodyJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Post with image" }],
        },
      ],
    };
    await editor.updateComplete;

    let receivedDetail:
      | (ComposeSubmitDetail & { pendingAttachments: unknown[] })
      | null = null;
    el.addEventListener("jant:compose-submit-deferred", (event) => {
      const customEvent = event as CustomEvent<
        ComposeSubmitDetail & { pendingAttachments: unknown[] }
      >;
      receivedDetail = customEvent.detail;
    });

    requireElement(
      el.querySelector<HTMLButtonElement>(".compose-publish-main"),
      "expected post button",
    ).click();

    expect(receivedDetail).not.toBeNull();
    const detail = receivedDetail as unknown as ComposeSubmitDetail & {
      pendingAttachments: unknown[];
    };
    expect(detail.attachments).toEqual([
      {
        type: "media",
        clientId: "test-id-1",
        mediaId: "media-1",
        alt: "A test image",
      },
    ]);
    expect(detail.pendingAttachments).toEqual([]);

    URL.revokeObjectURL(previewUrl);
  });

  it("dispatches deferred submit when uploads are pending", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );

    const blob = new Blob(["fake-image"], { type: "image/png" });
    const file = new File([blob], "test.png", { type: "image/png" });
    const previewUrl = URL.createObjectURL(blob);

    editor._attachments = [
      {
        clientId: "test-id-1",
        file,
        previewUrl,
        status: "uploading",
        progress: null,
        mediaId: null,
        alt: "Alt for pending",
        error: null,
        posterUrl: null,
        remoteUrl: null,
        summary: null,
        chars: null,
      },
    ];
    editor._bodyJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Post with pending upload" }],
        },
      ],
    };
    await editor.updateComplete;

    let deferredEvent: CustomEvent | null = null;
    el.addEventListener("jant:compose-submit-deferred", (event) => {
      deferredEvent = event as CustomEvent;
    });

    requireElement(
      el.querySelector<HTMLButtonElement>(".compose-publish-main"),
      "expected post button",
    ).click();

    expect(deferredEvent).not.toBeNull();
    expect(
      (deferredEvent as unknown as CustomEvent).detail.pendingAttachments,
    ).toHaveLength(1);

    URL.revokeObjectURL(previewUrl);
  });

  it("dispatches submit immediately even with pending inline image uploads", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );

    const bodyJson = {
      type: "doc",
      content: [
        {
          type: "image",
          attrs: {
            src: "blob:inline-preview",
            alt: "",
            title: "",
            caption: "",
          },
        },
      ],
    };
    editor._bodyJson = bodyJson;
    await editor.updateComplete;

    let receivedDetail: ComposeSubmitDetail | null = null;
    el.addEventListener("jant:compose-submit-deferred", (event) => {
      receivedDetail = (event as CustomEvent<ComposeSubmitDetail>).detail;
    });

    requireElement(
      el.querySelector<HTMLButtonElement>(".compose-publish-main"),
      "expected post button",
    ).click();
    await flushUpdates(el);

    // Submit fires immediately — blob URL resolution is handled by compose-bridge
    expect(receivedDetail).not.toBeNull();
    expect((receivedDetail as unknown as ComposeSubmitDetail).body).toBe(
      JSON.stringify(bodyJson),
    );
  });

  // ── Leaving compose ────────────────────────────────────────────────

  it("names the dialog for assistive tech now that no title is drawn", async () => {
    // The visible title carried the dialog's accessible name; it moves to an
    // attribute rather than disappearing with the row.
    const dialog = document.createElement("dialog");
    document.body.appendChild(dialog);
    const el = document.createElement(
      "jant-compose-dialog",
    ) as JantComposeDialog;
    el.collections = collections;
    el.labels = labels;
    dialog.appendChild(el);
    await flushUpdates(el);

    expect(dialog.getAttribute("aria-label")).toBe(labels.composeDialogLabel);

    // Tear the dialog down here: happy-dom throws when `body.innerHTML = ""`
    // in the shared beforeEach removes one it did not itself create.
    el.remove();
    dialog.remove();
  });

  it("closes from the × in the post header row", async () => {
    const el = await createElement();
    await flushUpdates(el);
    const requestCloseSpy = vi.spyOn(el, "requestClose");

    const closeBtn = requireElement(
      el.querySelector<HTMLButtonElement>(
        ".compose-thread-post-header .compose-close-btn",
      ),
      "expected close button in the post header",
    );
    expect(closeBtn.getAttribute("aria-label")).toBe(labels.cancel);

    closeBtn.click();
    await flushUpdates(el);

    expect(requestCloseSpy).toHaveBeenCalledTimes(1);
  });

  it("hands the header slot back to per-post remove in a thread, and moves the exit into the options panel", async () => {
    const el = await createElement();
    el._threadItems = [
      { id: "thread-1", format: "note" },
      { id: "thread-2", format: "note" },
    ];
    await flushUpdates(el);

    // Each post owns its × for removing itself, so no close button competes.
    expect(el.querySelector(".compose-close-btn")).toBeNull();
    expect(
      el.querySelectorAll(".compose-thread-post-remove").length,
    ).toBeGreaterThan(0);

    await openPublishPanel(el);
    const closeRow = requireElement(
      Array.from(
        el.querySelectorAll<HTMLButtonElement>(
          ".compose-publish-panel .compose-sheet-row",
        ),
      ).find(
        (row) =>
          row.querySelector(".compose-sheet-title")?.textContent?.trim() ===
          labels.closeCompose,
      ) ?? null,
      "expected a close row in the options panel",
    );

    const requestCloseSpy = vi.spyOn(el, "requestClose");
    closeRow.click();
    await flushUpdates(el);

    expect(el._showPublishPanel).toBe(false);
    expect(requestCloseSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps the exit out of the options panel when the × already offers one", async () => {
    const el = await createElement();
    await openPublishPanel(el);

    const titles = Array.from(
      el.querySelectorAll<HTMLElement>(
        ".compose-publish-panel .compose-sheet-title",
      ),
    ).map((n) => n.textContent?.trim());

    expect(titles).not.toContain(labels.closeCompose);
    expect(titles).toContain("Drafts");
  });

  it("requestClose on empty form closes immediately without confirmation", async () => {
    const el = await createElement();

    // Ensure no confirmation panel appears
    el.requestClose();
    await el.updateComplete;

    expect(el._confirmPanelOpen).toBe(false);
    expect(el.querySelector(".compose-confirm-panel")).toBeNull();
  });

  it("requestClose on empty form clears opener focus after closing", async () => {
    const el = await createElement();
    const trigger = document.createElement("button");
    trigger.type = "button";
    document.body.appendChild(trigger);

    const dialog = document.createElement("dialog");
    const closeSpy = vi.spyOn(dialog, "close");
    const closestSpy = vi
      .spyOn(el, "closest")
      .mockImplementation((selector: string) =>
        selector === "dialog"
          ? dialog
          : HTMLElement.prototype.closest.call(el, selector),
      );

    trigger.focus();
    const blurSpy = vi.spyOn(trigger, "blur");

    el.requestClose();
    await el.updateComplete;

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(blurSpy).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(trigger);

    closestSpy.mockRestore();
  });

  it("treats dialog backdrop clicks as close requests", async () => {
    const el = await createElement();
    const dialog = document.createElement("dialog");
    const requestCloseSpy = vi.spyOn(el, "requestClose");
    (
      el as unknown as {
        _dialogEl: HTMLDialogElement | null;
        _mousedownOnBackdrop: boolean;
        _handleDialogClick: (event: Event) => void;
      }
    )._dialogEl = dialog;
    (el as unknown as { _mousedownOnBackdrop: boolean })._mousedownOnBackdrop =
      true;
    vi.spyOn(document, "elementFromPoint").mockReturnValue(dialog);

    (
      el as unknown as {
        _handleDialogClick: (event: Event) => void;
      }
    )._handleDialogClick({
      target: dialog,
      clientX: 24,
      clientY: 24,
    } as unknown as Event);

    expect(requestCloseSpy).toHaveBeenCalledTimes(1);
  });

  it("ignores backdrop clicks that actually land on editor floating UI", async () => {
    const el = await createElement();
    const dialog = document.createElement("dialog");
    const requestCloseSpy = vi.spyOn(el, "requestClose");
    const floatingUi = document.createElement("div");
    floatingUi.setAttribute("data-editor-floating-ui", "true");
    (
      el as unknown as {
        _dialogEl: HTMLDialogElement | null;
        _handleDialogClick: (event: Event) => void;
      }
    )._dialogEl = dialog;
    vi.spyOn(document, "elementFromPoint").mockReturnValue(floatingUi);

    (
      el as unknown as {
        _handleDialogClick: (event: Event) => void;
      }
    )._handleDialogClick({
      target: dialog,
      clientX: 24,
      clientY: 24,
    } as unknown as Event);

    expect(requestCloseSpy).not.toHaveBeenCalled();
  });

  it("beforeunload does not warn when dialog was only opened", async () => {
    const el = await createElement();
    vi.spyOn(el, "closest").mockReturnValue({
      open: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLDialogElement);

    const event = new Event("beforeunload", {
      cancelable: true,
    }) as globalThis.BeforeUnloadEvent;

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(
      (
        el as unknown as { _hasUnsavedChanges: () => boolean }
      )._hasUnsavedChanges(),
    ).toBe(false);
  });

  it("beforeunload does not warn after switching to link without entering content", async () => {
    const el = await createElement();
    vi.spyOn(el, "closest").mockReturnValue({
      open: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLDialogElement);

    el._format = "link";
    await flushUpdates(el);

    const event = new Event("beforeunload", {
      cancelable: true,
    }) as globalThis.BeforeUnloadEvent;

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(
      (
        el as unknown as { _hasUnsavedChanges: () => boolean }
      )._hasUnsavedChanges(),
    ).toBe(false);
  });

  it("beforeunload does not warn after switching to quote without entering content", async () => {
    const el = await createElement();
    vi.spyOn(el, "closest").mockReturnValue({
      open: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLDialogElement);

    el._format = "quote";
    await flushUpdates(el);

    const event = new Event("beforeunload", {
      cancelable: true,
    }) as globalThis.BeforeUnloadEvent;

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(
      (
        el as unknown as { _hasUnsavedChanges: () => boolean }
      )._hasUnsavedChanges(),
    ).toBe(false);
  });

  it("ignores empty attached text placeholders when checking unsaved changes", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );

    editor._attachedTexts = [
      {
        clientId: "t1",
        bodyJson: null,
        bodyHtml: "",
        summary: "",
      },
    ];
    editor._attachmentOrder = ["t1"];
    await editor.updateComplete;

    expect(
      (
        el as unknown as { _hasUnsavedChanges: () => boolean }
      )._hasUnsavedChanges(),
    ).toBe(false);
  });

  it("beforeunload warns after compose content changes", async () => {
    const el = await createElement();
    vi.spyOn(el, "closest").mockReturnValue({
      open: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLDialogElement);
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );

    editor._bodyJson = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Unsaved" }] },
      ],
    };
    await editor.updateComplete;

    const event = new Event("beforeunload", {
      cancelable: true,
    }) as globalThis.BeforeUnloadEvent;

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("ignores native dialog cancel right after file picker cancel", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );

    editor.dispatchEvent(
      new CustomEvent("jant:file-picker-open", {
        bubbles: true,
        composed: true,
      }),
    );
    editor.dispatchEvent(
      new CustomEvent("jant:file-picker-close", {
        bubbles: true,
        composed: true,
        detail: { cancelled: true },
      }),
    );

    const requestCloseSpy = vi.spyOn(el, "requestClose");
    const cancelEvent = new Event("cancel", {
      cancelable: true,
    });

    (
      el as unknown as {
        _handleDialogCancel: (event: Event) => void;
      }
    )._handleDialogCancel(cancelEvent);

    expect(cancelEvent.defaultPrevented).toBe(true);
    expect(requestCloseSpy).not.toHaveBeenCalled();
  });

  it("ignores Escape right after file picker cancel", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    editor._bodyJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Keep open" }],
        },
      ],
    };
    await editor.updateComplete;

    editor.dispatchEvent(
      new CustomEvent("jant:file-picker-open", {
        bubbles: true,
        composed: true,
      }),
    );
    editor.dispatchEvent(
      new CustomEvent("jant:file-picker-close", {
        bubbles: true,
        composed: true,
        detail: { cancelled: true },
      }),
    );

    el.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
      }),
    );
    await el.updateComplete;

    expect(el._confirmPanelOpen).toBe(false);
  });

  it("ignores Escape while an IME is composing (e.g. CJK candidate popup)", async () => {
    // Regression test for GitHub issue #120: when a user types pinyin and
    // presses Escape to dismiss the IME candidate popup, the compose dialog
    // must not interpret it as a close request.
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    editor._bodyJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "已经写了一些内容" }],
        },
      ],
    };
    await editor.updateComplete;

    const requestCloseSpy = vi.spyOn(el, "requestClose");
    el.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", {
        key: "Escape",
        isComposing: true,
        bubbles: true,
      }),
    );
    await el.updateComplete;

    expect(requestCloseSpy).not.toHaveBeenCalled();
    expect(el._confirmPanelOpen).toBe(false);

    // Sanity: once composition ends, Escape works as before.
    el.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
      }),
    );
    await el.updateComplete;
    expect(requestCloseSpy).toHaveBeenCalledTimes(1);
  });

  it("still closes normally after file picker selection", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    editor._bodyJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Close after selecting" }],
        },
      ],
    };
    await editor.updateComplete;

    editor.dispatchEvent(
      new CustomEvent("jant:file-picker-open", {
        bubbles: true,
        composed: true,
      }),
    );
    editor.dispatchEvent(
      new CustomEvent("jant:file-picker-close", {
        bubbles: true,
        composed: true,
        detail: { cancelled: false },
      }),
    );

    el.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
      }),
    );
    await el.updateComplete;

    expect(el._confirmPanelOpen).toBe(true);
  });

  it("clears file picker Escape suppression after pointer interaction", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    editor._bodyJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Close after clicking back" }],
        },
      ],
    };
    await editor.updateComplete;

    editor.dispatchEvent(
      new CustomEvent("jant:file-picker-open", {
        bubbles: true,
        composed: true,
      }),
    );
    editor.dispatchEvent(
      new CustomEvent("jant:file-picker-close", {
        bubbles: true,
        composed: true,
        detail: { cancelled: true },
      }),
    );

    el.dispatchEvent(
      new globalThis.PointerEvent("pointerdown", {
        bubbles: true,
      }),
    );
    el.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
      }),
    );
    await el.updateComplete;

    expect(el._confirmPanelOpen).toBe(true);
  });

  it("clears file picker Escape suppression after non-Escape key input", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    editor._bodyJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Close after typing again" }],
        },
      ],
    };
    await editor.updateComplete;

    editor.dispatchEvent(
      new CustomEvent("jant:file-picker-open", {
        bubbles: true,
        composed: true,
      }),
    );
    editor.dispatchEvent(
      new CustomEvent("jant:file-picker-close", {
        bubbles: true,
        composed: true,
        detail: { cancelled: true },
      }),
    );

    el.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", {
        key: "a",
        bubbles: true,
      }),
    );
    el.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
      }),
    );
    await el.updateComplete;

    expect(el._confirmPanelOpen).toBe(true);
  });

  it("Escape cancels slash commands without opening the close confirmation", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    const tiptap = requireEditor(editor);

    tiptap.commands.focus("end");
    tiptap.commands.insertContent("/");
    await flushUpdates(el);

    expect(document.querySelector(".tiptap-slash-menu")).not.toBeNull();

    const requestCloseSpy = vi.spyOn(el, "requestClose");
    const escapeEvent = new globalThis.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    tiptap.view.dom.dispatchEvent(escapeEvent);
    await flushUpdates(el);

    expect(escapeEvent.defaultPrevented).toBe(true);
    expect(requestCloseSpy).not.toHaveBeenCalled();
    expect(el._confirmPanelOpen).toBe(false);
    expect(document.querySelector(".tiptap-slash-menu")).toBeNull();
    expect(tiptap.getText()).toBe("");
  });

  it("Escape cancels the table size picker without closing compose", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    const tiptap = requireEditor(editor);

    tiptap.commands.focus("end");
    tiptap.commands.insertContent("/tab");
    await flushUpdates(el);

    const tableItem = Array.from(
      document.querySelectorAll<HTMLElement>(".tiptap-slash-item"),
    ).find((item) => item.textContent?.includes("Table"));
    requireElement(
      tableItem ?? null,
      "expected Table slash item",
    ).dispatchEvent(
      new globalThis.MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
      }),
    );
    await vi.waitFor(() => {
      expect(
        document.querySelector(".tiptap-table-size-picker"),
      ).not.toBeNull();
    });

    const requestCloseSpy = vi.spyOn(el, "requestClose");
    const currentSize = requireElement(
      document.querySelector<HTMLButtonElement>(
        ".tiptap-table-size-cell.is-current",
      ),
      "expected current table size",
    );
    const escapeEvent = new globalThis.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    currentSize.dispatchEvent(escapeEvent);
    await flushUpdates(el);

    expect(escapeEvent.defaultPrevented).toBe(true);
    expect(requestCloseSpy).not.toHaveBeenCalled();
    expect(document.querySelector(".tiptap-table-size-picker")).toBeNull();
    expect(tiptap.getText()).toBe("");
  });

  it("shows a clear empty state when slash commands have no matches", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    const tiptap = requireEditor(editor);

    tiptap.commands.focus("end");
    tiptap.commands.insertContent("/zzz");
    await flushUpdates(el);

    const menu = requireElement(
      document.querySelector<HTMLElement>(".tiptap-slash-menu"),
      "expected slash menu",
    );
    expect(menu.querySelectorAll(".tiptap-slash-item")).toHaveLength(0);
    expect(
      requireElement(
        menu.querySelector<HTMLElement>(".tiptap-slash-empty"),
        "expected slash empty state",
      ).textContent,
    ).toContain("No matches. Try another command.");

    const requestCloseSpy = vi.spyOn(el, "requestClose");
    const enterEvent = new globalThis.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    tiptap.view.dom.dispatchEvent(enterEvent);
    await flushUpdates(el);

    expect(enterEvent.defaultPrevented).toBe(true);
    expect(requestCloseSpy).not.toHaveBeenCalled();
    expect(el._confirmPanelOpen).toBe(false);
    expect(tiptap.getText()).toBe("/zzz");
  });

  it("does not open the slash menu when the caret sits inside a `/word` in prose", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    const tiptap = requireEditor(editor);

    tiptap.commands.focus("end");
    tiptap.commands.insertContent("before /now, after");
    await flushUpdates(el);

    // Move the caret into the middle of "now" (between "/" and "n").
    const text = tiptap.getText();
    const slashIndex = text.indexOf("/now");
    // +2 accounts for the doc/paragraph boundary before the text starts.
    tiptap.commands.setTextSelection(slashIndex + 2);
    await flushUpdates(el);

    expect(document.querySelector(".tiptap-slash-menu")).toBeNull();
  });

  it("does not reopen the slash menu when the caret moves back to an existing `/word`", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    const tiptap = requireEditor(editor);

    // Type "/image " followed by more text, then press Escape to close the
    // menu that (rightly) opened while typing "/image".
    tiptap.commands.focus("end");
    tiptap.commands.insertContent("/image hello");
    await flushUpdates(el);

    // Menu should be gone because the space after "/image" closed it.
    expect(document.querySelector(".tiptap-slash-menu")).toBeNull();

    // Now move the caret back to just after "/image" (between "e" and " ").
    const text = tiptap.getText();
    const endOfImage = text.indexOf("/image") + "/image".length;
    tiptap.commands.setTextSelection(endOfImage + 1);
    await flushUpdates(el);

    // Selection-only change should NOT reopen the menu.
    expect(document.querySelector(".tiptap-slash-menu")).toBeNull();
  });

  it("dialog cancel closes the emoji picker before prompting to save", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    editor._bodyJson = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Keep typing" }] },
      ],
    };
    editor._showEmojiPicker = true;
    await editor.updateComplete;

    const closeEmojiPickerSpy = vi.spyOn(editor, "closeEmojiPicker");
    const focusSpy = vi.spyOn(editor, "focusSelection");

    (
      el as unknown as {
        _handleDialogCancel: (event: Event) => void;
      }
    )._handleDialogCancel(new Event("cancel", { cancelable: true }));
    await flushUpdates(el);

    expect(closeEmojiPickerSpy).toHaveBeenCalledWith({ restoreFocus: true });
    expect(el._confirmPanelOpen).toBe(false);
    expect(focusSpy).toHaveBeenCalled();
  });

  it("dialog cancel closes the collection selector and keeps selected collections", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    editor._bodyJson = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Tagged post" }] },
      ],
    };
    el._showCollection = true;
    el._collectionIds = ["col-1"];
    await editor.updateComplete;

    const focusSpy = vi.spyOn(editor, "focusInput");

    (
      el as unknown as {
        _handleDialogCancel: (event: Event) => void;
      }
    )._handleDialogCancel(new Event("cancel", { cancelable: true }));
    await flushUpdates(el);

    expect(el._showCollection).toBe(false);
    expect(el._collectionIds).toEqual(["col-1"]);
    expect(el._confirmPanelOpen).toBe(false);
    expect(focusSpy).toHaveBeenCalledWith();
  });

  it("dialog cancel closes publish settings and returns focus to the editor", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    editor._bodyJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Publish panel content" }],
        },
      ],
    };
    el._showPublishPanel = true;
    await editor.updateComplete;

    const focusSpy = vi.spyOn(editor, "focusInput");

    (
      el as unknown as {
        _handleDialogCancel: (event: Event) => void;
      }
    )._handleDialogCancel(new Event("cancel", { cancelable: true }));
    await flushUpdates(el);

    expect(el._showPublishPanel).toBe(false);
    expect(el._confirmPanelOpen).toBe(false);
    expect(focusSpy).toHaveBeenCalledWith();
  });

  it("requestClose with content shows confirmation panel", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    editor._bodyJson = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Some text" }] },
      ],
    };
    await editor.updateComplete;

    el.requestClose();
    await el.updateComplete;

    expect(el._confirmPanelOpen).toBe(true);
    expect(el.querySelector(".compose-confirm-panel")).not.toBeNull();
    expect(
      el.querySelector(".compose-confirm-title")?.textContent?.trim(),
    ).toBe("Save to drafts?");
  });

  it("Cmd/Ctrl+Enter publishes from the main compose editor", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    editor._bodyJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Publish from shortcut" }],
        },
      ],
    };
    await editor.updateComplete;

    const submitSpy = vi
      .spyOn(
        el as unknown as { _submit: (status: "published" | "draft") => void },
        "_submit",
      )
      .mockImplementation(() => {});

    el.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", {
        key: "Enter",
        metaKey: true,
        bubbles: true,
      }),
    );

    expect(submitSpy).toHaveBeenCalledWith("published");
  });

  it("publishes the latest fullscreen content after handing it back", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    const submitSpy = vi
      .spyOn(
        el as unknown as { _submit: (status: "published" | "draft") => void },
        "_submit",
      )
      .mockImplementation(() => {});
    const setEditorStateSpy = vi.spyOn(editor, "setEditorState");

    (
      el as unknown as {
        _handleFullscreenClose: (
          event: CustomEvent<ComposeFullscreenCloseDetail>,
        ) => void;
      }
    )._handleFullscreenClose(
      new CustomEvent<ComposeFullscreenCloseDetail>("jant:fullscreen-close", {
        detail: {
          json: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Written while fullscreen" }],
              },
            ],
          },
          title: "Fullscreen title",
          showTitle: true,
          replyExpanded: false,
          intent: "publish",
          editorIndex: 0,
        },
      }),
    );

    expect(setEditorStateSpy).toHaveBeenCalled();
    expect(editor.getData()).toMatchObject({
      title: "Fullscreen title",
      body: expect.stringContaining("Written while fullscreen"),
    });
    expect(submitSpy).toHaveBeenCalledWith("published");
  });

  it("does not submit an empty fullscreen post", async () => {
    const el = await createElement();
    const submitSpy = vi.spyOn(
      el as unknown as { _submit: (status: "published" | "draft") => void },
      "_submit",
    );

    (
      el as unknown as {
        _handleFullscreenClose: (
          event: CustomEvent<ComposeFullscreenCloseDetail>,
        ) => void;
      }
    )._handleFullscreenClose(
      new CustomEvent<ComposeFullscreenCloseDetail>("jant:fullscreen-close", {
        detail: {
          json: { type: "doc", content: [{ type: "paragraph" }] },
          title: "",
          showTitle: false,
          replyExpanded: false,
          intent: "publish",
          editorIndex: 0,
        },
      }),
    );

    expect(submitSpy).not.toHaveBeenCalled();
  });

  it("tracks the source editor for fullscreen thread editing", async () => {
    const el = await createElement();
    el._threadItems = [
      { id: "thread-1", format: "note" },
      { id: "thread-2", format: "note" },
    ];
    await el.updateComplete;

    const editors = Array.from(
      el.querySelectorAll<JantComposeEditor>("jant-compose-editor"),
    );
    const openDetail: ComposeFullscreenOpenDetail = {
      json: null,
      title: "",
      showTitle: false,
    };
    editors[1]?.dispatchEvent(
      new CustomEvent<ComposeFullscreenOpenDetail>("jant:fullscreen-open", {
        bubbles: true,
        detail: openDetail,
      }),
    );

    expect(openDetail).toMatchObject({ editorIndex: 1 });

    (
      el as unknown as {
        _handleFullscreenClose: (
          event: CustomEvent<ComposeFullscreenCloseDetail>,
        ) => void;
      }
    )._handleFullscreenClose(
      new CustomEvent<ComposeFullscreenCloseDetail>("jant:fullscreen-close", {
        detail: {
          json: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Second thread post" }],
              },
            ],
          },
          title: "",
          showTitle: false,
          replyExpanded: false,
          editorIndex: 1,
        },
      }),
    );

    expect(editors[0]?.getData().body).toBe("");
    expect(editors[1]?.getData().body).toContain("Second thread post");
  });

  it("Cmd/Ctrl+Enter focuses the link URL when the URL is invalid", async () => {
    const el = await createElement();
    el._format = "link";
    await el.updateComplete;

    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    editor._url = "example.com";
    await editor.updateComplete;

    const focusUrlSpy = vi.spyOn(editor, "focusUrlInput");
    const submitSpy = vi.spyOn(
      el as unknown as { _submit: (status: "published" | "draft") => void },
      "_submit",
    );

    el.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", {
        key: "Enter",
        metaKey: true,
        bubbles: true,
      }),
    );

    expect(focusUrlSpy).toHaveBeenCalledWith("end");
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it("blocks publish for link posts without showing a title error on blur", async () => {
    const el = await createElement();
    el._format = "link";
    await el.updateComplete;

    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    editor._url = "https://example.com";
    await editor.updateComplete;

    expect(
      requireElement(
        el.querySelector<HTMLButtonElement>(".compose-publish-main"),
        "expected publish button",
      ).disabled,
    ).toBe(true);

    const titleInput = requireElement(
      el.querySelector<HTMLInputElement>(".compose-link-title"),
      "expected link title input",
    );
    titleInput.dispatchEvent(new Event("blur"));
    await el.updateComplete;

    expect(el.querySelector("[data-compose-link-title-error]")).toBeNull();
  });

  it("Cmd/Ctrl+Enter finishes an attached text editor instead of publishing", async () => {
    const el = await createElement();
    (
      el as unknown as {
        _attachedPanelOpen: boolean;
      }
    )._attachedPanelOpen = true;

    const doneSpy = vi.spyOn(
      el as unknown as { _doneAttachedPanel: () => void },
      "_doneAttachedPanel",
    );
    const submitSpy = vi.spyOn(
      el as unknown as { _submit: (status: "published" | "draft") => void },
      "_submit",
    );

    el.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", {
        key: "Enter",
        metaKey: true,
        bubbles: true,
      }),
    );

    expect(doneSpy).toHaveBeenCalled();
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it("cancelling an empty attached text editor discards it without confirmation", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );

    editor._attachedTexts = [
      {
        clientId: "t1",
        bodyJson: null,
        bodyHtml: "",
        summary: "",
      },
    ];
    editor._attachmentOrder = ["t1"];
    await editor.updateComplete;

    (
      el as unknown as {
        _attachedTextIndex: number;
        _attachedPanelOpen: boolean;
        _attachedEditor: { getJSON(): unknown; destroy(): void } | null;
        _attachedTextSnapshot: unknown;
        _cancelAttachedPanel: () => Promise<void>;
      }
    )._attachedTextIndex = 0;
    (
      el as unknown as {
        _attachedPanelOpen: boolean;
      }
    )._attachedPanelOpen = true;
    (
      el as unknown as {
        _attachedEditor: { getJSON(): unknown; destroy(): void } | null;
      }
    )._attachedEditor = {
      getJSON: () => ({
        type: "doc",
        content: [{ type: "paragraph" }],
      }),
      destroy: vi.fn(),
    };
    (
      el as unknown as {
        _attachedTextSnapshot: unknown;
      }
    )._attachedTextSnapshot = null;

    await (
      el as unknown as {
        _cancelAttachedPanel: () => Promise<void>;
      }
    )._cancelAttachedPanel();

    expect(el._attachedPanelOpen).toBe(false);
    expect(editor._attachedTexts).toEqual([]);
    expect(editor._attachmentOrder).toEqual([]);
  });

  it("reopening an attached text editor places the cursor at the end", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );

    editor._attachedTexts = [
      {
        clientId: "t1",
        bodyJson: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Existing attachment body" }],
            },
          ],
        },
        bodyHtml: "<p>Existing attachment body</p>",
        summary: "Existing attachment body",
      },
    ];
    editor._attachmentOrder = ["t1"];
    await editor.updateComplete;

    (
      el as unknown as {
        _handleAttachedPanelOpen: (event: Event) => void;
      }
    )._handleAttachedPanelOpen(
      new CustomEvent("jant:attached-panel-open", {
        detail: { index: 0 },
      }),
    );
    await flushUpdates(el);

    const attachedEditor = (
      el as unknown as {
        _attachedEditor: {
          state: {
            selection: { from: number; to: number };
          };
        } | null;
      }
    )._attachedEditor;
    if (!attachedEditor) {
      throw new Error("expected attached editor instance");
    }

    expect(attachedEditor.state.selection.from).toBeGreaterThan(1);
    expect(attachedEditor.state.selection.from).toBe(
      attachedEditor.state.selection.to,
    );
  });

  it("cancelling a dirty attached text editor uses the shared three-action confirm panel", async () => {
    const el = await createElement();

    (
      el as unknown as {
        _attachedTextIndex: number;
        _attachedPanelOpen: boolean;
        _attachedEditor: {
          commands: { focus: () => void };
          destroy(): void;
          getJSON(): unknown;
        } | null;
        _attachedTextSnapshot: unknown;
        _cancelAttachedPanel: () => void;
      }
    )._attachedTextIndex = 0;
    (
      el as unknown as {
        _attachedPanelOpen: boolean;
      }
    )._attachedPanelOpen = true;
    (
      el as unknown as {
        _attachedEditor: {
          commands: { focus: () => void };
          destroy(): void;
          getJSON(): unknown;
        } | null;
      }
    )._attachedEditor = {
      commands: { focus: vi.fn() },
      destroy: vi.fn(),
      getJSON: () => ({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Changed attachment" }],
          },
        ],
      }),
    };
    (
      el as unknown as {
        _attachedTextSnapshot: unknown;
      }
    )._attachedTextSnapshot = null;

    (
      el as unknown as {
        _cancelAttachedPanel: () => void;
      }
    )._cancelAttachedPanel();
    await el.updateComplete;

    expect(el._confirmPanelOpen).toBe(true);
    expect(el.querySelector(".compose-confirm-panel")).not.toBeNull();
    expect(
      el.querySelector(".compose-confirm-title")?.textContent?.trim(),
    ).toBe("Save text attachment?");
    expect(el.querySelector(".compose-confirm-save")?.textContent?.trim()).toBe(
      "Save",
    );
    expect(
      el.querySelector(".compose-confirm-discard")?.textContent?.trim(),
    ).toBe("Don't save");
    expect(
      el.querySelector(".compose-confirm-cancel")?.textContent?.trim(),
    ).toBe("Cancel");
  });

  it("cancel on attached text confirm returns focus to the attached editor", async () => {
    const el = await createElement();
    const focusSpy = vi.fn();

    (
      el as unknown as {
        _attachedPanelOpen: boolean;
        _confirmPanelOpen: boolean;
        _confirmForAttachedText: boolean;
        _attachedEditor: {
          commands: { focus: () => void };
          destroy(): void;
        } | null;
      }
    )._attachedPanelOpen = true;
    (
      el as unknown as {
        _confirmPanelOpen: boolean;
        _confirmForAttachedText: boolean;
        _attachedEditor: {
          commands: { focus: () => void };
          destroy(): void;
        } | null;
      }
    )._confirmPanelOpen = true;
    (
      el as unknown as {
        _confirmForAttachedText: boolean;
        _attachedEditor: {
          commands: { focus: () => void };
          destroy(): void;
        } | null;
      }
    )._confirmForAttachedText = true;
    (
      el as unknown as {
        _attachedEditor: {
          commands: { focus: () => void };
          destroy(): void;
        } | null;
      }
    )._attachedEditor = {
      commands: { focus: focusSpy },
      destroy: vi.fn(),
    };

    el.requestClose();
    await el.updateComplete;
    await flushUpdates(el);

    expect(el._confirmPanelOpen).toBe(false);
    expect(focusSpy).toHaveBeenCalled();
  });

  it("clicking the empty attached editor area focuses the attached editor", async () => {
    const el = await createElement();
    const focusSpy = vi.fn();

    (
      el as unknown as {
        _attachedPanelOpen: boolean;
        _attachedEditor: {
          commands: { focus: () => void };
          destroy(): void;
          getJSON(): unknown;
        } | null;
      }
    )._attachedPanelOpen = true;
    (
      el as unknown as {
        _attachedEditor: {
          commands: { focus: () => void };
          destroy(): void;
          getJSON(): unknown;
        } | null;
      }
    )._attachedEditor = {
      commands: { focus: focusSpy },
      destroy: vi.fn(),
      getJSON: () => ({
        type: "doc",
        content: [{ type: "paragraph" }],
      }),
    };
    await el.updateComplete;

    const container = requireElement(
      el.querySelector<HTMLElement>(".compose-attached-tiptap"),
      "expected attached editor container",
    );
    container.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
      }),
    );

    expect(focusSpy).toHaveBeenCalled();
  });

  it("confirm save draft dispatches submit-deferred with draft status", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    editor._bodyJson = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Draft me" }] },
      ],
    };
    await editor.updateComplete;

    el.requestClose();
    await el.updateComplete;

    let receivedDetail: ComposeSubmitDetail | null = null;
    el.addEventListener("jant:compose-submit-deferred", (event) => {
      receivedDetail = (event as CustomEvent<ComposeSubmitDetail>).detail;
    });

    const saveBtn = requireElement(
      el.querySelector<HTMLButtonElement>(".compose-confirm-save"),
      "expected save draft button",
    );
    saveBtn.click();
    await el.updateComplete;

    expect(receivedDetail).not.toBeNull();
    expect((receivedDetail as unknown as ComposeSubmitDetail).status).toBe(
      "draft",
    );
    expect(el._confirmPanelOpen).toBe(false);
  });

  it("confirm cancel returns to editor without closing", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    editor._bodyJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Keep editing" }],
        },
      ],
    };
    await editor.updateComplete;

    el.requestClose();
    await el.updateComplete;

    expect(el._confirmPanelOpen).toBe(true);

    const cancelBtn = requireElement(
      el.querySelector<HTMLButtonElement>(".compose-confirm-cancel"),
      "expected cancel button",
    );
    const focusSpy = vi.spyOn(editor, "focusInput");
    cancelBtn.click();
    await el.updateComplete;

    expect(el._confirmPanelOpen).toBe(false);
    expect(focusSpy).toHaveBeenCalled();
    // Editor content should be preserved
    expect(editor._bodyJson).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Keep editing" }],
        },
      ],
    });
  });

  it("requestClose on confirm panel dismisses it (Escape = Cancel)", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    editor._bodyJson = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Esc test" }] },
      ],
    };
    await editor.updateComplete;

    el.requestClose();
    await el.updateComplete;
    expect(el._confirmPanelOpen).toBe(true);

    // Second requestClose (same path as Escape via dialog oncancel)
    el.requestClose();
    await el.updateComplete;

    expect(el._confirmPanelOpen).toBe(false);
    // Content should be preserved (not discarded)
    expect(editor._bodyJson).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Esc test" }] },
      ],
    });
  });

  it("confirm discard closes and resets", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    editor._bodyJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Will discard" }],
        },
      ],
    };
    await editor.updateComplete;

    el.requestClose();
    await el.updateComplete;

    const discardBtn = requireElement(
      el.querySelector<HTMLButtonElement>(".compose-confirm-discard"),
      "expected discard button",
    );
    discardBtn.click();
    await el.updateComplete;

    expect(el._confirmPanelOpen).toBe(false);
    expect(el._format).toBe("note");
    expect(el._collectionIds).toEqual([]);
  });

  it("loaded draft shows format switcher and Post button, not edit mode", async () => {
    const el = await createElement();

    // Simulate what _loadDraft sets (without fetching)
    el._draftSourceId = "draft123";
    el._format = "note";
    await el.updateComplete;

    // Format switcher should be visible, and the submit label says this is a
    // new post rather than an edit.
    expect(el.querySelector(".compose-segmented")).not.toBeNull();
    expect(el.querySelector(".compose-publish-main")?.textContent?.trim()).toBe(
      "Post",
    );

    // Button should say "Post", not "Done"
    const postBtn = requireElement(
      el.querySelector<HTMLButtonElement>(".compose-publish-main"),
      "expected post button",
    );
    expect(postBtn.textContent?.trim()).toBe("Post");
  });

  it("discard on loaded draft sends DELETE request", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );

    // Simulate loaded draft with content
    el._draftSourceId = "draft456";
    editor._bodyJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Draft content" }],
        },
      ],
    };
    await editor.updateComplete;

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    el.requestClose();
    await el.updateComplete;

    // Click "Don't save" (discard)
    const discardBtn = requireElement(
      el.querySelector<HTMLButtonElement>(".compose-confirm-discard"),
      "expected discard button",
    );
    discardBtn.click();
    await el.updateComplete;

    expect(fetchSpy).toHaveBeenCalledWith("/api/posts/draft456", {
      method: "DELETE",
    });

    fetchSpy.mockRestore();
  });

  it("submit from loaded draft includes draftSourceId as editPostId", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );

    el._draftSourceId = "draft789";
    editor._bodyJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Publish this draft" }],
        },
      ],
    };
    await editor.updateComplete;

    let receivedDetail: ComposeSubmitDetail | null = null;
    el.addEventListener("jant:compose-submit-deferred", (event) => {
      receivedDetail = (event as CustomEvent<ComposeSubmitDetail>).detail;
    });

    requireElement(
      el.querySelector<HTMLButtonElement>(".compose-publish-main"),
      "expected post button",
    ).click();

    expect(receivedDetail).not.toBeNull();
    expect((receivedDetail as unknown as ComposeSubmitDetail).editPostId).toBe(
      "draft789",
    );
    expect(
      (receivedDetail as unknown as ComposeSubmitDetail).draftSourceId,
    ).toBe("draft789");
    expect((receivedDetail as unknown as ComposeSubmitDetail).status).toBe(
      "published",
    );
  });

  it("opens a thread draft without deleting it and preserves its draft identity", async () => {
    const rootId = "pst_draft_root";
    const replyId = "pst_draft_reply";
    const requests: Array<{ url: string; method: string }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      requests.push({ url, method: init?.method ?? "GET" });

      if (url === `/api/posts/${rootId}`) {
        return new Response(
          JSON.stringify({
            id: rootId,
            threadId: rootId,
            format: "note",
            status: "draft",
            slug: "draft-thread",
            title: "Draft thread",
            body: null,
            attachments: [],
            collectionIds: [],
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      if (url === "/api/posts?status=draft&limit=50") {
        return new Response(
          JSON.stringify({
            posts: [
              {
                id: replyId,
                threadId: rootId,
                replyToId: rootId,
                format: "quote",
                status: "draft",
                quoteText: "Draft reply",
                attachments: [],
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const el = await createElement();
    await el.openDraft(rootId);
    await flushUpdates(el);

    expect(el._draftSourceId).toBe(rootId);
    expect(el.querySelectorAll("jant-compose-editor")).toHaveLength(2);
    expect(requests).toEqual([
      { url: `/api/posts/${rootId}`, method: "GET" },
      { url: "/api/posts?status=draft&limit=50", method: "GET" },
    ]);

    let receivedDetail: ComposeSubmitDetail | null = null;
    el.addEventListener("jant:compose-submit-deferred", (event) => {
      receivedDetail = (event as CustomEvent<ComposeSubmitDetail>).detail;
    });
    requireElement(
      el.querySelector<HTMLButtonElement>(".compose-publish-main"),
      "expected publish button",
    ).click();

    expect(receivedDetail).not.toBeNull();
    expect(
      (receivedDetail as unknown as ComposeSubmitDetail).draftSourceId,
    ).toBe(rootId);
    expect((receivedDetail as unknown as ComposeSubmitDetail).editPostId).toBe(
      rootId,
    );
    expect(
      (receivedDetail as unknown as ComposeSubmitDetail).threadPosts,
    ).toHaveLength(2);
    expect(requests.every((request) => request.method === "GET")).toBe(true);
  });

  it("draft button confirm save dispatches draft then opens drafts panel", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    editor._bodyJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Save then browse" }],
        },
      ],
    };
    await editor.updateComplete;

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ posts: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    let receivedDetail: ComposeSubmitDetail | null = null;
    el.addEventListener("jant:compose-submit-deferred", (event) => {
      receivedDetail = (event as CustomEvent<ComposeSubmitDetail>).detail;
    });

    // Click the drafts row in the options panel → confirm panel
    await openPublishPanel(el);
    requireElement(draftsRow(el), "expected drafts row").click();
    await flushUpdates(el);
    expect(el._confirmPanelOpen).toBe(true);

    // Click "Save"
    requireElement(
      el.querySelector<HTMLButtonElement>(".compose-confirm-save"),
      "expected save button",
    ).click();
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    // Draft submitted
    expect(receivedDetail).not.toBeNull();
    expect((receivedDetail as unknown as ComposeSubmitDetail).status).toBe(
      "draft",
    );
    // Drafts panel waits for the bridge to finish writing before opening
    expect(el._draftsPanelOpen).toBe(false);
    expect(el._confirmPanelOpen).toBe(false);

    // Simulate the bridge signalling that the draft was saved
    document.dispatchEvent(
      new CustomEvent("jant:compose-submit-complete", {
        detail: { status: "draft" },
      }),
    );
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    expect(el._draftsPanelOpen).toBe(true);

    fetchSpy.mockRestore();
  });

  it("draft button confirm discard opens drafts panel without saving", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    editor._bodyJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Discard then browse" }],
        },
      ],
    };
    await editor.updateComplete;

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ posts: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    let submitFired = false;
    el.addEventListener("jant:compose-submit-deferred", () => {
      submitFired = true;
    });

    // Click the drafts row in the options panel → confirm panel
    await openPublishPanel(el);
    requireElement(draftsRow(el), "expected drafts row").click();
    await flushUpdates(el);

    // Click "Don't save"
    requireElement(
      el.querySelector<HTMLButtonElement>(".compose-confirm-discard"),
      "expected discard button",
    ).click();
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    // No submit dispatched
    expect(submitFired).toBe(false);
    // Drafts panel opened
    expect(el._draftsPanelOpen).toBe(true);
    expect(el._confirmPanelOpen).toBe(false);

    fetchSpy.mockRestore();
  });

  it("attachments detected as content for confirmation", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );

    const blob = new Blob(["fake-image"], { type: "image/png" });
    const file = new File([blob], "test.png", { type: "image/png" });
    const previewUrl = URL.createObjectURL(blob);

    editor._attachments = [
      {
        clientId: "test-id-1",
        file,
        previewUrl,
        status: "done",
        progress: null,
        mediaId: "media-1",
        alt: "",
        error: null,
        posterUrl: null,
        remoteUrl: null,
        summary: null,
        chars: null,
      },
    ];
    await editor.updateComplete;

    el.requestClose();
    await el.updateComplete;

    expect(el._confirmPanelOpen).toBe(true);
    expect(el.querySelector(".compose-confirm-panel")).not.toBeNull();

    URL.revokeObjectURL(previewUrl);
  });

  it("rating detected as content for confirmation", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    editor._rating = 3;
    editor._showRating = true;
    await editor.updateComplete;

    el.requestClose();
    await el.updateComplete;

    expect(el._confirmPanelOpen).toBe(true);
  });

  it("hidden rating does not trigger confirmation on close", async () => {
    const el = await createElement();
    const editor = requireElement(
      el.querySelector<JantComposeEditor>("jant-compose-editor"),
      "expected compose editor",
    );
    editor._rating = 3;
    editor._showRating = false;
    await editor.updateComplete;

    el.requestClose();
    await el.updateComplete;

    expect(el._confirmPanelOpen).toBe(false);
  });
});
