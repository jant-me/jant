// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, vi } from "vitest";
import type {
  SettingsLabels,
  SettingsTimezone,
  SettingsSaveDetail,
  SettingsAboutPageStatus,
} from "../settings-types.js";
import { MAX_SITE_NAME_LENGTH } from "../../../types.js";
import "../jant-settings-general.js";
import type { JantSettingsGeneral } from "../jant-settings-general.js";

function requireElement<T>(element: T | null | undefined, message: string): T {
  if (!element) {
    throw new Error(message);
  }
  return element;
}

function findSelectByLabel(
  el: HTMLElement,
  labelText: string,
): globalThis.HTMLSelectElement | null {
  for (const field of Array.from(el.querySelectorAll<HTMLElement>(".field"))) {
    const label = field.querySelector(".label");
    if (!label?.textContent?.includes(labelText)) continue;
    return field.querySelector("select") as globalThis.HTMLSelectElement | null;
  }

  return null;
}

function findRadioByValue(
  el: HTMLElement,
  name: string,
  value: string,
): HTMLInputElement | null {
  return el.querySelector<HTMLInputElement>(
    `input[type="radio"][name="${name}"][value="${value}"]`,
  );
}

function findSectionByHeading(
  el: HTMLElement,
  headingText: string,
): HTMLElement | null {
  return (
    Array.from(el.querySelectorAll<HTMLElement>("section")).find((section) =>
      section.querySelector("h3")?.textContent?.includes(headingText),
    ) ?? null
  );
}

function findSaveButtonByHeading(
  el: HTMLElement,
  headingText: string,
): HTMLButtonElement | null {
  return (
    findSectionByHeading(el, headingText)?.querySelector<HTMLButtonElement>(
      ".btn",
    ) ?? null
  );
}

const labels: SettingsLabels = {
  blogAvatar: "Blog Avatar",
  uploadAvatar: "Upload Avatar",
  remove: "Remove",
  confirmRemoveAvatar: "Remove this avatar?",
  avatarHelp: "For best results, upload a square image.",
  displayInHeader: "Display avatar in my site header",
  processing: "Processing...",
  uploading: "Uploading...",
  uploadError: "Upload failed.",
  general: "General",
  site: "Site",
  aboutPage: "About page",
  aboutPagePrompt: "Want to write a fuller introduction?",
  aboutPageConflict:
    "/about is already used. Rename that item before creating an About page.",
  createAboutPage: "Create About page",
  editAboutPage: "Edit About page",
  timeSection: "Time",
  home: "Home",
  search: "Search",
  siteName: "Site Name",
  aboutBlog: "About this blog",
  aboutBlogHelp: "Displayed above your blog posts.",
  timeZone: "Time Zone",
  feeds: "Feeds",
  mainRssFeed: "Main RSS feed",
  mainRssFeedHelp: "This controls what /feed returns.",
  mainRssFeedWarning: "Changing this updates what subscribers get from /feed.",
  availableFeedUrls: "Fixed feed URLs",
  availableFeedUrlsHelp:
    "Use these when you want a feed URL that never changes.",
  mainFeedUrl: "Main feed",
  latestFeedUrl: "Latest feed",
  featuredFeedUrl: "Featured feed",
  archiveFeedUrl: "Archive feed",
  archiveFeedUrlHelp:
    "Every published post, including ones hidden from Latest.",
  latestFeedOption: "Latest",
  latestFeedOptionDescription: "Uses the latest public posts for /feed.",
  featuredFeedOption: "Featured",
  featuredFeedOptionDescription: "Uses featured posts for /feed.",
  siteFooter: "Site Footer",
  footerHelp: "Displayed at the bottom of posts.",
  showJantBrandingOnHome:
    'Show "Build with Jant" at the bottom of the home page',
  markdownSupported: "Markdown supported",
  allowIndexing: "Allow search engines to index my site",
  demoSeoLocked: "Demo sites always stay hidden from search engines.",
  save: "Save",
  cancel: "Cancel",
  copy: "Copy",
  copyFailed: "Could not copy. Try again.",
  feedUrlCopied: "Feed URL copied.",
};

