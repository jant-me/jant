import { describe, expect, it } from "vitest";
import { defaultFeedRenderer } from "../feed.js";
import type {
  FeedData,
  FeedPostView,
  MediaView,
  PostView,
} from "../../types.js";

function makeMediaView(overrides: Partial<MediaView> = {}): MediaView {
  return {
    id: "med_1",
    url: "https://example.com/media/file.bin",
    thumbnailUrl: "https://example.com/media/file.bin",
    mimeType: "application/octet-stream",
    ...overrides,
  };
}

function makePostView(overrides: Partial<FeedPostView> = {}): FeedPostView {
  return {
    id: "post-1",
    permalink: "/post-1",
    slug: "post-1",
    format: "note",
    status: "published",
    visibility: "public",
    pinned: false,
    featured: false,
    publishedAt: "2026-03-19T00:00:00.000Z",
    publishedAtFormatted: "Mar 19, 2026",
    publishedAtTime: "00:00",
    publishedAtRelative: "now",
    updatedAt: "2026-03-19T00:00:00.000Z",
    media: [],
    collections: [],
    isLastInThread: true,
    ...overrides,
  };
}

function makeFeedData(post: FeedPostView): FeedData {
  return {
    siteName: "Jant",
    siteDescription: "Thoughts, links, and quotes — one post at a time",
    siteUrl: "https://example.com",
    siteLanguage: "en",
    selfUrl: "https://example.com/feed",
    posts: [post],
  };
}

