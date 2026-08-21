// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import { initCustomUrlMenus } from "../custom-url-menu.js";

/**
 * happy-dom has no popover API, so the top layer is stubbed: `showPopover`
 * and `hidePopover` drive a flag that `:popover-open` then reports, the same
 * contract the browser offers.
 */
function stubTopLayer(menu: HTMLElement) {
  let shown = false;
  const nativeMatches = menu.matches.bind(menu);

  Object.assign(menu, {
    showPopover: () => {
      shown = true;
    },
    hidePopover: () => {
      shown = false;
    },
    matches: (selector: string) =>
      selector === ":popover-open" ? shown : nativeMatches(selector),
  });

  return () => shown;
}

/** happy-dom lays nothing out, so anchoring math needs stated geometry. */
function stubRect(el: HTMLElement, rect: Partial<globalThis.DOMRect>) {
  el.getBoundingClientRect = () =>
    ({
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      width: 0,
      height: 0,
      ...rect,
    }) as globalThis.DOMRect;
}

function renderMenus({ topLayer = false } = {}) {
  document.body.innerHTML = `
    <div data-custom-url-actions>
      <code data-row-blank-space>/first</code>
      <button
        type="button"
        data-custom-url-action="toggle-menu"
        aria-expanded="false"
      >
        More actions
      </button>
      <div data-custom-url-menu role="menu" popover="manual" hidden>
        <button type="button" role="menuitem" data-custom-url-action="delete">
          Delete
        </button>
      </div>
    </div>
    <div data-custom-url-actions>
      <button
        type="button"
        data-custom-url-action="toggle-menu"
        aria-expanded="false"
      >
        More actions
      </button>
      <div data-custom-url-menu role="menu" popover="manual" hidden>
        <button type="button" role="menuitem" data-custom-url-action="delete">
          Delete
        </button>
      </div>
    </div>
  `;

  const menus = document.querySelectorAll<HTMLElement>(
    "[data-custom-url-menu]",
  );
  // Stubbed before init: the script reads popover support once, up front.
  const isInTopLayer = topLayer ? stubTopLayer(menus[0]!) : () => false;

  initCustomUrlMenus();

  const triggers = document.querySelectorAll<HTMLButtonElement>(
    "[data-custom-url-action='toggle-menu']",
  );
  const menuItems = document.querySelectorAll<HTMLElement>("[role='menuitem']");

  return {
    isInTopLayer,
    firstRowBlankSpace: document.querySelector<HTMLElement>(
      "[data-row-blank-space]",
    ),
    firstTrigger: triggers[0],
    secondTrigger: triggers[1],
    firstMenu: menus[0],
    secondMenu: menus[1],
    firstDeleteButton: menuItems[0],
  };
}

describe("custom URL menus", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("closes when clicking outside the row", () => {
    const { firstTrigger, firstMenu } = renderMenus();

    firstTrigger?.click();
    expect(firstMenu?.hidden).toBe(false);
    expect(firstTrigger?.getAttribute("aria-expanded")).toBe("true");

    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(firstMenu?.hidden).toBe(true);
    expect(firstTrigger?.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes when clicking blank space in its own row", () => {
    const { firstTrigger, firstMenu, firstRowBlankSpace } = renderMenus();

    firstTrigger?.click();
    expect(firstMenu?.hidden).toBe(false);

    firstRowBlankSpace?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );

    expect(firstMenu?.hidden).toBe(true);
    expect(firstTrigger?.getAttribute("aria-expanded")).toBe("false");
  });

  it("stays open when clicking inside the menu", () => {
    const { firstTrigger, firstMenu } = renderMenus();

    firstTrigger?.click();
    firstMenu?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(firstMenu?.hidden).toBe(false);
    expect(firstTrigger?.getAttribute("aria-expanded")).toBe("true");
  });

  it("closes on Escape and returns focus to the trigger", () => {
    const { firstTrigger, firstMenu, firstDeleteButton } = renderMenus();

    firstTrigger?.click();
    firstDeleteButton?.focus();

    firstMenu?.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", { key: "Escape" }),
    );

    expect(firstMenu?.hidden).toBe(true);
    expect(firstTrigger?.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(firstTrigger);
  });

  it("shows in the top layer and anchors itself to the trigger", () => {
    const { firstTrigger, firstMenu, isInTopLayer } = renderMenus({
      topLayer: true,
    });

    firstTrigger?.click();

    expect(isInTopLayer()).toBe(true);
    // The row list clips its children, so an open menu escapes to the top
    // layer and is positioned against the viewport instead of the row.
    expect(firstMenu?.style.top).not.toBe("");
    expect(firstMenu?.style.left).not.toBe("");

    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(isInTopLayer()).toBe(false);
    expect(firstMenu?.hidden).toBe(true);
  });

  // The viewport is 1024x768 under happy-dom.
  it("anchors below the trigger when the viewport has room", () => {
    const { firstTrigger, firstMenu } = renderMenus({ topLayer: true });
    stubRect(firstTrigger!, { top: 100, bottom: 126, right: 500 });
    stubRect(firstMenu!, { width: 140, height: 120 });

    firstTrigger?.click();

    expect(firstMenu?.style.top).toBe("132px");
    expect(firstMenu?.style.left).toBe("360px");
  });

  it("flips above the trigger when the viewport bottom is too close", () => {
    const { firstTrigger, firstMenu } = renderMenus({ topLayer: true });
    stubRect(firstTrigger!, { top: 700, bottom: 726, right: 500 });
    stubRect(firstMenu!, { width: 140, height: 120 });

    firstTrigger?.click();

    expect(firstMenu?.style.top).toBe("574px");
    expect(firstMenu?.style.left).toBe("360px");
  });

  it("keeps the menu inside the left viewport edge", () => {
    const { firstTrigger, firstMenu } = renderMenus({ topLayer: true });
    stubRect(firstTrigger!, { top: 100, bottom: 126, right: 60 });
    stubRect(firstMenu!, { width: 140, height: 120 });

    firstTrigger?.click();

    expect(firstMenu?.style.left).toBe("8px");
  });

  it("closes the previous menu when another one opens", () => {
    const { firstTrigger, secondTrigger, firstMenu, secondMenu } =
      renderMenus();

    firstTrigger?.click();
    expect(firstMenu?.hidden).toBe(false);

    secondTrigger?.click();

    expect(firstMenu?.hidden).toBe(true);
    expect(secondMenu?.hidden).toBe(false);
    expect(firstTrigger?.getAttribute("aria-expanded")).toBe("false");
    expect(secondTrigger?.getAttribute("aria-expanded")).toBe("true");
  });
});