const timezones: SettingsTimezone[] = [
  { value: "UTC", label: "(UTC) UTC" },
  { value: "America/New_York", label: "(UTC-05:00) Eastern Time" },
];

const initialData = {
  siteName: "My Blog",
  siteDescription: "A test blog",
  timeZone: "UTC",
  mainRssFeed: "featured",
  siteFooter: "Footer text",
  showJantBrandingOnHome: false,
  noindex: false,
};

function findCheckboxByLabel(
  el: HTMLElement,
  labelText: string,
): HTMLInputElement | undefined {
  return Array.from(
    el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  ).find((checkbox) =>
    checkbox.closest("label")?.textContent?.includes(labelText),
  );
}

async function createElement(
  opts: {
    demoMode?: boolean;
    aboutPage?: SettingsAboutPageStatus;
  } = {},
): Promise<JantSettingsGeneral> {
  const el = document.createElement(
    "jant-settings-general",
  ) as JantSettingsGeneral;
  el.labels = labels;
  el.timezones = timezones;
  el.siteNameFallback = "Fallback Name";
  el.siteDescriptionFallback = "Fallback Description";
  el.mainFeedUrl = "/feed";
  el.latestFeedUrl = "/latest/feed";
  el.featuredFeedUrl = "/featured/feed";
  el.archiveFeedUrl = "/archive/feed";
  el.aboutPage =
    opts.aboutPage ??
    ({
      state: "missing",
      path: "/about",
    } satisfies SettingsAboutPageStatus);
  el.aboutEditUrl = "/about?edit=1";
  el.aboutCreateUrl = "/settings/general/about-page";
  el.demoMode = opts.demoMode ?? false;
  document.body.appendChild(el);
  await el.updateComplete;
  el.initData(initialData);
  await el.updateComplete;
  return el;
}

