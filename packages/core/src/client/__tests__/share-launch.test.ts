// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { ensureShareMock, showToastMock } = vi.hoisted(() => ({
  ensureShareMock: vi.fn(async () => {}),
  showToastMock: vi.fn(),
}));

vi.mock("../lazy-entries.js", () => ({ ensureShare: ensureShareMock }));
vi.mock("../toast.js", () => ({ showToast: showToastMock }));

/** Stands in for the dialog the share bundle defines. */
class FakeShareDialog extends HTMLElement {
  open = vi.fn(async () => {});
}
customElements.define("jant-share-dialog", FakeShareDialog);

const STYLESHEET = "/_assets/client-share-abc123.css";

/** The links `share-launch` puts in the head, kept out of the document. */
let linked: globalThis.HTMLLinkElement[];

beforeEach(() => {
  vi.resetModules();
  ensureShareMock.mockClear();
  showToastMock.mockReset();
  document.documentElement.dataset.shareStylesheet = STYLESHEET;
  linked = [];
  // Inserted for real, happy-dom would fetch the sheet; the test plays the
  // browser's part and fires load or error itself.
  vi.spyOn(document.head, "appendChild").mockImplementation(
    <T extends Node>(node: T) => {
      linked.push(node as unknown as globalThis.HTMLLinkElement);
      return node;
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("<div data-share-card></div>")),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function dialog(): FakeShareDialog | null {
  return document.querySelector<FakeShareDialog>("jant-share-dialog");
}

describe("openShareImage", () => {
  it("opens the dialog once the share stylesheet has loaded", async () => {
    const { openShareImage } = await import("../share-launch.js");

    const opening = openShareImage("post-1");
    await vi.waitFor(() => expect(linked).toHaveLength(1));
    expect(linked[0]!.rel).toBe("stylesheet");
    expect(linked[0]!.getAttribute("href")).toBe(STYLESHEET);
    expect(dialog()).toBeNull();

    linked[0]!.dispatchEvent(new Event("load"));
    await opening;

    expect(dialog()?.open).toHaveBeenCalledTimes(1);
  });

  it("links the stylesheet once however often it opens", async () => {
    const { openShareImage, warmShareImage } =
      await import("../share-launch.js");
    warmShareImage();
    await vi.waitFor(() => expect(linked).toHaveLength(1));
    linked[0]!.dispatchEvent(new Event("load"));

    await openShareImage("post-1");
    await openShareImage("post-2");

    expect(linked).toHaveLength(1);
    expect(dialog()?.open).toHaveBeenCalledTimes(2);
  });

  it("reports a stylesheet that fails, and links it again next time", async () => {
    const { openShareImage } = await import("../share-launch.js");

    const failing = openShareImage("post-1");
    await vi.waitFor(() => expect(linked).toHaveLength(1));
    linked[0]!.dispatchEvent(new Event("error"));
    await failing;

    expect(showToastMock).toHaveBeenCalledWith(
      "Could not open sharing. Check your connection and try again.",
      "error",
    );
    expect(dialog()).toBeNull();

    const retry = openShareImage("post-1");
    await vi.waitFor(() => expect(linked).toHaveLength(2));
    linked[1]!.dispatchEvent(new Event("load"));
    await retry;

    expect(dialog()?.open).toHaveBeenCalledTimes(1);
  });
});
