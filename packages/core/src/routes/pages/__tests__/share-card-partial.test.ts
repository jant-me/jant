import { describe, expect, it } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { DEFAULT_TEST_SITE_ID } from "../../../__tests__/helpers/db.js";
import { partialPageRoutes } from "../partials.js";

function createPartialTestApp(options: { authenticated?: boolean } = {}) {
  const testApp = createTestApp(options);
  testApp.app.route("/", partialPageRoutes);
  return testApp;
}

async function attachImages(
  services: ReturnType<typeof createTestApp>["services"],
  postId: string,
  count: number,
) {
  for (let index = 0; index < count; index++) {
    await services.media.create({
      postId,
      filename: `photo-${index}.jpg`,
      originalName: `photo-${index}.jpg`,
      mimeType: "image/jpeg",
      size: 1024,
      storageKey: `media/${DEFAULT_TEST_SITE_ID}/photo-${index}.jpg`,
      width: 800,
      height: 600,
    });
  }
}

type Services = ReturnType<typeof createTestApp>["services"];
type NewPost = Parameters<Services["posts"]["create"]>[0];

/** A Thread of published posts, each replying to the one before. */
async function createThread(services: Services, posts: Partial<NewPost>[]) {
  const created = [];
  for (const post of posts) {
    const previous = created.at(-1);
    created.push(
      await services.posts.create({
        format: "note",
        status: "published",
        ...post,
        ...(previous ? { replyToId: previous.id } : {}),
      } as NewPost),
    );
  }
  return created;
}

/** The markup of the card's Thread, split at each post on its rail. */
function threadItems(html: string): string[] {
  return html
    .split('class="share-card-thread-item')
    .slice(1)
    .map((item) => item.split("share-card-foot")[0] ?? item);
}

function paragraphs(count: number): string {
  return Array.from(
    { length: count },
    (_, index) =>
      `Paragraph ${index + 1}. The owner rode this street for ten years before he stopped.`,
  ).join("\n\n");
}

