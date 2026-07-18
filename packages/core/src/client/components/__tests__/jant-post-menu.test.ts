// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

const { showConfirmDialogMock, showToastMock } = vi.hoisted(() => ({
  showConfirmDialogMock: vi.fn(),
  showToastMock: vi.fn(),
}));

vi.mock("../confirm.js", () => ({
  showConfirmDialog: showConfirmDialogMock,
}));

vi.mock("../toast.js", () => ({
  showToast: showToastMock,
}));

import { JantPostMenu, removeLeadingFeedDivider } from "../jant-post-menu.js";

function requireElement<T extends globalThis.Element>(
  element: T | null,
  message: string,
): T {
  if (!element) {
    throw new Error(message);
  }
  return element;
}

function click(element: globalThis.Element) {
  element.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      composed: true,
      detail: 1,
    }),
  );
}

function keydown(
  element: globalThis.Element,
  key: string,
  init: globalThis.KeyboardEventInit = {},
) {
  element.dispatchEvent(
    new globalThis.KeyboardEvent("keydown", {
      bubbles: true,
      key,
      ...init,
    }),
  );
}

function collectionPickerTitles(root: globalThis.Element): string[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(".post-menu-picker-option"),
  ).map(
    (option) =>
      option.querySelector(".post-menu-picker-title")?.textContent?.trim() ??
      "",
  );
}

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
  Object.defineProperty(document.documentElement, "clientWidth", {
    configurable: true,
    value: width,
  });
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function createMenu(): Promise<{
  menu: JantPostMenu;
  trigger: HTMLButtonElement;
}> {
  document.body.innerHTML = `
    <article
      data-post
      data-post-id="post-1"
      data-post-visibility="latest_hidden"
    >
      <button
        type="button"
        data-post-menu-trigger
        aria-expanded="false"
      >
        More actions
      </button>
    </article>
  `;

  const composeDialog = document.createElement(
    "jant-compose-dialog",
  ) as HTMLElement & { labels?: unknown };
  composeDialog.labels = {
    addCollection: "Add Collection",
    collectionFormLabels: {
      cancelLabel: "Cancel",
      quickHint: "More options are available after you create it.",
      quickSubmitLabel: "Done",
    },
  };
  document.body.appendChild(composeDialog);

  const menu = document.createElement("jant-post-menu") as JantPostMenu;
  document.body.appendChild(menu);
  await menu.updateComplete;

  const trigger = requireElement(
    document.querySelector<HTMLButtonElement>("[data-post-menu-trigger]"),
    "expected post menu trigger",
  );

  return { menu, trigger };
}

