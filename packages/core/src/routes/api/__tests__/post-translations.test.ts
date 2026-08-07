/**
 * Language and translation endpoints.
 *
 * These are the write paths the post menu drives. The interesting cases are the
 * refusals: a language the site does not publish, and a translation link that
 * would put two posts of the same language in one group. Both have to come back
 * as readable messages, because the menu shows them verbatim.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { postsApiRoutes } from "../posts.js";

function createApiTestApp() {
  const testApp = createTestApp({ authenticated: true });
  testApp.app.route("/api/posts", postsApiRoutes);
  return testApp;
}

function noteBody(text: string): string {
  return JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
}

async function enableMultilingual(
  services: ReturnType<typeof createTestApp>["services"],
) {
  await services.settings.set("SITE_LANGUAGE", "zh-Hans");
  await services.settings.set("ADDITIONAL_LANGUAGES", "en");
  await services.settings.set("MULTILINGUAL_ENABLED", "true");
}

describe("PUT /api/posts/:id/language", () => {
  let app: ReturnType<typeof createApiTestApp>["app"];
  let services: ReturnType<typeof createApiTestApp>["services"];

  beforeEach(async () => {
    const testApp = createApiTestApp();
    app = testApp.app;
    services = testApp.services;
    await enableMultilingual(services);
  });

  it("changes the language of the whole thread", async () => {
    const root = await services.posts.create({
      format: "note",
      body: noteBody("root"),
      language: "zh-Hans",
      status: "published",
    });
    const reply = await services.posts.create({
      format: "note",
      body: noteBody("reply"),
      replyToId: root.id,
      status: "published",
    });

    const res = await app.request(`/api/posts/${root.id}/language`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "en" }),
    });

    expect(res.status).toBe(200);
    expect((await services.posts.getById(root.id))?.language).toBe("en");
    // A Thread is written in one language — that is what makes every language
    // filter a plain column predicate.
    expect((await services.posts.getById(reply.id))?.language).toBe("en");
  });

  it("refuses a language the site does not publish", async () => {
    const post = await services.posts.create({
      format: "note",
      body: noteBody("root"),
      language: "zh-Hans",
      status: "published",
    });

    const res = await app.request(`/api/posts/${post.id}/language`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "ja" }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({
      error: expect.stringContaining("does not publish that language"),
    });
  });

  it("rejects a malformed tag before it reaches the service", async () => {
    const post = await services.posts.create({
      format: "note",
      body: noteBody("root"),
      status: "published",
    });

    const res = await app.request(`/api/posts/${post.id}/language`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "not a tag" }),
    });

    expect(res.status).toBe(400);
  });
});

describe("translation links", () => {
  let app: ReturnType<typeof createApiTestApp>["app"];
  let services: ReturnType<typeof createApiTestApp>["services"];

  beforeEach(async () => {
    const testApp = createApiTestApp();
    app = testApp.app;
    services = testApp.services;
    await enableMultilingual(services);
  });

  async function seedPair() {
    const zh = await services.posts.create({
      format: "note",
      title: "中文文章",
      body: noteBody("中文"),
      language: "zh-Hans",
      status: "published",
    });
    const en = await services.posts.create({
      format: "note",
      title: "English post",
      body: noteBody("English"),
      language: "en",
      status: "published",
    });
    return { zh, en };
  }

  it("links two posts and lists them from either side", async () => {
    const { zh, en } = await seedPair();

    const link = await app.request(`/api/posts/${zh.id}/translations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId: en.id }),
    });
    expect(link.status).toBe(200);

    const fromZh = (await (
      await app.request(`/api/posts/${zh.id}/translations`)
    ).json()) as { translations: Array<{ id: string; language: string }> };
    expect(fromZh.translations).toEqual([
      expect.objectContaining({ id: en.id, language: "en" }),
    ]);

    const fromEn = (await (
      await app.request(`/api/posts/${en.id}/translations`)
    ).json()) as { translations: Array<{ id: string }> };
    expect(fromEn.translations).toEqual([
      expect.objectContaining({ id: zh.id }),
    ]);
  });

  it("refuses to put two posts of one language in a group", async () => {
    const { zh } = await seedPair();
    const otherZh = await services.posts.create({
      format: "note",
      title: "另一篇中文",
      body: noteBody("中文"),
      language: "zh-Hans",
      status: "published",
    });

    const res = await app.request(`/api/posts/${zh.id}/translations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId: otherZh.id }),
    });

    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /same language|already/i,
    );
  });

  it("unlinks, and clears the group rather than leaving one post in it", async () => {
    const { zh, en } = await seedPair();
    await services.posts.linkTranslation(zh.id, en.id);

    const res = await app.request(`/api/posts/${zh.id}/translations`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);

    expect(
      (await services.posts.getById(zh.id))?.translationGroupId,
    ).toBeNull();
    // The other side would otherwise be a one-member group: a translation of
    // nothing.
    expect(
      (await services.posts.getById(en.id))?.translationGroupId,
    ).toBeNull();
  });

  it("returns an empty list for a post with no translations", async () => {
    const { zh } = await seedPair();

    const body = (await (
      await app.request(`/api/posts/${zh.id}/translations`)
    ).json()) as { translations: unknown[] };
    expect(body.translations).toEqual([]);
  });
});

describe("GET /api/posts/:id/translations/candidates", () => {
  let app: ReturnType<typeof createApiTestApp>["app"];
  let services: ReturnType<typeof createApiTestApp>["services"];

  beforeEach(async () => {
    const testApp = createApiTestApp();
    app = testApp.app;
    services = testApp.services;
    await services.settings.set("SITE_LANGUAGE", "zh-Hans");
    await services.settings.set("ADDITIONAL_LANGUAGES", "en,ja");
    await services.settings.set("MULTILINGUAL_ENABLED", "true");
  });

  async function candidatesFor(postId: string, query: string) {
    const res = await app.request(
      `/api/posts/${postId}/translations/candidates?q=${encodeURIComponent(query)}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      candidates: Array<{ id: string; title: string | null }>;
    };
    return body.candidates;
  }

  it("offers a published post in another language", async () => {
    const zh = await services.posts.create({
      format: "note",
      title: "咖啡笔记",
      body: noteBody("中文"),
      language: "zh-Hans",
      status: "published",
    });
    const en = await services.posts.create({
      format: "note",
      title: "Coffee notes",
      body: noteBody("English"),
      language: "en",
      status: "published",
    });

    expect(await candidatesFor(zh.id, "Coffee")).toEqual([
      expect.objectContaining({ id: en.id }),
    ]);
  });

  it("hides posts in a language this one already speaks for", async () => {
    // Everything the menu offers has to work when clicked — making the author
    // hit the conflict error to find out is not a filter.
    const zh = await services.posts.create({
      format: "note",
      title: "咖啡笔记",
      body: noteBody("中文"),
      language: "zh-Hans",
      status: "published",
    });
    await services.posts.create({
      format: "note",
      title: "咖啡笔记 coffee",
      body: noteBody("中文"),
      language: "zh-Hans",
      status: "published",
    });

    expect(await candidatesFor(zh.id, "咖啡")).toEqual([]);
  });

  it("hides a language the group already holds", async () => {
    const zh = await services.posts.create({
      format: "note",
      title: "咖啡笔记",
      body: noteBody("中文"),
      language: "zh-Hans",
      status: "published",
    });
    const en = await services.posts.create({
      format: "note",
      title: "Coffee notes",
      body: noteBody("English"),
      language: "en",
      status: "published",
    });
    await services.posts.linkTranslation(zh.id, en.id);

    const other = await services.posts.create({
      format: "note",
      title: "Coffee, again",
      body: noteBody("English"),
      language: "en",
      status: "published",
    });
    expect(await candidatesFor(zh.id, "Coffee")).not.toContainEqual(
      expect.objectContaining({ id: other.id }),
    );
  });

  it("hides a post already in another group, which cannot be merged", async () => {
    const a = await services.posts.create({
      format: "note",
      title: "Coffee A",
      body: noteBody("English"),
      language: "en",
      status: "published",
    });
    const b = await services.posts.create({
      format: "note",
      title: "咖啡 Coffee B",
      body: noteBody("中文"),
      language: "zh-Hans",
      status: "published",
    });
    const c = await services.posts.create({
      format: "note",
      title: "Coffee C",
      body: noteBody("日本語"),
      language: "ja",
      status: "published",
    });
    await services.posts.linkTranslation(b.id, c.id);
    // `a` has no group, so joining b+c is fine — that group has no English yet.
    expect(await candidatesFor(a.id, "Coffee")).toContainEqual(
      expect.objectContaining({ id: b.id }),
    );

    const d = await services.posts.create({
      format: "note",
      title: "Coffee D",
      body: noteBody("日本語"),
      language: "ja",
      status: "published",
    });
    await services.posts.linkTranslation(a.id, d.id);
    // Now both sides have groups, which `linkTranslation` refuses to merge.
    expect(await candidatesFor(a.id, "Coffee")).not.toContainEqual(
      expect.objectContaining({ id: b.id }),
    );
  });

  it("hides drafts, replies, and the post itself", async () => {
    const zh = await services.posts.create({
      format: "note",
      title: "咖啡 coffee",
      body: noteBody("中文"),
      language: "zh-Hans",
      status: "published",
    });
    await services.posts.create({
      format: "note",
      title: "Coffee draft",
      body: noteBody("English"),
      language: "en",
      status: "draft",
    });
    const root = await services.posts.create({
      format: "note",
      title: "Coffee root",
      body: noteBody("English"),
      language: "en",
      status: "published",
    });
    await services.posts.create({
      format: "note",
      title: "Coffee reply",
      body: noteBody("English"),
      replyToId: root.id,
      status: "published",
    });

    // The root is fair game; its reply and the draft are not, and neither is
    // the post doing the asking.
    expect(await candidatesFor(zh.id, "coffee")).toEqual([
      expect.objectContaining({ id: root.id }),
    ]);
  });

  it("matches body text, not just titles", async () => {
    const zh = await services.posts.create({
      format: "note",
      body: noteBody("中文"),
      language: "zh-Hans",
      status: "published",
    });
    const en = await services.posts.create({
      format: "note",
      body: noteBody("An untitled note about espresso."),
      language: "en",
      status: "published",
    });

    expect(await candidatesFor(zh.id, "espresso")).toEqual([
      expect.objectContaining({ id: en.id }),
    ]);
  });
});

describe("display labels", () => {
  let app: ReturnType<typeof createApiTestApp>["app"];
  let services: ReturnType<typeof createApiTestApp>["services"];

  beforeEach(async () => {
    const testApp = createApiTestApp();
    app = testApp.app;
    services = testApp.services;
    await enableMultilingual(services);
  });

  it("names an untitled note by its opening line, not its slug", async () => {
    // A slug is a URL. Showing "yidcy" where a name belongs tells the author
    // nothing about which post they are looking at.
    const zh = await services.posts.create({
      format: "note",
      body: noteBody("中文"),
      language: "zh-Hans",
      status: "published",
    });
    const en = await services.posts.create({
      format: "note",
      body: noteBody("An untitled note about espresso and its many moods."),
      language: "en",
      status: "published",
    });

    const candidates = (await (
      await app.request(
        `/api/posts/${zh.id}/translations/candidates?q=espresso`,
      )
    ).json()) as { candidates: Array<{ id: string; label: string }> };

    expect(candidates.candidates[0]).toMatchObject({
      id: en.id,
      label: "An untitled note about espresso and its many moods.",
    });
  });

  it("prefers a real title when there is one", async () => {
    const zh = await services.posts.create({
      format: "note",
      body: noteBody("中文"),
      language: "zh-Hans",
      status: "published",
    });
    const en = await services.posts.create({
      format: "note",
      title: "Coffee notes",
      body: noteBody("Something about espresso."),
      language: "en",
      status: "published",
    });
    await services.posts.linkTranslation(zh.id, en.id);

    const body = (await (
      await app.request(`/api/posts/${zh.id}/translations`)
    ).json()) as { translations: Array<{ label: string }> };

    expect(body.translations[0]?.label).toBe("Coffee notes");
  });

  it("gives the single-post API the same derived name", async () => {
    // The composer's "Writing the X version of …" banner reads this.
    const post = await services.posts.create({
      format: "note",
      body: noteBody("An untitled note the composer has to name somehow."),
      status: "published",
    });

    const body = (await (
      await app.request(`/api/posts/${post.id}`)
    ).json()) as { displayTitle: string };

    expect(body.displayTitle).toBe(
      "An untitled note the composer has to name somehow.",
    );
  });
});

describe("changing the language while editing", () => {
  it("applies to the whole thread", async () => {
    const testApp = createApiTestApp();
    await enableMultilingual(testApp.services);
    const root = await testApp.services.posts.create({
      format: "note",
      bodyMarkdown: "Root",
      language: "zh-Hans",
      status: "published",
    });
    const reply = await testApp.services.posts.create({
      format: "note",
      bodyMarkdown: "Reply",
      replyToId: root.id,
      status: "published",
    });

    const res = await testApp.app.request(`/api/posts/${root.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "en" }),
    });

    expect(res.status).toBe(200);
    expect((await testApp.services.posts.getById(root.id))?.language).toBe(
      "en",
    );
    expect((await testApp.services.posts.getById(reply.id))?.language).toBe(
      "en",
    );
  });

  it("refuses when the translation group already holds that language", async () => {
    const testApp = createApiTestApp();
    await enableMultilingual(testApp.services);
    const zh = await testApp.services.posts.create({
      format: "note",
      bodyMarkdown: "中文",
      language: "zh-Hans",
      status: "published",
    });
    const en = await testApp.services.posts.create({
      format: "note",
      bodyMarkdown: "English",
      language: "en",
      status: "published",
    });
    await testApp.services.posts.linkTranslation(zh.id, en.id);

    const res = await testApp.app.request(`/api/posts/${zh.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "en", title: "New title" }),
    });

    expect(res.status).toBe(409);
    // The refusal lands before anything else is written.
    const after = await testApp.services.posts.getById(zh.id);
    expect(after?.language).toBe("zh-Hans");
    expect(after?.title).toBeNull();
  });
});

describe("language on create", () => {
  it("reads the language out of the text when nobody chose one", async () => {
    const testApp = createApiTestApp();
    await enableMultilingual(testApp.services);

    const res = await testApp.app.request("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        format: "note",
        bodyMarkdown: "This one is written in English.",
        status: "published",
      }),
    });

    expect(res.status).toBe(201);
    expect((await res.json()) as { language: string }).toMatchObject({
      language: "en",
    });
  });

  it("keeps an explicit choice over what the text looks like", async () => {
    const testApp = createApiTestApp();
    await enableMultilingual(testApp.services);

    const res = await testApp.app.request("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        format: "note",
        bodyMarkdown: "这段是中文。",
        language: "en",
        status: "published",
      }),
    });

    expect((await res.json()) as { language: string }).toMatchObject({
      language: "en",
    });
  });

  it("stamps nothing on a site that publishes one language", async () => {
    const testApp = createApiTestApp();

    const res = await testApp.app.request("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        format: "note",
        bodyMarkdown: "This one is written in English.",
        status: "published",
      }),
    });

    expect((await res.json()) as { language: string | null }).toMatchObject({
      language: null,
    });
  });
});
