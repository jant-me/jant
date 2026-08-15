// @vitest-environment happy-dom

/**
 * The shared post picker.
 *
 * It is deliberately ignorant of what it is picking for — the caller supplies
 * the copy and the search — so these tests are about the contract: it resolves
 * exactly once, it never lets a slow search overwrite a newer one, and it can
 * always be backed out of.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import "../jant-post-picker.js";
import type { JantPostPicker } from "../jant-post-picker.js";

function mountPicker(): JantPostPicker {
  const el = document.createElement("jant-post-picker") as JantPostPicker;
  document.body.appendChild(el);
  return el;
}

async function flush(el: JantPostPicker) {
  await el.updateComplete;
  await Promise.resolve();
  await el.updateComplete;
}

function type(el: JantPostPicker, value: string) {
  const input = el.querySelector<HTMLInputElement>(".picker-dialog-input");
  if (!input) throw new Error("expected the search input");
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function optionLabels(el: JantPostPicker): string[] {
  return Array.from(
    el.querySelectorAll<HTMLElement>(".picker-dialog-option-label"),
  ).map((node) => node.textContent?.trim() ?? "");
}

const BASE = {
  heading: "Link a translation",
  placeholder: "Search your posts…",
  emptyHint: "Nothing matched that you could link.",
};

describe("JantPostPicker", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
    // happy-dom does not implement the modal dialog methods.
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.removeAttribute("open");
      },
    });
  });

  it("shows the caller's copy", async () => {
    const el = mountPicker();
    void el.pick({ ...BASE, search: async () => [] });
    await flush(el);

    expect(el.querySelector(".picker-dialog-title")?.textContent).toContain(
      "Link a translation",
    );
    expect(
      el.querySelector<HTMLInputElement>(".picker-dialog-input")?.placeholder,
    ).toBe("Search your posts…");
  });

  it("resolves with the picked post", async () => {
    const el = mountPicker();
    const picked = el.pick({
      ...BASE,
      minQueryLength: 1,
      search: async () => [
        { id: "pst_one", label: "Coffee notes", meta: "English" },
      ],
    });
    await flush(el);

    type(el, "coffee");
    await new Promise((resolve) => setTimeout(resolve, 250));
    await flush(el);

    expect(optionLabels(el)).toEqual(["Coffee notes"]);
    el.querySelector<HTMLButtonElement>(".picker-dialog-option")?.click();

    expect(await picked).toBe("pst_one");
  });

  it("resolves to null when dismissed", async () => {
    const el = mountPicker();
    const picked = el.pick({ ...BASE, search: async () => [] });
    await flush(el);

    el.querySelector<HTMLDialogElement>(".picker-dialog")?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    expect(await picked).toBeNull();
  });

  it("says nothing matched rather than looking empty", async () => {
    const el = mountPicker();
    void el.pick({ ...BASE, minQueryLength: 1, search: async () => [] });
    await flush(el);

    type(el, "nothing");
    await new Promise((resolve) => setTimeout(resolve, 250));
    await flush(el);

    expect(el.textContent).toContain("Nothing matched that you could link.");
  });

  it("keeps quiet until the query is worth searching", async () => {
    const search = vi.fn(async () => []);
    const el = mountPicker();
    void el.pick({ ...BASE, search });
    await flush(el);

    type(el, "a");
    await new Promise((resolve) => setTimeout(resolve, 250));
    await flush(el);

    expect(search).not.toHaveBeenCalled();
    expect(el.textContent).not.toContain("Nothing matched");
  });

  it("does not let a slow search overwrite a newer one", async () => {
    const el = mountPicker();
    void el.pick({
      ...BASE,
      minQueryLength: 1,
      search: async (query) => {
        // The first query is slower than the second, which is exactly the race
        // a debounce alone does not fix.
        if (query === "slow") {
          await new Promise((resolve) => setTimeout(resolve, 120));
          return [{ id: "pst_stale", label: "Stale result" }];
        }
        return [{ id: "pst_fresh", label: "Fresh result" }];
      },
    });
    await flush(el);

    type(el, "slow");
    await new Promise((resolve) => setTimeout(resolve, 210));
    type(el, "fast");
    await new Promise((resolve) => setTimeout(resolve, 250));
    await flush(el);

    expect(optionLabels(el)).toEqual(["Fresh result"]);
  });

  it("abandons an earlier request when reopened", async () => {
    const el = mountPicker();
    const first = el.pick({ ...BASE, search: async () => [] });
    await flush(el);

    void el.pick({ ...BASE, search: async () => [] });

    expect(await first).toBeNull();
  });
});
