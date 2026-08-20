// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import { initCustomUrlMenus } from "../custom-url-menu.js";

function renderMenus() {
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
      <div data-custom-url-menu role="menu" hidden>
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
      <div data-custom-url-menu role="menu" hidden>
        <button type="button" role="menuitem" data-custom-url-action="delete">
          Delete
        </button>
      </div>
    </div>
  `;

  initCustomUrlMenus();

  const triggers = document.querySelectorAll<HTMLButtonElement>(
    "[data-custom-url-action='toggle-menu']",
  );
  const menus = document.querySelectorAll<HTMLElement>(
    "[data-custom-url-menu]",
  );
  const menuItems = document.querySelectorAll<HTMLElement>("[role='menuitem']");

  return {
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
