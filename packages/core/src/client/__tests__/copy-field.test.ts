// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "../copy-field.js";

const FEED_URL = "https://example.com/feed";
const COPIED = "Feed URL copied.";
const FAILED = "Could not copy. Select the address and copy it.";

function requireElement<T>(element: T | null | undefined, message: string): T {
  if (!element) throw new Error(message);
  return element;
}

function renderField({ hiddenButton = false } = {}): {
  input: HTMLInputElement;
  button: HTMLButtonElement;
} {
  document.body.innerHTML = `
    <div id="toast-container"></div>
    <div data-copy-field-root>
      <div class="relative">
        <input type="text" readonly value="${FEED_URL}" data-copy-field-value />
        <button
          type="button"
          ${hiddenButton ? "hidden" : ""}
          data-copy-field="${COPIED}"
          data-copy-field-failed="${FAILED}"
        >Copy</button>
      </div>
    </div>
  `;

  return {
    input: requireElement(
      document.querySelector<HTMLInputElement>("[data-copy-field-value]"),
      "expected the address input",
    ),
    button: requireElement(
      document.querySelector<HTMLButtonElement>("[data-copy-field]"),
      "expected the copy button",
    ),
  };
}

function toastText(): string {
  return document.getElementById("toast-container")?.textContent ?? "";
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("copy field", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("copying", () => {
    beforeEach(() => {
      document.body.innerHTML = "";
    });

    it("copies the address and reports it", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(globalThis.navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });

      const { button } = renderField();
      button.click();
      await settle();

      expect(writeText).toHaveBeenCalledWith(FEED_URL);
      expect(toastText()).toContain(COPIED);
    });

    // The Clipboard API is absent on insecure origins and can be denied by
    // permission. Failing loudly is what points the reader at selecting the
    // address by hand instead.
    it("reports a failure when the clipboard is unavailable", async () => {
      Object.defineProperty(globalThis.navigator, "clipboard", {
        value: undefined,
        configurable: true,
      });

      const { button } = renderField();
      button.click();
      await settle();

      expect(toastText()).toContain("Could not copy");
    });

    it("reports a failure when the clipboard refuses", async () => {
      const writeText = vi.fn().mockRejectedValue(new Error("denied"));
      Object.defineProperty(globalThis.navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });

      const { button } = renderField();
      button.click();
      await settle();

      expect(toastText()).toContain("Could not copy");
    });

    it("finds fields added after load", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(globalThis.navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });

      // Nothing re-runs against new markup; the listener is on the document.
      const { button } = renderField();
      button.click();
      await settle();

      expect(writeText).toHaveBeenCalledWith(FEED_URL);
    });
  });

  describe("manual selection fallback", () => {
    beforeEach(() => {
      document.body.innerHTML = "";
    });

    it("selects the whole address on click", () => {
      const { input } = renderField();
      const select = vi.spyOn(input, "select");

      input.dispatchEvent(new Event("click", { bubbles: true }));

      expect(select).toHaveBeenCalledTimes(1);
    });

    it("selects the whole address on focus", () => {
      const { input } = renderField();
      const select = vi.spyOn(input, "select");

      input.dispatchEvent(new Event("focus"));

      expect(select).toHaveBeenCalledTimes(1);
    });
  });

  // The server ships the button hidden so that without this script the field
  // degrades to a selectable input rather than a button that does nothing.
  describe("revealing the button", () => {
    it("reveals a button the server rendered hidden", () => {
      const { button } = renderField({ hiddenButton: true });
      expect(button.hidden).toBe(true);

      document.dispatchEvent(new Event("DOMContentLoaded"));

      expect(button.hidden).toBe(false);
    });
  });
});
