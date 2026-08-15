/**
 * Multilingual lifecycle: enabling, disabling, and the invariants that keep the
 * language set and the `post.language` column agreeing with each other.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestDatabase,
  DEFAULT_TEST_SITE_ID,
} from "../../__tests__/helpers/db.js";
import { createCollectionService } from "../collection.js";
import { createCustomUrlService } from "../custom-url.js";
import { createLanguageService, type LanguageService } from "../language.js";
import { createPathService } from "../path.js";
import { createPostService } from "../post.js";
import { createSettingsService } from "../settings.js";
import type { Database } from "../../db/index.js";

function noteBody(text: string): string {
  return JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
}

describe("LanguageService", () => {
  let db: Database;
  let language: LanguageService;
  let posts: ReturnType<typeof createPostService>;
  let settings: ReturnType<typeof createSettingsService>;
  let paths: ReturnType<typeof createPathService>;
  let collections: ReturnType<typeof createCollectionService>;

  beforeEach(async () => {
    const testDb = createTestDatabase();
    db = testDb.db as unknown as Database;
    paths = createPathService(db, DEFAULT_TEST_SITE_ID);
    settings = createSettingsService(db, DEFAULT_TEST_SITE_ID);
    posts = createPostService(
      db,
      { slugIdLength: 5 },
      DEFAULT_TEST_SITE_ID,
      paths,
    );
    collections = createCollectionService(db, DEFAULT_TEST_SITE_ID, paths);
    language = createLanguageService({ settings, posts, paths });
    await settings.set("SITE_LANGUAGE", "zh-Hans");
  });

  describe("state", () => {
    it("reports a single-language site as off", async () => {
      const state = await language.getState();

      expect(state).toEqual({
        enabled: false,
        primary: "zh-Hans",
        additional: [],
        all: ["zh-Hans"],
      });
    });

    it("stays off when the flag is set but no other language is configured", async () => {
      await settings.set("MULTILINGUAL_ENABLED", "true");

      expect((await language.getState()).enabled).toBe(false);
    });

    it("drops the primary language from the additional list", async () => {
      await settings.set("MULTILINGUAL_ENABLED", "true");
      await settings.set("ADDITIONAL_LANGUAGES", "zh-Hans,en");

      const state = await language.getState();
      expect(state.additional).toEqual(["en"]);
      expect(state.all).toEqual(["zh-Hans", "en"]);
    });
  });

  describe("enable", () => {
    it("stamps existing posts and turns the feature on", async () => {
      const post = await posts.create({
        format: "note",
        body: noteBody("旧文"),
      });

      const { markedCount } = await language.enable({
        primary: "zh-Hans",
        additional: ["en"],
      });

      expect(markedCount).toBe(1);
      expect((await posts.getById(post.id))?.language).toBe("zh-Hans");
      expect(await language.getState()).toMatchObject({
        enabled: true,
        primary: "zh-Hans",
        additional: ["en"],
      });
    });

    it("marks with the language chosen in the dialog, not the stored one", async () => {
      // The stored site language may never have been set deliberately, so the
      // dialog's value wins and is written back.
      const post = await posts.create({
        format: "note",
        body: noteBody("English post"),
      });

      await language.enable({ primary: "en", additional: ["zh-Hans"] });

      expect((await posts.getById(post.id))?.language).toBe("en");
      expect(await settings.get("SITE_LANGUAGE")).toBe("en");
    });

    it("refuses to turn on with no second language", async () => {
      await expect(
        language.enable({ primary: "zh-Hans", additional: [] }),
      ).rejects.toThrow(/at least one more language/);
      expect((await language.getState()).enabled).toBe(false);
    });

    it("ignores the primary language repeated in the additional list", async () => {
      await expect(
        language.enable({ primary: "zh-Hans", additional: ["zh-Hans"] }),
      ).rejects.toThrow(/at least one more language/);
    });

    it("normalizes the tags it stores", async () => {
      await language.enable({ primary: "ZH-hans", additional: ["EN", "JA"] });

      expect(await settings.get("ADDITIONAL_LANGUAGES")).toBe("en,ja");
      expect(await settings.get("SITE_LANGUAGE")).toBe("zh-Hans");
    });

    // Turning multilingual off keeps both the languages and the stamps, and
    // the re-enable dialog lets the author edit the list freely — so enable
    // itself must hold the invariant the remove guard holds, or dropping a
    // language there would strand its posts outside every view.
    it("refuses a list that leaves stamped posts without a language", async () => {
      await language.enable({ primary: "zh-Hans", additional: ["ja"] });
      await posts.create({
        format: "note",
        body: noteBody("日本語の投稿"),
        language: "ja",
      });
      await language.disable();

      await expect(
        language.enable({ primary: "zh-Hans", additional: ["en"] }),
      ).rejects.toThrow(/still written in a language missing from this list/);
      // Nothing was written: the site stays off with its old lists intact.
      expect((await language.getState()).enabled).toBe(false);
      expect(await settings.get("ADDITIONAL_LANGUAGES")).toBe("ja");
    });

    it("accepts any list that seats every stamped language", async () => {
      await language.enable({ primary: "zh-Hans", additional: ["ja"] });
      await posts.create({
        format: "note",
        body: noteBody("日本語の投稿"),
        language: "ja",
      });
      await language.disable();

      // ja changes seats — it becomes the primary — and en joins fresh.
      await language.enable({ primary: "ja", additional: ["zh-Hans", "en"] });

      expect(await language.getState()).toMatchObject({
        enabled: true,
        primary: "ja",
        additional: ["zh-Hans", "en"],
      });
    });
  });

  describe("URL prefix conflicts", () => {
    it("refuses a language whose prefix is taken by a post", async () => {
      await posts.create({
        format: "note",
        slug: "ja",
        title: "Just a post",
        body: noteBody("hello"),
      });

      await expect(
        language.enable({ primary: "zh-Hans", additional: ["ja"] }),
      ).rejects.toThrow(/\/ja is already taken/);
    });

    it("refuses a language whose prefix shadows a nested path", async () => {
      await posts.create({
        format: "note",
        path: "ja/notes",
        title: "Nested",
        body: noteBody("hello"),
      });

      await expect(language.addLanguage("ja")).rejects.toThrow(/already taken/);
    });

    it("refuses a language whose prefix is a Jant application route", async () => {
      // `is` is a real ISO 639 code (Icelandic) — but so are `it`, `no`, and
      // `go`, which is why prefixes are checked here rather than reserved
      // globally.
      await settings.set("SITE_LANGUAGE", "en");
      await expect(
        language.enable({ primary: "en", additional: ["archive"] }),
      ).rejects.toThrow(/Jant already uses/);
    });

    it("leaves the site untouched when one language of several conflicts", async () => {
      await posts.create({
        format: "note",
        slug: "ja",
        title: "Just a post",
        body: noteBody("hello"),
      });

      await expect(
        language.enable({ primary: "zh-Hans", additional: ["en", "ja"] }),
      ).rejects.toThrow();

      expect((await language.getState()).enabled).toBe(false);
      expect(await settings.get("ADDITIONAL_LANGUAGES")).toBeNull();
    });

    it("does not mind a collection whose slug merely starts with the letters", async () => {
      await collections.create({ slug: "japanese", title: "Japanese" });

      await expect(language.addLanguage("ja")).resolves.toBeUndefined();
    });

    it("blocks a new custom URL from claiming a live language prefix", async () => {
      await language.enable({ primary: "zh-Hans", additional: ["en"] });
      const customUrls = createCustomUrlService(
        db,
        DEFAULT_TEST_SITE_ID,
        paths,
      );

      await expect(
        customUrls.create({
          path: "en",
          targetType: "redirect",
          toPath: "somewhere",
        }),
      ).rejects.toThrow(/reserved/);
      expect(await customUrls.isPathAvailable("en")).toBe(false);
    });

    it("blocks a new post slug from claiming a live language prefix", async () => {
      await language.enable({ primary: "zh-Hans", additional: ["en"] });

      await expect(
        posts.create({ format: "note", slug: "en", body: noteBody("hi") }),
      ).rejects.toThrow(/reserved/);
    });

    it("leaves those slugs available while multilingual is off", async () => {
      const post = await posts.create({
        format: "note",
        slug: "en",
        body: noteBody("hi"),
      });

      expect(post.slug).toBe("en");
    });
  });

  describe("changing the primary language", () => {
    beforeEach(async () => {
      await language.enable({ primary: "zh-Hans", additional: ["en", "ja"] });
    });

    it("swaps both lists in one step", async () => {
      await language.setPrimary("en");

      const state = await language.getState();
      expect(state.primary).toBe("en");
      // Both halves: `en` leaves the list, `zh-Hans` joins it. Doing only one
      // would leave a language's posts with no view at all.
      expect(state.additional).toEqual(["ja", "zh-Hans"]);
    });

    it("does not touch any post", async () => {
      const post = await posts.create({
        format: "note",
        body: noteBody("中文"),
        language: "zh-Hans",
      });

      await language.setPrimary("en");

      expect((await posts.getById(post.id))?.language).toBe("zh-Hans");
    });

    it("refuses a language the site does not serve", async () => {
      await expect(language.setPrimary("ko")).rejects.toThrow(
        /Add that language/,
      );
    });

    it("is a no-op when it is already primary", async () => {
      await language.setPrimary("zh-Hans");
      expect((await language.getState()).additional).toEqual(["en", "ja"]);
    });
  });

  describe("removing a language", () => {
    beforeEach(async () => {
      await language.enable({ primary: "zh-Hans", additional: ["en", "ja"] });
    });

    it("removes a language nobody has written in", async () => {
      await language.removeLanguage("ja");

      expect((await language.getState()).additional).toEqual(["en"]);
    });

    it("refuses while posts still use it, and says how many", async () => {
      await posts.create({
        format: "note",
        body: noteBody("one"),
        language: "en",
      });
      await posts.create({
        format: "note",
        body: noteBody("two"),
        language: "en",
      });

      await expect(language.removeLanguage("en")).rejects.toThrow(
        /2 posts are still written/,
      );
      expect((await language.getState()).additional).toEqual(["en", "ja"]);
    });

    it("counts drafts too", async () => {
      await posts.create({
        format: "note",
        body: noteBody("draft"),
        language: "en",
        status: "draft",
      });

      await expect(language.removeLanguage("en")).rejects.toThrow(
        /One post is still written/,
      );
    });

    it("still counts posts after multilingual is switched off", async () => {
      await posts.create({
        format: "note",
        body: noteBody("english"),
        language: "en",
      });
      await language.disable();

      await expect(language.removeLanguage("en")).rejects.toThrow(
        /still written/,
      );
    });

    it("refuses to remove the primary language", async () => {
      await expect(language.removeLanguage("zh-Hans")).rejects.toThrow(
        /primary language/,
      );
    });
  });

  describe("turning it off and back on", () => {
    it("keeps the configuration and every post language", async () => {
      await language.enable({ primary: "zh-Hans", additional: ["en"] });
      const post = await posts.create({
        format: "note",
        body: noteBody("English"),
        language: "en",
      });

      await language.disable();

      const off = await language.getState();
      expect(off.enabled).toBe(false);
      expect(off.additional).toEqual(["en"]);
      expect((await posts.getById(post.id))?.language).toBe("en");
    });

    it("only marks posts written while it was off", async () => {
      await language.enable({ primary: "zh-Hans", additional: ["en"] });
      const marked = await posts.create({
        format: "note",
        body: noteBody("English"),
        language: "en",
      });

      await language.disable();
      // Composing has no language control while multilingual is off.
      const unmarked = await posts.create({
        format: "note",
        body: noteBody("written while off"),
      });

      expect((await language.getEnablePreview()).pendingCount).toBe(1);

      const { markedCount } = await language.enable({
        primary: "zh-Hans",
        additional: ["en"],
      });

      expect(markedCount).toBe(1);
      expect((await posts.getById(marked.id))?.language).toBe("en");
      expect((await posts.getById(unmarked.id))?.language).toBe("zh-Hans");
    });
  });

  describe("the language-set invariant", () => {
    it("holds after enable, add, primary change, and remove", async () => {
      await language.enable({ primary: "zh-Hans", additional: ["en"] });
      await posts.create({
        format: "note",
        body: noteBody("中文"),
        language: "zh-Hans",
      });
      await posts.create({
        format: "note",
        body: noteBody("English"),
        language: "en",
      });

      await language.addLanguage("ja");
      await language.setPrimary("en");
      await language.removeLanguage("ja");

      const state = await language.getState();
      const configured = new Set(state.all);
      const used = (await posts.list()).map((post) => post.language);

      expect(used.length).toBeGreaterThan(0);
      for (const tag of used) {
        expect(tag).not.toBeNull();
        expect(configured.has(tag as string)).toBe(true);
      }
    });
  });
});
