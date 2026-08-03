// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/core";
import type {
  ComposeFullscreenCloseDetail,
  ComposeLabels,
} from "../compose-types.js";
import "../jant-compose-fullscreen.js";
import type { JantComposeFullscreen } from "../jant-compose-fullscreen.js";

const labels = {
  note: "Note",
  fullscreen: "Fullscreen",
  exitFullscreen: "Exit fullscreen",
  done: "Done",
  titlePlaceholder: "Title",
  bodyPlaceholder: "What's on your mind...",
  showMore: "Show more",
  showLess: "Show less",
  newThread: "New Thread",
  newPost: "New Post",
  replyTitle: "Reply",
  editTitle: "Edit",
} as ComposeLabels;

async function flush(el?: JantComposeFullscreen) {
  await Promise.resolve();
  await Promise.resolve();
  if (el) {
    await el.updateComplete;
  }
}

function requireEditor(el: JantComposeFullscreen): Editor {
  const editor = (el as unknown as { _editor?: Editor | null })._editor;
  if (!editor) {
    throw new Error("expected fullscreen editor instance");
  }
  return editor;
}

describe("JantComposeFullscreen", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";

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

  it("shows the title field when the editor arrived with one open", async () => {
    const el = document.createElement(
      "jant-compose-fullscreen",
    ) as JantComposeFullscreen;
    el.labels = labels;
    document.body.appendChild(el);
    await flush(el);

    document.dispatchEvent(
      new CustomEvent("jant:fullscreen-open", {
        detail: { json: null, title: "", showTitle: true, labels },
      }),
    );
    await flush(el);

    expect(el.querySelector(".compose-fullscreen-title")).not.toBeNull();
    expect(el.textContent).not.toContain("Fullscreen");
  });

  it("offers a way back to a title the editor had hidden", async () => {
    const el = document.createElement(
      "jant-compose-fullscreen",
    ) as JantComposeFullscreen;
    el.labels = labels;
    document.body.appendChild(el);
    await flush(el);

    document.dispatchEvent(
      new CustomEvent("jant:fullscreen-open", {
        detail: { json: null, title: "", showTitle: false, labels },
      }),
    );
    await flush(el);

    expect(el.querySelector(".compose-fullscreen-title")).toBeNull();
    const reveal = el.querySelector<HTMLButtonElement>(
      ".compose-fullscreen-title-placeholder",
    );
    expect(reveal).not.toBeNull();

    reveal?.click();
    await flush(el);
    expect(el.querySelector(".compose-fullscreen-title")).not.toBeNull();
  });

  it.each(["metaKey", "ctrlKey"] as const)(
    "publishes with %s+Enter and returns the latest editor state",
    async (modifier) => {
      const el = document.createElement(
        "jant-compose-fullscreen",
      ) as JantComposeFullscreen;
      el.labels = labels;
      document.body.appendChild(el);
      await flush(el);

      document.dispatchEvent(
        new CustomEvent("jant:fullscreen-open", {
          detail: {
            json: null,
            title: "Keyboard post",
            labels,
            editorIndex: 2,
          },
        }),
      );
      await flush(el);

      requireEditor(el).commands.setContent({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Publish from fullscreen" }],
          },
        ],
      });

      let detail: ComposeFullscreenCloseDetail | null = null;
      document.addEventListener(
        "jant:fullscreen-close",
        (event) => {
          detail = (event as CustomEvent<ComposeFullscreenCloseDetail>).detail;
        },
        { once: true },
      );

      el.querySelector(".compose-fullscreen-dialog")?.dispatchEvent(
        new globalThis.KeyboardEvent("keydown", {
          key: "Enter",
          [modifier]: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await flush(el);

      expect(detail).toMatchObject({
        title: "Keyboard post",
        intent: "publish",
        editorIndex: 2,
        json: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Publish from fullscreen" }],
            },
          ],
        },
      });
      expect(el.querySelector(".compose-fullscreen-dialog")).toBeNull();
    },
  );

  it("does not publish while an IME composition is active", async () => {
    const el = document.createElement(
      "jant-compose-fullscreen",
    ) as JantComposeFullscreen;
    el.labels = labels;
    document.body.appendChild(el);
    await flush(el);

    document.dispatchEvent(
      new CustomEvent("jant:fullscreen-open", {
        detail: {
          json: null,
          title: "",
          labels,
        },
      }),
    );
    await flush(el);

    el.querySelector(".compose-fullscreen-dialog")?.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", {
        key: "Enter",
        metaKey: true,
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await flush(el);

    expect(el.querySelector(".compose-fullscreen-dialog")).not.toBeNull();
  });

  it("restores and returns the current editor selection", async () => {
    const el = document.createElement(
      "jant-compose-fullscreen",
    ) as JantComposeFullscreen;
    el.labels = labels;
    document.body.appendChild(el);
    await flush(el);

    document.dispatchEvent(
      new CustomEvent("jant:fullscreen-open", {
        detail: {
          json: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "abcdef" }],
              },
            ],
          },
          title: "",
          selection: { from: 4, to: 4 },
          labels,
        },
      }),
    );
    await flush(el);

    const editor = requireEditor(el);
    expect(editor.state.selection.from).toBe(4);
    expect(editor.state.selection.to).toBe(4);

    editor.chain().focus().setTextSelection({ from: 2, to: 2 }).run();

    let detail: ComposeFullscreenCloseDetail | null = null;
    document.addEventListener(
      "jant:fullscreen-close",
      (event) => {
        detail = (event as CustomEvent<ComposeFullscreenCloseDetail>).detail;
      },
      { once: true },
    );

    el.querySelector<HTMLButtonElement>(".compose-fullscreen-done")?.click();

    expect(detail).toMatchObject({
      selection: { from: 2, to: 2 },
    });
  });

  it("renders reply context when provided", async () => {
    const el = document.createElement(
      "jant-compose-fullscreen",
    ) as JantComposeFullscreen;
    el.labels = labels;
    document.body.appendChild(el);
    await flush(el);

    document.dispatchEvent(
      new CustomEvent("jant:fullscreen-open", {
        detail: {
          json: null,
          title: "",
          showTitle: true,
          labels,
          replyContext: {
            contentHtml: "<p>A quiet sentence worth answering.</p>",
            dateText: "Mar 10, 2026",
            expanded: false,
          },
        },
      }),
    );
    await flush(el);

    expect(el.textContent).toContain("A quiet sentence worth answering.");
    expect(el.textContent).toContain("Mar 10, 2026");
    expect(el.textContent).toContain("Show more");
    // The reply's title field lives inside its own row, not the toolbar.
    expect(
      el.querySelector(
        ".compose-fullscreen-editor-row .compose-fullscreen-title-reply",
      ),
    ).not.toBeNull();
  });

  it("renders reply titles inside the current reply node instead of the toolbar", async () => {
    const el = document.createElement(
      "jant-compose-fullscreen",
    ) as JantComposeFullscreen;
    el.labels = labels;
    document.body.appendChild(el);
    await flush(el);

    document.dispatchEvent(
      new CustomEvent("jant:fullscreen-open", {
        detail: {
          json: null,
          title: "Follow-up",
          labels,
          replyContext: {
            contentHtml: "<p>Thread seed.</p>",
            dateText: "Mar 12, 2026",
            expanded: false,
          },
        },
      }),
    );
    await flush(el);

    expect(
      el.querySelector(
        ".compose-fullscreen-editor-row .compose-fullscreen-title-reply",
      ),
    ).not.toBeNull();
    expect(
      el.querySelector(
        ".compose-fullscreen-toolbar .compose-fullscreen-title-reply",
      ),
    ).toBeNull();
  });

  it("preserves reply expansion state on close", async () => {
    const el = document.createElement(
      "jant-compose-fullscreen",
    ) as JantComposeFullscreen;
    el.labels = labels;
    document.body.appendChild(el);
    await flush(el);

    document.dispatchEvent(
      new CustomEvent("jant:fullscreen-open", {
        detail: {
          json: null,
          title: "",
          labels,
          replyContext: {
            contentHtml: "<p>One more thread preview.</p>",
            dateText: "Mar 11, 2026",
            expanded: false,
          },
        },
      }),
    );
    await flush(el);

    el.querySelector<HTMLButtonElement>(".compose-reply-toggle")?.click();
    await flush(el);

    let detail: ComposeFullscreenCloseDetail | null = null;
    document.addEventListener(
      "jant:fullscreen-close",
      (event) => {
        detail = (event as CustomEvent<ComposeFullscreenCloseDetail>).detail;
      },
      { once: true },
    );

    el.querySelector<HTMLButtonElement>(".compose-fullscreen-done")?.click();

    if (!detail) {
      throw new Error("expected fullscreen close detail");
    }
    const closeDetail = detail as ComposeFullscreenCloseDetail;
    expect(closeDetail.replyExpanded).toBe(true);
  });

  it("closes on Escape when no editor overlay is open", async () => {
    const el = document.createElement(
      "jant-compose-fullscreen",
    ) as JantComposeFullscreen;
    el.labels = labels;
    document.body.appendChild(el);
    await flush(el);

    document.dispatchEvent(
      new CustomEvent("jant:fullscreen-open", {
        detail: {
          json: null,
          title: "",
          labels,
        },
      }),
    );
    await flush(el);

    let detail: ComposeFullscreenCloseDetail | null = null;
    document.addEventListener(
      "jant:fullscreen-close",
      (event) => {
        detail = (event as CustomEvent<ComposeFullscreenCloseDetail>).detail;
      },
      { once: true },
    );

    el.querySelector(".compose-fullscreen-dialog")?.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await flush(el);

    expect(detail).not.toBeNull();
    expect(el.querySelector(".compose-fullscreen-dialog")).toBeNull();
  });

  it("closes immediately without waiting for pending inline image uploads", async () => {
    const el = document.createElement(
      "jant-compose-fullscreen",
    ) as JantComposeFullscreen;
    el.labels = labels;
    document.body.appendChild(el);
    await flush(el);

    document.dispatchEvent(
      new CustomEvent("jant:fullscreen-open", {
        detail: {
          json: {
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
          },
          title: "",
          labels,
        },
      }),
    );
    await flush(el);

    let detail: ComposeFullscreenCloseDetail | null = null;
    document.addEventListener(
      "jant:fullscreen-close",
      (event) => {
        detail = (event as CustomEvent<ComposeFullscreenCloseDetail>).detail;
      },
      { once: true },
    );

    // Click Done — should close immediately even with pending uploads
    el.querySelector<HTMLButtonElement>(".compose-fullscreen-done")?.click();
    await flush(el);

    // Close event fires right away with current content (blob URLs intact)
    if (!detail) {
      throw new Error("expected fullscreen close detail");
    }
    const closeDetail = detail as ComposeFullscreenCloseDetail;
    expect(closeDetail.json).toMatchObject({
      content: expect.arrayContaining([
        expect.objectContaining({
          type: "image",
          attrs: expect.objectContaining({
            src: "blob:inline-preview",
          }),
        }),
      ]),
    });
  });
});
