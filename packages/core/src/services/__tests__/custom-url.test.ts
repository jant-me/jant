import { describe, it, expect, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import {
  createTestDatabase,
  DEFAULT_TEST_SITE_ID,
} from "../../__tests__/helpers/db.js";
import { createCustomUrlService } from "../custom-url.js";
import { createPostService } from "../post.js";
import type { Database } from "../../db/index.js";

describe("CustomUrlService", () => {
  let db: Database;
  let customUrlService: ReturnType<typeof createCustomUrlService>;
  let postService: ReturnType<typeof createPostService>;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db as unknown as Database;
    customUrlService = createCustomUrlService(db, DEFAULT_TEST_SITE_ID);
    postService = createPostService(
      db,
      { slugIdLength: 5 },
      DEFAULT_TEST_SITE_ID,
    );
  });

  describe("create", () => {
    it("creates a redirect custom URL", async () => {
      const url = await customUrlService.create({
        path: "old-page",
        targetType: "redirect",
        toPath: "/new-page",
        redirectType: 301,
      });

      expect(url.path).toBe("old-page");
      expect(url.targetType).toBe("redirect");
      expect(url.toPath).toBe("/new-page");
      expect(url.redirectType).toBe(301);
      expect(typeof url.id).toBe("string");
      expect(typeof url.createdAt).toBe("number");
    });

    it("creates a post custom URL", async () => {
      const post = await postService.create({ format: "note" });

      const url = await customUrlService.create({
        path: "blog/my-post",
        targetType: "post",
        targetId: post.id,
      });

      expect(url.path).toBe("blog/my-post");
      expect(url.targetType).toBe("post");
      expect(url.targetId).toBe(post.id);
    });

    it("rejects reserved paths", async () => {
      await expect(
        customUrlService.create({
          path: "dash",
          targetType: "redirect",
          toPath: "/somewhere",
        }),
      ).rejects.toThrow("reserved");
    });

    it("rejects duplicate paths", async () => {
      await customUrlService.create({
        path: "my-path",
        targetType: "redirect",
        toPath: "/target",
      });

      await expect(
        customUrlService.create({
          path: "my-path",
          targetType: "redirect",
          toPath: "/other-target",
        }),
      ).rejects.toThrow("already in use");
    });

    it("rejects paths that conflict with post slugs", async () => {
      const post = await postService.create({
        format: "note",
        slug: "my-slug",
      });

      await expect(
        customUrlService.create({
          path: post.slug,
          targetType: "redirect",
          toPath: "/somewhere",
        }),
      ).rejects.toThrow("conflicts with an existing post slug");
    });
  });

  // Postgres gives no order among rows that tie on the sort key, so paging
  // by created_at alone repeated some custom URLs and never showed others
  // (482 rows listed, 478 distinct, on a real site).
  describe("list order", () => {
    it("orders custom URLs created in the same second by ID", async () => {
      const created = [];
      for (const path of ["a-page", "b-page", "c-page"]) {
        created.push(
          await customUrlService.create({
            path,
            targetType: "redirect",
            toPath: "/target",
            redirectType: 301,
          }),
        );
      }
      await db.run(sql`UPDATE path_registry SET created_at = 1000`);

      const listed = await customUrlService.list();
      const expected = created
        .map((url) => url.id)
        .sort()
        .reverse();
      expect(listed.map((url) => url.id)).toEqual(expected);

      const pages = [
        ...(await customUrlService.list({ limit: 2, offset: 0 })),
        ...(await customUrlService.list({ limit: 2, offset: 2 })),
      ];
      expect(pages.map((url) => url.id)).toEqual(expected);
    });
  });

  describe("getByPath", () => {
    it("returns custom URL by path", async () => {
      await customUrlService.create({
        path: "test-path",
        targetType: "redirect",
        toPath: "/target",
        redirectType: 302,
      });

      const result = await customUrlService.getByPath("test-path");
      expect(result).not.toBeNull();
      expect(result?.path).toBe("test-path");
      expect(result?.redirectType).toBe(302);
    });

    it("returns null for non-existent path", async () => {
      const result = await customUrlService.getByPath("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("getByTarget", () => {
    it("returns custom URL by target", async () => {
      const post = await postService.create({ format: "note" });
      await customUrlService.create({
        path: "custom-path",
        targetType: "post",
        targetId: post.id,
      });

      const result = await customUrlService.getByTarget("post", post.id);
      expect(result).not.toBeNull();
      expect(result?.path).toBe("custom-path");
      expect(result?.targetId).toBe(post.id);
    });

    it("returns null when no match", async () => {
      const result = await customUrlService.getByTarget(
        "post",
        "nonexistent-id",
      );
      expect(result).toBeNull();
    });
  });

  describe("delete", () => {
    it("deletes a custom URL", async () => {
      const url = await customUrlService.create({
        path: "to-delete",
        targetType: "redirect",
        toPath: "/target",
      });

      const deleted = await customUrlService.delete(url.id);
      expect(deleted).toBe(true);

      const result = await customUrlService.getByPath("to-delete");
      expect(result).toBeNull();
    });

    it("returns false for non-existent ID", async () => {
      const deleted = await customUrlService.delete("nonexistent-id");
      expect(deleted).toBe(false);
    });
  });

  describe("list", () => {
    it("returns all custom URLs", async () => {
      await customUrlService.create({
        path: "path-1",
        targetType: "redirect",
        toPath: "/a",
      });
      await customUrlService.create({
        path: "path-2",
        targetType: "redirect",
        toPath: "/b",
      });

      const all = await customUrlService.list();
      expect(all).toHaveLength(2);
    });

    it("returns empty array when none exist", async () => {
      const all = await customUrlService.list();
      expect(all).toEqual([]);
    });
  });

  describe("isPathAvailable", () => {
    it("returns true for available path", async () => {
      const available = await customUrlService.isPathAvailable("free-path");
      expect(available).toBe(true);
    });

    it("returns false for reserved path", async () => {
      const available = await customUrlService.isPathAvailable("api");
      expect(available).toBe(false);
    });

    it("returns false for existing custom URL path", async () => {
      await customUrlService.create({
        path: "taken-path",
        targetType: "redirect",
        toPath: "/target",
      });

      const available = await customUrlService.isPathAvailable("taken-path");
      expect(available).toBe(false);
    });

    it("returns false for existing post slug", async () => {
      const post = await postService.create({
        format: "note",
        slug: "post-slug",
      });

      const available = await customUrlService.isPathAvailable(post.slug);
      expect(available).toBe(false);
    });
  });
});