describe("feed renderers", () => {
  // Stamping the render time on <updated> tells every reader the feed changed
  // on every poll, which is untrue and useless for change detection.
  it("dates the feed by its newest entry, not the render time", () => {
    const xml = defaultFeedRenderer({
      ...makeFeedData(makePostView()),
      posts: [
        makePostView({
          id: "a",
          permalink: "/a",
          feedUpdatedAt: "2026-01-02T00:00:00.000Z",
        }),
        makePostView({
          id: "b",
          permalink: "/b",
          feedUpdatedAt: "2026-05-09T00:00:00.000Z",
        }),
        makePostView({
          id: "c",
          permalink: "/c",
          feedUpdatedAt: "2026-03-04T00:00:00.000Z",
        }),
      ],
    });

    const feedUpdated = /<id>[^<]*<\/id>\s*<updated>([^<]+)<\/updated>/.exec(
      xml,
    )?.[1];
    expect(feedUpdated).toBe("2026-05-09T00:00:00.000Z");
  });

  // A directory listing this blog has no other machine-readable place to read
  // an avatar from, so the feed is where it has to be.
  it("emits the site avatar as an absolute atom:icon", () => {
    const xml = defaultFeedRenderer({
      ...makeFeedData(makePostView()),
      siteIconUrl: "/media/avatar.png",
    });

    expect(xml).toContain("<icon>https://example.com/media/avatar.png</icon>");
  });

  it("leaves atom:icon out when the site has no avatar", () => {
    const xml = defaultFeedRenderer(makeFeedData(makePostView()));

    expect(xml).not.toContain("<icon>");
  });

  it("falls back to the render time for an empty feed", () => {
    const xml = defaultFeedRenderer({
      ...makeFeedData(makePostView()),
      posts: [],
    });

    const feedUpdated = /<id>[^<]*<\/id>\s*<updated>([^<]+)<\/updated>/.exec(
      xml,
    )?.[1];
    expect(feedUpdated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("keeps Atom entry titles empty for untitled posts and strips script tags from content", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          title: undefined,
          summary: "哈哈哈😍",
          excerpt: "哈哈哈😍",
          bodyHtml:
            '<p>哈哈哈😍</p><script type="application/json" data-jant-meta>{"kind":"text"}</script>',
        }),
      ),
    );

    expect(xml).toContain("<title></title>");
    expect(xml).toContain('<summary type="text">哈哈哈😍</summary>');
    expect(xml).toContain("<![CDATA[<p>哈哈哈😍</p>]]>");
    expect(xml).not.toContain("data-jant-meta");
    expect(xml).not.toContain('{"kind":"text"}');
  });

  it("strips embed iframes and replaces them with the fallback link", () => {
    const post = makePostView({
      bodyHtml:
        "<p>Watch this:</p>" +
        '<figure class="tiptap-embed-figure" data-provider="youtube" data-orientation="landscape">' +
        '<div class="tiptap-embed-frame">' +
        '<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" sandbox="allow-scripts" loading="lazy"></iframe>' +
        "</div>" +
        '<a class="tiptap-embed-fallback" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ" target="_blank" rel="noopener noreferrer">YouTube →</a>' +
        "</figure>",
    });
    const xml = defaultFeedRenderer(makeFeedData(post));
    expect(xml).not.toContain("<iframe");
    expect(xml).not.toContain("tiptap-embed-figure");
    expect(xml).toContain("tiptap-embed-fallback");
    expect(xml).toContain("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("strips raw HTML blocks entirely", () => {
    const post = makePostView({
      bodyHtml:
        "<p>Sign up:</p>" +
        '<div class="tiptap-html-block"><script src="https://letterbird.co/embed/v1.js"></script></div>',
    });
    const xml = defaultFeedRenderer(makeFeedData(post));
    expect(xml).not.toContain("tiptap-html-block");
    expect(xml).not.toContain("letterbird.co/embed/v1.js");
    expect(xml).not.toContain("<script");
    expect(xml).toContain("<p>Sign up:</p>");
  });

  it("removes stray iframes even outside embed figures", () => {
    const post = makePostView({
      bodyHtml: '<p>Hi</p><iframe src="https://example.com"></iframe>',
    });
    const xml = defaultFeedRenderer(makeFeedData(post));
    expect(xml).not.toContain("<iframe");
  });

  it("resolves relative links and media URLs inside post HTML", () => {
    const post = makePostView({
      bodyHtml:
        '<p><a href="/related">Related</a> <a href="#footnote">Footnote</a></p>' +
        '<img src="/media/inline.jpg" alt="Inline">' +
        '<video poster="/media/poster.jpg"><source src="/media/clip.mp4"></video>' +
        '<span data-src="/leave-this-relative"></span>',
    });
    const xml = defaultFeedRenderer(makeFeedData(post));

    expect(xml).toContain('href="https://example.com/related"');
    expect(xml).toContain('href="#footnote"');
    expect(xml).toContain('src="https://example.com/media/inline.jpg"');
    expect(xml).toContain('poster="https://example.com/media/poster.jpg"');
    expect(xml).toContain('src="https://example.com/media/clip.mp4"');
    expect(xml).toContain('data-src="/leave-this-relative"');
  });

  it("does not expose quote attribution as feed title", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          format: "quote",
          title: "Marcus Aurelius",
          url: "https://example.com/meditations",
          quoteText: "What stands in the way becomes the way.",
          summary: undefined,
          excerpt: undefined,
        }),
      ),
    );

    expect(xml).toContain("<title></title>");
    expect(xml).toContain(
      '<summary type="text">What stands in the way becomes the way.</summary>',
    );
    expect(xml).toContain("Marcus Aurelius");
    expect(xml).toContain("https://example.com/meditations");
  });

  // The site keeps quote line breaks with `white-space: pre-line`; feed
  // readers strip CSS, so the breaks have to be markup or the quote collapses
  // into one run-on paragraph.
  it("keeps quote line breaks as markup", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          format: "quote",
          quoteText: "Roses are red\nViolets are blue\n\nSo it goes.",
          summary: undefined,
          excerpt: undefined,
        }),
      ),
    );

    expect(xml).toContain(
      "<blockquote><p>Roses are red<br/>Violets are blue</p>\n<p>So it goes.</p></blockquote>",
    );
  });

  it("normalizes CRLF line breaks in quotes", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          format: "quote",
          quoteText: "First line\r\nSecond line",
          summary: undefined,
          excerpt: undefined,
        }),
      ),
    );

    const content =
      /<content type="html"><!\[CDATA\[([\s\S]*?)\]\]><\/content>/.exec(
        xml,
      )?.[1];
    expect(content).toBe(
      "<blockquote><p>First line<br/>Second line</p></blockquote>",
    );
  });

  it("escapes quote text before inserting line-break markup", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          format: "quote",
          quoteText: "<script>alert(1)</script>\nsecond & last",
          summary: undefined,
          excerpt: undefined,
        }),
      ),
    );

    expect(xml).toContain(
      "<blockquote><p>&lt;script&gt;alert(1)&lt;/script&gt;<br/>second &amp; last</p></blockquote>",
    );
  });

  it("falls back to the summary when a quote holds only whitespace", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          format: "quote",
          quoteText: "  \n  ",
          summary: "A quote worth keeping",
          excerpt: undefined,
        }),
      ),
    );

    expect(xml).not.toContain("<blockquote");
    expect(xml).toContain("<p>A quote worth keeping</p>");
  });

  it("link posts point <link> to original URL with ★ permalink back to blog", () => {
    const post = makePostView({
      format: "link",
      title: "Interesting Article",
      url: "https://external.com/article",
      bodyHtml: "<p>My thoughts on this.</p>",
    });
    const data = makeFeedData(post);

    const xml = defaultFeedRenderer(data);
    // Atom <link rel="alternate"> should point to external URL
    expect(xml).toContain(
      '<link href="https://external.com/article" rel="alternate"/>',
    );
    // Atom should have <link rel="related"> back to blog
    expect(xml).toContain(
      '<link href="https://example.com/post-1" rel="related"/>',
    );
    // Atom <id> should remain the blog permalink
    expect(xml).toContain("<id>https://example.com/post-1</id>");
    // Should contain ★ permalink
    expect(xml).toContain(
      '<a href="https://example.com/post-1" title="Permalink">&nbsp;★&nbsp;</a>',
    );
  });

  it("renders YouTube Link previews as a linked thumbnail with a provider-aware action", () => {
    const post = makePostView({
      format: "link",
      title: "A useful video",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      bodyHtml: "<p>My notes on the video.</p>",
      previewKind: "video",
      previewProvider: "youtube",
      previewImageUrl: "/media/previews/youtube.jpg",
    });
    const xml = defaultFeedRenderer(makeFeedData(post));

    expect(xml).toContain(
      '<figure><a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"><img src="https://example.com/media/previews/youtube.jpg" alt="A useful video"/></a><figcaption><a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">▶ Watch on YouTube</a></figcaption></figure>',
    );
    expect(xml.indexOf("<figure>")).toBeLessThan(
      xml.indexOf("My notes on the video."),
    );
    expect(xml).not.toContain("<iframe");
    expect(xml).not.toContain('rel="enclosure"');
  });

  it("renders non-video Link previews without a video action", () => {
    const post = makePostView({
      format: "link",
      title: "Illustrated article",
      url: "https://external.com/illustrated",
      previewKind: "image",
      previewImageUrl: "https://example.com/previews/article.jpg",
    });
    const xml = defaultFeedRenderer(makeFeedData(post));

    expect(xml).toContain(
      '<figure><a href="https://external.com/illustrated"><img src="https://example.com/previews/article.jpg" alt="Illustrated article"/></a></figure>',
    );
    expect(xml).not.toContain("Watch video");
    expect(xml).not.toContain("Watch on");
  });

  it("keeps the text fallback when a Link post has no preview image", () => {
    const post = makePostView({
      format: "link",
      title: "Text-only link",
      url: "https://external.com/text-only",
    });
    const xml = defaultFeedRenderer(makeFeedData(post));

    expect(xml).toContain("<![CDATA[<p>Text-only link</p>");
    expect(xml).not.toContain("<figure>");
  });

  it("note posts still link to blog permalink without ★", () => {
    const post = makePostView({
      format: "note",
      title: "A thought",
      bodyHtml: "<p>Just thinking.</p>",
    });
    const xml = defaultFeedRenderer(makeFeedData(post));
    expect(xml).toContain(
      '<link href="https://example.com/post-1" rel="alternate"/>',
    );
    expect(xml).not.toContain("★");
  });

  it("uses feed-specific timestamps when provided", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          feedPublishedAt: "2026-03-20T08:30:00.000Z",
          feedUpdatedAt: "2026-03-20T09:45:00.000Z",
        }),
      ),
    );

    expect(xml).toContain("<published>2026-03-20T08:30:00.000Z</published>");
    expect(xml).toContain("<updated>2026-03-20T09:45:00.000Z</updated>");
  });

  it("renders thread replies with hr separator and time element", () => {
    const reply = makePostView({
      id: "reply-1",
      permalink: "/reply-1",
      slug: "reply-1",
      publishedAt: "2026-03-19T12:00:00.000Z",
      publishedAtFormatted: "Mar 19, 2026",
      publishedAtTime: "12:00",
      publishedAtRelative: "now",
      updatedAt: "2026-03-19T12:00:00.000Z",
      bodyHtml: "<p>This is a reply</p>",
    });

    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          title: "Thread Root",
          bodyHtml: "<p>Root content</p>",
          threadReplies: [reply],
        }),
      ),
    );

    expect(xml).toContain("<p>Root content</p>");
    expect(xml).toContain("<hr/>");
    expect(xml).toContain('<time datetime="2026-03-19T12:00:00.000Z">');
    expect(xml).toContain("<p>This is a reply</p>");
  });

  it("renders note reply titles inline because replies do not get their own Atom entry title", () => {
    const reply = makePostView({
      id: "reply-1",
      permalink: "/reply-1",
      slug: "reply-1",
      title: "Reply Article",
      bodyHtml: "<p>Reply article body.</p>",
    });

    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          title: "Thread Root",
          bodyHtml: "<p>Root content</p>",
          threadReplies: [reply],
        }),
      ),
    );

    expect(xml).toContain(
      '<h2><a href="https://example.com/reply-1">Reply Article</a></h2>',
    );
    expect(xml).toContain("<p>Reply article body.</p>");
  });

  it("renders link reply domain and title inline before commentary", () => {
    const reply = makePostView({
      id: "reply-1",
      permalink: "/reply-1",
      slug: "reply-1",
      format: "link",
      title: "test rss title",
      url: "https://www.jant.me/test-rss-title",
      bodyHtml: "<p>rss body</p>",
    });

    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          summary: "test rss",
          bodyHtml: "<p>test rss</p>",
          threadReplies: [reply],
        }),
      ),
    );

    expect(xml).toContain(
      '<p><a href="https://www.jant.me/test-rss-title">jant.me</a></p>',
    );
    expect(xml).toContain(
      '<h2><a href="https://www.jant.me/test-rss-title">test rss title</a></h2>',
    );
    expect(xml).toContain("<p>rss body</p>");
    expect(xml).toContain(
      '<a href="https://example.com/reply-1" title="Permalink">&nbsp;★&nbsp;</a>',
    );
  });

  it("renders a YouTube Link preview inside a thread reply", () => {
    const reply = makePostView({
      id: "reply-video",
      permalink: "/reply-video",
      slug: "reply-video",
      format: "link",
      title: "Thread video",
      url: "https://youtu.be/dQw4w9WgXcQ",
      previewKind: "video",
      previewProvider: "youtube",
      previewImageUrl: "/media/previews/thread-video.jpg",
    });

    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          title: "Thread Root",
          bodyHtml: "<p>Root content</p>",
          threadReplies: [reply],
        }),
      ),
    );

    const replyTitle =
      '<h2><a href="https://youtu.be/dQw4w9WgXcQ">Thread video</a></h2>';
    const preview =
      '<figure><a href="https://youtu.be/dQw4w9WgXcQ"><img src="https://example.com/media/previews/thread-video.jpg" alt="Thread video"/></a><figcaption><a href="https://youtu.be/dQw4w9WgXcQ">▶ Watch on YouTube</a></figcaption></figure>';
    expect(xml).toContain(replyTitle);
    expect(xml).toContain(preview);
    expect(xml.indexOf(replyTitle)).toBeLessThan(xml.indexOf(preview));
  });

  it("includes thread reply media as Atom enclosures on the combined entry", () => {
    const reply = makePostView({
      id: "reply-1",
      permalink: "/reply-1",
      slug: "reply-1",
      bodyHtml: "<p>Reply with audio.</p>",
      media: [
        makeMediaView({
          id: "reply-audio",
          url: "https://example.com/media/reply.mp3",
          thumbnailUrl: "https://example.com/media/reply.mp3",
          mimeType: "audio/mpeg",
          originalName: "reply.mp3",
          size: 1024,
        }),
      ],
    });

    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          title: "Thread Root",
          bodyHtml: "<p>Root content</p>",
          threadReplies: [reply],
        }),
      ),
    );

    expect(xml).toContain(
      '<link rel="enclosure" type="audio/mpeg" href="https://example.com/media/reply.mp3" length="1024" title="reply.mp3"',
    );
    expect(xml).toContain(
      '<a href="https://example.com/media/reply.mp3">📎 [audio/mpeg] reply.mp3</a> (1 KB)',
    );
  });

  it("embeds image attachments as figures with alt text caption", () => {
    const post = makePostView({
      bodyHtml: "<p>Look at this.</p>",
      media: [
        makeMediaView({
          id: "med_img",
          url: "https://example.com/media/photo.jpg",
          thumbnailUrl: "https://example.com/media/photo-thumb.jpg",
          mimeType: "image/jpeg",
          altText: "A red bicycle",
          width: 1200,
          height: 800,
          size: 245_000,
        }),
      ],
    });
    const xml = defaultFeedRenderer(makeFeedData(post));

    expect(xml).toContain('<a href="https://example.com/media/photo.jpg">');
    expect(xml).toContain(
      '<img src="https://example.com/media/photo.jpg" alt="A red bicycle" width="1200" height="800"/>',
    );
    expect(xml).toContain("<figcaption>A red bicycle</figcaption>");
    expect(xml).toContain(
      '<link rel="enclosure" type="image/jpeg" href="https://example.com/media/photo.jpg" length="245000"',
    );
  });

  it("renders video attachments as poster + caption (never inline <video>)", () => {
    const post = makePostView({
      media: [
        makeMediaView({
          id: "med_vid",
          url: "https://example.com/media/clip.mp4",
          thumbnailUrl: "https://example.com/media/clip-thumb.jpg",
          posterUrl: "https://example.com/media/clip-poster.jpg",
          mimeType: "video/mp4",
          durationSeconds: 42,
          size: 1_200_000,
          width: 1920,
          height: 1080,
        }),
      ],
    });
    const xml = defaultFeedRenderer(makeFeedData(post));

    expect(xml).not.toContain("<video");
    expect(xml).toContain(
      '<img src="https://example.com/media/clip-poster.jpg"',
    );
    // The action label is a link (not just the thumbnail); metadata sits
    // outside the link in parens, matching the audio/text attachment style.
    expect(xml).toContain(
      '<figcaption><a href="https://example.com/media/clip.mp4">▶ Watch video</a> (0:42 · 1.1 MB)</figcaption>',
    );
    expect(xml).toContain(
      '<link rel="enclosure" type="video/mp4" href="https://example.com/media/clip.mp4" length="1200000"',
    );
  });

  it("resolves relative attachment, poster, and enclosure URLs", () => {
    const post = makePostView({
      media: [
        makeMediaView({
          id: "med_local_vid",
          url: "/media/local-clip.mp4",
          thumbnailUrl: "/media/local-clip-thumb.jpg",
          posterUrl: "/media/local-clip-poster.jpg",
          mimeType: "video/mp4",
        }),
      ],
    });
    const xml = defaultFeedRenderer(makeFeedData(post));

    expect(xml).toContain(
      '<a href="https://example.com/media/local-clip.mp4"><img src="https://example.com/media/local-clip-poster.jpg"',
    );
    expect(xml).toContain(
      '<a href="https://example.com/media/local-clip.mp4">▶ Watch video</a>',
    );
    expect(xml).toContain(
      '<link rel="enclosure" type="video/mp4" href="https://example.com/media/local-clip.mp4"',
    );
  });

  it("renders audio attachments as a labeled link with duration and size", () => {
    const post = makePostView({
      media: [
        makeMediaView({
          id: "med_audio",
          url: "https://example.com/media/song.mp3",
          thumbnailUrl: "https://example.com/media/song.mp3",
          mimeType: "audio/mpeg",
          originalName: "song.mp3",
          durationSeconds: 215,
          size: 5_242_880,
        }),
      ],
    });
    const xml = defaultFeedRenderer(makeFeedData(post));

    expect(xml).toContain(
      '<a href="https://example.com/media/song.mp3">📎 [audio/mpeg] song.mp3</a> (3:35 · 5.0 MB)',
    );
    expect(xml).toContain(
      '<link rel="enclosure" type="audio/mpeg" href="https://example.com/media/song.mp3" length="5242880" title="song.mp3"',
    );
  });

  it("renders text attachments as a single-line link to the rendered preview with char count", () => {
    const post = makePostView({
      permalink: "/post-1",
      media: [
        makeMediaView({
          id: "med_txt",
          url: "https://example.com/media/notes.md",
          thumbnailUrl: "https://example.com/media/notes.md",
          mimeType: "text/markdown",
          originalName: "notes.md",
          summary: "Outline of the talk: intro, three acts, takeaways.",
          chars: 4200,
        }),
      ],
    });
    const xml = defaultFeedRenderer(makeFeedData(post));

    expect(xml).toContain(
      '<a href="https://example.com/post-1/text/med_txt">📎 [text/markdown] notes.md</a> (4200 chars): Outline of the talk: intro, three acts, takeaways.',
    );
    // No multi-line aside / "Read full text" CTA — single line only.
    expect(xml).not.toContain("Read full text");
    expect(xml).not.toContain("<aside>");
  });

  it("omits the summary suffix when a text attachment has none", () => {
    const post = makePostView({
      permalink: "/post-1",
      media: [
        makeMediaView({
          id: "med_txt_no_summary",
          url: "https://example.com/media/silent.md",
          thumbnailUrl: "https://example.com/media/silent.md",
          mimeType: "text/markdown",
          originalName: "silent.md",
          chars: 50,
        }),
      ],
    });
    const xml = defaultFeedRenderer(makeFeedData(post));

    expect(xml).toContain(
      '<a href="https://example.com/post-1/text/med_txt_no_summary">📎 [text/markdown] silent.md</a> (50 chars)</p>',
    );
    expect(xml).not.toContain("(50 chars):");
  });

  it("falls back to file size when a text attachment has no char count", () => {
    const post = makePostView({
      permalink: "/post-1",
      media: [
        makeMediaView({
          id: "med_txt2",
          url: "https://example.com/media/raw.txt",
          thumbnailUrl: "https://example.com/media/raw.txt",
          mimeType: "text/plain",
          originalName: "raw.txt",
          size: 2048,
        }),
      ],
    });
    const xml = defaultFeedRenderer(makeFeedData(post));

    expect(xml).toContain(
      '<a href="https://example.com/post-1/text/med_txt2">📎 [text/plain] raw.txt</a> (2 KB)',
    );
  });

  it("renders document attachments as a link with size suffix", () => {
    const post = makePostView({
      media: [
        makeMediaView({
          id: "med_pdf",
          url: "https://example.com/media/spec.pdf",
          thumbnailUrl: "https://example.com/media/spec.pdf",
          mimeType: "application/pdf",
          originalName: "spec.pdf",
          size: 524_288,
        }),
      ],
    });
    const xml = defaultFeedRenderer(makeFeedData(post));

    expect(xml).toContain(
      '<a href="https://example.com/media/spec.pdf">📎 [application/pdf] spec.pdf</a> (512 KB)',
    );
    expect(xml).toContain(
      '<link rel="enclosure" type="application/pdf" href="https://example.com/media/spec.pdf" length="524288" title="spec.pdf"',
    );
  });

  it("strips MIME-type parameters from the attachment label", () => {
    const post = makePostView({
      permalink: "/post-1",
      media: [
        makeMediaView({
          id: "med_html",
          url: "https://example.com/media/note.html",
          thumbnailUrl: "https://example.com/media/note.html",
          mimeType: "text/html; charset=utf-8",
          originalName: "note.html",
          chars: 120,
        }),
      ],
    });
    const xml = defaultFeedRenderer(makeFeedData(post));

    // The visible link tag should be cleaned to the bare type
    expect(xml).toContain("[text/html] note.html");
    // The enclosure link still preserves the full canonical MIME type
    expect(xml).toContain('type="text/html; charset=utf-8"');
  });

  it("escapes XML special characters in media URLs and names", () => {
    const post = makePostView({
      media: [
        makeMediaView({
          id: "med_x",
          url: "https://example.com/media/file.pdf?a=1&b=2",
          thumbnailUrl: "https://example.com/media/file.pdf?a=1&b=2",
          mimeType: "application/pdf",
          originalName: "Q&A <draft>.pdf",
          size: 1024,
        }),
      ],
    });
    const xml = defaultFeedRenderer(makeFeedData(post));

    expect(xml).not.toContain("?a=1&b=2");
    expect(xml).toContain("?a=1&amp;b=2");
    expect(xml).toContain("Q&amp;A &lt;draft&gt;.pdf");
  });

  it("emits no enclosure links and no media block when post has no media", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          bodyHtml: "<p>Plain text only.</p>",
        }),
      ),
    );

    expect(xml).not.toContain('rel="enclosure"');
    expect(xml).not.toContain("<figure>");
  });
});

