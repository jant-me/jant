// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { showConfirmDialogMock, showToastMock } = vi.hoisted(() => ({
  showConfirmDialogMock: vi.fn(),
  showToastMock: vi.fn(),
}));

vi.mock("../../confirm.js", () => ({
  showConfirmDialog: showConfirmDialogMock,
}));
vi.mock("../../toast.js", () => ({ showToast: showToastMock }));

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
  otherLanguages: "Other languages",
  addLanguage: "Add language",
  removeLanguage: "Remove {language}",
  enableTitle: "Turn on multilingual content",
  enableWhatHappensTitle: "What turning this on does",
  enableEffectViews:
    "Each language gets its own home page, archive, feed, and collection pages.",
  enableEffectCompose:
    "You choose a language when you publish, and can link posts as translations of one another.",
  enableEffectUrls:
    "Post addresses do not change. The primary language keeps the root address; the others get a URL prefix.",
  enableEffectReversible:
    "You can turn this off again at any time without losing anything.",
  enableMarkTitle: "One-time change to your existing posts",
  // Lingui resolves the plural server-side against the real count, so what
  // reaches the component already has a number and only `{language}` left.
  enableMarkWarning: "Your 347 existing posts will be marked as {language}.",
  enableMarkWarningEmpty: "You have no posts yet, so nothing gets marked.",
  enableFixHint:
    "Any post written in another language can be corrected from its own menu afterwards.",
  enableNeedsLanguage: "Add at least one more language to turn this on.",
  enableConfirm: "Mark posts and turn on",
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
  urlPreview: "Reader URLs:",
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

