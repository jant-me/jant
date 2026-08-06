import { describe, it, expect } from "vitest";
import { generatePostSlug } from "../slug.js";

/** Helper: always-available check */
const alwaysAvailable = async () => true;

/** Helper: never-available check */
const neverAvailable = async () => false;

/** Helper: available after N calls */
function availableAfter(n: number) {
  let calls = 0;
  return async () => {
    calls++;
    return calls > n;
  };
}

describe("generatePostSlug", () => {
  describe("user-provided slug", () => {
    it("returns user slug when available", async () => {
      const slug = await generatePostSlug({
        slug: "my-post",
        idLength: 5,
        isAvailable: alwaysAvailable,
      });
      expect(slug).toBe("my-post");
    });

    it("throws ConflictError when slug is taken", async () => {
      await expect(
        generatePostSlug({
          slug: "taken-slug",
          idLength: 5,
          isAvailable: neverAvailable,
        }),
      ).rejects.toThrow("already in use");
    });

    it("throws ValidationError for reserved slug", async () => {
      await expect(
        generatePostSlug({
          slug: "dash",
          idLength: 5,
          isAvailable: alwaysAvailable,
        }),
      ).rejects.toThrow("reserved");
    });

    it("prioritizes user slug over title", async () => {
      const slug = await generatePostSlug({
        slug: "custom-slug",
        title: "My Title",
        idLength: 5,
        isAvailable: alwaysAvailable,
      });
      expect(slug).toBe("custom-slug");
    });
  });

  describe("title-based slug", () => {
    it("generates slug from title", async () => {
      const slug = await generatePostSlug({
        title: "Hello World",
        idLength: 5,
        isAvailable: alwaysAvailable,
      });
      expect(slug).toBe("hello-world");
    });

    it("appends random suffix on conflict", async () => {
      const slug = await generatePostSlug({
        title: "Hello World",
        idLength: 5,
        isAvailable: availableAfter(1), // first call (base) fails, second succeeds
      });
      expect(slug).toMatch(/^hello-world-[a-z0-9]{5}$/);
    });

    it("retries with different random suffixes", async () => {
      const slug = await generatePostSlug({
        title: "Test Post",
        idLength: 5,
        isAvailable: availableAfter(3),
      });
      expect(slug).toMatch(/^test-post-[a-z0-9]{5}$/);
    });

    it("throws after exceeding max retries", async () => {
      await expect(
        generatePostSlug({
          title: "Test Post",
          idLength: 5,
          isAvailable: neverAvailable,
        }),
      ).rejects.toThrow("Could not generate a unique slug");
    });

    it("romanizes Korean titles", async () => {
      const slug = await generatePostSlug({
        title: "개발 일지",
        idLength: 5,
        isAvailable: alwaysAvailable,
      });
      expect(slug).toBe("gaebal-ilji");
    });

    it("falls back to random IDs for kanji-heavy Japanese titles", async () => {
      const slug = await generatePostSlug({
        title: "日本語のタイトルです",
        idLength: 5,
        isAvailable: alwaysAvailable,
      });
      expect(slug).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/);
    });
  });

  describe("random slug (no title, no slug)", () => {
    it("generates random ID of specified length", async () => {
      const slug = await generatePostSlug({
        idLength: 5,
        isAvailable: alwaysAvailable,
      });
      expect(slug).toMatch(/^[a-z0-9]{5}$/);
    });

    it("retries on conflict", async () => {
      const slug = await generatePostSlug({
        idLength: 8,
        isAvailable: availableAfter(2),
      });
      expect(slug).toMatch(/^[a-z0-9]{8}$/);
    });

    it("throws after exceeding max retries", async () => {
      await expect(
        generatePostSlug({
          idLength: 5,
          isAvailable: neverAvailable,
        }),
      ).rejects.toThrow("Could not generate a unique slug");
    });
  });
});
