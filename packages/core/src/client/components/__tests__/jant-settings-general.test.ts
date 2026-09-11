// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, vi } from "vitest";
import type {
  SettingsLabels,
  SettingsTimezone,
  SettingsSaveDetail,
  SettingsAboutPageStatus,
} from "../settings-types.js";
import { MAX_SITE_NAME_LENGTH } from "../../../types.js";
import type { DiscoverPageUrls } from "../../../lib/discover.js";
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

/**
 * Matched exactly: "Site" is a prefix of "Site visibility", so a substring
 * match would find whichever of the two comes first on the page.
 */
function findSectionByHeading(
  el: HTMLElement,
  headingText: string,
): HTMLElement | null {
  return (
    Array.from(el.querySelectorAll<HTMLElement>("section")).find(
      (section) =>
        section.querySelector("h3")?.textContent?.trim() === headingText,
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
  siteVisibility: "Site visibility",
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
  discoverName: "Jant Discover",
  discoverRules: "Discover community rules",
  discoverEnabled: "Allow Jant Discover to list my site",
  discoverIntro:
    "Jant Discover is a directory of Jant blogs, curated by hand by the Jant community to help people find new Jant blogs and posts. A post you mark Featured appears on the Discover home page 24 hours later, and link and quote posts appear on the Links and Quotes lists 24 hours after they are published. You can keep editing them in the meantime. See the Discover community rules.",
  discoverDemoLocked: "Demo sites are never listed in Discover.",
  discoverFeedsOffLocked:
    "Discover reads your Atom feed, so it needs feeds turned on.",
  discoverSearchOff:
    "Search engine indexing is off, so this site is not listed by default. Ticking the box above lists it anyway.",
  discoverAnnounce: "Announce my site",
  discoverAnnounceManual: "Or submit your address by hand",
  save: "Save",
  cancel: "Cancel",
  copy: "Copy",
  copyFailed: "Could not copy. Try again.",
  feedUrlCopied: "Feed URL copied.",
  feedsDocs: "All feed addresses",
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
  discover: "",
};

const discoverPages: DiscoverPageUrls = {
  home: "https://jant.me/discover",
  links: "https://jant.me/links",
  quotes: "https://jant.me/quotes",
  rules: "https://jant.me/discover/about",
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

/**
 * The Discover help line, found by its text: it is one of several muted
 * paragraphs in the section, and only this one carries the directory's links.
 */
function findIntroParagraph(el: HTMLElement): HTMLElement | null {
  return (
    Array.from(el.querySelectorAll<HTMLElement>("p")).find(
      (paragraph) => paragraph.textContent?.trim() === labels.discoverIntro,
    ) ?? null
  );
}

async function createElement(
  opts: {
    demoMode?: boolean;
    feedsEnabled?: boolean;
    aboutPage?: SettingsAboutPageStatus;
    /** The deployment's own answer: "" when it has none. */
    discoverDefault?: string;
    /** Serialized status view, as the server hands it to the component. */
    discoverStatus?: string;
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
  el.discoverPages = discoverPages;
  el.discoverDefault = opts.discoverDefault ?? "";
  el.discoverStatus = opts.discoverStatus ?? "";
  el.feedsEnabled = opts.feedsEnabled ?? true;
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
      labels.siteVisibility,
      labels.feeds,
      labels.timeSection,
      labels.home,
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

  it("auto-saves the main RSS feed choice without a save button", async () => {
    const el = await createElement();
    const latestRadio = requireElement(
      findRadioByValue(el, "main-rss-feed", "latest"),
      "expected latest radio option",
    );

    expect(findSaveButtonByHeading(el, labels.feeds)).toBeNull();

    let detail: SettingsSaveDetail | null = null;
    el.addEventListener("jant:settings-save", (event) => {
      detail = (event as CustomEvent<SettingsSaveDetail>).detail;
    });

    latestRadio.click();
    await el.updateComplete;

    expect(detail).not.toBeNull();
    expect((detail as unknown as SettingsSaveDetail).endpoint).toBe(
      "/settings/general/feeds",
    );
    expect((detail as unknown as SettingsSaveDetail).section).toBe("feeds");
    expect((detail as unknown as SettingsSaveDetail).data.mainRssFeed).toBe(
      "latest",
    );
    expect(latestRadio.checked).toBe(true);
  });

  it("sectionError for the feed choice restores the saved value", async () => {
    const el = await createElement();
    const latestRadio = requireElement(
      findRadioByValue(el, "main-rss-feed", "latest"),
      "expected latest radio option",
    );

    latestRadio.click();
    await el.updateComplete;
    expect(latestRadio.checked).toBe(true);

    el.sectionError("feeds");
    await el.updateComplete;

    expect(latestRadio.checked).toBe(false);
    expect(
      requireElement(
        findRadioByValue(el, "main-rss-feed", "featured"),
        "expected featured radio option",
      ).checked,
    ).toBe(true);
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

  /**
   * Every control here saves on change, like the indexing checkbox beside it:
   * ticking the box stores the default mode, and a mode is stored the moment
   * it is picked. Ticking the box is also how a self-hosted site opts in, and
   * that first save is what announces it to the directory.
   */
  describe("Discover", () => {
    it("renders the section under Site visibility", async () => {
      const el = await createElement();

      expect(findSectionByHeading(el, labels.siteVisibility)).not.toBeNull();
      expect(el.textContent).toContain(labels.discoverEnabled);
      expect(el.textContent).toContain(labels.discoverIntro);
    });

    // Opt-in: a self-hosted site nobody configured shows the box unticked.
    it("starts off for a site with no deployment default", async () => {
      const el = await createElement();
      const toggle = requireElement(
        findCheckboxByLabel(el, labels.discoverEnabled) ?? null,
        "expected the Discover checkbox",
      );

      expect(toggle.checked).toBe(false);

      toggle.click();
      await el.updateComplete;

      expect(toggle.checked).toBe(true);
    });

    // Hosted Jant sets `DISCOVER=latest`, and an owner who has never opened
    // this page must not be shown "off" while their feeds say otherwise.
    it("starts on when the deployment lists its blogs", async () => {
      const el = await createElement({ discoverDefault: "latest" });

      expect(
        requireElement(
          findCheckboxByLabel(el, labels.discoverEnabled) ?? null,
          "expected the Discover checkbox",
        ).checked,
      ).toBe(true);
    });

    // The section carries no Save button of its own: the only button it can
    // render is the announcement retry, which needs a failed announcement.
    it("offers no Save button", async () => {
      const el = await createElement();
      const section = requireElement(
        findSectionByHeading(el, labels.siteVisibility),
        "expected the Site visibility section",
      );

      expect(section.querySelectorAll("button").length).toBe(0);
    });

    it("sends latest when the box is ticked", async () => {
      const el = await createElement();
      let detail: SettingsSaveDetail | null = null;
      el.addEventListener("jant:settings-save", (event) => {
        detail = (event as CustomEvent<SettingsSaveDetail>).detail;
      });

      requireElement(
        findCheckboxByLabel(el, labels.discoverEnabled) ?? null,
        "expected the Discover checkbox",
      ).click();
      await el.updateComplete;

      const d = detail as unknown as SettingsSaveDetail;
      expect(d.endpoint).toBe("/settings/general/discover");
      expect(d.section).toBe("discover");
      expect(d.data.discover).toBe("latest");
    });

    it("sends off when the box is unticked", async () => {
      const el = await createElement({ discoverDefault: "latest" });
      let detail: SettingsSaveDetail | null = null;
      el.addEventListener("jant:settings-save", (event) => {
        detail = (event as CustomEvent<SettingsSaveDetail>).detail;
      });

      requireElement(
        findCheckboxByLabel(el, labels.discoverEnabled) ?? null,
        "expected the Discover checkbox",
      ).click();
      await el.updateComplete;

      expect((detail as unknown as SettingsSaveDetail).data.discover).toBe(
        "off",
      );
    });

    // A site that chose the old featured-only mode reads as on, and the box
    // widens it only when the owner ticks it again — never on its own.
    it("keeps a stored featured choice ticked, and writes latest on re-tick", async () => {
      const el = await createElement();
      el.initData({ ...initialData, discover: "featured" });
      await el.updateComplete;
      const details: SettingsSaveDetail[] = [];
      el.addEventListener("jant:settings-save", (event) => {
        details.push((event as CustomEvent<SettingsSaveDetail>).detail);
      });

      const toggle = requireElement(
        findCheckboxByLabel(el, labels.discoverEnabled) ?? null,
        "expected the Discover checkbox",
      );
      expect(toggle.checked).toBe(true);
      expect(details).toHaveLength(0);

      toggle.click();
      await el.updateComplete;
      expect(details[0]?.data.discover).toBe("off");

      el.sectionSaved("discover");
      await el.updateComplete;
      requireElement(
        findCheckboxByLabel(el, labels.discoverEnabled) ?? null,
        "expected the Discover checkbox",
      ).click();
      await el.updateComplete;
      expect(details[1]?.data.discover).toBe("latest");
    });

    // The controls stay disabled until the save answers, so a second click
    // cannot race the first.
    it("disables the controls while a save is in flight", async () => {
      const el = await createElement({ discoverDefault: "latest" });
      const toggle = requireElement(
        findCheckboxByLabel(el, labels.discoverEnabled) ?? null,
        "expected the Discover checkbox",
      );

      toggle.click();
      await el.updateComplete;

      expect(toggle.disabled).toBe(true);

      el.sectionSaved("discover");
      await el.updateComplete;

      expect(
        requireElement(
          findCheckboxByLabel(el, labels.discoverEnabled) ?? null,
          "expected the Discover checkbox",
        ).disabled,
      ).toBe(false);
    });

    // A failed save leaves the page describing the site as it still is.
    it("restores the stored choice when the save fails", async () => {
      const el = await createElement({ discoverDefault: "latest" });
      const toggle = requireElement(
        findCheckboxByLabel(el, labels.discoverEnabled) ?? null,
        "expected the Discover checkbox",
      );

      toggle.click();
      await el.updateComplete;
      el.sectionError("discover");
      await el.updateComplete;

      expect(
        requireElement(
          findCheckboxByLabel(el, labels.discoverEnabled) ?? null,
          "expected the Discover checkbox",
        ).checked,
      ).toBe(true);
    });

    it("locks the control off for a demo site", async () => {
      const el = await createElement({ demoMode: true });
      const toggle = requireElement(
        findCheckboxByLabel(el, labels.discoverEnabled) ?? null,
        "expected the Discover checkbox",
      );

      expect(toggle.disabled).toBe(true);
      expect(toggle.checked).toBe(false);
      expect(el.textContent).toContain(labels.discoverDemoLocked);
    });

    // Discover reads the Atom feed, so with feeds off there is nothing to read.
    it("locks the control off when the site publishes no feeds", async () => {
      const el = await createElement({ feedsEnabled: false });
      const toggle = requireElement(
        findCheckboxByLabel(el, labels.discoverEnabled) ?? null,
        "expected the Discover checkbox",
      );

      expect(toggle.disabled).toBe(true);
      expect(el.textContent).toContain(labels.discoverFeedsOffLocked);
    });

    // What Discover is, is best answered by the list itself, so the sentence
    // explaining the list is the way into it: the name goes to the home, the
    // list names to the lists, and the rules to the page of rules.
    it("links each page the help line names to that page", async () => {
      const el = await createElement();
      const intro = requireElement(
        findIntroParagraph(el),
        "expected the Discover help line",
      );
      const links = Array.from(intro.querySelectorAll<HTMLAnchorElement>("a"));

      expect(
        links.map((link) => [link.textContent, link.getAttribute("href")]),
      ).toEqual([
        [labels.discoverName, discoverPages.home],
        ["Links", discoverPages.links],
        ["Quotes", discoverPages.quotes],
        [labels.discoverRules, discoverPages.rules],
      ]);
      for (const link of links) {
        expect(link.getAttribute("target")).toBe("_blank");
        expect(link.getAttribute("rel")).toBe("noopener noreferrer");
        expect(link.className).toContain("underline");
      }
      // The whole line still reads as one sentence.
      expect(intro.textContent?.trim()).toBe(labels.discoverIntro);
    });

    // A `<label>` forwards a click on any descendant to its control, so a link
    // inside it would open the directory and flip the setting on the way out.
    it("keeps the directory link out of the checkbox label", async () => {
      const el = await createElement();
      const label = requireElement(
        findCheckboxByLabel(el, labels.discoverEnabled)?.closest("label"),
        "expected the Discover checkbox label",
      );

      expect(label.querySelector("a")).toBeNull();
      expect(label.textContent).toContain(labels.discoverEnabled);
    });

    // A directory this deployment does not announce to has no address to
    // link, and a sentence with a dead link in it is worse than a plain one.
    it("renders the help line as plain text with no directory configured", async () => {
      const el = await createElement();
      el.discoverPages = null;
      await el.updateComplete;

      const intro = requireElement(
        findIntroParagraph(el),
        "expected the Discover help line",
      );

      expect(intro.querySelector("a")).toBeNull();
      expect(intro.textContent?.trim()).toBe(labels.discoverIntro);
    });

    // The two checkboxes are one rule read twice. Search indexing gates the
    // deployment default, so a page that answers the second from a value the
    // server resolved at load time goes on claiming a listing the feed has
    // already stopped declaring — right until the owner reloads and finds out.
    it("unticks Discover when search indexing is turned off", async () => {
      const el = await createElement({ discoverDefault: "latest" });
      const discover = requireElement(
        findCheckboxByLabel(el, labels.discoverEnabled) ?? null,
        "expected the Discover checkbox",
      );
      const indexing = requireElement(
        findCheckboxByLabel(el, labels.allowIndexing) ?? null,
        "expected the indexing checkbox",
      );
      expect(discover.checked).toBe(true);

      indexing.click();
      await el.updateComplete;

      expect(discover.checked).toBe(false);
    });

    // A control that moves on its own has to say why it moved.
    it("says why the box unticked itself", async () => {
      const el = await createElement({ discoverDefault: "latest" });
      expect(el.textContent).not.toContain(labels.discoverSearchOff);

      requireElement(
        findCheckboxByLabel(el, labels.allowIndexing) ?? null,
        "expected the indexing checkbox",
      ).click();
      await el.updateComplete;

      expect(el.textContent).toContain(labels.discoverSearchOff);
    });

    // Nothing was holding this site back: the deployment lists nothing by
    // default, so an unticked box is the opt-in it has always been.
    it("says nothing about search on a site no default would list", async () => {
      const el = await createElement();

      requireElement(
        findCheckboxByLabel(el, labels.allowIndexing) ?? null,
        "expected the indexing checkbox",
      ).click();
      await el.updateComplete;

      expect(el.textContent).not.toContain(labels.discoverSearchOff);
    });

    // An owner who answered Discover is not being held back by anything: the
    // stored choice is read first, whichever way it went.
    it("says nothing about search once the owner has answered", async () => {
      const el = await createElement({ discoverDefault: "latest" });
      const discover = requireElement(
        findCheckboxByLabel(el, labels.discoverEnabled) ?? null,
        "expected the Discover checkbox",
      );

      discover.click();
      await el.updateComplete;
      el.sectionSaved("discover");
      await el.updateComplete;

      requireElement(
        findCheckboxByLabel(el, labels.allowIndexing) ?? null,
        "expected the indexing checkbox",
      ).click();
      await el.updateComplete;

      expect(discover.checked).toBe(false);
      expect(el.textContent).not.toContain(labels.discoverSearchOff);
    });

    it("ticks Discover again when search indexing comes back", async () => {
      const el = await createElement({ discoverDefault: "latest" });
      const indexing = requireElement(
        findCheckboxByLabel(el, labels.allowIndexing) ?? null,
        "expected the indexing checkbox",
      );

      indexing.click();
      await el.updateComplete;
      el.sectionSaved("search");
      await el.updateComplete;
      indexing.click();
      await el.updateComplete;
      el.sectionSaved("search");
      await el.updateComplete;

      expect(
        requireElement(
          findCheckboxByLabel(el, labels.discoverEnabled) ?? null,
          "expected the Discover checkbox",
        ).checked,
      ).toBe(true);
    });

    // An owner who ticked the box meant it, and turning off search indexing
    // does not quietly undo it — the server reads it the same way.
    it("leaves a stored choice alone when search indexing is turned off", async () => {
      const el = await createElement({ discoverDefault: "latest" });
      const discover = requireElement(
        findCheckboxByLabel(el, labels.discoverEnabled) ?? null,
        "expected the Discover checkbox",
      );

      discover.click();
      await el.updateComplete;
      el.sectionSaved("discover");
      await el.updateComplete;
      discover.click();
      await el.updateComplete;
      el.sectionSaved("discover");
      await el.updateComplete;
      expect(discover.checked).toBe(true);

      requireElement(
        findCheckboxByLabel(el, labels.allowIndexing) ?? null,
        "expected the indexing checkbox",
      ).click();
      await el.updateComplete;

      expect(discover.checked).toBe(true);
    });

    // The status is what the server sent with the page, and it sends a line
    // only when there is something to say. A site whose setting is doing what
    // it says is handed nothing, and no heading is left behind to announce an
    // empty block. Ticking the box does not conjure one either: the lines are
    // recomputed on the next page load.
    it("drops the status block when the server sends no lines", async () => {
      const el = await createElement({
        discoverStatus: JSON.stringify({
          lines: [],
          showAnnounce: false,
          submitUrl: null,
        }),
      });

      expect(el.querySelector(".border-t.pt-3")).toBeNull();

      requireElement(
        findCheckboxByLabel(el, labels.discoverEnabled) ?? null,
        "expected the Discover checkbox",
      ).click();
      await el.updateComplete;

      expect(el.querySelector(".border-t.pt-3")).toBeNull();
    });

    it("shows the status the server sent for a listed site", async () => {
      const el = await createElement({
        discoverDefault: "latest",
        discoverStatus: JSON.stringify({
          lines: ["Not announced yet."],
          showAnnounce: false,
          submitUrl: null,
        }),
      });

      expect(el.textContent).toContain("Not announced yet.");
    });

    // The lines and the button are separate halves of the same block, so the
    // block cannot key its existence on the lines alone.
    it("keeps the block for an announce button with no lines", async () => {
      const el = await createElement({
        discoverDefault: "latest",
        discoverStatus: JSON.stringify({
          lines: [],
          showAnnounce: true,
          submitUrl: null,
        }),
      });

      expect(el.textContent).toContain(labels.discoverAnnounce);
    });
  });
});
