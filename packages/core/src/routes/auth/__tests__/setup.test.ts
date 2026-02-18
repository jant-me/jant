import { describe, it, expect, beforeEach } from "vitest";
import { createTestDatabase } from "../../../__tests__/helpers/db.js";
import { createPageService } from "../../../services/page.js";
import { createSettingsService } from "../../../services/settings.js";
import { createNavItemService } from "../../../services/navigation.js";
import type { Database } from "../../../db/index.js";
import type { PageService } from "../../../services/page.js";
import type { SettingsService } from "../../../services/settings.js";
import type { NavItemService } from "../../../services/navigation.js";

/**
 * Reproduces the seed logic from POST /setup to verify the default About page
 * and navigation items are created correctly.
 */
async function runSetupSeed(services: {
  pages: PageService;
  settings: SettingsService;
  navItems: NavItemService;
}) {
  await services.settings.completeOnboarding();

  await services.navItems.create({
    type: "link",
    label: "Collections",
    url: "/collections",
  });
  await services.navItems.create({
    type: "link",
    label: "Archive",
    url: "/archive",
  });

  const aboutPage = await services.pages.create({
    slug: "about",
    title: "About",
    body: [
      "Welcome to my corner of the internet.",
      "",
      "This is a place where I share my thoughts, ideas, and things I find interesting. Feel free to look around and get to know what this site is all about.",
      "",
      "If you'd like to get in touch, don't hesitate to reach out.",
    ].join("\n"),
    status: "published",
  });

  await services.navItems.create({
    type: "page",
    label: "About",
    url: "/about",
    pageId: aboutPage.id,
  });
}

describe("Setup seed logic", () => {
  let services: {
    pages: PageService;
    settings: SettingsService;
    navItems: NavItemService;
  };

  beforeEach(() => {
    const testDb = createTestDatabase();
    const db = testDb.db as unknown as Database;
    services = {
      pages: createPageService(db),
      settings: createSettingsService(db),
      navItems: createNavItemService(db),
    };
  });

  it("creates a default About page with correct content", async () => {
    await runSetupSeed(services);

    const aboutPage = await services.pages.getBySlug("about");
    expect(aboutPage).not.toBeNull();
    expect(aboutPage!.title).toBe("About");
    expect(aboutPage!.status).toBe("published");
    expect(aboutPage!.body).toContain("Welcome to my corner of the internet");
    expect(aboutPage!.bodyHtml).toBeTruthy();
  });

  it("adds About page to navigation as a page-type nav item", async () => {
    await runSetupSeed(services);

    const aboutPage = await services.pages.getBySlug("about");
    const navItemsList = await services.navItems.list();

    const aboutNavItem = navItemsList.find(
      (item) => item.pageId === aboutPage!.id,
    );
    expect(aboutNavItem).toBeDefined();
    expect(aboutNavItem!.type).toBe("page");
    expect(aboutNavItem!.label).toBe("About");
    expect(aboutNavItem!.url).toBe("/about");
  });

  it("creates three nav items total: Collections, Archive, About", async () => {
    await runSetupSeed(services);

    const navItemsList = await services.navItems.list();
    expect(navItemsList).toHaveLength(3);

    const labels = navItemsList.map((item) => item.label);
    expect(labels).toContain("Collections");
    expect(labels).toContain("Archive");
    expect(labels).toContain("About");
  });

  it("renders About page body as HTML", async () => {
    await runSetupSeed(services);

    const aboutPage = await services.pages.getBySlug("about");
    expect(aboutPage!.bodyHtml).toContain("<p>");
    expect(aboutPage!.bodyHtml).toContain(
      "Welcome to my corner of the internet",
    );
  });
});
