// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The capture needs a real layout engine; the card never finishes loading
// here, which leaves the dialog open and its actions disabled.
vi.mock("../../share-capture.js", () => ({
  prepareShareCard: vi.fn(),
}));

vi.mock("../../toast.js", () => ({
  showToast: vi.fn(),
}));

import { JantShareDialog } from "../jant-share-dialog.js";

beforeEach(() => {
  // happy-dom's <dialog> has no modal implementation.
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
});

afterEach(() => {
  document.body.innerHTML = "";
});

/** Opens the dialog from a trigger, on a card that is still loading. */
async function openDialog() {
  const trigger = document.createElement("button");
  document.body.appendChild(trigger);
  const dialog = new JantShareDialog();
  document.body.appendChild(dialog);
  void dialog.open(() => new Promise<string>(() => {}), trigger);
  await dialog.updateComplete;
  return { dialog, trigger };
}

describe("JantShareDialog", () => {
  it("closes from the bottom Close button and returns focus", async () => {
    const { dialog, trigger } = await openDialog();
    const close = dialog.querySelector<HTMLButtonElement>(
      ".share-dialog-close",
    );
    expect(close?.textContent?.trim()).toBe("Close");
    // Close works while the picture is still being made.
    expect(close?.disabled).toBe(false);

    close?.click();
    await dialog.updateComplete;
    await Promise.resolve();

    expect(dialog.querySelector(".share-dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on Escape", async () => {
    const { dialog, trigger } = await openDialog();

    dialog
      .querySelector(".share-dialog")
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    await dialog.updateComplete;
    await Promise.resolve();

    expect(dialog.querySelector(".share-dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
