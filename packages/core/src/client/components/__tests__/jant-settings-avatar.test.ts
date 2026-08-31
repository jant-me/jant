// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from "vitest";

import type {
  AvatarRemoveDetail,
  SettingsLabels,
  SettingsSaveDetail,
} from "../settings-types.js";
import "../jant-settings-avatar.js";
import type { JantSettingsAvatar } from "../jant-settings-avatar.js";

function requireElement<T extends globalThis.Element>(
  element: T | null,
  message: string,
): T {
  if (!element) {
    throw new Error(message);
  }
  return element;
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
  markdownSupported: "Markdown supported",
  footerHelp: "Displayed at the bottom of posts.",
  showJantBrandingOnHome:
    'Show "Build with Jant" at the bottom of the home page',
  allowIndexing: "Allow search engines to index my site",
  demoSeoLocked: "Demo sites always stay hidden from search engines.",
  discoverEnabled: "Show my site and posts in Jant Discover",
  discoverIntro: "Discover is a public list of Jant blogs.",
  discoverAnnounce:
    "Turning this on sends your feed address to the directory once.",
  discoverDocs: "How Discover picks posts",
  discoverLatest: "Latest",
  discoverLatestHint: "Draws from your latest public posts.",
  discoverFeatured: "Featured only",
  discoverFeaturedHint: "Draws only from posts you have marked Featured.",
  discoverDemoLocked: "Demo sites are never listed in Discover.",
  discoverFeedsOffLocked:
    "Discover reads your Atom feed, so it needs feeds turned on.",
  discoverStatusHeading: "Where your site stands",
  discoverAnnounceRetry: "Announce again",
  discoverAnnounceManual: "Or submit your address by hand",
  save: "Save",
  cancel: "Cancel",
  copy: "Copy",
  copyFailed: "Could not copy. Try again.",
  feedUrlCopied: "Feed URL copied.",
  feedsDocs: "All feed addresses",
};