describe("JantSettingsLanguage", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    showConfirmDialogMock.mockReset();
    showToastMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("single-language site", () => {
    it("shows the content language and a quiet multilingual toggle", async () => {
      const el = await createElement();

      expect(el.textContent).toContain(labels.contentLanguage);
      expect(el.textContent).toContain(labels.contentLanguageHelp);
      expect(el.textContent).toContain(labels.multilingual);
      // Nothing about extra languages until the author opts in.
      expect(el.textContent).not.toContain(labels.otherLanguages);
      expect(el.textContent).not.toContain(labels.urlPreview);
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

      const checkbox = el.querySelector<HTMLInputElement>(
        'input[type="checkbox"]',
      );
      checkbox?.click();
      await el.updateComplete;

      const dialog = el.querySelector("[data-enable-dialog]");
      expect(dialog).not.toBeNull();
      expect(dialog?.textContent).toContain("347 existing posts");
      expect(dialog?.textContent).toContain("简体中文");
    });

    it("fills the language slot the server left open", async () => {
      const el = await createElement({ unmarkedPostCount: 347 });
      el.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
      await el.updateComplete;

      const dialog = el.querySelector("[data-enable-dialog]");
      expect(dialog?.textContent).toContain("简体中文");
      expect(dialog?.textContent).not.toContain("{language}");
    });

    it("says nothing gets marked on an empty site", async () => {
      const el = await createElement({ unmarkedPostCount: 0 });
      el.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
      await el.updateComplete;

      const dialog = el.querySelector("[data-enable-dialog]");
      expect(dialog?.textContent).toContain(labels.enableMarkWarningEmpty);
      expect(dialog?.textContent).not.toContain(labels.enableFixHint);
    });

    it("keeps the warning in step with the primary language chosen in the dialog", async () => {
      const el = await createElement({ unmarkedPostCount: 5 });
      el.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
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

    it("cannot be confirmed without a second language", async () => {
      const el = await createElement({ unmarkedPostCount: 3 });
      el.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
      await el.updateComplete;

      const confirm = findByText<HTMLButtonElement>(
        el,
        "button",
        labels.enableConfirm,
      );
      expect(confirm?.disabled).toBe(true);
      expect(el.textContent).toContain(labels.enableNeedsLanguage);
    });

    it("posts the chosen languages and updates the page", async () => {
      const el = await createElement({ unmarkedPostCount: 3 });
      const calls = mockFetch({ toast: "Multilingual content is on." });

      el.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
      await el.updateComplete;

      el.querySelector<HTMLButtonElement>(
        'button[aria-labelledby="language-enable-add-label"]',
      )?.click();
      await el.updateComplete;
      findByText<HTMLButtonElement>(el, '[role="option"]', "English")?.click();
      await el.updateComplete;

      findByText<HTMLButtonElement>(
        el,
        "button",
        labels.enableConfirm,
      )?.click();
      await vi.waitFor(() =>
        expect(el.textContent).toContain(labels.primaryLanguageHelp),
      );

      expect(calls[0]?.url).toBe("/settings/language/enable");
      expect(calls[0]?.body).toEqual({
        primary: "zh-Hans",
        additional: ["en"],
      });
      expect(el.textContent).toContain(labels.otherLanguages);
    });

    it("unchecks the toggle again when the dialog is cancelled", async () => {
      const el = await createElement({ unmarkedPostCount: 3 });
      const calls = mockFetch({});

      const checkbox = el.querySelector<HTMLInputElement>(
        "[data-multilingual-toggle]",
      );
      checkbox?.click();
      await el.updateComplete;
      expect(checkbox?.checked).toBe(true);

      findByText<HTMLButtonElement>(el, "button", labels.cancel)?.click();
      await el.updateComplete;

      // The browser flipped it on click; nothing was saved, so it must go back.
      expect(checkbox?.checked).toBe(false);
      expect(calls).toHaveLength(0);
    });

    it("leaves the toggle on once the change is saved", async () => {
      const el = await createElement({ unmarkedPostCount: 3 });
      mockFetch({ toast: "Multilingual content is on." });

      const checkbox = el.querySelector<HTMLInputElement>(
        "[data-multilingual-toggle]",
      );
      checkbox?.click();
      await el.updateComplete;

      el.querySelector<HTMLButtonElement>(
        'button[aria-labelledby="language-enable-add-label"]',
      )?.click();
      await el.updateComplete;
      findByText<HTMLButtonElement>(el, '[role="option"]', "English")?.click();
      await el.updateComplete;
      findByText<HTMLButtonElement>(
        el,
        "button",
        labels.enableConfirm,
      )?.click();
      await vi.waitFor(() =>
        expect(el.textContent).toContain(labels.primaryLanguageHelp),
      );

      expect(
        el.querySelector<HTMLInputElement>("[data-multilingual-toggle]")
          ?.checked,
      ).toBe(true);
    });

    it("closes on Escape without saving", async () => {
      const el = await createElement({ unmarkedPostCount: 3 });
      const calls = mockFetch({});

      el.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
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

    it("relabels the language field and previews the reader URLs", async () => {
      const el = await createElement(enabled);

      expect(el.textContent).toContain(labels.primaryLanguage);
      expect(el.textContent).toContain(labels.primaryLanguageHelp);
      expect(el.textContent).not.toContain(labels.contentLanguageHelp);
      expect(el.textContent).toContain(labels.urlPreview);

      const codes = Array.from(el.querySelectorAll("code")).map((node) =>
        node.textContent?.trim(),
      );
      expect(codes).toEqual(["/", "/en", "/ja"]);
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
        'button[aria-labelledby="language-add-label"]',
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

      const remove = el.querySelector<HTMLButtonElement>(
        'button[aria-label="Remove English"]',
      );
      remove?.click();
      await vi.waitFor(() => expect(calls.length).toBe(1));
      await el.updateComplete;

      expect(calls[0]?.url).toBe("/settings/language/remove");
      expect(el.textContent).toContain("English");
    });

    it("drops a language the server accepted", async () => {
      const el = await createElement(enabled);
      const calls = mockFetch({ toast: "Language removed." });

      el.querySelector<HTMLButtonElement>(
        'button[aria-label="Remove 日本語"]',
      )?.click();
      await vi.waitFor(() =>
        expect(
          el.querySelector('button[aria-label="Remove 日本語"]'),
        ).toBeNull(),
      );

      expect(calls[0]?.url).toBe("/settings/language/remove");
      expect(
        el.querySelector('button[aria-label="Remove English"]'),
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

      el.querySelector<HTMLButtonElement>(
        'button[aria-labelledby="language-primary-label"]',
      )?.click();
      await el.updateComplete;
      findByText<HTMLButtonElement>(el, '[role="option"]', "English")?.click();
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

      el.querySelector<HTMLButtonElement>(
        'button[aria-labelledby="language-primary-label"]',
      )?.click();
      await el.updateComplete;
      findByText<HTMLButtonElement>(el, '[role="option"]', "English")?.click();
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

    it("re-checks the toggle when turning it off is declined", async () => {
      const el = await createElement(enabled);
      const calls = mockFetch({});
      showConfirmDialogMock.mockResolvedValue(false);

      const checkbox = el.querySelector<HTMLInputElement>(
        "[data-multilingual-toggle]",
      );
      checkbox?.click();
      await vi.waitFor(() => expect(checkbox?.checked).toBe(true));

      expect(calls).toHaveLength(0);
      expect(el.textContent).toContain(labels.urlPreview);
    });

    it("confirms before turning multilingual off", async () => {
      const el = await createElement(enabled);
      const calls = mockFetch({ toast: "Multilingual content is off." });
      showConfirmDialogMock.mockResolvedValue(true);

      el.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
      await vi.waitFor(() => expect(calls.length).toBe(1));
      await el.updateComplete;

      expect(calls[0]?.url).toBe("/settings/language/disable");
      // The languages stay configured; only the views stop.
      expect(el.textContent).not.toContain(labels.urlPreview);
      expect(el.textContent).toContain(labels.contentLanguageHelp);
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
