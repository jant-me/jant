// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  QUEUED_TOAST_STORAGE_KEY,
  consumeQueuedToast,
  queueToastForNextPage,
  showToast,
  showToastWithAction,
} from "../toast.js";

describe("toast", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="toast-container"></div>';
    globalThis.sessionStorage.clear();
    vi.useRealTimers();
  });

  it("queues and consumes a toast on the next page load", () => {
    queueToastForNextPage("Published!");

    expect(globalThis.sessionStorage.getItem(QUEUED_TOAST_STORAGE_KEY)).toBe(
      '{"message":"Published!","type":"success"}',
    );

    expect(consumeQueuedToast()).toBe(true);
    expect(globalThis.sessionStorage.getItem(QUEUED_TOAST_STORAGE_KEY)).toBe(
      null,
    );
    expect(
      document.querySelector("#toast-container .toast span")?.textContent,
    ).toBe("Published!");
  });

  it("restores queued action toasts", () => {
    queueToastForNextPage("Published!", "success", {
      label: "View",
      href: "/published-post",
    });

    expect(consumeQueuedToast()).toBe(true);

    const action = document.querySelector<HTMLAnchorElement>(
      "#toast-container .toast .toast-action",
    );
    expect(action?.textContent).toBe("View");
    expect(action?.getAttribute("href")).toBe("/published-post");
  });

  it("renders error toasts without a copy button — text is selectable instead", () => {
    showToast("Publish failed.", "error");

    const toast = document.querySelector(".toast-error");
    expect(toast).not.toBeNull();
    expect(toast?.querySelector("button")).toBeNull();
  });

  it("pauses auto-dismiss while hovered and resumes the remaining time", () => {
    vi.useFakeTimers();
    showToast("Publish failed.", "error");
    const toast = document.querySelector<HTMLElement>(".toast");
    if (!toast) throw new Error("toast not rendered");

    vi.advanceTimersByTime(2000);
    toast.dispatchEvent(new Event("pointerenter"));
    vi.advanceTimersByTime(60_000);
    expect(toast.classList.contains("toast-out")).toBe(false);

    toast.dispatchEvent(new Event("pointerleave"));
    vi.advanceTimersByTime(999);
    expect(toast.classList.contains("toast-out")).toBe(false);
    vi.advanceTimersByTime(1);
    expect(toast.classList.contains("toast-out")).toBe(true);
  });

  it("pauses auto-dismiss while focus is inside the toast", () => {
    vi.useFakeTimers();
    showToastWithAction("Collection created.", {
      label: "Edit Navigation",
      href: "/settings/navigation",
    });
    const toast = document.querySelector<HTMLElement>(".toast");
    if (!toast) throw new Error("toast not rendered");

    toast.dispatchEvent(new Event("focusin"));
    vi.advanceTimersByTime(60_000);
    expect(toast.classList.contains("toast-out")).toBe(false);

    toast.dispatchEvent(new Event("focusout"));
    vi.advanceTimersByTime(5000);
    expect(toast.classList.contains("toast-out")).toBe(true);
  });

  it("mounts toasts inside an open modal dialog and restores them on close", async () => {
    const dialog = document.createElement("dialog");
    document.body.appendChild(dialog);
    dialog.showModal();

    showToast("Publish failed.", "error");

    const container = document.getElementById("toast-container");
    expect(container?.parentElement).toBe(dialog);
    expect(container?.querySelector(".toast span")?.textContent).toBe(
      "Publish failed.",
    );

    dialog.close();
    // the dialog close event is dispatched in a queued task
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container?.parentElement).toBe(document.body);
  });

  it("keeps action toasts available longer than passive notifications", () => {
    vi.useFakeTimers();
    showToastWithAction("Collection created.", {
      label: "Edit Navigation",
      href: "/settings/navigation",
    });
    const toast = document.querySelector<HTMLElement>(".toast");

    vi.advanceTimersByTime(3000);
    expect(toast?.classList.contains("toast-out")).toBe(false);

    vi.advanceTimersByTime(2000);
    expect(toast?.classList.contains("toast-out")).toBe(true);
  });
});