describe("feed Discover declaration", () => {
  it("declares the mode and the feed to poll", () => {
    const xml = defaultFeedRenderer({
      ...makeFeedData(makePostView()),
      discover: "latest",
      discoverFeedUrl: "https://example.com/latest/feed",
    });

    expect(xml).toContain('xmlns:jant="https://jant.me/ns"');
    expect(xml).toContain(
      '<jant:discover feed="https://example.com/latest/feed">latest</jant:discover>',
    );
  });

  it("points featured sites at the featured feed", () => {
    const xml = defaultFeedRenderer({
      ...makeFeedData(makePostView()),
      discover: "featured",
      discoverFeedUrl: "https://example.com/featured/feed",
    });

    expect(xml).toContain(
      '<jant:discover feed="https://example.com/featured/feed">featured</jant:discover>',
    );
  });

  // `none` is an answer, so it is still declared — a crawler that already
  // knows the site has to be told to stop, and silence would read as "this
  // site predates Discover" instead.
  it("declares none without a feed attribute", () => {
    const xml = defaultFeedRenderer({
      ...makeFeedData(makePostView()),
      discover: "none",
      discoverFeedUrl: null,
    });

    expect(xml).toContain("<jant:discover>none</jant:discover>");
    expect(xml).not.toContain("feed=");
  });

  it("declares nothing, and no namespace, when the field is absent", () => {
    const xml = defaultFeedRenderer(makeFeedData(makePostView()));

    expect(xml).not.toContain("jant:discover");
    expect(xml).not.toContain("xmlns:jant");
  });

  it("keeps a sitePathPrefix in the polled feed URL", () => {
    const xml = defaultFeedRenderer({
      ...makeFeedData(makePostView()),
      siteUrl: "https://example.com/blog",
      discover: "latest",
      discoverFeedUrl: "https://example.com/blog/latest/feed",
    });

    expect(xml).toContain('feed="https://example.com/blog/latest/feed"');
  });
});