describe("JantPostMenu", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    setViewport(1024, 768);
    showConfirmDialogMock.mockReset();
    showToastMock.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: unknown, init?: globalThis.RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url === "/api/collections?view=compose") {
          return Promise.resolve(
            jsonResponse({
              collections: [
                { id: "collection-1", title: "Movies", slug: "movies" },
              ],
            }),
          );
        }
        if (url === "/api/posts/post-1" && method === "GET") {
          return Promise.resolve(
            jsonResponse({
              collectionIds: ["collection-1"],
            }),
          );
        }
        if (url === "/api/posts/post-1" && method === "DELETE") {
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        throw new Error(`Unexpected fetch in test: ${url}`);
      }),
    );
  });

  it("moves visibility controls into a submenu", async () => {
    const { menu, trigger } = await createMenu();

    click(trigger);
    await menu.updateComplete;

    const visibilityButton = requireElement(
      menu.querySelector<HTMLElement>("[data-post-menu-open-visibility]"),
      "expected visibility button in main menu",
    );
    expect(visibilityButton.textContent).toContain("Visibility");
    expect(menu.textContent).toContain("Hidden from Latest");

    click(visibilityButton);
    await menu.updateComplete;

    expect(menu.querySelector("[data-visibility-panel]")).not.toBeNull();
    expect(menu.textContent).toContain("Public");
    expect(menu.textContent).toContain("Hidden from Latest");
    expect(menu.textContent).toContain("Private");
  });

  it("returns to the main menu before closing on Escape", async () => {
    const { menu, trigger } = await createMenu();

    click(trigger);
    await menu.updateComplete;
    click(
      requireElement(
        menu.querySelector<HTMLElement>("[data-post-menu-open-visibility]"),
        "expected visibility button in main menu",
      ),
    );
    await menu.updateComplete;

    document.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", {
        bubbles: true,
        key: "Escape",
      }),
    );
    await menu.updateComplete;

    expect(menu.querySelector("[data-visibility-panel]")).toBeNull();
    expect(
      menu.querySelector("[data-post-menu-open-visibility]"),
    ).not.toBeNull();

    document.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", {
        bubbles: true,
        key: "Escape",
      }),
    );
    await menu.updateComplete;

    expect(menu.textContent?.trim()).toBe("");
  });

  it("anchors to the trigger edge using document coordinates", async () => {
    setViewport(1440, 900);
    const { menu, trigger } = await createMenu();
    trigger.getBoundingClientRect = () =>
      new globalThis.DOMRect(736, 240, 24, 24);

    click(trigger);
    await menu.updateComplete;

    const wrapper = requireElement(
      menu.querySelector<HTMLElement>(".dropdown-menu"),
      "expected dropdown wrapper",
    );
    const style = wrapper.getAttribute("style") ?? "";

    expect(style).toContain("position:absolute");
    expect(style).toContain("left:760px");
    expect(style).toContain("top:270px");
    expect(style).toContain("translateX(-100%)");
  });

  it("includes the current document scroll offset in its anchor position", async () => {
    Object.defineProperty(window, "scrollX", {
      configurable: true,
      value: 24,
    });
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 320,
    });

    const { menu, trigger } = await createMenu();
    trigger.getBoundingClientRect = () =>
      new globalThis.DOMRect(736, 240, 24, 24);

    click(trigger);
    await menu.updateComplete;

    const wrapper = requireElement(
      menu.querySelector<HTMLElement>(".dropdown-menu"),
      "expected dropdown wrapper",
    );
    const style = wrapper.getAttribute("style") ?? "";

    expect(style).toContain("left:784px");
    expect(style).toContain("top:590px");
  });

  it("hides the collection picker surface behind quick add", async () => {
    const { menu, trigger } = await createMenu();

    click(trigger);
    await menu.updateComplete;

    click(
      requireElement(
        menu.querySelector<HTMLElement>("[data-post-menu-open-collections]"),
        "expected collections button in main menu",
      ),
    );
    await Promise.resolve();
    await menu.updateComplete;

    click(
      requireElement(
        menu.querySelector<HTMLElement>("[data-post-menu-add-collection]"),
        "expected add collection button in collection picker",
      ),
    );
    await menu.updateComplete;

    expect(menu.querySelector(".dropdown-menu")).toBeNull();
    expect(menu.querySelector(".post-menu-backdrop")).toBeNull();
    expect(menu.querySelector("[data-collection-quick-dialog]")).not.toBeNull();
  });

  it("moves collection focus with arrow keys and toggles with Space", async () => {
    const selectedIds = ["collection-1"];
    const fetchMock = vi.fn(
      async (input: unknown, init?: globalThis.RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url === "/api/collections?view=compose" && method === "GET") {
          return jsonResponse({
            collections: [
              { id: "collection-1", title: "Movies", slug: "movies" },
              { id: "collection-2", title: "Books", slug: "books" },
            ],
          });
        }

        if (url === "/api/posts/post-1" && method === "GET") {
          return jsonResponse({ collectionIds: [...selectedIds] });
        }

        if (
          url === "/api/collections/collection-1/threads/post-1" &&
          method === "DELETE"
        ) {
          selectedIds.splice(0, 1);
          return new Response(null, { status: 204 });
        }

        throw new Error(`Unexpected fetch in test: ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { menu, trigger } = await createMenu();

    click(trigger);
    await menu.updateComplete;

    click(
      requireElement(
        menu.querySelector<HTMLElement>("[data-post-menu-open-collections]"),
        "expected collections button in main menu",
      ),
    );
    await Promise.resolve();
    await menu.updateComplete;

    await vi.waitFor(() => {
      expect(
        menu.querySelector<HTMLInputElement>(".post-menu-picker-search input"),
      ).not.toBeNull();
      expect(collectionPickerTitles(menu)).toEqual(["Movies", "Books"]);
    });

    const searchInput = requireElement(
      menu.querySelector<HTMLInputElement>(".post-menu-picker-search input"),
      "expected collection search input",
    );
    expect(document.activeElement).toBe(searchInput);

    keydown(searchInput, "ArrowDown");
    await menu.updateComplete;

    let options = Array.from(
      menu.querySelectorAll<HTMLButtonElement>(".post-menu-picker-option"),
    );
    expect(document.activeElement).toBe(options[0]);

    keydown(
      requireElement(options[0] ?? null, "expected first option"),
      "ArrowDown",
    );
    await menu.updateComplete;
    options = Array.from(
      menu.querySelectorAll<HTMLButtonElement>(".post-menu-picker-option"),
    );
    expect(document.activeElement).toBe(options[1]);

    keydown(
      requireElement(options[1] ?? null, "expected second option"),
      "ArrowUp",
    );
    await menu.updateComplete;
    options = Array.from(
      menu.querySelectorAll<HTMLButtonElement>(".post-menu-picker-option"),
    );
    expect(document.activeElement).toBe(options[0]);

    keydown(requireElement(options[0] ?? null, "expected first option"), " ");
    await Promise.resolve();
    await menu.updateComplete;
    expect(menu._threadCollectionIds).toEqual([]);

    options = Array.from(
      menu.querySelectorAll<HTMLButtonElement>(".post-menu-picker-option"),
    );
    expect(document.activeElement).toBe(options[0]);

    keydown(
      requireElement(options[0] ?? null, "expected first option"),
      "ArrowUp",
    );
    await menu.updateComplete;
    expect(document.activeElement).toBe(searchInput);
  });

  it("derives Child action scope from Thread identity", async () => {
    const { menu, trigger } = await createMenu();
    const article = requireElement(
      trigger.closest<HTMLElement>("article[data-post]"),
      "expected post article",
    );
    article.dataset.postId = "reply-1";
    article.dataset.threadRootId = "post-1";
    document.body.insertAdjacentHTML(
      "afterbegin",
      '<div data-collection-id="collection-1"></div>',
    );

    click(trigger);
    await menu.updateComplete;

    expect(menu.textContent).toContain("Edit");
    expect(menu.textContent).toContain("Add to Featured");
    expect(menu.textContent).toContain("Delete");
    expect(menu.querySelector("[data-post-menu-open-collections]")).toBeNull();
    expect(menu.querySelector("[data-post-menu-open-visibility]")).toBeNull();
    expect(menu.textContent).not.toContain("Pin this post");
    expect(menu.textContent).not.toContain("Pin in collection");
  });

  it("blocks the collection shortcut for a Child without a reply marker", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    const { menu, trigger } = await createMenu();
    const article = requireElement(
      trigger.closest<HTMLElement>("article[data-post]"),
      "expected post article",
    );
    article.dataset.postId = "reply-1";
    article.dataset.threadRootId = "post-1";

    menu.openCollectionsForPost(article);
    await menu.updateComplete;

    expect(menu.textContent?.trim()).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("closes the collection picker with Enter without toggling the focused option", async () => {
    const selectedIds = ["collection-1"];
    const fetchMock = vi.fn(
      async (input: unknown, init?: globalThis.RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url === "/api/collections?view=compose" && method === "GET") {
          return jsonResponse({
            collections: [
              { id: "collection-1", title: "Movies", slug: "movies" },
              { id: "collection-2", title: "Books", slug: "books" },
            ],
          });
        }

        if (url === "/api/posts/post-1" && method === "GET") {
          return jsonResponse({ collectionIds: [...selectedIds] });
        }

        throw new Error(`Unexpected fetch in test: ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { menu, trigger } = await createMenu();

    click(trigger);
    await menu.updateComplete;

    click(
      requireElement(
        menu.querySelector<HTMLElement>("[data-post-menu-open-collections]"),
        "expected collections button in main menu",
      ),
    );
    await Promise.resolve();
    await menu.updateComplete;

    await vi.waitFor(() => {
      expect(
        menu.querySelectorAll<HTMLButtonElement>(".post-menu-picker-option"),
      ).toHaveLength(2);
    });

    const firstOption = requireElement(
      menu.querySelector<HTMLButtonElement>(".post-menu-picker-option"),
      "expected first collection option",
    );
    firstOption.focus();

    keydown(firstOption, "Enter");
    await menu.updateComplete;

    expect(menu._threadCollectionIds).toEqual(["collection-1"]);
    expect(menu.textContent?.trim()).toBe("");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("does not restore focus to the trigger when the shortcut opens the collection picker and Enter closes it", async () => {
    const { menu, trigger } = await createMenu();
    const article = requireElement(
      trigger.closest<HTMLElement>("article[data-post]"),
      "expected post article",
    );

    menu.openCollectionsForPost(article);
    await Promise.resolve();
    await menu.updateComplete;

    await vi.waitFor(() => {
      expect(
        menu.querySelector<HTMLInputElement>(".post-menu-picker-search input"),
      ).not.toBeNull();
    });

    const searchInput = requireElement(
      menu.querySelector<HTMLInputElement>(".post-menu-picker-search input"),
      "expected collection search input",
    );
    searchInput.focus();

    keydown(searchInput, "Enter");
    await menu.updateComplete;

    expect(menu.textContent?.trim()).toBe("");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).not.toBe(trigger);
  });

  it("does not restore focus to the trigger when the shortcut-opened picker closes on Escape", async () => {
    const { menu, trigger } = await createMenu();
    const article = requireElement(
      trigger.closest<HTMLElement>("article[data-post]"),
      "expected post article",
    );

    menu.openCollectionsForPost(article);
    await Promise.resolve();
    await menu.updateComplete;

    await vi.waitFor(() => {
      expect(
        menu.querySelector<HTMLInputElement>(".post-menu-picker-search input"),
      ).not.toBeNull();
    });

    document.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", {
        bubbles: true,
        key: "Escape",
      }),
    );
    await menu.updateComplete;

    expect(menu.querySelector("[data-post-menu-item-primary]")).not.toBeNull();

    document.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", {
        bubbles: true,
        key: "Escape",
      }),
    );
    await menu.updateComplete;

    expect(menu.textContent?.trim()).toBe("");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).not.toBe(trigger);
  });

  it("keeps selected collections first when opening and after reopening", async () => {
    const selectedIds = ["collection-2"];
    const fetchMock = vi.fn(
      async (input: unknown, init?: globalThis.RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url === "/api/collections?view=compose" && method === "GET") {
          return jsonResponse({
            collections: [
              { id: "collection-1", title: "Books", slug: "books" },
              { id: "collection-2", title: "Movies", slug: "movies" },
              { id: "collection-3", title: "Travel", slug: "travel" },
            ],
          });
        }

        if (url === "/api/posts/post-1" && method === "GET") {
          return jsonResponse({ collectionIds: [...selectedIds] });
        }

        if (
          url === "/api/collections/collection-3/threads" &&
          method === "POST"
        ) {
          selectedIds.push("collection-3");
          return new Response(null, { status: 200 });
        }

        if (
          url === "/api/collections/collection-2/threads/post-1" &&
          method === "DELETE"
        ) {
          const index = selectedIds.indexOf("collection-2");
          if (index >= 0) selectedIds.splice(index, 1);
          return new Response(null, { status: 204 });
        }

        throw new Error(`Unexpected fetch in test: ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { menu, trigger } = await createMenu();

    click(trigger);
    await menu.updateComplete;

    click(
      requireElement(
        menu.querySelector<HTMLElement>("[data-post-menu-open-collections]"),
        "expected collections button in main menu",
      ),
    );
    await Promise.resolve();
    await menu.updateComplete;

    await vi.waitFor(() => {
      expect(collectionPickerTitles(menu)).toEqual([
        "Movies",
        "Books",
        "Travel",
      ]);
    });

    const options = menu.querySelectorAll<HTMLElement>(
      ".post-menu-picker-option",
    );
    click(
      requireElement(options[2] ?? null, "expected third collection option"),
    );
    await Promise.resolve();
    await menu.updateComplete;

    expect(collectionPickerTitles(menu)).toEqual(["Movies", "Books", "Travel"]);

    click(
      requireElement(
        menu.querySelector<HTMLElement>(".post-menu-panel-back"),
        "expected collection panel back button",
      ),
    );
    await menu.updateComplete;

    click(
      requireElement(
        menu.querySelector<HTMLElement>("[data-post-menu-open-collections]"),
        "expected collections button in main menu",
      ),
    );
    await Promise.resolve();
    await menu.updateComplete;

    await vi.waitFor(() => {
      expect(collectionPickerTitles(menu)).toEqual([
        "Movies",
        "Travel",
        "Books",
      ]);
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/collections?view=compose", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  });

  it("closes the menu before waiting on delete confirmation", async () => {
    const confirmation = deferred<boolean>();
    showConfirmDialogMock.mockReturnValueOnce(confirmation.promise);

    const { menu, trigger } = await createMenu();

    click(trigger);
    await menu.updateComplete;

    click(
      requireElement(
        menu.querySelector<HTMLElement>(".post-menu-item-danger"),
        "expected delete button in main menu",
      ),
    );
    await Promise.resolve();
    await menu.updateComplete;

    expect(menu.textContent?.trim()).toBe("");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    confirmation.resolve(false);
    await Promise.resolve();
  });

  it("removes the leading feed divider from the first remaining timeline item", async () => {
    const host = document.createElement("div");
    host.innerHTML = `
      <div class="feed-item" data-timeline-item-id="post-1"></div>
      <div class="feed-item" data-timeline-item-id="post-2">
        <hr class="feed-divider" />
      </div>
    `;

    host.firstElementChild?.remove();
    removeLeadingFeedDivider(host);

    const remainingItems = Array.from(
      host.querySelectorAll<HTMLElement>(".feed-item"),
    );
    expect(remainingItems).toHaveLength(1);
    expect(remainingItems[0]?.dataset.timelineItemId).toBe("post-2");
    expect(remainingItems[0]?.querySelector(".feed-divider")).toBeNull();
  });
});
