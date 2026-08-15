/**
 * Multilingual data foundation: the language column, the thread-uniform rule
 * it depends on, translation groups, and the enable-time backfill.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import {
  createTestDatabase,
  DEFAULT_TEST_SITE_ID,
} from "../../__tests__/helpers/db.js";
import { posts, settings, sites } from "../../db/schema.js";
import { createCollectionService } from "../collection.js";
import { createPostService } from "../post.js";
import { createSettingsService } from "../settings.js";
import type { Database } from "../../db/index.js";

const OTHER_SITE_ID = "sit_other0000000000000000000000";

function noteBody(text: string): string {
  return JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
}

describe("post language", () => {
  let db: Database;
  let postService: ReturnType<typeof createPostService>;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db as unknown as Database;
    postService = createPostService(
      db,
      { slugIdLength: 5 },
      DEFAULT_TEST_SITE_ID,
    );
  });

  describe("storage and normalization", () => {
    it("stores nothing when the caller supplies no language", async () => {
      const post = await postService.create({
        format: "note",
        body: noteBody("Hello"),
      });

      expect(post.language).toBeNull();
      expect(post.translationGroupId).toBeNull();
    });

    it("normalizes a supplied tag to canonical BCP 47 case", async () => {
      const post = await postService.create({
        format: "note",
        body: noteBody("你好"),
        language: "ZH-hans",
      });

      expect(post.language).toBe("zh-Hans");
    });

    it("rejects a tag that is not BCP 47", async () => {
      await expect(
        postService.create({
          format: "note",
          body: noteBody("Hello"),
          language: "not a locale!!!",
        }),
      ).rejects.toThrow(/BCP 47/);
    });
  });

  describe("thread-uniform rule", () => {
    it("gives a reply the root's language, ignoring what the caller asked for", async () => {
      const root = await postService.create({
        format: "note",
        body: noteBody("根"),
        language: "zh-Hans",
      });
      const reply = await postService.create({
        format: "note",
        body: noteBody("回复"),
        replyToId: root.id,
        language: "en",
      });

      expect(reply.language).toBe("zh-Hans");
    });

    it("rewrites every post in the thread when the language changes", async () => {
      const root = await postService.create({
        format: "note",
        body: noteBody("root"),
        language: "en",
      });
      const reply = await postService.create({
        format: "note",
        body: noteBody("reply"),
        replyToId: root.id,
      });

      await postService.setThreadLanguage(root.id, "ja");

      expect((await postService.getById(root.id))?.language).toBe("ja");
      expect((await postService.getById(reply.id))?.language).toBe("ja");
    });

    it("accepts any post in the thread as the handle for the change", async () => {
      const root = await postService.create({
        format: "note",
        body: noteBody("root"),
        language: "en",
      });
      const reply = await postService.create({
        format: "note",
        body: noteBody("reply"),
        replyToId: root.id,
      });

      await postService.setThreadLanguage(reply.id, "zh-Hant");

      expect((await postService.getById(root.id))?.language).toBe("zh-Hant");
      expect((await postService.getById(reply.id))?.language).toBe("zh-Hant");
    });
  });

  describe("lang filter", () => {
    beforeEach(async () => {
      await postService.create({
        format: "note",
        body: noteBody("中文一"),
        language: "zh-Hans",
      });
      await postService.create({
        format: "note",
        body: noteBody("中文二"),
        language: "zh-Hans",
      });
      await postService.create({
        format: "note",
        body: noteBody("English one"),
        language: "en",
      });
    });

    it("returns only posts in the requested language", async () => {
      const zh = await postService.list({ lang: "zh-Hans" });
      const en = await postService.list({ lang: "en" });

      expect(zh).toHaveLength(2);
      expect(en).toHaveLength(1);
    });

    it("counts with the same filter", async () => {
      expect(await postService.count({ lang: "zh-Hans" })).toBe(2);
      expect(await postService.count({ lang: "en" })).toBe(1);
      expect(await postService.count({ lang: "ja" })).toBe(0);
    });

    it("returns everything when no language is requested", async () => {
      expect(await postService.list()).toHaveLength(3);
    });

    it("matches exactly, without language-family folding", async () => {
      expect(await postService.count({ lang: "zh" })).toBe(0);
    });
  });

  describe("enable-time backfill", () => {
    it("stamps every post that has no language yet", async () => {
      await postService.create({ format: "note", body: noteBody("a") });
      await postService.create({ format: "note", body: noteBody("b") });

      expect(await postService.countMissingLanguage()).toBe(2);
      expect(await postService.materializeMissingLanguage("zh-Hans")).toBe(2);
      expect(await postService.countMissingLanguage()).toBe(0);
      expect(await postService.countByLanguage("zh-Hans")).toBe(2);
    });

    it("stamps replies too, so threads stay uniform", async () => {
      const root = await postService.create({
        format: "note",
        body: noteBody("root"),
      });
      const reply = await postService.create({
        format: "note",
        body: noteBody("reply"),
        replyToId: root.id,
      });

      await postService.materializeMissingLanguage("en");

      expect((await postService.getById(root.id))?.language).toBe("en");
      expect((await postService.getById(reply.id))?.language).toBe("en");
    });

    it("is idempotent and leaves already-marked posts alone", async () => {
      await postService.create({
        format: "note",
        body: noteBody("english"),
        language: "en",
      });
      const untagged = await postService.create({
        format: "note",
        body: noteBody("untagged"),
      });

      expect(await postService.materializeMissingLanguage("zh-Hans")).toBe(1);
      expect(await postService.materializeMissingLanguage("zh-Hans")).toBe(0);
      expect(await postService.countByLanguage("en")).toBe(1);
      expect((await postService.getById(untagged.id))?.language).toBe(
        "zh-Hans",
      );
    });

    it("never touches another site's posts", async () => {
      await db.insert(sites).values({
        id: OTHER_SITE_ID,
        key: "other",
        name: "Other",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const otherService = createPostService(
        db,
        { slugIdLength: 5 },
        OTHER_SITE_ID,
      );
      const foreign = await otherService.create({
        format: "note",
        body: noteBody("foreign"),
      });
      await postService.create({ format: "note", body: noteBody("mine") });

      expect(await postService.materializeMissingLanguage("zh-Hans")).toBe(1);

      const stillMissing = await db
        .select({ id: posts.id })
        .from(posts)
        .where(and(eq(posts.siteId, OTHER_SITE_ID), isNull(posts.language)));
      expect(stillMissing.map((row) => row.id)).toEqual([foreign.id]);
    });
  });

  describe("translation groups", () => {
    it("links a new translation to its source, minting the group once", async () => {
      const source = await postService.create({
        format: "note",
        title: "书评",
        body: noteBody("中文正文"),
        language: "zh-Hans",
      });
      const translation = await postService.create({
        format: "note",
        title: "Book review",
        body: noteBody("English body"),
        language: "en",
        translationOfId: source.id,
      });

      const refreshedSource = await postService.getById(source.id);
      expect(translation.translationGroupId).toMatch(/^tgr_[a-z0-9]{26}$/);
      expect(refreshedSource?.translationGroupId).toBe(
        translation.translationGroupId,
      );
    });

    it("makes the pair visible to each other", async () => {
      const source = await postService.create({
        format: "note",
        body: noteBody("中文"),
        language: "zh-Hans",
      });
      const translation = await postService.create({
        format: "note",
        body: noteBody("English"),
        language: "en",
        translationOfId: source.id,
      });

      expect(
        (await postService.listTranslations(source.id)).map((p) => p.id),
      ).toEqual([translation.id]);
      expect(
        (await postService.listTranslations(translation.id)).map((p) => p.id),
      ).toEqual([source.id]);
    });

    it("joins a third language to the same group automatically", async () => {
      const zh = await postService.create({
        format: "note",
        body: noteBody("中文"),
        language: "zh-Hans",
      });
      const en = await postService.create({
        format: "note",
        body: noteBody("English"),
        language: "en",
        translationOfId: zh.id,
      });
      const ja = await postService.create({
        format: "note",
        body: noteBody("日本語"),
        language: "ja",
        translationOfId: en.id,
      });

      // `zh` was returned before the group existed; re-read it.
      const groupId = (await postService.getById(zh.id))?.translationGroupId;
      expect(groupId).toMatch(/^tgr_/);
      expect(en.translationGroupId).toBe(groupId);
      expect(ja.translationGroupId).toBe(groupId);
      expect(await postService.listTranslations(zh.id)).toHaveLength(2);
    });

    it("refuses a language the group already holds", async () => {
      const zh = await postService.create({
        format: "note",
        body: noteBody("中文"),
        language: "zh-Hans",
      });
      await postService.create({
        format: "note",
        title: "English version",
        body: noteBody("English"),
        language: "en",
        translationOfId: zh.id,
      });

      await expect(
        postService.create({
          format: "note",
          body: noteBody("Another English"),
          language: "en",
          translationOfId: zh.id,
        }),
      ).rejects.toThrow(/already the English version/);
    });

    it("refuses a translation written in the source's own language", async () => {
      const zh = await postService.create({
        format: "note",
        body: noteBody("中文"),
        language: "zh-Hans",
      });

      await expect(
        postService.create({
          format: "note",
          body: noteBody("更多中文"),
          language: "zh-Hans",
          translationOfId: zh.id,
        }),
      ).rejects.toThrow(/already written in this language/);
    });

    it("refuses to hang a group off a reply", async () => {
      const root = await postService.create({
        format: "note",
        body: noteBody("root"),
        language: "en",
      });
      const reply = await postService.create({
        format: "note",
        body: noteBody("reply"),
        replyToId: root.id,
      });

      await expect(
        postService.create({
          format: "note",
          body: noteBody("中文"),
          language: "zh-Hans",
          translationOfId: reply.id,
        }),
      ).rejects.toThrow(/thread's first post/);
    });

    it("refuses a translation that is itself a reply", async () => {
      const source = await postService.create({
        format: "note",
        body: noteBody("source"),
        language: "en",
      });
      const otherRoot = await postService.create({
        format: "note",
        body: noteBody("other"),
        language: "en",
      });

      await expect(
        postService.create({
          format: "note",
          body: noteBody("中文"),
          language: "zh-Hans",
          replyToId: otherRoot.id,
          translationOfId: source.id,
        }),
      ).rejects.toThrow(/thread's first post/);
    });

    it("refuses a source that belongs to another site", async () => {
      await db.insert(sites).values({
        id: OTHER_SITE_ID,
        key: "other",
        name: "Other",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const otherService = createPostService(
        db,
        { slugIdLength: 5 },
        OTHER_SITE_ID,
      );
      const foreign = await otherService.create({
        format: "note",
        body: noteBody("foreign"),
        language: "en",
      });

      await expect(
        postService.create({
          format: "note",
          body: noteBody("中文"),
          language: "zh-Hans",
          translationOfId: foreign.id,
        }),
      ).rejects.toThrow(/not found/i);
    });

    it("leaves nothing behind when the translation fails to save", async () => {
      const source = await postService.create({
        format: "note",
        body: noteBody("中文"),
        language: "zh-Hans",
      });

      await expect(
        postService.create({
          format: "note",
          body: noteBody("English"),
          translationOfId: source.id,
        }),
      ).rejects.toThrow(/Choose a language/);

      expect((await postService.getById(source.id))?.translationGroupId).toBe(
        null,
      );
      expect(await postService.count()).toBe(1);
    });

    it("blocks a language change that would collide inside the group", async () => {
      const zh = await postService.create({
        format: "note",
        title: "中文标题",
        body: noteBody("中文"),
        language: "zh-Hans",
      });
      const en = await postService.create({
        format: "note",
        title: "English title",
        body: noteBody("English"),
        language: "en",
        translationOfId: zh.id,
      });

      await expect(
        postService.setThreadLanguage(en.id, "zh-Hans"),
      ).rejects.toThrow(/中文标题/);
      expect((await postService.getById(en.id))?.language).toBe("en");
    });

    it("allows a language change that stays unique inside the group", async () => {
      const zh = await postService.create({
        format: "note",
        body: noteBody("中文"),
        language: "zh-Hans",
      });
      const en = await postService.create({
        format: "note",
        body: noteBody("English"),
        language: "en",
        translationOfId: zh.id,
      });

      await postService.setThreadLanguage(en.id, "ja");
      expect((await postService.getById(en.id))?.language).toBe("ja");
    });

    it("links two posts that were published separately", async () => {
      const zh = await postService.create({
        format: "note",
        body: noteBody("中文"),
        language: "zh-Hans",
      });
      const en = await postService.create({
        format: "note",
        body: noteBody("English"),
        language: "en",
      });

      await postService.linkTranslation(zh.id, en.id);

      const refreshed = await postService.getById(zh.id);
      expect(refreshed?.translationGroupId).toMatch(/^tgr_/);
      expect((await postService.getById(en.id))?.translationGroupId).toBe(
        refreshed?.translationGroupId,
      );
    });

    it("refuses to merge two existing groups", async () => {
      const zh = await postService.create({
        format: "note",
        body: noteBody("中文"),
        language: "zh-Hans",
      });
      await postService.create({
        format: "note",
        body: noteBody("English"),
        language: "en",
        translationOfId: zh.id,
      });
      const ja = await postService.create({
        format: "note",
        body: noteBody("日本語"),
        language: "ja",
      });
      await postService.create({
        format: "note",
        body: noteBody("한국어"),
        language: "ko",
        translationOfId: ja.id,
      });

      await expect(postService.linkTranslation(zh.id, ja.id)).rejects.toThrow(
        /Unlink one of them first/,
      );
    });

    it("refuses to link two posts sharing a language", async () => {
      const a = await postService.create({
        format: "note",
        body: noteBody("one"),
        language: "en",
      });
      const b = await postService.create({
        format: "note",
        body: noteBody("two"),
        language: "en",
      });

      await expect(postService.linkTranslation(a.id, b.id)).rejects.toThrow(
        /same language/,
      );
    });

    it("clears the group entirely when unlinking leaves one post", async () => {
      const zh = await postService.create({
        format: "note",
        body: noteBody("中文"),
        language: "zh-Hans",
      });
      const en = await postService.create({
        format: "note",
        body: noteBody("English"),
        language: "en",
        translationOfId: zh.id,
      });

      await postService.unlinkTranslation(en.id);

      expect((await postService.getById(en.id))?.translationGroupId).toBeNull();
      expect((await postService.getById(zh.id))?.translationGroupId).toBeNull();
    });

    it("keeps the group when unlinking still leaves two members", async () => {
      const zh = await postService.create({
        format: "note",
        body: noteBody("中文"),
        language: "zh-Hans",
      });
      const en = await postService.create({
        format: "note",
        body: noteBody("English"),
        language: "en",
        translationOfId: zh.id,
      });
      const ja = await postService.create({
        format: "note",
        body: noteBody("日本語"),
        language: "ja",
        translationOfId: zh.id,
      });

      await postService.unlinkTranslation(ja.id);

      const groupId = (await postService.getById(zh.id))?.translationGroupId;
      expect(groupId).toMatch(/^tgr_/);
      expect((await postService.getById(en.id))?.translationGroupId).toBe(
        groupId,
      );
      expect((await postService.getById(ja.id))?.translationGroupId).toBeNull();
    });

    it("rejects a duplicate language inside a group at the database level", async () => {
      const zh = await postService.create({
        format: "note",
        body: noteBody("中文"),
        language: "zh-Hans",
      });
      const en = await postService.create({
        format: "note",
        body: noteBody("English"),
        language: "en",
        translationOfId: zh.id,
      });
      const other = await postService.create({
        format: "note",
        body: noteBody("Another English"),
        language: "en",
      });

      await expect(
        db
          .update(posts)
          .set({ translationGroupId: en.translationGroupId })
          .where(eq(posts.id, other.id)),
      ).rejects.toThrow(/UNIQUE/i);
    });

    it("allows many posts outside any group to share a language", async () => {
      await postService.create({
        format: "note",
        body: noteBody("one"),
        language: "en",
      });
      await postService.create({
        format: "note",
        body: noteBody("two"),
        language: "en",
      });

      expect(await postService.countByLanguage("en")).toBe(2);
    });
  });

  describe("thread-member-grained queries", () => {
    // Collection and featured queries group thread *members* by thread_id, so
    // a member row's language has to agree with its root's. The thread-uniform
    // rule is what makes the plain column predicate safe there.
    it("filters collection threads by language, replies included", async () => {
      const collectionService = createCollectionService(
        db,
        DEFAULT_TEST_SITE_ID,
      );
      const collection = await collectionService.create({
        slug: "reading",
        title: "Reading",
      });

      const zhRoot = await postService.create({
        format: "note",
        body: noteBody("中文根"),
        language: "zh-Hans",
        collectionIds: [collection.id],
      });
      await postService.create({
        format: "note",
        body: noteBody("中文回复"),
        replyToId: zhRoot.id,
      });
      await postService.create({
        format: "note",
        body: noteBody("English root"),
        language: "en",
        collectionIds: [collection.id],
      });

      const zhIds = await postService.listCollectionThreadRootIds(
        collection.id,
        { lang: "zh-Hans" },
      );
      const enIds = await postService.listCollectionThreadRootIds(
        collection.id,
        { lang: "en" },
      );

      expect(zhIds).toEqual([zhRoot.id]);
      expect(enIds).toHaveLength(1);
      expect(
        await postService.countCollectionThreadRoots(collection.id, {
          lang: "zh-Hans",
        }),
      ).toBe(1);
    });

    it("filters featured threads by language", async () => {
      const zh = await postService.create({
        format: "note",
        body: noteBody("中文"),
        language: "zh-Hans",
        featured: true,
      });
      await postService.create({
        format: "note",
        body: noteBody("English"),
        language: "en",
        featured: true,
      });

      expect(
        await postService.listFeaturedThreadRootIds({ lang: "zh-Hans" }),
      ).toEqual([zh.id]);
      expect(await postService.countFeaturedThreadRoots({ lang: "en" })).toBe(
        1,
      );
    });
  });

  describe("slug conflicts", () => {
    beforeEach(async () => {
      const settingsService = createSettingsService(db, DEFAULT_TEST_SITE_ID);
      await settingsService.set("SITE_LANGUAGE", "zh-Hans");
    });

    it("prefers a language suffix over a random one for a secondary language", async () => {
      await postService.create({
        format: "note",
        title: "Book Review",
        body: noteBody("中文"),
        language: "zh-Hans",
      });
      const translated = await postService.create({
        format: "note",
        title: "Book Review",
        body: noteBody("English"),
        language: "en",
      });

      expect(translated.slug).toBe("book-review-en");
    });

    it("lowercases a script-tagged language for the suffix", async () => {
      await postService.create({
        format: "note",
        title: "Book Review",
        body: noteBody("中文"),
        language: "zh-Hans",
      });
      const translated = await postService.create({
        format: "note",
        title: "Book Review",
        body: noteBody("繁體"),
        language: "zh-Hant",
      });

      expect(translated.slug).toBe("book-review-zh-hant");
    });

    it("falls back to a random suffix for the primary language", async () => {
      await postService.create({
        format: "note",
        title: "Book Review",
        body: noteBody("中文一"),
        language: "zh-Hans",
      });
      const second = await postService.create({
        format: "note",
        title: "Book Review",
        body: noteBody("中文二"),
        language: "zh-Hans",
      });

      expect(second.slug).not.toBe("book-review-zh-hans");
      expect(second.slug).toMatch(/^book-review-[a-z0-9]{5}$/);
    });

    it("falls back to a random suffix when the language slug is also taken", async () => {
      await postService.create({
        format: "note",
        title: "Book Review",
        body: noteBody("中文"),
        language: "zh-Hans",
      });
      const first = await postService.create({
        format: "note",
        title: "Book Review",
        body: noteBody("English"),
        language: "en",
      });
      const second = await postService.create({
        format: "note",
        title: "Book Review",
        body: noteBody("More English"),
        language: "en",
      });

      expect(first.slug).toBe("book-review-en");
      expect(second.slug).toMatch(/^book-review-[a-z0-9]{5}$/);
    });

    it("leaves an uncontested slug untouched", async () => {
      const post = await postService.create({
        format: "note",
        title: "Book Review",
        body: noteBody("English"),
        language: "en",
      });

      expect(post.slug).toBe("book-review");
    });

    it("does not query the site language for posts without one", async () => {
      const post = await postService.create({
        format: "note",
        title: "Book Review",
        body: noteBody("plain"),
      });
      const rows = await db
        .select({ key: settings.key })
        .from(settings)
        .where(eq(settings.siteId, DEFAULT_TEST_SITE_ID));

      expect(post.slug).toBe("book-review");
      expect(rows.map((row) => row.key)).toContain("SITE_LANGUAGE");
    });
  });
});
