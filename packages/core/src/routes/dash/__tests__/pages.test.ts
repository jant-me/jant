/**
 * Tests for the page/nav management logic used by dashboard pages routes.
 *
 * Note: Route handler tests that import JSX components with @lingui/react/macro
 * cannot run in vitest (requires SWC plugin). These tests verify the service
 * layer operations that the routes orchestrate.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDatabase } from "../../../__tests__/helpers/db.js";
import { createPageService } from "../../../services/page.js";
import { createNavItemService } from "../../../services/navigation.js";
import type { Database } from "../../../db/index.js";

describe("Dashboard Pages - Nav Management Logic", () => {
  let db: Database;
  let pageService: ReturnType<typeof createPageService>;
  let navItemService: ReturnType<typeof createNavItemService>;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db as unknown as Database;
    pageService = createPageService(db);
    navItemService = createNavItemService(db);
  });

  describe("add page to nav", () => {
    it("creates a page-type nav item for the page", async () => {
      const page = await pageService.create({
        slug: "about",
        title: "About Us",
      });

      // Simulate what the route handler does
      await navItemService.create({
        type: "page",
        label: page.title || page.slug,
        url: `/${page.slug}`,
        pageId: page.id,
      });

      const navItems = await navItemService.list();
      expect(navItems).toHaveLength(1);
      expect(navItems[0]?.type).toBe("page");
      expect(navItems[0]?.label).toBe("About Us");
      expect(navItems[0]?.url).toBe("/about");
      expect(navItems[0]?.pageId).toBe(page.id);
    });

    it("uses slug as label when page has no title", async () => {
      const page = await pageService.create({ slug: "about" });

      await navItemService.create({
        type: "page",
        label: page.title || page.slug,
        url: `/${page.slug}`,
        pageId: page.id,
      });

      const navItems = await navItemService.list();
      expect(navItems[0]?.label).toBe("about");
    });

    it("page appears in nav and not in listNotInNav after adding", async () => {
      const page = await pageService.create({
        slug: "about",
        title: "About",
      });

      // Before adding to nav
      let notInNav = await pageService.listNotInNav();
      expect(notInNav).toHaveLength(1);

      // Add to nav
      await navItemService.create({
        type: "page",
        label: page.title || page.slug,
        url: `/${page.slug}`,
        pageId: page.id,
      });

      // After adding to nav
      notInNav = await pageService.listNotInNav();
      expect(notInNav).toHaveLength(0);

      const navItems = await navItemService.list();
      expect(navItems).toHaveLength(1);
    });
  });

  describe("remove page from nav", () => {
    it("removes the nav item but keeps the page", async () => {
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

      // Simulate what the route handler does: find and delete nav item by pageId
      const allNavItems = await navItemService.list();
      const found = allNavItems.find((item) => item.pageId === page.id);
      expect(found).toBeDefined();
      await navItemService.delete(found?.id as number);

      // Nav item should be gone
      const navItems = await navItemService.list();
      expect(navItems).toHaveLength(0);

      // Page should still exist
      const foundPage = await pageService.getById(page.id);
      expect(foundPage).not.toBeNull();

      // Page should appear in "not in nav" list
      const notInNav = await pageService.listNotInNav();
      expect(notInNav).toHaveLength(1);
      expect(notInNav[0]?.slug).toBe("about");
    });
  });

  describe("reorder nav items", () => {
    it("reorders nav items by position", async () => {
      const a = await navItemService.create({
        type: "link",
        label: "A",
        url: "/a",
      });
      const b = await navItemService.create({
        type: "link",
        label: "B",
        url: "/b",
      });

      // Reverse order
      await navItemService.reorder([b.id, a.id]);

      const items = await navItemService.list();
      expect(items[0]?.label).toBe("B");
      expect(items[1]?.label).toBe("A");
    });
  });

  describe("link CRUD", () => {
    it("creates a link nav item", async () => {
      await navItemService.create({
        type: "link",
        label: "Blog",
        url: "/blog",
      });

      const navItems = await navItemService.list();
      expect(navItems).toHaveLength(1);
      expect(navItems[0]?.type).toBe("link");
      expect(navItems[0]?.label).toBe("Blog");
      expect(navItems[0]?.url).toBe("/blog");
    });

    it("updates a link nav item", async () => {
      const item = await navItemService.create({
        type: "link",
        label: "Blog",
        url: "/blog",
      });

      await navItemService.update(item.id, {
        label: "Posts",
        url: "/posts",
      });

      const updated = await navItemService.getById(item.id);
      expect(updated?.label).toBe("Posts");
      expect(updated?.url).toBe("/posts");
    });

    it("deletes a link nav item", async () => {
      const item = await navItemService.create({
        type: "link",
        label: "Blog",
        url: "/blog",
      });

      await navItemService.delete(item.id);

      const found = await navItemService.getById(item.id);
      expect(found).toBeNull();
    });
  });

  describe("unified page listing", () => {
    it("separates pages into nav and non-nav groups", async () => {
      const aboutPage = await pageService.create({
        slug: "about",
        title: "About",
      });
      await pageService.create({ slug: "contact", title: "Contact" });

      // Add about to nav
      await navItemService.create({
        type: "page",
        label: "About",
        url: "/about",
        pageId: aboutPage.id,
      });

      // Also add a link nav item
      await navItemService.create({
        type: "link",
        label: "External",
        url: "https://example.com",
      });

      // Simulate the unified page view data fetch
      const navItems = await navItemService.list();
      const otherPages = await pageService.listNotInNav();

      expect(navItems).toHaveLength(2); // page + link
      expect(otherPages).toHaveLength(1); // only contact
      expect(otherPages[0]?.slug).toBe("contact");
    });
  });
});
