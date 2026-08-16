// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { showConfirmDialogMock, showToastMock, queueToastMock } = vi.hoisted(
  () => ({
    showConfirmDialogMock: vi.fn(),
    showToastMock: vi.fn(),
    queueToastMock: vi.fn(),
  }),
);

vi.mock("../../confirm.js", () => ({
  showConfirmDialog: showConfirmDialogMock,
}));
vi.mock("../../toast.js", () => ({
  showToast: showToastMock,
  queueToastForNextPage: queueToastMock,
}));

import "../jant-settings-language.js";
import type { JantSettingsLanguage } from "../jant-settings-language.js";

const labels = {
  siteSection: "Site",
  dashboardSection: "Dashboard",
  contentLanguage: "Content language",
  contentLanguageHelp: "The language your readers and search engines see.",
  primaryLanguage: "Primary language",
  primaryLanguageHelp: "The root address (/, /feed) shows this language.",
  dashboardLanguage: "Dashboard language",
  dashboardLanguageHelp: "The language of your admin pages. Only you see this.",
  followContent: "Follow content language",
  multilingual: "Multilingual content",
  multilingualHelp: "Give each language its own home page, archive, and feed.",
  multilingualDocs: "Multilingual guide",
  multilingualDocsHelp:
    "URL structure, per-language feeds, and linking translations.",
  statusOn: "On",
  turnOn: "Turn on",
  addMissingLanguage: "Add {language}",
  viewPosts: "View these posts",
  languagesLabel: "Languages",
  primaryBadge: "Primary",
  makePrimary: "Make primary",
  otherLanguages: "Other languages",
  addLanguage: "Add language",
  removeLanguage: "Remove {language}",
  languageMenu: "Options for {language}",
  enableTitle: "Turn on multilingual content",
  enableReassurance:
    "Post addresses do not change, and you can turn this off again at any time.",
  enableMarkTitle: "One-time change to your existing posts",
  // Lingui resolves the plural server-side against the real count, so what
  // reaches the component already has a number and only `{language}` left.
  enableMarkWarning: "Your 347 existing posts will be marked as {language}.",
  enableFixHint:
    "Any post written in another language can be corrected from its own menu afterwards.",
  enableNeedsLanguage: "Add at least one more language to turn this on.",
  changePrimaryTitle: "Change the primary language?",
  changePrimaryBody:
    "{next} will be served at the root address, and {previous} moves to {prefix}.",
  changePrimaryConfirm: "Switch",
  disableTitle: "Turn off multilingual content?",
  disableBody: "The {prefix} addresses redirect to the root.",
  disableConfirm: "Turn off",
  cancel: "Cancel",
  save: "Save",
  saving: "Saving…",
  searchPlaceholder: "Search…",
  noMatches: "No matches.",
};

const locales = [
  { tag: "en", native: "English", english: "English", coverage: 1 },
  {
    tag: "zh-Hans",
    native: "简体中文",
    english: "Simplified Chinese",
    coverage: 1,
  },
  {
    tag: "zh-Hant",
    native: "繁體中文",
    english: "Traditional Chinese",
    coverage: 1,
  },
  { tag: "ja", native: "日本語", english: "Japanese", coverage: 0 },
  { tag: "fi", native: "suomi", english: "Finnish", coverage: 0 },
];

interface InitialState {
  contentLanguage?: string;
  dashboardLanguage?: string;
  multilingualEnabled?: boolean;
  additionalLanguages?: string[];
  unmarkedPostCount?: number;
  sitePathPrefix?: string;
}

function seedInitialState(state: InitialState) {
  const script = document.createElement("script");
  script.type = "application/json";
  script.id = "language-settings-initial-data";
  script.textContent = JSON.stringify({
    contentLanguage: "zh-Hans",
    dashboardLanguage: "",
    multilingualEnabled: false,
    additionalLanguages: [],
    unmarkedPostCount: 0,
    sitePathPrefix: "",
    ...state,
  });
  document.body.appendChild(script);
}

