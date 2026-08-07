// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, vi } from "vitest";
vi.mock("../../upload-with-metadata.js", () => ({
  uploadWithMetadata: vi.fn(),
}));
import type { Editor, JSONContent } from "@tiptap/core";
import type { Slice } from "@tiptap/pm/model";
import * as ProseMirrorView from "@tiptap/pm/view";
import type { ComposeLabels } from "../compose-types.js";
import { renderTiptapJson } from "../../../lib/tiptap-render.js";
import "../jant-compose-editor.js";
import type { JantComposeEditor } from "../jant-compose-editor.js";
import { uploadWithMetadata } from "../../upload-with-metadata.js";

function requireElement<T extends globalThis.Element>(
  element: T | null,
  message: string,
): T {
  if (!element) {
    throw new Error(message);
  }
  return element;
}

function requireItem<T extends globalThis.Element>(
  collection: globalThis.NodeListOf<T>,
  index: number,
  message: string,
): T {
  const item = collection.item(index);
  if (!item) {
    throw new Error(message);
  }
  return item;
}

function requireValue<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
  return value;
}

function requireEditor(el: JantComposeEditor): Editor {
  return requireValue(
    (el as unknown as { _editor?: Editor | null })._editor,
    "expected compose editor instance",
  );
}

interface MockClipboardItem {
  kind: string;
  type: string;
  getAsFile(): File | null;
}

interface MockClipboardData {
  items: MockClipboardItem[];
  files: File[];
}

type MockPasteEvent = globalThis.ClipboardEvent & {
  clipboardData: MockClipboardData;
  defaultPrevented: boolean;
};

function createPasteEvent(files: File[]): MockPasteEvent {
  let defaultPrevented = false;
  return {
    clipboardData: {
      items: files.map((file) => ({
        kind: "file",
        type: file.type,
        getAsFile: () => file,
      })),
      files,
    },
    preventDefault() {
      defaultPrevented = true;
    },
    get defaultPrevented() {
      return defaultPrevented;
    },
  } as unknown as MockPasteEvent;
}

function triggerEditorPaste(el: JantComposeEditor, files: File[]) {
  const editor = requireEditor(el);
  const event = createPasteEvent(files);
  let handled = false;

  editor.view.someProp("handlePaste", (handler: unknown) => {
    const pasteHandler = handler as (
      view: Editor["view"],
      event: globalThis.ClipboardEvent,
      slice: unknown,
    ) => boolean | void;
    const result = pasteHandler(
      editor.view,
      event as globalThis.ClipboardEvent,
      undefined,
    );
    handled = result === true;
    return handled;
  });

  return { handled, event };
}

function parsePastedText(el: JantComposeEditor, text: string): Slice | null {
  const editor = requireEditor(el);
  let slice: Slice | null = null;

  editor.view.someProp("clipboardTextParser", (handler: unknown) => {
    const parseClipboardText = handler as (
      text: string,
      context: typeof editor.state.selection.$from,
      plainText: boolean,
      view: Editor["view"],
    ) => Slice | null;

    slice = parseClipboardText(
      text,
      editor.state.selection.$from,
      false,
      editor.view,
    );
    return true;
  });

  return slice;
}

function copyEditorSelection(el: JantComposeEditor) {
  const editor = requireEditor(el);
  editor.commands.selectAll();
  return editor.view.serializeForClipboard(editor.state.selection.content());
}

const parseFromClipboard = (
  ProseMirrorView as unknown as {
    __parseFromClipboard: (
      view: Editor["view"],
      text: string,
      html: string | null,
      plainText: boolean,
      context: Editor["state"]["selection"]["$from"],
    ) => Slice | null;
  }
).__parseFromClipboard;

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
  translationOf: "Translation of “{title}”",
  translationOfInLanguage: "Writing the {language} version of “{title}”",
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