describe("/_/share-card/:postId", () => {
  it("is the author's: a signed-out request finds nothing", async () => {
    const { app, services } = createPartialTestApp();
    const post = await services.posts.create({
      format: "note",
      bodyMarkdown: "Hello",
      status: "published",
    });

    const res = await app.request(`/_/share-card/${post.id}`);

    expect(res.status).toBe(404);
  });

  it.each([
    ["a draft", { status: "draft" as const }],
    [
      "a Private post",
      { status: "published" as const, visibility: "private" as const },
    ],
  ])("refuses %s, whose address a reader cannot open", async (_, state) => {
    const { app, services } = createPartialTestApp({ authenticated: true });
    const post = await services.posts.create({
      format: "note",
      bodyMarkdown: "Hello",
      ...state,
    });

    const res = await app.request(`/_/share-card/${post.id}`);

    expect(res.status).toBe(404);
  });

  it("shares a post Hidden from Latest, which still has an address", async () => {
    const { app, services } = createPartialTestApp({ authenticated: true });
    const post = await services.posts.create({
      format: "note",
      bodyMarkdown: "Hello",
      status: "published",
      visibility: "latest_hidden",
    });

    const res = await app.request(`/_/share-card/${post.id}`);

    expect(res.status).toBe(200);
  });

  it("draws its icons inline: the capture copies the card without the page's sprite", async () => {
    const { app, services } = createPartialTestApp({ authenticated: true });
    const post = await services.posts.create({
      format: "link",
      title: "The Slow Web",
      url: "https://jackcheng.com/the-slow-web/",
      status: "published",
    });

    const html = await (await app.request(`/_/share-card/${post.id}`)).text();

    expect(html).toContain("share-card-link-domain");
    expect(html).not.toContain("<use href=");
  });

  it("leads a titled note with its title and the timeline's summary", async () => {
    const { app, services } = createPartialTestApp({ authenticated: true });
    const post = await services.posts.create({
      format: "note",
      title: "A Bicycle Café",
      bodyMarkdown: paragraphs(8),
      status: "published",
    });

    const html = await (await app.request(`/_/share-card/${post.id}`)).text();

    expect(html).toContain('data-layout="article"');
    expect(html).toContain('class="share-card-title">A Bicycle Café<');
    // Titled posts take the article summary: five blocks, then a mark that
    // there is more.
    expect(html).toContain("Paragraph 5.");
    expect(html).not.toContain("Paragraph 6.");
    expect(html).toContain("share-card-more");
  });

  it("stops where the author put the read-more break", async () => {
    const { app, services } = createPartialTestApp({ authenticated: true });
    const post = await services.posts.create({
      format: "note",
      title: "A Bicycle Café",
      bodyMarkdown: "Before the break.\n\n<!--more-->\n\nAfter the break.",
      status: "published",
    });

    const html = await (await app.request(`/_/share-card/${post.id}`)).text();

    expect(html).toContain("Before the break.");
    expect(html).not.toContain("After the break.");
  });

  // Ten blocks, and a hidden tail long enough (over 200 characters) that the
  // note summary does not fold it back in.
  it("gives an untitled note the note summary's room", async () => {
    const { app, services } = createPartialTestApp({ authenticated: true });
    const post = await services.posts.create({
      format: "note",
      bodyMarkdown: paragraphs(14),
      status: "published",
    });

    const html = await (await app.request(`/_/share-card/${post.id}`)).text();

    expect(html).toContain('data-layout="note"');
    expect(html).not.toContain("share-card-title");
    expect(html).toContain("Paragraph 10.");
    expect(html).not.toContain("Paragraph 11.");
  });

  it("ends a post that fits without a mark that there is more", async () => {
    const { app, services } = createPartialTestApp({ authenticated: true });
    const post = await services.posts.create({
      format: "note",
      bodyMarkdown: "Hello",
      status: "published",
    });

    const html = await (await app.request(`/_/share-card/${post.id}`)).text();

    expect(html).not.toContain("share-card-more");
  });

  it("sets a short quote large, with who said it and where", async () => {
    const { app, services } = createPartialTestApp({ authenticated: true });
    const post = await services.posts.create({
      format: "quote",
      quoteText: "Focus is about saying no.",
      title: "Some Author",
      url: "https://www.example.com/focus",
      bodyMarkdown: "Still true.",
      status: "published",
    });

    const html = await (await app.request(`/_/share-card/${post.id}`)).text();

    expect(html).toContain('data-layout="quote"');
    expect(html).toContain('data-size="short">Focus is about saying no.<');
    expect(html).toContain("Some Author · example.com");
    expect(html).toContain("Still true.");
  });

  it("sets a long quote smaller", async () => {
    const { app, services } = createPartialTestApp({ authenticated: true });
    const post = await services.posts.create({
      format: "quote",
      quoteText: "A".repeat(120),
      status: "published",
    });

    const html = await (await app.request(`/_/share-card/${post.id}`)).text();

    expect(html).toContain('data-size="long"');
  });

  it("shows the page a link post points at", async () => {
    const { app, services } = createPartialTestApp({ authenticated: true });
    const post = await services.posts.create({
      format: "link",
      title: "The Slow Web",
      url: "https://jackcheng.com/the-slow-web/",
      bodyMarkdown: "Still worth reading.",
      status: "published",
    });

    const html = await (await app.request(`/_/share-card/${post.id}`)).text();

    expect(html).toContain('data-layout="link"');
    expect(html).toContain('class="share-card-link-title">The Slow Web<');
    expect(html).toContain("<span>jackcheng.com</span>");
    expect(html).toContain("Still worth reading.");
  });

  it("puts four images across the top, from the site's own origin, and counts the rest", async () => {
    const { app, services } = createPartialTestApp({ authenticated: true });
    const post = await services.posts.create({
      format: "note",
      bodyMarkdown: "Five shops.",
      status: "published",
    });
    await attachImages(services, post.id, 5);

    const html = await (await app.request(`/_/share-card/${post.id}`)).text();

    // Same-origin paths: the capture can only paint images it may read.
    const sources = [
      ...html.matchAll(/<div class="share-card-image"><img src="([^"]+)"/g),
    ].map((match) => match[1]);
    expect(sources).toHaveLength(4);
    for (const src of sources) {
      expect(src).toMatch(new RegExp(`^/media/${DEFAULT_TEST_SITE_ID}/`));
    }
    expect(html).toContain('data-count="4"');
    expect(html).toContain('class="share-card-more-images">+1<');
  });

  it("gives a lone image its stored size, so the card keeps its shape", async () => {
    const { app, services } = createPartialTestApp({ authenticated: true });
    const post = await services.posts.create({
      format: "note",
      bodyMarkdown: "One screenshot.",
      status: "published",
    });
    await services.media.create({
      postId: post.id,
      filename: "chat.png",
      originalName: "chat.png",
      mimeType: "image/png",
      size: 2048,
      storageKey: `media/${DEFAULT_TEST_SITE_ID}/chat.png`,
      width: 1620,
      height: 680,
    });

    const html = await (await app.request(`/_/share-card/${post.id}`)).text();

    expect(html).toContain('data-count="1"');
    expect(html).toContain(
      `<img src="/media/${DEFAULT_TEST_SITE_ID}/chat.png" alt="" width="1620" height="680"`,
    );
  });

  it("shows a video by its poster, marked as a video", async () => {
    const { app, services } = createPartialTestApp({ authenticated: true });
    const post = await services.posts.create({
      format: "note",
      bodyMarkdown: "A short clip.",
      status: "published",
    });
    await services.media.create({
      postId: post.id,
      filename: "clip.mp4",
      originalName: "clip.mp4",
      mimeType: "video/mp4",
      size: 4096,
      storageKey: `media/${DEFAULT_TEST_SITE_ID}/clip.mp4`,
      posterKey: `media/${DEFAULT_TEST_SITE_ID}/clip-poster.webp`,
      width: 1280,
      height: 720,
    });

    const html = await (await app.request(`/_/share-card/${post.id}`)).text();

    expect(html).toContain(
      `<img src="/media/${DEFAULT_TEST_SITE_ID}/clip-poster.webp"`,
    );
    expect(html).toContain("share-card-play");
  });

  it("lists the files a picture cannot show, by format, name and size", async () => {
    // A post whose point is a PDF or a recording should not lose it on the
    // card.
    const { app, services } = createPartialTestApp({ authenticated: true });
    const post = await services.posts.create({
      format: "note",
      bodyMarkdown: "Reading list.",
      status: "published",
    });
    const files = [
      ["Slow Web Manifesto.pdf", "application/pdf", { size: 2_200_000 }],
      ["The Art of Slowness.epub", "application/epub+zip", { size: 512 }],
      ["Interview.m4a", "audio/mp4", { durationSeconds: 187 }],
      [
        "Notes.md",
        "text/markdown",
        { summary: "Water at 92 degrees.", chars: 1234 },
      ],
      ["Extra.pdf", "application/pdf", {}],
    ] as const;
    for (const [name, mimeType, extra] of files) {
      await services.media.create({
        postId: post.id,
        filename: name,
        originalName: name,
        mimeType,
        size: 1024,
        storageKey: `media/${DEFAULT_TEST_SITE_ID}/${name}`,
        ...extra,
      });
    }

    const html = await (await app.request(`/_/share-card/${post.id}`)).text();

    expect(html).toContain('class="share-card-file-format">PDF<');
    expect(html).toContain("Slow Web Manifesto");
    expect(html).toContain("2.1 MB");
    expect(html).toContain('class="share-card-file-format">EPUB<');
    expect(html).toContain('class="share-card-file-format">M4A<');
    expect(html).toContain("3:07");
    // Three listed, the rest counted.
    expect(html).not.toContain("Water at 92 degrees.");
    expect(html).toContain('class="share-card-file-more">+2<');
  });

  it("titles an attached text by its opening words", async () => {
    const { app, services } = createPartialTestApp({ authenticated: true });
    const post = await services.posts.create({
      format: "note",
      bodyMarkdown: "Brewing notes.",
      status: "published",
    });
    await services.media.create({
      postId: post.id,
      filename: "notes.md",
      originalName: "notes.md",
      mimeType: "text/markdown",
      size: 2048,
      storageKey: `media/${DEFAULT_TEST_SITE_ID}/notes.md`,
      summary: "Water at 92 degrees.\nThen wait.",
      chars: 1234,
    });

    const html = await (await app.request(`/_/share-card/${post.id}`)).text();

    expect(html).toContain('data-kind="text"');
    expect(html).toContain(
      'class="share-card-file-title">Water at 92 degrees.<',
    );
    expect(html).toContain("1.2k chars");
  });

  it("gives a post on its own no Thread", async () => {
    const { app, services } = createPartialTestApp({ authenticated: true });
    const post = await services.posts.create({
      format: "note",
      bodyMarkdown: "Hello",
      status: "published",
    });

    const html = await (await app.request(`/_/share-card/${post.id}`)).text();

    expect(html).not.toContain("data-thread");
    expect(html).not.toContain("share-card-thread");
  });

  describe("a post in a Thread", () => {
    it("sits under the Thread's first post, the posts between folded away, above a line of the post after", async () => {
      const { app, services } = createPartialTestApp({ authenticated: true });
      const posts = await createThread(
        services,
        Array.from({ length: 7 }, (_, index) => ({
          bodyMarkdown: `Post ${index + 1} of the walk.`,
        })),
      );

      const html = await (
        await app.request(`/_/share-card/${posts[5]?.id}`)
      ).text();
      const items = threadItems(html);

      expect(html).toContain("data-thread");
      expect(items).toHaveLength(4);
      expect(items[0]).toContain("is-root");
      expect(items[0]).toContain("Post 1 of the walk.");
      expect(items[1]).toContain("share-card-thread-gap");
      expect(items[1]).toContain('data-hidden="4"');
      expect(items[2]).toContain("share-card-thread-current");
      expect(items[2]).toContain("Post 6 of the walk.");
      expect(items[2]).toMatch(/class="share-card-thread-position">6 \/ 7</);
      expect(items[3]).toContain("is-next");
      expect(items[3]).toContain("Post 7 of the walk.");
      for (const hidden of [2, 3, 4, 5]) {
        expect(html).not.toContain(`Post ${hidden} of the walk.`);
      }
    });

    it("shares the Thread's first post with the post after it", async () => {
      const { app, services } = createPartialTestApp({ authenticated: true });
      const posts = await createThread(services, [
        { bodyMarkdown: "First." },
        { bodyMarkdown: "Second." },
        { bodyMarkdown: "Third." },
      ]);

      const html = await (
        await app.request(`/_/share-card/${posts[0]?.id}`)
      ).text();
      const items = threadItems(html);

      expect(items).toHaveLength(2);
      expect(items[0]).toContain("share-card-thread-current");
      expect(items[0]).toMatch(/>1 \/ 3</);
      expect(items[1]).toContain("Second.");
      expect(html).not.toContain("Third.");
    });

    it("folds nothing when the Thread's first post is just before", async () => {
      const { app, services } = createPartialTestApp({ authenticated: true });
      const posts = await createThread(services, [
        { bodyMarkdown: "First." },
        { bodyMarkdown: "Second." },
        { bodyMarkdown: "Third." },
      ]);

      const html = await (
        await app.request(`/_/share-card/${posts[1]?.id}`)
      ).text();
      const items = threadItems(html);

      expect(items).toHaveLength(3);
      expect(items[0]).toContain("First.");
      expect(items[1]).toContain("share-card-thread-current");
      expect(items[2]).toContain("Third.");
      expect(html).not.toContain("share-card-thread-gap");
    });

    it("ends on the shared post when it is the Thread's last", async () => {
      const { app, services } = createPartialTestApp({ authenticated: true });
      const posts = await createThread(services, [
        { bodyMarkdown: "First." },
        { bodyMarkdown: "Second." },
        { bodyMarkdown: "Third." },
      ]);

      const html = await (
        await app.request(`/_/share-card/${posts[2]?.id}`)
      ).text();
      const items = threadItems(html);

      expect(items).toHaveLength(3);
      expect(items[0]).toContain("First.");
      expect(items[1]).toContain('data-hidden="1"');
      expect(items[2]).toContain("share-card-thread-current");
      expect(items[2]).toMatch(/>3 \/ 3</);
      expect(html).not.toContain("Second.");
      expect(html).not.toContain("is-next");
    });

    // The card shows what a reader opening its QR code finds.
    it("leaves out a reply that is not published, and does not count it", async () => {
      const { app, services } = createPartialTestApp({ authenticated: true });
      const [, reply] = await createThread(services, [
        { bodyMarkdown: "First." },
        { bodyMarkdown: "Second." },
      ]);
      await services.posts.create({
        format: "note",
        bodyMarkdown: "Still a draft.",
        status: "draft",
        replyToId: reply?.id,
      });

      const html = await (
        await app.request(`/_/share-card/${reply?.id}`)
      ).text();

      expect(html).toContain("First.");
      expect(html).toMatch(/>2 \/ 2</);
      expect(html).not.toContain("Still a draft.");
      expect(html).not.toContain("is-next");
    });

    it("shows the posts around it by their title and words, a quote by its words and source", async () => {
      const { app, services } = createPartialTestApp({ authenticated: true });
      const titledThread = await createThread(services, [
        {
          title: "Kyoto in Three Days",
          bodyMarkdown: "No plans, one river.",
        },
        { bodyMarkdown: "The shared post." },
        {
          format: "link",
          title: "The Kamo River Spacing Rule",
          url: "https://example.com/kamogawa",
        },
      ]);
      const quoteThread = await createThread(services, [
        {
          format: "quote",
          quoteText: "Travel is for coming home to your own room.",
          title: "An old book",
          url: "https://www.example.com/room",
        },
        { bodyMarkdown: "The shared post." },
      ]);

      const [titled, , link] = threadItems(
        await (
          await app.request(`/_/share-card/${titledThread[1]?.id}`)
        ).text(),
      );
      const [quote] = threadItems(
        await (await app.request(`/_/share-card/${quoteThread[1]?.id}`)).text(),
      );

      // The first post gets room to say what the Thread is about: its
      // title, then the start of its words.
      expect(titled).toContain(
        'class="share-card-context-title">Kyoto in Three Days<',
      );
      expect(titled).toContain(
        'class="share-card-context-body">No plans, one river.<',
      );
      expect(quote).toContain('data-format="quote"');
      expect(quote).toContain(
        'class="share-card-context-body">Travel is for coming home to your own room.<',
      );
      expect(quote).not.toContain("share-card-context-title");
      // Who said it, as the quote card itself shows it.
      expect(quote).toContain("has-source");
      expect(quote).toContain(
        'class="share-card-context-source">An old book · example.com<',
      );
      expect(link).toContain(
        'class="share-card-context-title">The Kamo River Spacing Rule<',
      );
      // A link with no words of its own is not shown by its address.
      expect(link).not.toContain("share-card-context-body");
    });

    // The timeline shows a photo post by its photos; a thumbnail the size
    // of a line of text does not say what it is.
    it("shows a post with no words by its images, counting past three", async () => {
      const { app, services } = createPartialTestApp({ authenticated: true });
      const posts = await createThread(services, [
        { bodyMarkdown: "" },
        { bodyMarkdown: "The shared post." },
      ]);
      const photos = posts[0];
      if (!photos) throw new Error("expected the Thread's first post");
      await attachImages(services, photos.id, 5);

      const html = await (
        await app.request(`/_/share-card/${posts[1]?.id}`)
      ).text();
      const [before] = threadItems(html);

      expect(before).toContain(
        'class="share-card-context-images" data-count="3"',
      );
      expect(before).toMatch(/src="\/media\/[^"]+photo-0\.jpg"/);
      expect(before).toMatch(/src="\/media\/[^"]+photo-2\.jpg"/);
      expect(before).not.toContain("photo-3.jpg");
      expect(before).toContain('class="share-card-more-images">+2<');
      expect(before).not.toContain("share-card-context-text");
    });

    it("shows a post with neither words nor images by its first file", async () => {
      const { app, services } = createPartialTestApp({ authenticated: true });
      const posts = await createThread(services, [
        { bodyMarkdown: "" },
        { bodyMarkdown: "The shared post." },
      ]);
      const report = posts[0];
      if (!report) throw new Error("expected the Thread's first post");
      await services.media.create({
        postId: report.id,
        filename: "Annual report.pdf",
        originalName: "Annual report.pdf",
        mimeType: "application/pdf",
        size: 4096,
        storageKey: `media/${DEFAULT_TEST_SITE_ID}/annual-report.pdf`,
      });

      const html = await (
        await app.request(`/_/share-card/${posts[1]?.id}`)
      ).text();
      const [before] = threadItems(html);

      expect(before).toContain(
        'class="share-card-context-body">PDF · Annual report<',
      );
    });

    it("joins a line's paragraphs, without a space after Chinese punctuation", async () => {
      const { app, services } = createPartialTestApp({ authenticated: true });
      const english = await createThread(services, [
        { bodyMarkdown: "One river.\n\nNo plans." },
        { bodyMarkdown: "The shared post." },
      ]);
      const chinese = await createThread(services, [
        { bodyMarkdown: "下午下雨。\n\n躲进一家旧书店。" },
        { bodyMarkdown: "The shared post." },
      ]);

      const englishCard = await (
        await app.request(`/_/share-card/${english[1]?.id}`)
      ).text();
      const chineseCard = await (
        await app.request(`/_/share-card/${chinese[1]?.id}`)
      ).text();

      expect(englishCard).toContain("One river. No plans.");
      expect(chineseCard).toContain("下午下雨。躲进一家旧书店。");
    });

    // Across the top of the paper, they would come before the post above.
    it("puts the shared post's images after its text, in its own column", async () => {
      const { app, services } = createPartialTestApp({ authenticated: true });
      const posts = await createThread(services, [
        { bodyMarkdown: "First." },
        { bodyMarkdown: "With photos." },
      ]);
      const reply = posts[1];
      if (!reply) throw new Error("expected the reply");
      await attachImages(services, reply.id, 2);

      const html = await (
        await app.request(`/_/share-card/${reply.id}`)
      ).text();
      const current = threadItems(html)[1] ?? "";

      expect(current).toContain("share-card-thread-current");
      expect(current.indexOf("With photos.")).toBeLessThan(
        current.indexOf("share-card-images"),
      );
      expect(html.indexOf("share-card-images")).toBeGreaterThan(
        html.indexOf("share-card-thread"),
      );
    });
  });

  it("points its QR code and address at the post", async () => {
    const { app, services } = createPartialTestApp({ authenticated: true });
    const post = await services.posts.create({
      format: "note",
      bodyMarkdown: "Hello",
      slug: "hello-card",
      status: "published",
    });

    const html = await (await app.request(`/_/share-card/${post.id}`)).text();

    expect(html).toMatch(/class="share-card-url">[^<]*\/hello-card</);
    expect(html).toMatch(/class="share-card-qr"><svg[^>]*viewBox=/);
    expect(html).toContain('data-file-name="hello-card"');
  });
});
