// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { openShareImageMock, warmShareImageMock, showToastMock } = vi.hoisted(
  () => ({
    openShareImageMock: vi.fn(),
    warmShareImageMock: vi.fn(),
    showToastMock: vi.fn(),
  }),
);

// The share dialog ships in its own bundle; the menu only hands it the post.
vi.mock("../../share-launch.js", () => ({
  openShareImage: openShareImageMock,
  warmShareImage: warmShareImageMock,
}));

vi.mock("../../toast.js", () => ({
  showToast: showToastMock,
}));

import { JantShareMenu } from "../jant-share-menu.js";

function click(element: globalThis.Element) {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function pressEscape() {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
}

function article(id: string, permalink: string): string {
  return `
    <article data-post data-post-id="${id}" data-post-permalink="${permalink}">
      <footer data-post-meta>
        <button type="button" data-share-menu-trigger aria-expanded="false">
          More actions
        </button>
      </footer>
    </article>
  `;
}

async function createMenu() {
  document.body.innerHTML =
    article("post-1", "/hello-world") + article("post-2", "/second");
  const menu = new JantShareMenu();
  document.body.appendChild(menu);
  await menu.updateComplete;
  const [first, second] = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-share-menu-trigger]"),
  );
  return { menu, first: first!, second: second! };
}

async function open(menu: JantShareMenu, trigger: HTMLElement) {
  click(trigger);
  await menu.updateComplete;
  await Promise.resolve();
}

beforeEach(() => {
  openShareImageMock.mockReset();
  warmShareImageMock.mockReset();
  showToastMock.mockReset();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("JantShareMenu", () => {
  it("opens on a post's More button with Copy link and Share as image", async () => {
    const { menu, first } = await createMenu();

    await open(menu, first);

    const items = Array.from(
      menu.querySelectorAll<HTMLElement>("[role='menuitem']"),
    );
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      "Copy link",
      "Share as image",
    ]);
    expect(first.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(items[0]);
    // So picking Share as image has no bundle left to wait for.
    expect(warmShareImageMock).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and returns focus to the button", async () => {
    const { menu, first } = await createMenu();
    await open(menu, first);

    pressEscape();
    await menu.updateComplete;

    expect(menu.querySelector("[role='menu']")).toBeNull();
    expect(first.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(first);
  });

  it("closes on a click outside it", async () => {
    const { menu, first } = await createMenu();
    await open(menu, first);

    click(menu.querySelector(".post-menu-backdrop")!);
    await menu.updateComplete;

    expect(menu.querySelector("[role='menu']")).toBeNull();
    expect(first.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes when its own button is pressed again", async () => {
    const { menu, first } = await createMenu();
    await open(menu, first);

    await open(menu, first);

    expect(menu.querySelector("[role='menu']")).toBeNull();
    expect(document.activeElement).toBe(first);
  });

  it("moves to another post's button, leaving one menu open", async () => {
    const { menu, first, second } = await createMenu();
    await open(menu, first);

    await open(menu, second);

    expect(menu.querySelectorAll("[role='menu']")).toHaveLength(1);
    expect(first.getAttribute("aria-expanded")).toBe("false");
    expect(second.getAttribute("aria-expanded")).toBe("true");
  });

  it("copies the post's own address, not the page's", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const { menu, second } = await createMenu();
    await open(menu, second);

    click(menu.querySelector("[data-share-menu-copy-link]")!);
    await vi.waitFor(() => expect(showToastMock).toHaveBeenCalled());

    expect(writeText).toHaveBeenCalledWith(
      new URL("/second", globalThis.location.href).href,
    );
    expect(showToastMock).toHaveBeenCalledWith("Link copied.");
    expect(menu.querySelector("[role='menu']")).toBeNull();
    expect(document.activeElement).toBe(second);
  });

  it("hands the post to the share dialog", async () => {
    const { menu, first } = await createMenu();
    await open(menu, first);

    click(menu.querySelector("[data-share-menu-share-image]")!);
    await menu.updateComplete;

    expect(openShareImageMock).toHaveBeenCalledWith("post-1", first);
    expect(menu.querySelector("[role='menu']")).toBeNull();
  });
});