async function createElement(
  format: string = "note",
  options: { titleByDefault?: boolean } = {},
): Promise<JantComposeEditor> {
  const el = document.createElement("jant-compose-editor") as JantComposeEditor;
  el.format = format as "note" | "link" | "quote";
  el.labels = labels;
  if (options.titleByDefault !== undefined) {
    el.titleByDefault = options.titleByDefault;
  }
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function tiptapDoc(...content: JSONContent[]): JSONContent {
  return { type: "doc", content };
}

function tiptapHeading(level: number, text: string): JSONContent {
  return {
    type: "heading",
    attrs: { level },
    content: [{ type: "text", text }],
  };
}

function tiptapParagraph(text: string): JSONContent {
  return {
    type: "paragraph",
    content: [{ type: "text", text }],
  };
}

async function toggleEmojiPicker(el: JantComposeEditor) {
  (
    el as unknown as {
      _toggleEmojiPicker: () => void;
    }
  )._toggleEmojiPicker();
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  await Promise.resolve();
  await Promise.resolve();
  await el.updateComplete;
}

describe("JantComposeEditor", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("renders note fields by default", async () => {
    const el = await createElement("note");
    const tiptapContainer = requireElement(
      el.querySelector<HTMLElement>(".compose-tiptap-body"),
      "expected compose Tiptap body container",
    );
    expect(tiptapContainer).toBeTruthy();
  });

  it("renders link fields when format is link", async () => {
    const el = await createElement("link");
    const urlInput = requireElement(
      el.querySelector<HTMLInputElement>('input[type="url"]'),
      "expected url input",
    );
    expect(urlInput.placeholder).toBe("Paste a URL...");

    const titleInput = el.querySelector<HTMLInputElement>(
      ".compose-link-title",
    );
    expect(titleInput).not.toBeNull();
    expect(el.querySelector("[data-compose-url-status]")).toBeNull();
  });

  it("shows an inline URL error only after the field blurs", async () => {
    const el = await createElement("link");
    const urlInput = requireElement(
      el.querySelector<HTMLInputElement>('input[type="url"]'),
      "expected url input",
    );

    urlInput.value = "example.com";
    urlInput.dispatchEvent(new Event("input", { bubbles: true }));
    await el.updateComplete;

    expect(el.querySelector("[data-compose-url-status]")).toBeNull();
    expect(urlInput.getAttribute("aria-invalid")).toBe("false");

    urlInput.dispatchEvent(new Event("blur"));
    await el.updateComplete;

    expect(el.getUrlValidationMessage()).toBe(
      "Enter a valid URL starting with http://, https://, or mailto:.",
    );
    expect(urlInput.getAttribute("aria-invalid")).toBe("true");
    expect(
      el.querySelector("[data-compose-url-status]")?.textContent?.trim(),
    ).toBe("Enter a valid URL starting with http://, https://, or mailto:.");
  });

  it("keeps the link URL quiet when the field is empty on blur", async () => {
    const el = await createElement("link");
    const urlInput = requireElement(
      el.querySelector<HTMLInputElement>('input[type="url"]'),
      "expected url input",
    );

    urlInput.dispatchEvent(new Event("blur"));
    await el.updateComplete;

    expect(urlInput.getAttribute("aria-invalid")).toBe("false");
    expect(el.querySelector("[data-compose-url-status]")).toBeNull();
  });

  it("renders quote fields when format is quote", async () => {
    const el = await createElement("quote");
    const quoteTextarea = el.querySelector<HTMLTextAreaElement>(
      ".compose-quote-text",
    );
    expect(quoteTextarea).not.toBeNull();

    const authorInput = el.querySelector<HTMLInputElement>(
      ".compose-quote-author",
    );
    expect(authorInput).not.toBeNull();
    expect(el.querySelector(".compose-quote-mark svg path")).not.toBeNull();
  });

  it("accepts mailto links as valid URLs", async () => {
    const el = await createElement("link");
    const urlInput = requireElement(
      el.querySelector<HTMLInputElement>('input[type="url"]'),
      "expected url input",
    );

    urlInput.value = "mailto:test@example.com";
    urlInput.dispatchEvent(new Event("input", { bubbles: true }));
    await el.updateComplete;

    expect(el.getUrlValidationMessage()).toBeNull();
    expect(urlInput.getAttribute("aria-invalid")).toBe("false");
  });

  it("keeps the link title quiet when the field is empty on blur", async () => {
    const el = await createElement("link");
    const titleInput = requireElement(
      el.querySelector<HTMLInputElement>(".compose-link-title"),
      "expected link title input",
    );

    expect(el.querySelector("[data-compose-link-title-error]")).toBeNull();

    titleInput.dispatchEvent(new Event("blur"));
    await el.updateComplete;

    expect(el.querySelector("[data-compose-link-title-error]")).toBeNull();
    expect(titleInput.getAttribute("aria-invalid")).toBe("false");
  });

  it("dispatches file picker lifecycle events when media picker is cancelled", async () => {
    const el = await createElement("note");
    const states: Array<"open" | "cancelled"> = [];

    el.addEventListener("jant:file-picker-open", () => {
      states.push("open");
    });
    el.addEventListener("jant:file-picker-close", (event) => {
      const detail = (event as CustomEvent<{ cancelled?: boolean }>).detail;
      if (detail?.cancelled) {
        states.push("cancelled");
      }
    });

    (
      el as unknown as {
        _openFilePicker: () => void;
      }
    )._openFilePicker();

    const input = requireValue(
      (
        el as unknown as {
          _fileInput: HTMLInputElement | null;
        }
      )._fileInput,
      "expected file input",
    );
    input.dispatchEvent(new Event("cancel"));

    expect(states).toEqual(["open", "cancelled"]);
  });

  it("recreates the emoji picker after closing so later categories stay populated", async () => {
    const el = await createElement("note");
    let pickerInstanceCount = 0;

    const editor = el as unknown as {
      _emojiContainer: HTMLElement | null;
      _emojiPickerEl: HTMLElement | null;
      _mountEmojiPicker: () => Promise<void>;
    };

    editor._mountEmojiPicker = async () => {
      if (!editor._emojiContainer) {
        editor._emojiContainer = document.createElement("div");
        editor._emojiContainer.className = "compose-emoji-picker";
      }
      document.body.appendChild(editor._emojiContainer);

      if (!editor._emojiPickerEl) {
        pickerInstanceCount += 1;
        const picker = document.createElement("div");
        picker.setAttribute("data-instance-id", String(pickerInstanceCount));
        picker.attachShadow({ mode: "open" }).innerHTML = `
          <section data-category="people">😀 😃 😄</section>
          <section data-category="nature">🐶 🌿 🐢</section>
        `;
        editor._emojiPickerEl = picker;
      }

      editor._emojiContainer.innerHTML = "";
      editor._emojiContainer.appendChild(editor._emojiPickerEl);
    };

    await toggleEmojiPicker(el);

    const firstPicker = requireValue(
      editor._emojiPickerEl,
      "expected first emoji picker",
    );
    const firstInstanceId = requireValue(
      firstPicker.getAttribute("data-instance-id"),
      "expected first emoji picker instance id",
    );

    expect(
      firstPicker.shadowRoot?.querySelector('[data-category="nature"]')
        ?.textContent,
    ).toContain("🐶");

    el.closeEmojiPicker();
    await toggleEmojiPicker(el);

    const secondPicker = requireValue(
      editor._emojiPickerEl,
      "expected reopened emoji picker",
    );

    expect(secondPicker.getAttribute("data-instance-id")).not.toBe(
      firstInstanceId,
    );
    expect(
      secondPicker.shadowRoot?.querySelector('[data-category="nature"]')
        ?.textContent,
    ).toContain("🐶");
  });

  it("parses inserted markdown link syntax into a link mark", async () => {
    const el = await createElement("note");
    const editor = requireEditor(el);

    editor.commands.insertContent("[OpenAI](https://openai.com)", {
      contentType: "markdown",
    });

    const paragraph = editor.getJSON().content?.[0];
    const linkTextNode = paragraph?.content?.[0];

    expect(editor.getText()).toBe("OpenAI");
    expect(linkTextNode).toMatchObject({
      type: "text",
      text: "OpenAI",
      marks: [
        expect.objectContaining({
          type: "link",
          attrs: expect.objectContaining({ href: "https://openai.com" }),
        }),
      ],
    });
  });

  it("linkifies inserted bare URLs in markdown mode", async () => {
    const el = await createElement("note");
    const editor = requireEditor(el);

    editor.commands.insertContent("https://openai.com", {
      contentType: "markdown",
    });

    const paragraph = editor.getJSON().content?.[0];
    const linkTextNode = paragraph?.content?.[0];

    expect(linkTextNode).toMatchObject({
      type: "text",
      text: "https://openai.com",
      marks: [
        expect.objectContaining({
          type: "link",
          attrs: expect.objectContaining({ href: "https://openai.com" }),
        }),
      ],
    });
  });

  it("parses pasted markdown links into link marks", async () => {
    const el = await createElement("note");

    const slice = parsePastedText(el, "[OpenAI](https://openai.com)");
    const linkTextNode = slice?.content.firstChild;

    expect(linkTextNode?.text).toBe("OpenAI");
    expect(linkTextNode?.marks[0]?.type.name).toBe("link");
    expect(linkTextNode?.marks[0]?.attrs.href).toBe("https://openai.com");
  });

  it("linkifies pasted bare URLs", async () => {
    const el = await createElement("note");

    const slice = parsePastedText(el, "https://openai.com");
    const linkTextNode = slice?.content.firstChild;

    expect(linkTextNode?.text).toBe("https://openai.com");
    expect(linkTextNode?.marks[0]?.type.name).toBe("link");
    expect(linkTextNode?.marks[0]?.attrs.href).toBe("https://openai.com");
  });

  it("serializes read more markers as markdown comments in plain text", async () => {
    const el = await createElement("note");
    const editor = requireEditor(el);

    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Before" }],
        },
        { type: "moreBreak" },
        {
          type: "paragraph",
          content: [{ type: "text", text: "After" }],
        },
      ],
    });
    expect(editor.getText()).toBe("Before\n\n<!--more-->\n\nAfter");
  });

  it("parses pasted read more markers into moreBreak nodes", async () => {
    const el = await createElement("note");

    const slice = parsePastedText(el, "Before\n\n<!--more-->\n\nAfter");

    expect(slice?.content.childCount).toBe(3);
    expect(slice?.content.firstChild?.textContent).toBe("Before");
    expect(slice?.content.child(1).type.name).toBe("moreBreak");
    expect(slice?.content.lastChild?.textContent).toBe("After");
  });

  it("parses pasted visible read more labels into moreBreak nodes", async () => {
    const el = await createElement("note");

    const slice = parsePastedText(el, "Before\n\nRead More ↓\n\nAfter");

    expect(slice?.content.childCount).toBe(3);
    expect(slice?.content.firstChild?.textContent).toBe("Before");
    expect(slice?.content.child(1).type.name).toBe("moreBreak");
    expect(slice?.content.lastChild?.textContent).toBe("After");
  });

  it("preserves read more markers when copied and pasted between editors", async () => {
    const source = await createElement("note");
    const target = await createElement("note");
    const sourceEditor = requireEditor(source);
    const targetEditor = requireEditor(target);

    sourceEditor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Before" }],
        },
        { type: "moreBreak" },
        {
          type: "paragraph",
          content: [{ type: "text", text: "After" }],
        },
      ],
    });

    const { dom, text } = copyEditorSelection(source);

    targetEditor.commands.clearContent();
    targetEditor.view.pasteHTML(dom.innerHTML);

    expect(targetEditor.getJSON().content?.[1]).toMatchObject({
      type: "moreBreak",
    });
    expect(renderTiptapJson(JSON.stringify(targetEditor.getJSON()))).toContain(
      "<!--more-->",
    );
    expect(text).toBe("Before\n\n<!--more-->\n\nAfter");
  });

  it("renders pasted visible read more labels as excerpt markers", async () => {
    const el = await createElement("note");
    const editor = requireEditor(el);

    editor.commands.clearContent();
    const slice = parseFromClipboard(
      editor.view,
      "Before\n\nRead More ↓\n\nAfter",
      null,
      false,
      editor.state.selection.$from,
    );
    if (!slice) {
      throw new Error("expected clipboard slice");
    }
    editor.view.dispatch(editor.state.tr.replaceSelection(slice));

    expect(renderTiptapJson(JSON.stringify(editor.getJSON()))).toContain(
      "<!--more-->",
    );
  });

  it("toggles star rating visibility", async () => {
    const el = await createElement("note");

    // Rating not visible initially
    expect(el.querySelector(".compose-star-rating")).toBeNull();

    // Click score button to show rating
    const scoreBtnEl = requireElement(
      el.querySelector<HTMLButtonElement>('.compose-tool-btn[title="Rate"]'),
      "expected score tool button",
    );
    scoreBtnEl.click();
    await el.updateComplete;

    expect(el.querySelector(".compose-star-rating")).not.toBeNull();
  });

  it("sets rating on star click and deselects on same star", async () => {
    const el = await createElement("note");
    el._showRating = true;
    await el.updateComplete;

    const stars = el.querySelectorAll<HTMLButtonElement>(".compose-star");
    expect(stars.length).toBe(5);

    // Click third star
    stars[2].click();
    await el.updateComplete;
    expect(el._rating).toBe(3);

    // Rating label shows
    const label = el.querySelector(".compose-star-label");
    expect(label?.textContent).toContain("3/5");

    // Click third star again to deselect
    stars[2].click();
    await el.updateComplete;
    expect(el._rating).toBe(0);
  });

  it("dispatches attached panel open event and creates new item", async () => {
    const el = await createElement("note");

    const events: CustomEvent[] = [];
    el.addEventListener("jant:attached-panel-open", (e) =>
      events.push(e as CustomEvent),
    );

    // Click attached text tool button
    const toolBtns =
      el.querySelectorAll<HTMLButtonElement>(".compose-tool-btn");
    const attachedBtn = requireItem(
      toolBtns,
      1,
      "expected attached text button",
    );
    attachedBtn.click();
    await el.updateComplete;

    expect(events).toHaveLength(1);
    expect(events[0].detail.index).toBe(0);
    expect(el._attachedTexts).toHaveLength(1);
    expect(el._attachedTexts[0].bodyJson).toBeNull();
  });

  it("shows a note's title field by default on a post that starts a thread", async () => {
    const el = await createElement("note");
    expect(el.querySelector(".compose-note-title")).not.toBeNull();
    expect(el.querySelector('.compose-tool-btn[title="Title"]')).not.toBeNull();
  });

  it("hides a note's title field by default on a continuation post", async () => {
    const el = await createElement("note", { titleByDefault: false });
    expect(el.querySelector(".compose-note-title")).toBeNull();
  });

  it("toggles the title field from the toolbar", async () => {
    const el = await createElement("note", { titleByDefault: false });
    const toggle = requireElement(
      el.querySelector<HTMLButtonElement>('.compose-tool-btn[title="Title"]'),
      "expected title toggle",
    );

    toggle.click();
    await el.updateComplete;
    expect(el.querySelector(".compose-note-title")).not.toBeNull();

    toggle.click();
    await el.updateComplete;
    expect(el.querySelector(".compose-note-title")).toBeNull();
  });

  it("drops a hidden title from the submitted data", async () => {
    const el = await createElement("note");
    el._title = "Named";
    el._showTitle = false;
    await el.updateComplete;
    expect(el.getData().title).toBe("");
  });

  it("keeps the title field visible when a post arrives with one", async () => {
    const el = await createElement("note", { titleByDefault: false });
    el.populate({ format: "note", title: "Loaded title" });
    await el.updateComplete;
    expect(el.querySelector(".compose-note-title")).not.toBeNull();
  });

  it.each([
    ["note", ".compose-note-title"],
    ["link", ".compose-link-title"],
  ] as const)(
    "moves from the %s title to the start of the body on Enter",
    async (format, selector) => {
      const el = await createElement(format);
      if (format === "note") {
        await el.updateComplete;
      }

      const titleInput = requireElement(
        el.querySelector<HTMLInputElement>(selector),
        `expected ${format} title input`,
      );
      const editor = requireEditor(el);
      titleInput.focus();

      const event = new globalThis.KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      titleInput.dispatchEvent(event);
      await new Promise<void>((resolve) => {
        globalThis.requestAnimationFrame(() => resolve());
      });

      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(editor.view.dom);
      expect(editor.state.selection.from).toBe(1);
    },
  );

  it("keeps focus in the title while an IME composition is active", async () => {
    const el = await createElement("note");
    await el.updateComplete;

    const titleInput = requireElement(
      el.querySelector<HTMLInputElement>(".compose-note-title"),
      "expected note title input",
    );
    titleInput.focus();

    const event = new globalThis.KeyboardEvent("keydown", {
      key: "Enter",
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    titleInput.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(titleInput);
  });

  it("leaves Mod-Enter available for the publish shortcut", async () => {
    const el = await createElement("note");
    await el.updateComplete;

    const titleInput = requireElement(
      el.querySelector<HTMLInputElement>(".compose-note-title"),
      "expected note title input",
    );
    titleInput.focus();

    const event = new globalThis.KeyboardEvent("keydown", {
      key: "Enter",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    titleInput.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(titleInput);
  });

  it("places fullscreen at the far right of the toolbar", async () => {
    const el = await createElement("note");
    const toolTitles = [
      ...el.querySelectorAll<HTMLButtonElement>(".compose-tool-btn"),
    ].map((button) => button.getAttribute("title"));

    expect(toolTitles).toEqual([
      "Media",
      "Attached Text",
      "Emoji",
      "Rate",
      "Title",
      "Fullscreen",
    ]);
    expect(
      el.querySelector('.compose-tool-btn-view[aria-label="Fullscreen"]'),
    ).not.toBeNull();
  });

  it("shows fullscreen only in note mode", async () => {
    const note = await createElement("note");
    expect(
      note.querySelector('.compose-tool-btn-view[aria-label="Fullscreen"]'),
    ).not.toBeNull();

    const link = await createElement("link");
    expect(
      link.querySelector('.compose-tool-btn-view[aria-label="Fullscreen"]'),
    ).toBeNull();

    const quote = await createElement("quote");
    expect(
      quote.querySelector('.compose-tool-btn-view[aria-label="Fullscreen"]'),
    ).toBeNull();
  });

  it("getData returns current field values", async () => {
    const el = await createElement("note");
    el._title = "Test Title";
    el._bodyJson = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Test Body" }] },
      ],
    };
    el._rating = 4;
    el._showRating = true;
    el._attachedTexts = [
      {
        clientId: "t1",
        bodyJson: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Some attached text" }],
            },
          ],
        },
        summary: "Some attached text",
        bodyHtml: "<p>Some attached text</p>",
      },
    ];

    const data = el.getData();
    expect(data.title).toBe("Test Title");
    expect(data.body).toContain("Test Body");
    expect(data.rating).toBe(4);
    expect(data.attachedTexts).toHaveLength(1);
    expect(data.attachedTexts[0].bodyJson).not.toBeNull();
    expect(data.url).toBe("");
    expect(data.quoteText).toBe("");
    expect(data.quoteAuthor).toBe("");
  });

  it("getData omits empty attached text placeholders", async () => {
    const el = await createElement("note");
    el._attachedTexts = [
      {
        clientId: "t1",
        bodyJson: null,
        summary: "",
        bodyHtml: "",
      },
      {
        clientId: "t2",
        bodyJson: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Keep me" }],
            },
          ],
        },
        summary: "Keep me",
        bodyHtml: "<p>Keep me</p>",
      },
    ];
    el._attachmentOrder = ["t1", "t2"];

    const data = el.getData();

    expect(data.attachedTexts).toHaveLength(1);
    expect(data.attachedTexts[0]?.clientId).toBe("t2");
    expect(data.attachmentOrder).toEqual(["t2"]);
  });

  it("getData returns the note title as typed", async () => {
    const el = await createElement("note");
    el._title = "Kept Title";

    expect(el.getData().title).toBe("Kept Title");
  });

  it("promotes a leading H1 to the note title", async () => {
    const el = await createElement("note");
    const editor = requireEditor(el);
    editor.commands.setContent(
      tiptapDoc(tiptapHeading(1, "My Markdown Title"), tiptapParagraph("Body")),
    );

    el.promoteLeadingH1Title({ force: true });
    await el.updateComplete;

    const data = el.getData();
    const body = JSON.parse(data.body) as JSONContent;

    expect(data.title).toBe("My Markdown Title");
    expect(body.content?.[0]).toEqual(tiptapParagraph("Body"));
  });

  it("keeps a leading H1 in the body while the cursor is still in it", async () => {
    const el = await createElement("note");
    const editor = requireEditor(el);

    editor.commands.setContent(tiptapDoc(tiptapHeading(1, "Draft title")));
    await el.updateComplete;

    const data = el.getData();
    const body = JSON.parse(data.body) as JSONContent;

    expect(data.title).toBe("");
    expect(body.content?.[0]).toEqual(tiptapHeading(1, "Draft title"));
  });

  it("does not overwrite an explicit note title with a leading H1", async () => {
    const el = await createElement("note");
    const editor = requireEditor(el);
    el._title = "Manual title";

    editor.commands.setContent(
      tiptapDoc(tiptapHeading(1, "Markdown Title"), tiptapParagraph("Body")),
    );

    el.promoteLeadingH1Title({ force: true });
    await el.updateComplete;

    const data = el.getData();
    const body = JSON.parse(data.body) as JSONContent;

    expect(data.title).toBe("Manual title");
    expect(body.content?.[0]).toEqual(tiptapHeading(1, "Markdown Title"));
  });

  it("does not promote a leading H1 for link posts", async () => {
    const el = await createElement("link");
    const editor = requireEditor(el);

    editor.commands.setContent(
      tiptapDoc(tiptapHeading(1, "Markdown Title"), tiptapParagraph("Body")),
    );

    el.promoteLeadingH1Title({ force: true });
    await el.updateComplete;

    const data = el.getData();
    const body = JSON.parse(data.body) as JSONContent;

    expect(data.title).toBe("");
    expect(body.content?.[0]).toEqual(tiptapHeading(1, "Markdown Title"));
  });

  it("omits rating when the rating control is hidden", async () => {
    const el = await createElement("note");
    el._rating = 3;
    el._showRating = false;

    const data = el.getData();
    expect(data.rating).toBe(0);
  });

  it("preserves rating in memory when toggling off and restores on toggle on", async () => {
    const el = await createElement("note");
    el._rating = 3;
    el._showRating = true;
    await el.updateComplete;

    el._showRating = false;
    await el.updateComplete;
    expect(el._rating).toBe(3);
    expect(el.getData().rating).toBe(0);

    el._showRating = true;
    await el.updateComplete;
    expect(el.getData().rating).toBe(3);
  });

  it("reset clears all fields", async () => {
    const el = await createElement("note");
    el._title = "Test";
    el._bodyJson = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Body" }] },
      ],
    };
    el._rating = 3;
    el._showRating = true;
    el._attachedTexts = [
      {
        clientId: "t1",
        bodyJson: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "text" }],
            },
          ],
        },
        summary: "text",
        bodyHtml: "<p>text</p>",
      },
    ];

    el.reset();

    expect(el._title).toBe("");
    expect(el._bodyJson).toBeNull();
    expect(el._rating).toBe(0);
    expect(el._showRating).toBe(false);
    expect(el._attachedTexts).toEqual([]);
  });

  it("shows attached text card in attachment strip", async () => {
    const el = await createElement("note");
    el._attachedTexts = [
      {
        clientId: "t1",
        bodyJson: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Some content here" }],
            },
          ],
        },
        summary: "Some content here",
        bodyHtml: "<p>Some content here</p>",
      },
    ];
    el._attachmentOrder = ["t1"];
    await el.updateComplete;

    const card = el.querySelector(".compose-attachment-text-card");
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("Some content here");
  });

  it("keeps a removable fallback card when a single saved image preview fails", async () => {
    const el = await createElement("note");

    el.populate({
      format: "note",
      media: [
        {
          id: "m1",
          previewUrl: "/missing.png",
          mimeType: "image/png",
        },
      ],
      attachmentOrder: ["m1"],
    });
    await el.updateComplete;

    const image = requireElement(
      el.querySelector<HTMLImageElement>(".compose-attachment-img"),
      "expected image preview",
    );
    image.dispatchEvent(new Event("error"));
    await el.updateComplete;

    const fallback = el.querySelector("[data-preview-failed='image']");
    expect(fallback).not.toBeNull();
    expect(fallback?.textContent).toContain("Image unavailable");
    expect(el.querySelector(".compose-attachment-remove")).not.toBeNull();
    expect(el.querySelector(".compose-attachment-img")).toBeNull();
  });

  it("media button shows inline add label when attachments are present", async () => {
    const el = await createElement("note");

    // Media button should not have add style initially
    const mediaBtn = el.querySelector<HTMLButtonElement>(".compose-tool-btn");
    expect(mediaBtn?.classList.contains("compose-tool-btn-add")).toBe(false);

    // Add an attachment
    const blob = new Blob(["fake"], { type: "image/png" });
    const file = new File([blob], "test.png", { type: "image/png" });
    el._attachments = [
      {
        clientId: "test-1",
        file,
        previewUrl: URL.createObjectURL(blob),
        status: "done",
        progress: null,
        mediaId: "m1",
        alt: "",
        error: null,
        posterUrl: null,
        remoteUrl: null,
        summary: null,
        chars: null,
      },
    ];
    await el.updateComplete;

    const mediaBtnAfter =
      el.querySelector<HTMLButtonElement>(".compose-tool-btn");
    expect(mediaBtnAfter?.classList.contains("compose-tool-btn-add")).toBe(
      true,
    );

    // Should show inline label, not tooltip
    const label = mediaBtnAfter?.querySelector(".compose-tool-label");
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe("Add");
  });

  it("moves attachments later with keyboard controls", async () => {
    const el = await createElement("note");
    const blob = new Blob(["fake"], { type: "image/png" });
    const file = new File([blob], "test.png", { type: "image/png" });
    el._attachments = [
      {
        clientId: "a1",
        file,
        previewUrl: URL.createObjectURL(blob),
        status: "done",
        progress: null,
        mediaId: "m1",
        alt: "",
        error: null,
        posterUrl: null,
        remoteUrl: null,
        summary: null,
        chars: null,
      },
      {
        clientId: "a2",
        file,
        previewUrl: URL.createObjectURL(blob),
        status: "done",
        progress: null,
        mediaId: "m2",
        alt: "",
        error: null,
        posterUrl: null,
        remoteUrl: null,
        summary: null,
        chars: null,
      },
    ];
    el._attachmentOrder = ["a1", "a2"];
    await el.updateComplete;

    const attachment = requireElement(
      el.querySelector<HTMLElement>(
        '[data-attachment-id="a1"] [data-attachment-sortable]',
      ),
      "expected attachment card",
    );
    attachment.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
      }),
    );
    await el.updateComplete;

    expect(el._attachmentOrder).toEqual(["a2", "a1"]);
  });

  it("preserves mixed attachment order when populate provides one", async () => {
    const el = await createElement("note");

    el.populate({
      format: "note",
      media: [
        {
          id: "m1",
          previewUrl: "/a.png",
          mimeType: "image/png",
        },
      ],
      textAttachments: [
        {
          clientId: "t1",
          bodyJson: JSON.stringify({
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Text attachment" }],
              },
            ],
          }),
          bodyHtml: "<p>Text attachment</p>",
          summary: "Text attachment",
        },
      ],
      attachmentOrder: ["t1", "m1"],
    });
    await el.updateComplete;

    const items = [
      ...el.querySelectorAll<HTMLElement>("[data-attachment-id]"),
    ].map((item) => item.dataset.attachmentId);

    expect(items).toHaveLength(2);
    expect(items[0]).toBe(el._attachmentOrder[0]);
    expect(items[1]).toBe(el._attachmentOrder[1]);
    expect(el._attachmentOrder[0]).toBe("t1");
  });

  it("pastes clipboard files into attachments when no title is set", async () => {
    const uploadWithMetadataMock = vi.mocked(uploadWithMetadata);
    const el = await createElement("note");
    const events: CustomEvent[] = [];
    el.addEventListener("jant:files-selected", (event) => {
      events.push(event as CustomEvent);
    });

    const image = new File(["image"], "clipboard.png", { type: "image/png" });
    const video = new File(["video"], "clipboard.mp4", { type: "video/mp4" });
    const { handled, event } = triggerEditorPaste(el, [image, video]);
    await el.updateComplete;

    expect(handled).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(uploadWithMetadataMock).not.toHaveBeenCalled();
    expect(el._attachments.map((attachment) => attachment.file.name)).toEqual([
      "clipboard.png",
      "clipboard.mp4",
    ]);
    expect(el._attachmentOrder).toHaveLength(2);
    expect(events).toHaveLength(1);
    expect(
      events[0].detail.files.map(
        (entry: { file: File; clientId: string }) => entry.file.name,
      ),
    ).toEqual(["clipboard.png", "clipboard.mp4"]);
  });

  it("pastes images inline and other media as attachments when a title is present", async () => {
    const uploadWithMetadataMock = vi.mocked(uploadWithMetadata);
    uploadWithMetadataMock.mockResolvedValue({
      url: "https://example.test/clipboard.webp",
      id: "med_test",
    });
    const el = await createElement("note");
    el._title = "Essay";
    await el.updateComplete;

    const image = new File(["image"], "clipboard.png", { type: "image/png" });
    const video = new File(["video"], "clipboard.mp4", { type: "video/mp4" });
    const { handled, event } = triggerEditorPaste(el, [image, video]);
    await Promise.resolve();
    await Promise.resolve();
    await el.updateComplete;

    expect(handled).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(uploadWithMetadataMock).toHaveBeenCalledTimes(1);
    expect(uploadWithMetadataMock.mock.calls[0]?.[0]).toBe(image);
    expect(el._attachments.map((attachment) => attachment.file.name)).toEqual([
      "clipboard.mp4",
    ]);
  });

  it("pastes images as attachments when only whitespace is in the title", async () => {
    const uploadWithMetadataMock = vi.mocked(uploadWithMetadata);
    const el = await createElement("note");
    el._title = "   ";
    await el.updateComplete;

    const image = new File(["image"], "clipboard.png", { type: "image/png" });
    const { handled } = triggerEditorPaste(el, [image]);
    await el.updateComplete;

    expect(handled).toBe(true);
    expect(uploadWithMetadataMock).not.toHaveBeenCalled();
    expect(el._attachments.map((attachment) => attachment.file.name)).toEqual([
      "clipboard.png",
    ]);
  });
});
