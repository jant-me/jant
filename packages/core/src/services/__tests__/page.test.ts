import { describe, it, expect, beforeEach } from "vitest";
import { createTestDatabase } from "../../__tests__/helpers/db.js";
import { createPageService } from "../page.js";
import { createNavItemService } from "../navigation.js";
import type { Database } from "../../db/index.js";

describe("PageService", () => {
  let db: Database;
  let pageService: ReturnType<typeof createPageService>;
  let navItemService: ReturnType<typeof createNavItemService>;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db as unknown as Database;
    pageService = createPageService(db);
    navItemService = createNavItemService(db);
  });

  describe("listNotInNav", () => {
    it("returns all pages when none are in navigation", async () => {
      await pageService.create({ slug: "about", title: "About" });
      await pageService.create({ slug: "contact", title: "Contact" });

      const pages = await pageService.listNotInNav();
      expect(pages).toHaveLength(2);
    });

    it("excludes pages that have a nav item", async () => {
      const aboutPage = await pageService.create({
        slug: "about",
        title: "About",
      });
      await pageService.create({ slug: "contact", title: "Contact" });

      // Add "About" to navigation
      await navItemService.create({
        type: "page",
        label: "About",
        url: "/about",
        pageId: aboutPage.id,
      });

      const pages = await pageService.listNotInNav();
      expect(pages).toHaveLength(1);
      expect(pages[0]?.slug).toBe("contact");
    });

    it("returns empty array when all pages are in navigation", async () => {
      const aboutPage = await pageService.create({
        slug: "about",
        title: "About",
      });

      await navItemService.create({
        type: "page",
        label: "About",
        url: "/about",
        pageId: aboutPage.id,
      });

      const pages = await pageService.listNotInNav();
      expect(pages).toHaveLength(0);
    });

    it("returns empty array when no pages exist", async () => {
      const pages = await pageService.listNotInNav();
      expect(pages).toHaveLength(0);
    });

    it("is not affected by link-type nav items (no pageId)", async () => {
      await pageService.create({ slug: "about", title: "About" });

      // Link-type nav items have no pageId
      await navItemService.create({
        type: "link",
        label: "External",
        url: "https://example.com",
      });

      const pages = await pageService.listNotInNav();
      expect(pages).toHaveLength(1);
    });

    it("returns multiple pages correctly", async () => {
      await pageService.create({ slug: "first", title: "First" });
      await pageService.create({ slug: "second", title: "Second" });
      await pageService.create({ slug: "third", title: "Third" });

      // Add one to nav
      const pages = await pageService.list();
      await navItemService.create({
        type: "page",
        label: "Second",
        url: "/second",
        pageId: pages.find((p) => p.slug === "second")!.id,
      });

      const notInNav = await pageService.listNotInNav();
      expect(notInNav).toHaveLength(2);
      const slugs = notInNav.map((p) => p.slug);
      expect(slugs).toContain("first");
      expect(slugs).toContain("third");
      expect(slugs).not.toContain("second");
    });
  });

  describe("update nav item sync", () => {
    it("syncs nav item label when page title changes", async () => {
      const page = await pageService.create({
        slug: "about",
        title: "About",
      });
      await navItemService.create({
        type: "page",
        label: "About",
        url: "/about",
        pageId: page.id,
      });

      await pageService.update(page.id, { title: "About Us" });

      const navs = await navItemService.list();
      expect(navs).toHaveLength(1);
      expect(navs[0]?.label).toBe("About Us");
    });

    it("syncs nav item url when page slug changes", async () => {
      const page = await pageService.create({
        slug: "about",
        title: "About",
      });
      await navItemService.create({
        type: "page",
        label: "About",
        url: "/about",
        pageId: page.id,
      });

      await pageService.update(page.id, { slug: "about-us" });

      const navs = await navItemService.list();
      expect(navs).toHaveLength(1);
      expect(navs[0]?.url).toBe("/about-us");
    });

    it("syncs both label and url when title and slug change together", async () => {
      const page = await pageService.create({
        slug: "about",
        title: "About",
      });
      await navItemService.create({
        type: "page",
        label: "About",
        url: "/about",
        pageId: page.id,
      });

      await pageService.update(page.id, {
        title: "About Our Company",
        slug: "about-our-company",
      });

      const navs = await navItemService.list();
      expect(navs).toHaveLength(1);
      expect(navs[0]?.label).toBe("About Our Company");
      expect(navs[0]?.url).toBe("/about-our-company");
    });

    it("does not change nav item label when title is unchanged", async () => {
      const page = await pageService.create({
        slug: "about",
        title: "About",
      });
      await navItemService.create({
        type: "page",
        label: "Custom Label",
        url: "/about",
        pageId: page.id,
      });

      // Update body only, not title
      await pageService.update(page.id, { body: "New content" });

      const navs = await navItemService.list();
      expect(navs[0]?.label).toBe("Custom Label");
    });

    it("does not affect nav items for other pages", async () => {
      const page1 = await pageService.create({
        slug: "about",
        title: "About",
      });
      const page2 = await pageService.create({
        slug: "contact",
        title: "Contact",
      });
      await navItemService.create({
        type: "page",
        label: "About",
        url: "/about",
        pageId: page1.id,
      });
      await navItemService.create({
        type: "page",
        label: "Contact",
        url: "/contact",
        pageId: page2.id,
      });

      await pageService.update(page1.id, { title: "About Us" });

      const navs = await navItemService.list();
      const aboutNav = navs.find((n) => n.pageId === page1.id);
      const contactNav = navs.find((n) => n.pageId === page2.id);
      expect(aboutNav?.label).toBe("About Us");
      expect(contactNav?.label).toBe("Contact");
    });
  });
});