async function createElement(
  avatarUrl = "",
  showInHeader = false,
): Promise<JantSettingsAvatar> {
  const el = document.createElement(
    "jant-settings-avatar",
  ) as JantSettingsAvatar;
  el.avatarUrl = avatarUrl;
  el.showInHeader = showInHeader;
  el.labels = labels;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

/** Toggle a checkbox reliably in happy-dom by explicitly dispatching change */
function toggleCheckbox(checkbox: HTMLInputElement) {
  checkbox.checked = !checkbox.checked;
  checkbox.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Find the save button (not the upload label which also has .btn) */
function findSaveBtn(el: HTMLElement): HTMLButtonElement | null {
  return el.querySelector<HTMLButtonElement>("button.btn:not(.btn-outline)");
}

/** Find the cancel button */
function findCancelBtn(el: HTMLElement): HTMLButtonElement | null {
  return el.querySelector<HTMLButtonElement>("button.btn-outline");
}

describe("JantSettingsAvatar", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders card with Blog Avatar heading", async () => {
    const el = await createElement();
    const heading = el.querySelector("h2");
    expect(heading?.textContent).toBe("Blog Avatar");
  });

  it("renders placeholder when no avatar URL", async () => {
    const el = await createElement();
    const img = el.querySelector("img");
    expect(img).toBeNull();
    const placeholder = el.querySelector('[class*="bg-muted"]');
    expect(placeholder).not.toBeNull();
  });

  it("renders avatar image when URL provided", async () => {
    const el = await createElement("https://example.com/avatar.png");
    const img = el.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.src).toBe("https://example.com/avatar.png");
    expect(img?.parentElement?.className).toContain("border-border/70");
  });

  it("shows Remove button when avatar exists", async () => {
    const el = await createElement("https://example.com/avatar.png");
    const buttons = el.querySelectorAll("button");
    const removeBtn = Array.from(buttons).find((b) =>
      b.textContent?.includes("Remove"),
    );
    expect(removeBtn).not.toBeNull();
  });

  it("hides Remove button when no avatar", async () => {
    const el = await createElement();
    const buttons = el.querySelectorAll("button");
    const removeBtn = Array.from(buttons).find((b) =>
      b.textContent?.includes("Remove"),
    );
    expect(removeBtn).toBeUndefined();
  });

  it("renders display-in-header checkbox with correct state", async () => {
    const el = await createElement("", true);
    const checkbox = el.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(checkbox?.checked).toBe(true);
  });

  it("toggling checkbox marks form as dirty", async () => {
    const el = await createElement("", false);
    const checkbox = requireElement(
      el.querySelector<HTMLInputElement>('input[type="checkbox"]'),
      "expected header display checkbox",
    );

    toggleCheckbox(checkbox);
    await el.updateComplete;

    const saveBtn = findSaveBtn(el);
    expect(saveBtn?.disabled).toBe(false);
  });

  it("cancel reverts checkbox to original state", async () => {
    const el = await createElement("", false);
    const checkbox = requireElement(
      el.querySelector<HTMLInputElement>('input[type="checkbox"]'),
      "expected header display checkbox",
    );

    toggleCheckbox(checkbox);
    await el.updateComplete;

    const cancelBtn = findCancelBtn(el);
    cancelBtn?.click();
    await el.updateComplete;

    expect(checkbox.checked).toBe(false);
  });

  it("dispatches jant:settings-save on save click", async () => {
    const el = await createElement("", false);
    const checkbox = requireElement(
      el.querySelector<HTMLInputElement>('input[type="checkbox"]'),
      "expected header display checkbox",
    );

    toggleCheckbox(checkbox);
    await el.updateComplete;

    let detail: SettingsSaveDetail | null = null;
    el.addEventListener("jant:settings-save", (event) => {
      const customEvent = event as CustomEvent<SettingsSaveDetail>;
      detail = customEvent.detail;
    });

    const saveBtn = findSaveBtn(el);
    saveBtn?.click();
    await el.updateComplete;

    expect(detail).not.toBeNull();
    const d = detail as unknown as SettingsSaveDetail;
    expect(d.endpoint).toBe("/settings/avatar/display");
    expect(d.section).toBe("avatar-display");
    expect(d.data.showHeaderAvatar).toBe("true");
  });

  it("dispatches jant:avatar-remove on remove click", async () => {
    const el = await createElement("https://example.com/avatar.png");

    let detail: AvatarRemoveDetail | null = null;
    el.addEventListener("jant:avatar-remove", (event) => {
      const customEvent = event as CustomEvent<AvatarRemoveDetail>;
      detail = customEvent.detail;
    });

    const removeButton = requireElement(
      Array.from(el.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === "Remove",
      ) ?? null,
      "expected remove avatar button",
    );
    removeButton.click();
    await Promise.resolve();

    const host = requireElement(
      document.querySelector<HTMLElement>("jant-confirm-dialog"),
      "expected shared confirm dialog host",
    );
    const confirmButton = requireElement(
      host.querySelector<HTMLButtonElement>(
        ".confirm-dialog-actions .btn-destructive",
      ),
      "expected confirm button",
    );
    confirmButton.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(detail).not.toBeNull();
    const d = detail as unknown as AvatarRemoveDetail;
    expect(d.endpoint).toBe("/settings/avatar/remove");
  });

  it("does not dispatch jant:avatar-remove when confirmation is canceled", async () => {
    const el = await createElement("https://example.com/avatar.png");

    let called = false;
    const removeButton = requireElement(
      Array.from(el.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === "Remove",
      ) ?? null,
      "expected remove avatar button",
    );
    el.addEventListener("jant:avatar-remove", () => {
      called = true;
    });
    removeButton.click();
    await Promise.resolve();

    const host = requireElement(
      document.querySelector<HTMLElement>("jant-confirm-dialog"),
      "expected shared confirm dialog host",
    );
    const cancelButton = requireElement(
      host.querySelector<HTMLButtonElement>(
        ".confirm-dialog-actions .btn-outline",
      ),
      "expected cancel button",
    );
    cancelButton.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(called).toBe(false);
  });

  it("saved() resets dirty state", async () => {
    const el = await createElement("", false);
    const checkbox = requireElement(
      el.querySelector<HTMLInputElement>('input[type="checkbox"]'),
      "expected header display checkbox",
    );

    toggleCheckbox(checkbox);
    await el.updateComplete;

    el.saved();
    await el.updateComplete;

    const saveBtn = findSaveBtn(el);
    expect(saveBtn?.disabled).toBe(true);
  });

  it("renders file input with data-avatar-upload attribute", async () => {
    const el = await createElement();
    const fileInput = el.querySelector<HTMLInputElement>(
      "input[data-avatar-upload]",
    );
    expect(fileInput).not.toBeNull();
    expect(fileInput?.type).toBe("file");
  });
});