async function createElement(
  state: InitialState = {},
): Promise<JantSettingsLanguage> {
  seedInitialState(state);
  const el = document.createElement(
    "jant-settings-language",
  ) as JantSettingsLanguage;
  el.labels = labels;
  el.locales = locales;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

/** Stub fetch with a fixed JSON response and record every call. */
function mockFetch(response: unknown, ok = true) {
  const calls: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      calls.push({
        url,
        body: init?.body ? JSON.parse(init.body) : undefined,
      });
      return {
        ok,
        status: ok ? 200 : 400,
        text: async () => JSON.stringify(response),
      } as unknown as Response;
    }),
  );
  return calls;
}

function findByText<T extends globalThis.Element>(
  el: globalThis.Element,
  selector: string,
  text: string,
): T | undefined {
  return Array.from(el.querySelectorAll<T>(selector)).find((node) =>
    node.textContent?.includes(text),
  );
}

/** Open the "⋯" actions menu on a language's row. */
async function openRowMenu(el: JantSettingsLanguage, language: string) {
  el.querySelector<HTMLButtonElement>(
    `[data-language-menu][aria-label="Options for ${language}"]`,
  )?.click();
  await el.updateComplete;
}

describe("JantSettingsLanguage", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    showConfirmDialogMock.mockReset();
    showToastMock.mockReset();
    queueToastMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("single-language site", () => {
    it("shows the content language and a quiet multilingual toggle", async () => {
      const el = await createElement();

      expect(el.textContent).toContain(labels.contentLanguage);
      expect(el.textContent).toContain(labels.contentLanguageHelp);
      // Multilingual is its own section, off by default: a description and
      // a way to turn it on — no badge announcing the default state.
      expect(el.textContent).toContain(labels.multilingual);
      expect(el.textContent).toContain(labels.turnOn);
      expect(el.querySelector(".badge-secondary")).toBeNull();
      expect(el.querySelector("[data-multilingual-setup]")).not.toBeNull();
      // No language management shows before the author opts in.
      expect(el.textContent).not.toContain(labels.addLanguage);
      expect(el.textContent).not.toContain(labels.otherLanguages);
      expect(el.textContent).not.toContain(labels.languagesLabel);
    });

    it("shows the language's own name, not its tag", async () => {
      const el = await createElement({ contentLanguage: "zh-Hant" });

      expect(el.textContent).toContain("繁體中文");
    });

    it("saves a new content language without a confirmation", async () => {
      const el = await createElement();
      const calls = mockFetch({ toast: "Language updated." });

      const trigger = el.querySelector<HTMLButtonElement>(
        '[data-language-picker] button[aria-labelledby="language-primary-label"]',
      );
      trigger?.click();
      await el.updateComplete;

      const option = findByText<HTMLButtonElement>(
        el,
        '[role="option"]',
        "日本語",
      );
      option?.click();
      await el.updateComplete;
      await vi.waitFor(() => expect(calls.length).toBe(1));

      expect(calls[0]?.url).toBe("/settings/language");
      expect(calls[0]?.body).toEqual({ contentLanguage: "ja" });
    });
  });

  describe("language picker", () => {
    it("filters as the author types", async () => {
      const el = await createElement();
      const trigger = el.querySelector<HTMLButtonElement>(
        '[data-language-picker] button[aria-labelledby="language-primary-label"]',
      );
      trigger?.click();
      await el.updateComplete;

      expect(trigger?.getAttribute("aria-expanded")).toBe("true");
      expect(el.querySelectorAll('[role="option"]').length).toBe(
        locales.length,
      );

      const search = el.querySelector<HTMLInputElement>(
        "[data-language-search]",
      );
      if (search) {
        search.value = "finn";
        search.dispatchEvent(new Event("input", { bubbles: true }));
      }
      await el.updateComplete;

      const filtered = el.querySelectorAll('[role="option"]');
      expect(filtered.length).toBe(1);
      expect(filtered[0]?.textContent).toContain("suomi");
    });

    it("says so when nothing matches", async () => {
      const el = await createElement();
      el.querySelector<HTMLButtonElement>(
        '[data-language-picker] button[aria-labelledby="language-primary-label"]',
      )?.click();
      await el.updateComplete;

      const search = el.querySelector<HTMLInputElement>(
        "[data-language-search]",
      );
      if (search) {
        search.value = "zzzz";
        search.dispatchEvent(new Event("input", { bubbles: true }));
      }
      await el.updateComplete;

      expect(el.textContent).toContain(labels.noMatches);
    });

    it("closes on Escape", async () => {
      const el = await createElement();
      const trigger = el.querySelector<HTMLButtonElement>(
        '[data-language-picker] button[aria-labelledby="language-primary-label"]',
      );
      trigger?.click();
      await el.updateComplete;
      expect(el.querySelector("[data-language-search]")).not.toBeNull();

      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await el.updateComplete;

      expect(el.querySelector("[data-language-search]")).toBeNull();
    });

    it("closes on an outside click", async () => {
      const el = await createElement();
      el.querySelector<HTMLButtonElement>(
        '[data-language-picker] button[aria-labelledby="language-primary-label"]',
      )?.click();
      await el.updateComplete;

      document.body.dispatchEvent(new Event("click", { bubbles: true }));
      await el.updateComplete;

      expect(el.querySelector("[data-language-search]")).toBeNull();
    });
  });

  describe("enable dialog", () => {
    it("quotes the number of posts that will be marked", async () => {
      const el = await createElement({ unmarkedPostCount: 347 });

      el.querySelector<HTMLButtonElement>("[data-multilingual-setup]")?.click();
      await el.updateComplete;

      const dialog = el.querySelector("[data-enable-dialog]");
      expect(dialog).not.toBeNull();
      expect(dialog?.textContent).toContain("347 existing posts");
      expect(dialog?.textContent).toContain("简体中文");
    });

    it("fills the language slot the server left open", async () => {
      const el = await createElement({ unmarkedPostCount: 347 });
      el.querySelector<HTMLButtonElement>("[data-multilingual-setup]")?.click();
      await el.updateComplete;

      const dialog = el.querySelector("[data-enable-dialog]");
      expect(dialog?.textContent).toContain("简体中文");
      expect(dialog?.textContent).not.toContain("{language}");
    });

    it("shows no marking warning when nothing needs marking", async () => {
      const el = await createElement({ unmarkedPostCount: 0 });
      el.querySelector<HTMLButtonElement>("[data-multilingual-setup]")?.click();
      await el.updateComplete;

      // Every post already carries a language (or there are none) — an alert
      // about a change that will not happen would only confuse.
      const dialog = el.querySelector("[data-enable-dialog]");
      expect(dialog).not.toBeNull();
      expect(dialog?.textContent).not.toContain(labels.enableMarkTitle);
      expect(dialog?.textContent).not.toContain(labels.enableFixHint);
    });

    it("keeps the warning in step with the primary language chosen in the dialog", async () => {
      const el = await createElement({ unmarkedPostCount: 5 });
      el.querySelector<HTMLButtonElement>("[data-multilingual-setup]")?.click();
      await el.updateComplete;

      const dialog = el.querySelector("[data-enable-dialog]");
      expect(dialog?.textContent).toContain("简体中文");

      el.querySelector<HTMLButtonElement>(
        'button[aria-labelledby="language-enable-primary-label"]',
      )?.click();
      await el.updateComplete;
      findByText<HTMLButtonElement>(el, '[role="option"]', "English")?.click();
      await el.updateComplete;

      expect(el.querySelector("[data-enable-dialog]")?.textContent).toContain(
        "English",
      );
    });

    it("shows a refusal inside the dialog and stays open", async () => {
      // Re-enabling with a language dropped from the list while its posts
      // remain — the server refuses, and a toast would hide under the modal.
      const el = await createElement({ unmarkedPostCount: 0 });
      const calls = mockFetch(
        { error: "3 posts are written in 繁體中文.", language: "zh-Hant" },
        false,
      );

      el.querySelector<HTMLButtonElement>("[data-multilingual-setup]")?.click();
      await el.updateComplete;
      el.querySelector<HTMLButtonElement>(
        'button[aria-labelledby="language-enable-add-label"]',
      )?.click();
      await el.updateComplete;
      findByText<HTMLButtonElement>(el, '[role="option"]', "English")?.click();
      await el.updateComplete;
      el.querySelector<HTMLButtonElement>("[data-enable-confirm]")?.click();
      await vi.waitFor(() => expect(calls.length).toBe(1));
      await vi.waitFor(() =>
        expect(
          el.querySelector('[data-enable-dialog] [role="alert"]'),
        ).not.toBeNull(),
      );

      expect(
        el.querySelector('[data-enable-dialog] [role="alert"]')?.textContent,
      ).toContain("3 posts are written in 繁體中文.");
      expect(showToastMock).not.toHaveBeenCalled();

      // The refusal names the language, so putting it back is one click.
      el.querySelector<HTMLButtonElement>("[data-enable-add-back]")?.click();
      await el.updateComplete;

      const dialog = el.querySelector("[data-enable-dialog]");
      expect(dialog?.textContent).toContain("繁體中文");
      expect(dialog?.querySelector('[role="alert"]')).toBeNull();
    });

    it("cannot be confirmed without a second language", async () => {
      const el = await createElement({ unmarkedPostCount: 3 });
      el.querySelector<HTMLButtonElement>("[data-multilingual-setup]")?.click();
      await el.updateComplete;

      const confirm = el.querySelector<HTMLButtonElement>(
        "[data-enable-confirm]",
      );
      expect(confirm?.disabled).toBe(true);
      expect(el.textContent).toContain(labels.enableNeedsLanguage);
    });

    it("posts the chosen languages and updates the page", async () => {
      const el = await createElement({ unmarkedPostCount: 3 });
      const calls = mockFetch({ toast: "Multilingual content is on." });

      el.querySelector<HTMLButtonElement>("[data-multilingual-setup]")?.click();
      await el.updateComplete;

      el.querySelector<HTMLButtonElement>(
        'button[aria-labelledby="language-enable-add-label"]',
      )?.click();
      await el.updateComplete;
      findByText<HTMLButtonElement>(el, '[role="option"]', "English")?.click();
      await el.updateComplete;

      el.querySelector<HTMLButtonElement>("[data-enable-confirm]")?.click();
      // The enabled view only exists once the change is saved.
      await vi.waitFor(() =>
        expect(el.querySelector("[data-multilingual-off]")).not.toBeNull(),
      );

      expect(calls[0]?.url).toBe("/settings/language/enable");
      expect(calls[0]?.body).toEqual({
        primary: "zh-Hans",
        additional: ["en"],
      });
      expect(el.textContent).toContain(labels.languagesLabel);
      expect(el.textContent).toContain("English");
    });

    it("carries the confirmation across the reload", async () => {
      const el = await createElement({ unmarkedPostCount: 3 });
      mockFetch({
        toast: "Multilingual content is on. 3 posts were marked as 简体中文.",
      });

      el.querySelector<HTMLButtonElement>("[data-multilingual-setup]")?.click();
      await el.updateComplete;
      el.querySelector<HTMLButtonElement>(
        'button[aria-labelledby="language-enable-add-label"]',
      )?.click();
      await el.updateComplete;
      findByText<HTMLButtonElement>(el, '[role="option"]', "English")?.click();
      await el.updateComplete;
      el.querySelector<HTMLButtonElement>("[data-enable-confirm]")?.click();
      await vi.waitFor(() =>
        expect(el.querySelector("[data-multilingual-off]")).not.toBeNull(),
      );

      // The stamped count is the one thing the reloaded page cannot show.
      expect(queueToastMock).toHaveBeenCalledWith(
        "Multilingual content is on. 3 posts were marked as 简体中文.",
      );
      expect(showToastMock).not.toHaveBeenCalled();
    });

    it("stays off when the dialog is cancelled", async () => {
      const el = await createElement({ unmarkedPostCount: 3 });
      const calls = mockFetch({});

      el.querySelector<HTMLButtonElement>("[data-multilingual-setup]")?.click();
      await el.updateComplete;
      expect(el.querySelector("[data-enable-dialog]")).not.toBeNull();

      findByText<HTMLButtonElement>(el, "button", labels.cancel)?.click();
      await el.updateComplete;

      // Nothing was saved: the page still offers turning it on.
      expect(el.querySelector("[data-enable-dialog]")).toBeNull();
      expect(el.querySelector("[data-multilingual-setup]")).not.toBeNull();
      expect(el.textContent).not.toContain(labels.languagesLabel);
      expect(calls).toHaveLength(0);
    });

    it("offers turning it off once the change is saved", async () => {
      const el = await createElement({ unmarkedPostCount: 3 });
      mockFetch({ toast: "Multilingual content is on." });

      el.querySelector<HTMLButtonElement>("[data-multilingual-setup]")?.click();
      await el.updateComplete;

      el.querySelector<HTMLButtonElement>(
        'button[aria-labelledby="language-enable-add-label"]',
      )?.click();
      await el.updateComplete;
      findByText<HTMLButtonElement>(el, '[role="option"]', "English")?.click();
      await el.updateComplete;
      el.querySelector<HTMLButtonElement>("[data-enable-confirm]")?.click();
      await vi.waitFor(() =>
        expect(el.querySelector("[data-multilingual-off]")).not.toBeNull(),
      );

      expect(el.querySelector("[data-multilingual-off]")).not.toBeNull();
      expect(el.querySelector("[data-multilingual-setup]")).toBeNull();
    });

    it("closes on Escape without saving", async () => {
      const el = await createElement({ unmarkedPostCount: 3 });
      const calls = mockFetch({});

      el.querySelector<HTMLButtonElement>("[data-multilingual-setup]")?.click();
      await el.updateComplete;
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await el.updateComplete;

      expect(el.querySelector("[data-enable-dialog]")).toBeNull();
      expect(calls).toHaveLength(0);
    });
  });

  describe("multilingual site", () => {
    const enabled = {
      multilingualEnabled: true,
      additionalLanguages: ["en", "ja"],
    };

    it("lists every language with its reader URL, primary first", async () => {
      const el = await createElement(enabled);

      expect(el.textContent).toContain(labels.languagesLabel);
      expect(el.textContent).toContain(labels.primaryBadge);
      expect(el.textContent).not.toContain(labels.contentLanguageHelp);

      const codes = Array.from(el.querySelectorAll("code")).map((node) =>
        node.textContent?.trim(),
      );
      expect(codes).toEqual(["/", "/en", "/ja"]);
      // Each address is a real link, opened away from the settings page.
      const links = Array.from(
        el.querySelectorAll<globalThis.HTMLAnchorElement>("li a"),
      );
      expect(links.map((link) => link.getAttribute("href"))).toEqual([
        "/",
        "/en",
        "/ja",
      ]);
      for (const link of links) {
        expect(link.getAttribute("target")).toBe("_blank");
        expect(link.getAttribute("rel")).toBe("noopener noreferrer");
      }
      // The primary row carries the badge; the others fold their rare
      // actions behind a "⋯" menu instead of a row of buttons.
      const primaryRow = findByText<globalThis.HTMLLIElement>(
        el,
        "li",
        "简体中文",
      );
      expect(primaryRow?.textContent).toContain(labels.primaryBadge);
      expect(primaryRow?.querySelector("[data-language-menu]")).toBeNull();
      expect(el.querySelectorAll("[data-language-menu]").length).toBe(2);
      expect(el.textContent).not.toContain(labels.makePrimary);
    });

    it("dismisses a row menu on Escape", async () => {
      const el = await createElement(enabled);

      await openRowMenu(el, "English");
      expect(el.querySelector('[role="menu"]')).not.toBeNull();

      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await el.updateComplete;

      expect(el.querySelector('[role="menu"]')).toBeNull();
    });

    it("honors the hosted site path prefix in those URLs", async () => {
      const el = await createElement({ ...enabled, sitePathPrefix: "/blog" });

      const codes = Array.from(el.querySelectorAll("code")).map((node) =>
        node.textContent?.trim(),
      );
      expect(codes).toEqual(["/blog/", "/blog/en", "/blog/ja"]);
    });

    it("adds a language", async () => {
      const el = await createElement(enabled);
      const calls = mockFetch({ toast: "Language added." });

      el.querySelector<HTMLButtonElement>(
        '[data-language-picker] button[aria-labelledby="language-list-label"]',
      )?.click();
      await el.updateComplete;
      findByText<HTMLButtonElement>(el, '[role="option"]', "繁體中文")?.click();
      await vi.waitFor(() => expect(calls.length).toBe(1));
      await el.updateComplete;

      expect(calls[0]?.url).toBe("/settings/language/add");
      expect(calls[0]?.body).toEqual({ language: "zh-Hant" });
      expect(el.textContent).toContain("繁體中文");
    });

    it("keeps a language on screen when the server refuses to remove it", async () => {
      const el = await createElement(enabled);
      const calls = mockFetch(
        { error: "2 posts are still written in this language." },
        false,
      );

      await openRowMenu(el, "English");
      findByText<HTMLButtonElement>(
        el,
        '[role="menuitem"]',
        "Remove English",
      )?.click();
      await vi.waitFor(() => expect(calls.length).toBe(1));
      await el.updateComplete;

      expect(calls[0]?.url).toBe("/settings/language/remove");
      expect(el.textContent).toContain("English");

      // The refusal shows under that language's row, with a way to the posts.
      await vi.waitFor(() =>
        expect(el.querySelector('[role="alert"]')).not.toBeNull(),
      );
      const alert = el.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain(
        "2 posts are still written in this language.",
      );
      const link = alert?.querySelector("a");
      expect(link?.getAttribute("href")).toBe("/en/archive");
      expect(link?.getAttribute("target")).toBe("_blank");
      expect(link?.textContent).toContain(labels.viewPosts);
    });

    it("drops a language the server accepted", async () => {
      const el = await createElement(enabled);
      const calls = mockFetch({ toast: "Language removed." });

      await openRowMenu(el, "日本語");
      findByText<HTMLButtonElement>(
        el,
        '[role="menuitem"]',
        "Remove 日本語",
      )?.click();
      await vi.waitFor(() =>
        expect(
          el.querySelector('[aria-label="Options for 日本語"]'),
        ).toBeNull(),
      );

      expect(calls[0]?.url).toBe("/settings/language/remove");
      expect(
        el.querySelector('[aria-label="Options for English"]'),
      ).not.toBeNull();
      const codes = Array.from(el.querySelectorAll("code")).map((node) =>
        node.textContent?.trim(),
      );
      expect(codes).toEqual(["/", "/en"]);
    });

    it("confirms before moving the root URLs to another language", async () => {
      const el = await createElement(enabled);
      const calls = mockFetch({ toast: "Primary language changed." });
      const confirmSpy = vi.fn().mockResolvedValue(false);
      showConfirmDialogMock.mockImplementation(confirmSpy);

      await openRowMenu(el, "English");
      findByText<HTMLButtonElement>(
        el,
        '[role="menuitem"]',
        labels.makePrimary,
      )?.click();
      await vi.waitFor(() => expect(confirmSpy).toHaveBeenCalled());

      // Declined — nothing is written.
      expect(calls).toHaveLength(0);
      const message = confirmSpy.mock.calls[0]?.[0]?.message as string;
      expect(message).toContain("English");
      expect(message).toContain("简体中文");
      expect(message).toContain("/zh-hans");
    });

    it("swaps the two lists once the change is confirmed", async () => {
      const el = await createElement(enabled);
      const calls = mockFetch({ toast: "Primary language changed." });
      showConfirmDialogMock.mockResolvedValue(true);

      await openRowMenu(el, "English");
      findByText<HTMLButtonElement>(
        el,
        '[role="menuitem"]',
        labels.makePrimary,
      )?.click();
      await vi.waitFor(() => expect(calls.length).toBe(1));
      await el.updateComplete;

      expect(calls[0]?.url).toBe("/settings/language/primary");
      expect(calls[0]?.body).toEqual({ language: "en" });
      const codes = Array.from(el.querySelectorAll("code")).map((node) =>
        node.textContent?.trim(),
      );
      // English takes the root; Simplified Chinese picks up a prefix.
      expect(codes).toEqual(["/", "/ja", "/zh-hans"]);
    });

    it("keeps the views when turning it off is declined", async () => {
      const el = await createElement(enabled);
      const calls = mockFetch({});
      showConfirmDialogMock.mockResolvedValue(false);

      el.querySelector<HTMLButtonElement>("[data-multilingual-off]")?.click();
      await vi.waitFor(() => expect(showConfirmDialogMock).toHaveBeenCalled());
      await el.updateComplete;

      expect(calls).toHaveLength(0);
      expect(el.querySelector("[data-language-menu]")).not.toBeNull();
    });

    it("confirms before turning multilingual off", async () => {
      const el = await createElement(enabled);
      const calls = mockFetch({ toast: "Multilingual content is off." });
      showConfirmDialogMock.mockResolvedValue(true);

      el.querySelector<HTMLButtonElement>("[data-multilingual-off]")?.click();
      await vi.waitFor(() => expect(calls.length).toBe(1));
      await el.updateComplete;

      expect(calls[0]?.url).toBe("/settings/language/disable");
      // The languages stay configured; only the views stop.
      expect(el.querySelector("[data-language-menu]")).toBeNull();
      expect(el.textContent).toContain(labels.contentLanguageHelp);
      // Reloading is what removes the header switcher, so the confirmation
      // has to survive it.
      expect(queueToastMock).toHaveBeenCalledWith(
        "Multilingual content is off.",
      );
    });
  });

  describe("dashboard language", () => {
    it("posts only the dashboard field", async () => {
      const el = await createElement();
      const calls = mockFetch({ toast: "Language updated." });

      const select = el.querySelector(
        "select",
      ) as globalThis.HTMLSelectElement | null;
      if (select) {
        select.value = "zh-Hant";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      await vi.waitFor(() => expect(calls.length).toBe(1));

      // Only the dashboard field: the content language is a separate control
      // on the same page, and sending it here would overwrite it.
      expect(calls[0]?.url).toBe("/settings/language");
      expect(calls[0]?.body).toEqual({ dashboardLanguage: "zh-Hant" });
    });

    it("offers following the content language", async () => {
      const el = await createElement();
      const options = Array.from(
        el.querySelectorAll(
          "select option",
        ) as unknown as globalThis.HTMLOptionElement[],
      );

      expect(options[0]?.value).toBe("");
      expect(options[0]?.textContent).toContain(labels.followContent);
      expect(options.map((option) => option.value)).toEqual([
        "",
        "en",
        "zh-Hans",
        "zh-Hant",
      ]);
    });
  });
});
