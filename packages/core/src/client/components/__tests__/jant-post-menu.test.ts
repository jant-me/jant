// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

const { showConfirmDialogMock, showToastMock } = vi.hoisted(() => ({
  showConfirmDialogMock: vi.fn(),
  showToastMock: vi.fn(),
}));

// Paths are relative to the *component*, which lives one level up from this
// folder — `../confirm.js` from here names a file that does not exist, so the
// mock silently never applied and the real dialog ran instead.
vi.mock("../../confirm.js", () => ({
  showConfirmDialog: showConfirmDialogMock,
}));

vi.mock("../../toast.js", () => ({
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

  describe("language panel", () => {
    /** Open the menu on a Thread that already has an English version. */
    async function openLanguagePanel(
      translations: Array<Record<string, unknown>> = [
        {
          id: "post-en",
          slug: "coffee-notes",
          label: "Coffee notes",
          language: "en",
        },
      ],
      languages: Array<{ tag: string; label: string }> = [
        { tag: "zh-Hans", label: "简体中文" },
        { tag: "en", label: "English" },
        { tag: "ja", label: "日本語" },
      ],
    ) {
      const { menu, trigger } = await createMenu();
      const article = requireElement(
        document.querySelector<HTMLElement>("article[data-post-id]"),
        "expected the post article",
      );
      article.dataset.postLanguage = "zh-Hans";

      menu.languages = languages;
      await menu.updateComplete;

      const existingFetch = globalThis.fetch as (
        input: unknown,
        init?: globalThis.RequestInit,
      ) => Promise<Response>;
      vi.stubGlobal(
        "fetch",
        vi.fn((input: unknown, init?: globalThis.RequestInit) => {
          const url = String(input);
          if (url === "/api/posts/post-1/translations") {
            return Promise.resolve(jsonResponse({ translations }));
          }
          if (
            url.endsWith("/translations") &&
            (init?.method ?? "GET") === "DELETE"
          ) {
            return Promise.resolve(new Response(null, { status: 204 }));
          }
          return existingFetch(input, init);
        }),
      );

      click(trigger);
      await menu.updateComplete;
      click(
        requireElement(
          menu.querySelector<HTMLElement>("[data-post-menu-open-language]"),
          "expected the language entry",
        ),
      );
      await menu.updateComplete;
      await Promise.resolve();
      await Promise.resolve();
      await menu.updateComplete;

      return { menu, trigger };
    }

    function radioLabels(menu: JantPostMenu): string[] {
      return Array.from(
        menu.querySelectorAll<HTMLElement>("[data-post-menu-language-option]"),
      ).map(
        (option) =>
          option.querySelector(".post-menu-item-label")?.textContent?.trim() ??
          "",
      );
    }

    async function openLanguageSwitch(menu: JantPostMenu) {
      click(
        requireElement(
          menu.querySelector<HTMLElement>(
            "[data-post-menu-open-language-switch]",
          ),
          "expected the change-language entry",
        ),
      );
      await menu.updateComplete;
    }

    it("keeps the picker one level down, behind the language it is on", async () => {
      // Switching a Thread's language is a correction made once if ever, while
      // reading and adding other versions is the daily work.
      const { menu } = await openLanguagePanel();

      expect(radioLabels(menu)).toEqual([]);
      const entry = requireElement(
        menu.querySelector<HTMLElement>(
          "[data-post-menu-open-language-switch]",
        ),
        "expected the change-language entry",
      );
      expect(
        entry.querySelector(".post-menu-item-meta")?.textContent,
      ).toContain("简体中文");

      await openLanguageSwitch(menu);
      expect(menu.textContent).toContain("Change language");
      expect(radioLabels(menu)).toEqual(["简体中文", "日本語"]);
    });

    it("leaves a language another version holds out of the picker", async () => {
      // The author cannot switch to it, so a dead row saying "Taken" answers a
      // question nobody asked. The version holding it is one level up.
      const { menu } = await openLanguagePanel();
      await openLanguageSwitch(menu);

      expect(radioLabels(menu)).not.toContain("English");
      expect(menu.textContent).not.toContain("Taken");
      expect(menu.textContent).not.toContain("Applies to the whole thread");
    });

    it("drops the change-language row when there is nothing to change to", async () => {
      // A two-language site whose other version is already linked: the picker
      // would hold a single unclickable row for the language it is already in.
      const { menu } = await openLanguagePanel(undefined, [
        { tag: "zh-Hans", label: "简体中文" },
        { tag: "en", label: "English" },
      ]);

      expect(
        menu.querySelector("[data-post-menu-open-language-switch]"),
      ).toBeNull();
      expect(menu.textContent).toContain("Other versions");
    });

    it("lands focus in the panel even when its only row arrives with the fetch", async () => {
      // Nothing is on screen until the translations resolve in that case, so
      // the first focus attempt has nothing to land on.
      const { menu } = await openLanguagePanel(undefined, [
        { tag: "zh-Hans", label: "简体中文" },
        { tag: "en", label: "English" },
      ]);
      await menu.updateComplete;
      await Promise.resolve();

      expect(document.activeElement).toBe(
        menu.querySelector("[data-post-menu-translation] a"),
      );
    });

    it("gives each other version a way to read it and a way to unlink it", async () => {
      const { menu } = await openLanguagePanel();

      const row = requireElement(
        menu.querySelector<HTMLElement>("[data-post-menu-translation]"),
        "expected a row for the English version",
      );
      // The language identifies the version; the title would only be clipped,
      // so it rides on the link instead of spending the row's width.
      expect(row.querySelector(".post-menu-item-label")?.textContent).toContain(
        "English",
      );
      expect(row.querySelector(".post-menu-item-meta")).toBeNull();

      const open = requireElement(
        row.querySelector<HTMLAnchorElement>("a"),
        "expected a link to the English version",
      );
      expect(open.getAttribute("href")).toBe("/coffee-notes");
      expect(open.getAttribute("target")).toBe("_blank");
      expect(open.getAttribute("rel")).toBe("noopener noreferrer");
      expect(open.getAttribute("title")).toBe("Coffee notes");

      const unlink = requireElement(
        row.querySelector<HTMLElement>("[data-post-menu-translation-unlink]"),
        "expected an unlink button",
      );
      expect(unlink.textContent?.trim()).toBe("Unlink");
    });

    it("unlinks the version whose row was clicked, once confirmed", async () => {
      // `DELETE` on the *other* post takes that one out of the group — which is
      // what "unlink the English version" means from this row.
      const { menu } = await openLanguagePanel();
      showConfirmDialogMock.mockResolvedValue(true);
      const reload = vi.fn();
      Object.defineProperty(window, "location", {
        configurable: true,
        value: { ...window.location, reload, assign: vi.fn() },
      });

      click(
        requireElement(
          menu.querySelector<HTMLElement>(
            "[data-post-menu-translation-unlink]",
          ),
          "expected an unlink button",
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(showConfirmDialogMock).toHaveBeenCalledWith(
        expect.objectContaining({ confirmLabel: "Unlink", tone: "danger" }),
      );
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/posts/post-en/translations",
        expect.objectContaining({ method: "DELETE" }),
      );
      expect(reload).toHaveBeenCalled();
    });

    it("keeps the link when the confirm is dismissed", async () => {
      const { menu, trigger } = await openLanguagePanel();
      showConfirmDialogMock.mockResolvedValue(false);

      click(
        requireElement(
          menu.querySelector<HTMLElement>(
            "[data-post-menu-translation-unlink]",
          ),
          "expected an unlink button",
        ),
      );
      await Promise.resolve();
      await Promise.resolve();

      expect(globalThis.fetch).not.toHaveBeenCalledWith(
        "/api/posts/post-en/translations",
        expect.objectContaining({ method: "DELETE" }),
      );
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
    });

    it("offers every free language for a new version", async () => {
      const { menu } = await openLanguagePanel();

      const addSection = requireElement(
        menu.querySelector<HTMLElement>("[data-post-menu-translation-first]")
          ?.parentElement ?? null,
        "expected the add-a-translation section",
      );
      expect(addSection.textContent).toContain("Write the 日本語 version");
      expect(addSection.textContent).not.toContain("Write the English");
      // Self-describing, so the section carries no label of its own.
      expect(addSection.textContent).toContain(
        "Link a version you already wrote",
      );
      expect(addSection.querySelector(".post-menu-section-label")).toBeNull();
    });

    it("resolves an address pasted into the link picker, and says what is wrong", async () => {
      // happy-dom has no modal dialog methods; the picker renders in light DOM
      // either way.
      Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
        configurable: true,
        value(this: HTMLDialogElement) {
          this.setAttribute("open", "");
        },
      });

      const { menu } = await openLanguagePanel();
      const existingFetch = globalThis.fetch as (
        input: unknown,
        init?: globalThis.RequestInit,
      ) => Promise<Response>;
      const fetchMock = vi.fn(
        (input: unknown, init?: globalThis.RequestInit) => {
          const url = String(input);
          if (url.includes("/translations/resolve?")) {
            return Promise.resolve(
              jsonResponse({
                resolution: { kind: "unpublished", address: "/coffee-notes" },
              }),
            );
          }
          return existingFetch(input, init);
        },
      );
      vi.stubGlobal("fetch", fetchMock);

      click(
        requireElement(
          Array.from(
            menu.querySelectorAll<HTMLElement>(".post-menu-item-label"),
          ).find((label) =>
            label.textContent?.includes("Link a version you already wrote"),
          ) ?? null,
          "expected the link-a-translation entry",
        ),
      );
      await menu.updateComplete;
      await Promise.resolve();

      const picker = requireElement(
        document.querySelector("jant-post-picker"),
        "expected the post picker",
      );
      const input = requireElement(
        picker.querySelector<HTMLInputElement>(".picker-dialog-input"),
        "expected the picker input",
      );
      input.value = "https://example.com/coffee-notes";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 250));
      await Promise.resolve();
      await Promise.resolve();

      // A URL goes to the resolver, never to the title search.
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes("/api/posts/post-1/translations/resolve?url="),
        ),
      ).toBe(true);
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes("/translations/candidates"),
        ),
      ).toBe(false);
      expect(picker.textContent).toContain("That post is a draft");
    });

    it("answers in the order the questions get asked", async () => {
      // The entry that opened this panel said "Language · 简体中文", so landing
      // on a panel whose last row is that same value read as a mismatch.
      const { menu } = await openLanguagePanel();

      const rows = Array.from(
        menu.querySelectorAll<HTMLElement>(
          ".post-menu-item-label, .post-menu-section-label",
        ),
      ).map((row) => row.textContent?.trim());

      expect(rows).toEqual([
        "Change language",
        "Write the 日本語 version",
        "Link a version you already wrote",
        "Other versions",
        "English",
      ]);
    });

    it("stays open when the clicked item re-renders the panel out from under itself", async () => {
      // A real browser runs a microtask checkpoint between event listeners, so
      // by the time the document-level handler sees the click, the item that
      // switched panels is already detached — the re-render swapped the whole
      // `.post-menu-view` out from under it, leaving the container behind.
      // `click()` from a script never reproduces that (the stack never empties,
      // so nothing re-renders mid-dispatch), so do the swap by hand in a second
      // listener on the item, which is where the checkpoint would fall.
      const { menu, trigger } = await createMenu();
      menu.languages = [
        { tag: "zh-Hans", label: "简体中文" },
        { tag: "en", label: "English" },
      ];
      click(trigger);
      await menu.updateComplete;

      const entry = requireElement(
        menu.querySelector<HTMLElement>("[data-post-menu-open-language]"),
        "expected the language entry",
      );
      entry.addEventListener("click", () =>
        menu.querySelector(".post-menu-view")?.remove(),
      );
      click(entry);
      await menu.updateComplete;

      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      expect(menu.textContent).toContain("Language");
    });

    it("walks back one panel per press of the back button", async () => {
      // The back button sits in the panel header, outside the `role="menu"`
      // list — matching only the list made every one of them read as a click
      // outside the menu and close the whole thing.
      const { menu } = await openLanguagePanel();
      await openLanguageSwitch(menu);

      const back = () =>
        click(
          requireElement(
            menu.querySelector<HTMLElement>(".post-menu-panel-back"),
            "expected a back button",
          ),
        );

      back();
      await menu.updateComplete;
      expect(
        menu.querySelector("[data-post-menu-open-language-switch]"),
      ).not.toBeNull();

      back();
      await menu.updateComplete;
      expect(
        menu.querySelector("[data-post-menu-open-language]"),
      ).not.toBeNull();
    });
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