describe("JantSettingsGeneral", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders grouped sections in the expected order", async () => {
    const el = await createElement();
    const groupTitles = Array.from(el.querySelectorAll("h3")).map((heading) =>
      heading.textContent?.trim(),
    );

    expect(el.querySelector("h2")?.textContent).toBe("General");
    expect(groupTitles).toEqual([
      labels.site,
      labels.timeSection,
      labels.feeds,
      labels.home,
      labels.search,
    ]);

    const siteSection = requireElement(
      findSectionByHeading(el, labels.site),
      "expected site section",
    );
    expect(siteSection.querySelector("[data-about-page-row]")).not.toBeNull();
  });

  it("renders a create About form from the missing About prompt", async () => {
    const el = await createElement();
    const aboutRow = requireElement(
      el.querySelector<HTMLElement>("[data-about-page-row]"),
      "expected About page row",
    );
    const form = requireElement(
      aboutRow.querySelector<HTMLFormElement>("form"),
      "expected create About page form",
    );
    const button = requireElement(
      form.querySelector<HTMLButtonElement>("button"),
      "expected create About page button",
    );

    expect(aboutRow.textContent).toContain(labels.aboutPagePrompt);
    expect(form.method).toBe("post");
    expect(form.action).toContain("/settings/general/about-page");
    expect(button.textContent).toContain(labels.createAboutPage);
  });

  it("renders an edit link when the About page exists", async () => {
    const el = await createElement({
      aboutPage: {
        state: "ready",
        path: "/about",
        post: {
          id: "pst_about000000000000000000000",
          title: "About",
          status: "published",
          visibility: "latest_hidden",
        },
      },
    });

    const aboutRow = requireElement(
      el.querySelector<HTMLElement>("[data-about-page-row]"),
      "expected About page row",
    );
    const editLink = requireElement(
      aboutRow.querySelector<HTMLAnchorElement>("a"),
      "expected About edit link",
    );

    expect(aboutRow.textContent).toContain(labels.aboutPagePrompt);
    expect(editLink.textContent).toContain(labels.editAboutPage);
    expect(editLink.href).toContain("/about?edit=1");
  });

  it("renders form fields with initial values", async () => {
    const el = await createElement();
    const siteNameInput = requireElement(
      el.querySelector<HTMLInputElement>('input[type="text"]'),
      "expected site name input",
    );
    expect(siteNameInput.value).toBe("My Blog");
    expect(siteNameInput.maxLength).toBe(MAX_SITE_NAME_LENGTH);

    // Description and footer use TipTap editors instead of textareas
    const descEditor = el.querySelector("[data-settings-desc-editor]");
    const footerEditor = el.querySelector("[data-settings-footer-editor]");
    expect(descEditor).not.toBeNull();
    expect(footerEditor).not.toBeNull();
  });

  it("renders timezone options", async () => {
    const el = await createElement();
    const tzSelect = requireElement(
      findSelectByLabel(el, labels.timeZone),
      "expected time zone select",
    );
    const options = tzSelect?.querySelectorAll("option");
    expect(options?.length).toBe(2);
    expect(options?.[0]?.value).toBe("UTC");
  });

  it("renders main RSS feed controls and fixed feed URLs", async () => {
    const el = await createElement();
    const featuredRadio = requireElement(
      findRadioByValue(el, "main-rss-feed", "featured"),
      "expected featured radio option",
    );
    const feedSection = requireElement(
      findSectionByHeading(el, labels.feeds),
      "expected feeds section",
    );
    const feedUrlInputs = feedSection.querySelectorAll<HTMLInputElement>(
      'input[readonly][type="text"]',
    );

    expect(featuredRadio.checked).toBe(true);
    expect(el.textContent).toContain(labels.mainRssFeedHelp);
    expect(el.textContent).toContain(labels.mainRssFeedWarning);
    expect(el.textContent).toContain(labels.featuredFeedOptionDescription);
    expect(el.textContent).toContain(labels.latestFeedOptionDescription);
    expect(Array.from(feedUrlInputs, (input) => input.value)).toEqual([
      "/feed",
      "/latest/feed",
      "/featured/feed",
      "/archive/feed",
    ]);
  });

  it("marks up each feed URL for the copy-field enhancer", async () => {
    const el = await createElement();
    const feedSection = requireElement(
      findSectionByHeading(el, labels.feeds),
      "expected feeds section",
    );
    const fields = feedSection.querySelectorAll("[data-copy-field-root]");

    expect(fields).toHaveLength(4);

    const firstField = requireElement(
      fields[0],
      "expected the main feed field",
    );
    const input = requireElement(
      firstField.querySelector<HTMLInputElement>(
        "input[data-copy-field-value]",
      ),
      "expected the address input",
    );
    const button = requireElement(
      firstField.querySelector<HTMLButtonElement>("button[data-copy-field]"),
      "expected the copy button",
    );

    expect(input.value).toBe("/feed");
    expect(button.getAttribute("data-copy-field")).toBe(labels.feedUrlCopied);
    expect(button.getAttribute("data-copy-field-failed")).toBe(
      labels.copyFailed,
    );
    expect(button.textContent).toContain(labels.copy);
  });

  it("tracks site group dirty state on input", async () => {
    const el = await createElement();
    const siteNameInput = requireElement(
      el.querySelector<HTMLInputElement>('input[type="text"]'),
      "expected site name input",
    );

    // Simulate input
    siteNameInput.value = "New Name";
    siteNameInput.dispatchEvent(new Event("input", { bubbles: true }));
    await el.updateComplete;

    const saveBtn = findSaveButtonByHeading(el, labels.site);
    expect(saveBtn?.disabled).toBe(false);
  });

  it("dispatches jant:settings-save for site section", async () => {
    const el = await createElement();
    const siteNameInput = requireElement(
      el.querySelector<HTMLInputElement>('input[type="text"]'),
      "expected site name input",
    );

    siteNameInput.value = "New Name";
    siteNameInput.dispatchEvent(new Event("input", { bubbles: true }));
    await el.updateComplete;

    let detail: SettingsSaveDetail | null = null;
    el.addEventListener("jant:settings-save", (event) => {
      const customEvent = event as CustomEvent<SettingsSaveDetail>;
      detail = customEvent.detail;
    });

    const saveBtn = findSaveButtonByHeading(el, labels.site);
    saveBtn?.click();
    await el.updateComplete;

    expect(detail).not.toBeNull();
    const d = detail as unknown as SettingsSaveDetail;
    expect(d.endpoint).toBe("/settings/general");
    expect(d.section).toBe("site");
    expect(d.data.siteName).toBe("New Name");
    expect(d.data.siteDescription).toBe("A test blog");
  });

  it("dispatches jant:settings-save for language and time section", async () => {
    const el = await createElement();
    const tzSelect = requireElement(
      findSelectByLabel(el, labels.timeZone),
      "expected time zone select",
    );

    tzSelect.value = "America/New_York";
    tzSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await el.updateComplete;

    let detail: SettingsSaveDetail | null = null;
    el.addEventListener("jant:settings-save", (event) => {
      detail = (event as CustomEvent<SettingsSaveDetail>).detail;
    });

    const saveBtn = findSaveButtonByHeading(el, labels.timeSection);
    saveBtn?.click();
    await el.updateComplete;

    expect(detail).not.toBeNull();
    expect((detail as unknown as SettingsSaveDetail).endpoint).toBe(
      "/settings/general/time",
    );
    expect((detail as unknown as SettingsSaveDetail).section).toBe("time");
    expect((detail as unknown as SettingsSaveDetail).data.timeZone).toBe(
      "America/New_York",
    );
  });

  it("includes mainRssFeed in feed section save", async () => {
    const el = await createElement();
    const latestRadio = requireElement(
      findRadioByValue(el, "main-rss-feed", "latest"),
      "expected latest radio option",
    );

    latestRadio.click();
    await el.updateComplete;

    let detail: SettingsSaveDetail | null = null;
    el.addEventListener("jant:settings-save", (event) => {
      detail = (event as CustomEvent<SettingsSaveDetail>).detail;
    });

    const saveBtn = findSaveButtonByHeading(el, labels.feeds);
    saveBtn?.click();
    await el.updateComplete;

    expect(detail).not.toBeNull();
    expect((detail as unknown as SettingsSaveDetail).endpoint).toBe(
      "/settings/general/feeds",
    );
    expect((detail as unknown as SettingsSaveDetail).data.mainRssFeed).toBe(
      "latest",
    );
  });

  it("sectionSaved resets site dirty state and updates originals", async () => {
    const el = await createElement();
    const siteNameInput = requireElement(
      el.querySelector<HTMLInputElement>('input[type="text"]'),
      "expected site name input",
    );

    // Make dirty and save
    siteNameInput.value = "Saved Name";
    siteNameInput.dispatchEvent(new Event("input", { bubbles: true }));
    await el.updateComplete;

    el.sectionSaved("site");
    await el.updateComplete;

    const saveBtn = findSaveButtonByHeading(el, labels.site);
    expect(saveBtn?.disabled).toBe(true);
  });

  it("search checkbox toggles noindex state before save completes", async () => {
    const el = await createElement();
    const searchCheckbox = findCheckboxByLabel(el, labels.allowIndexing);
    expect(searchCheckbox?.checked).toBe(true);

    searchCheckbox?.click();
    await el.updateComplete;

    expect(searchCheckbox?.checked).toBe(false);
  });

  it("includes footer in site section save", async () => {
    const el = await createElement();

    // Directly update internal state since TipTap editors may not
    // fully initialize in happy-dom
    (el as unknown as { _siteFooter: string })._siteFooter = "New footer";
    (el as unknown as { _siteDirty: boolean })._siteDirty = true;
    await el.updateComplete;

    let detail: SettingsSaveDetail | null = null;
    el.addEventListener("jant:settings-save", (event) => {
      const customEvent = event as CustomEvent<SettingsSaveDetail>;
      detail = customEvent.detail;
    });

    const saveBtn = findSaveButtonByHeading(el, labels.site);
    saveBtn?.click();
    await el.updateComplete;

    expect(detail).not.toBeNull();
    const d = detail as unknown as SettingsSaveDetail;
    expect(d.endpoint).toBe("/settings/general");
    expect(d.section).toBe("site");
    expect(d.data.siteFooter).toBe("New footer");
  });

  it("home checkbox auto-saves and does not enable other save buttons", async () => {
    const el = await createElement();
    const brandingCheckbox = requireElement(
      findCheckboxByLabel(el, labels.showJantBrandingOnHome) ?? null,
      "expected home page branding checkbox",
    );
    const siteSaveBtn = findSaveButtonByHeading(el, labels.site);

    expect(siteSaveBtn?.disabled).toBe(true);

    let detail: SettingsSaveDetail | null = null;
    el.addEventListener("jant:settings-save", (event) => {
      const customEvent = event as CustomEvent<SettingsSaveDetail>;
      detail = customEvent.detail;
    });

    brandingCheckbox.click();
    await el.updateComplete;

    expect(detail).not.toBeNull();
    const d = detail as unknown as SettingsSaveDetail;
    expect(d.endpoint).toBe("/settings/general/home");
    expect(d.section).toBe("home");
    expect(d.data).not.toHaveProperty("homeDefaultView");
    expect(d.data.showJantBrandingOnHome).toBe(true);
    expect(siteSaveBtn?.disabled).toBe(true);
  });

  it("sectionError for auto-saved home checkbox restores the saved value", async () => {
    const el = await createElement();
    const brandingCheckbox = requireElement(
      findCheckboxByLabel(el, labels.showJantBrandingOnHome) ?? null,
      "expected home page branding checkbox",
    );

    brandingCheckbox.click();
    await el.updateComplete;
    expect(brandingCheckbox.checked).toBe(true);

    el.sectionError("home");
    await el.updateComplete;

    expect(brandingCheckbox.checked).toBe(false);
  });

  it("dispatches jant:settings-save for search section immediately", async () => {
    const el = await createElement();
    const searchCheckbox = findCheckboxByLabel(el, labels.allowIndexing);

    let detail: SettingsSaveDetail | null = null;
    el.addEventListener("jant:settings-save", (event) => {
      const customEvent = event as CustomEvent<SettingsSaveDetail>;
      detail = customEvent.detail;
    });

    searchCheckbox?.click();
    await el.updateComplete;

    expect(detail).not.toBeNull();
    const d = detail as unknown as SettingsSaveDetail;
    expect(d.endpoint).toBe("/settings/general/search");
    expect(d.section).toBe("search");
    expect(d.data.allowIndexing).toBe(false);
  });

  it("disables search indexing toggle in demo mode", async () => {
    const el = await createElement({ demoMode: true });
    const searchCheckbox = requireElement(
      findCheckboxByLabel(el, labels.allowIndexing) ?? null,
      "expected search checkbox",
    );

    expect(searchCheckbox.disabled).toBe(true);
    expect(el.textContent).toContain(labels.demoSeoLocked);

    searchCheckbox.click();
    await el.updateComplete;

    expect(searchCheckbox.checked).toBe(true);
  });

  it("shows loading spinner during site save", async () => {
    const el = await createElement();
    const siteNameInput = requireElement(
      el.querySelector<HTMLInputElement>('input[type="text"]'),
      "expected site name input",
    );

    // Make dirty and save
    siteNameInput.value = "Loading test";
    siteNameInput.dispatchEvent(new Event("input", { bubbles: true }));
    await el.updateComplete;

    const saveBtn = findSaveButtonByHeading(el, labels.site);
    saveBtn?.click();
    await el.updateComplete;

    expect(saveBtn?.disabled).toBe(true);
    const spinner = saveBtn?.querySelector("svg.animate-spin");
    expect(spinner).not.toBeNull();
  });
});
