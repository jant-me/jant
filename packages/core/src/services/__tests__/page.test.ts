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
        pageId: (
          pages.find((p) => p.slug === "second") as (typeof pages)[number]
        ).id,
      });

      const notInNav = await pageService.listNotInNav();
      expect(notInNav).toHaveLength(2);
      const slugs = notInNav.map((p) => p.slug);
      expect(slugs).toContain("first");
      expect(slugs).toContain("third");
      expect(slugs).not.toContain("second");
    });
  });
});