describe("feed language alternates", () => {
  it("links each language's copy of the same feed", () => {
    const xml = defaultFeedRenderer({
      ...makeFeedData(makePostView()),
      languageAlternates: [
        { hreflang: "zh-Hans", href: "https://example.com/latest/feed" },
        { hreflang: "en", href: "https://example.com/en/latest/feed" },
      ],
    });

    expect(xml).toContain(
      '<link href="https://example.com/latest/feed" rel="alternate" type="application/atom+xml" hreflang="zh-Hans"/>',
    );
    expect(xml).toContain(
      '<link href="https://example.com/en/latest/feed" rel="alternate" type="application/atom+xml" hreflang="en"/>',
    );
  });

  it("emits nothing extra for a single-language site", () => {
    const xml = defaultFeedRenderer({
      ...makeFeedData(makePostView()),
      languageAlternates: [],
    });

    expect(xml).not.toContain("hreflang");
  });
});

describe("feed author", () => {
  // The feed title is composed, so it is not a name. A consumer that wants to
  // label the blog needs the site's own name somewhere, and this is the place
  // Atom already has for it.
  it("names the blog, separately from the composed feed title", () => {
    const xml = defaultFeedRenderer({
      ...makeFeedData(makePostView()),
      siteName: "A blog",
      title: "A blog - Latest posts",
    });

    expect(xml).toContain("<author><name>A blog</name></author>");
    expect(xml).toContain("<title>A blog - Latest posts</title>");
  });

  it("escapes a name that contains markup characters", () => {
    const xml = defaultFeedRenderer({
      ...makeFeedData(makePostView()),
      siteName: "Q&A <notes>",
    });

    expect(xml).toContain(
      "<author><name>Q&amp;A &lt;notes&gt;</name></author>",
    );
  });

  it("emits nothing when the site has no name", () => {
    const xml = defaultFeedRenderer({
      ...makeFeedData(makePostView()),
      siteName: "",
    });

    expect(xml).not.toContain("<author>");
  });
});
