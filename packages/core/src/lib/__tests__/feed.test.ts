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
    // The summary carries the entry's text whether or not it was truncated.
    expect(xml).toContain(
      '<summary type="html"><![CDATA[<p>哈哈哈😍</p>]]></summary>',
    );
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
      '<blockquote cite="https://example.com/meditations">' +
        "<p>What stands in the way becomes the way.</p></blockquote>",
    );
    expect(xml).toContain("Marcus Aurelius");
    expect(xml).toContain("https://example.com/meditations");
    // The quoted text is the entry's text, so it rides in the summary too.
    expect(xml).toContain(
      '<summary type="html"><![CDATA[<figure><blockquote cite=',
    );
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
      "<figure><blockquote><p>First line<br/>Second line</p></blockquote></figure>",
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
    // The reference comes before the commentary. Scoped to the content: the
    // summary carries the commentary without the preview, so a whole-document
    // search would find the note there first.
    const content =
      /<content type="html"><!\[CDATA\[([\s\S]*?)\]\]><\/content>/.exec(
        xml,
      )?.[1] ?? "";
    expect(content.indexOf("<figure>")).toBeLessThan(
      content.indexOf("My notes on the video."),
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

  it("renders thread replies with hr separator and a dated permalink", () => {
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
    expect(xml).toContain(
      '<time class="dt-published" datetime="2026-03-19T12:00:00.000Z">',
    );
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
    // The content already shows the picture inside a link to the original, so
    // an enclosure would only ask an attachment shelf to list it again.
    expect(xml).not.toContain('rel="enclosure"');
  });

  it("inlines a video player with the poster as an attribute", () => {
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

    expect(xml).toContain(
      '<video controls preload="none" ' +
        'poster="https://example.com/media/clip-poster.jpg" ' +
        'width="1920" height="1080">' +
        '<source src="https://example.com/media/clip.mp4" type="video/mp4"/>' +
        "</video>",
    );
    // The poster is an attribute now, not an <img> the reader might show
    // beside the player.
    expect(xml).not.toContain("<img");
    // The action label stays a link outside the <video>, so it survives a
    // sanitizer that drops the player; metadata sits outside the link in
    // parens, matching the audio/text attachment style.
    expect(xml).toContain(
      '<figcaption><a href="https://example.com/media/clip.mp4">▶ Watch video</a> (0:42 · 1.1 MB)</figcaption>',
    );
    expect(xml).toContain(
      '<link rel="enclosure" type="video/mp4" href="https://example.com/media/clip.mp4" length="1200000"',
    );
  });

  // The media pipeline only transforms image MIME types, so a video's
  // `thumbnailUrl` is the file itself. Feeding that to `<img src>` produced a
  // broken image pointing at an MP4.
  it("omits the poster for a video with no poster frame", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          media: [
            makeMediaView({
              id: "med_clip",
              url: "https://example.com/media/clip.mp4",
              thumbnailUrl: "https://example.com/media/clip.mp4",
              mimeType: "video/mp4",
              size: 28_000_000,
              width: 960,
              height: 448,
              originalName: "clip.mp4",
            }),
          ],
        }),
      ),
    );

    // No <img>, and crucially no poster pointing at the video file itself.
    expect(xml).not.toContain("<img");
    expect(xml).not.toContain("poster=");
    expect(xml).toContain(
      '<video controls preload="none" width="960" height="448">' +
        '<source src="https://example.com/media/clip.mp4" type="video/mp4"/>' +
        "</video>",
    );
    // The play cue, the link, and the size all survive without the still.
    expect(xml).toContain(
      '<figcaption><a href="https://example.com/media/clip.mp4">▶ Watch video</a> (26.7 MB)</figcaption>',
    );
    // Media RSS must not invent a thumbnail out of the video either.
    expect(xml).not.toContain("<media:thumbnail");
    // The enclosure is what lets a reader offer its own player.
    expect(xml).toContain(
      '<link rel="enclosure" type="video/mp4" href="https://example.com/media/clip.mp4"',
    );
  });

  // `<video>` has no `alt` attribute, so a described clip would lose its
  // description entirely if the caption did not carry it.
  it("moves a video's alt text into its caption", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          media: [
            makeMediaView({
              id: "med_described",
              url: "https://example.com/media/described.mp4",
              thumbnailUrl: "https://example.com/media/described.mp4",
              mimeType: "video/mp4",
              altText: "A heron takes off",
            }),
          ],
        }),
      ),
    );

    expect(xml).toContain(
      '<figcaption><a href="https://example.com/media/described.mp4">' +
        "▶ Watch video</a>: A heron takes off</figcaption>",
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
      'poster="https://example.com/media/local-clip-poster.jpg"',
    );
    expect(xml).toContain(
      '<source src="https://example.com/media/local-clip.mp4" type="video/mp4"/>',
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

  it("declares nothing when the field is absent", () => {
    const xml = defaultFeedRenderer(makeFeedData(makePostView()));

    expect(xml).not.toContain("jant:discover");
  });

  // The namespace is declared for whatever is emitted in it, and an entry's
  // format is emitted whatever the site answered about Discover. So the only
  // feed that leaves the declaration out is one with nothing in it at all.
  it("declares no namespace when nothing in it is emitted", () => {
    const xml = defaultFeedRenderer({
      ...makeFeedData(makePostView()),
      posts: [],
    });

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

describe("feed entry format", () => {
  // A quote and an untitled note are identical from the feed alone — both have
  // an empty <title> and a body — so this element is the only way to tell them
  // apart without fetching the post's page.
  it.each([
    ["note", "note"],
    ["link", "link"],
    ["quote", "quote"],
  ] as const)("declares a %s post as %s", (format, declared) => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          format,
          url: format === "link" ? "https://external.com/article" : undefined,
          quoteText: format === "quote" ? "A quote worth keeping" : undefined,
        }),
      ),
    );

    expect(xml).toContain(`<jant:format>${declared}</jant:format>`);
    expect(xml).toContain('xmlns:jant="https://jant.me/ns"');
  });

  // Core's own three formats. A titled note stays a note; drawing it as an
  // article is a decision the consumer makes from this and <title>.
  it("calls a titled note a note", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(makePostView({ format: "note", title: "A titled note" })),
    );

    expect(xml).toContain("<jant:format>note</jant:format>");
  });

  // Threads arrive as one entry keyed to the root, so the format is the root's.
  it("declares a thread by its root post", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          format: "quote",
          quoteText: "A quote worth keeping",
          threadReplies: [
            makePostView({
              id: "post-2",
              permalink: "/post-2",
              format: "note",
            }),
          ],
        }),
      ),
    );

    expect(xml).toContain("<jant:format>quote</jant:format>");
    expect(xml).not.toContain("<jant:format>note</jant:format>");
  });
});

/**
 * `<summary>` is the entry's text as the timeline renders it; `<content>` is
 * the post's full page. Media lives in the content and in the Media RSS
 * elements, never here.
 */
describe("feed entry summary", () => {
  function makeBody(paragraphs: string[]): string {
    return JSON.stringify({
      type: "doc",
      content: paragraphs.map((text) => ({
        type: "paragraph",
        content: [{ type: "text", text }],
      })),
    });
  }

  const longBody = makeBody([
    "Alpha ".repeat(40).trim(),
    "Bravo ".repeat(40).trim(),
    "Charlie ".repeat(40).trim(),
    "Delta ".repeat(40).trim(),
  ]);

  function getSummary(xml: string): string | undefined {
    return /<summary type="html"><!\[CDATA\[([\s\S]*?)\]\]><\/summary>/.exec(
      xml,
    )?.[1];
  }

  function getContent(xml: string): string | undefined {
    return /<content type="html"><!\[CDATA\[([\s\S]*?)\]\]><\/content>/.exec(
      xml,
    )?.[1];
  }

  it("sends a truncated summary alongside the full content", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          title: "A long read",
          body: longBody,
          bodyHtml: "<p>Alpha</p><p>Bravo</p><p>Charlie</p><p>Delta</p>",
        }),
      ),
    );

    const summary = getSummary(xml);
    expect(summary).toBeDefined();
    expect(summary).toContain("Alpha");
    expect(summary).not.toContain("Delta");
    expect(getContent(xml)).toContain("Delta");
  });

  // The field means one thing on its own — "this entry's text" — rather than
  // one defined by what the content happens to hold, so a short note repeats
  // itself here. That costs the words and buys `summary ?? ""` as the whole of
  // a consumer's rule.
  it("sends the summary even when it repeats the content", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          body: makeBody(["Just the one line."]),
          bodyHtml: "<p>Just the one line.</p>",
        }),
      ),
    );

    expect(getSummary(xml)).toBe("<p>Just the one line.</p>");
  });

  // A feed cannot express the timeline's justified row, so a consumer computes
  // it from the dimensions on `<media:content>`. Repeating the markup here
  // would only give it something to strip back out.
  it("leaves media out of the summary and keeps the rating", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          body: makeBody(["嘿嘿嘿"]),
          bodyHtml: "<p>嘿嘿嘿</p>",
          rating: 4,
          media: [
            makeMediaView({
              url: "https://example.com/media/one.webp",
              thumbnailUrl: "https://example.com/media/one.webp",
              mimeType: "image/webp",
            }),
          ],
        }),
      ),
    );

    expect(getSummary(xml)).toBe("<p>嘿嘿嘿</p>\n<p>★★★★☆ 4/5</p>");
    expect(getContent(xml)).toContain("one.webp");
  });

  it("leaves a link post's preview and ★ permalink out of the summary", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          format: "link",
          title: "A useful video",
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          body: makeBody(["My notes."]),
          bodyHtml: "<p>My notes.</p>",
          previewImageUrl: "/media/previews/youtube.jpg",
        }),
      ),
    );

    expect(getSummary(xml)).toBe("<p>My notes.</p>");
    const content = getContent(xml);
    expect(content).toContain("youtube.jpg");
    expect(content).toContain("★");
  });

  // Missing says exactly one thing: this post has no text.
  it("omits the summary for a post with no text at all", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          media: [
            makeMediaView({
              url: "https://example.com/media/1031.pdf",
              thumbnailUrl: "https://example.com/media/1031.pdf",
              mimeType: "application/pdf",
              size: 915872,
              originalName: "1031.pdf",
            }),
          ],
        }),
      ),
    );

    expect(xml).not.toContain("<summary");
    expect(getContent(xml)).toContain("1031.pdf");
  });

  // An entry's content may not be empty, so a post with no body, no media and
  // no title falls back to a bare `Post #<id>`. A summary may be empty, and
  // must be — that placeholder is not text the author wrote.
  it("omits the summary rather than falling back to a placeholder", () => {
    const xml = defaultFeedRenderer(makeFeedData(makePostView()));

    expect(xml).not.toContain("<summary");
    expect(getContent(xml)).toContain("Post #post-1");
  });

  // The site draws this separator with `.feed-quote-commentary::before`, which
  // feed readers strip along with the rest of the CSS.
  it("separates a quote from its commentary with a rule", () => {
    const content = getContent(
      defaultFeedRenderer(
        makeFeedData(
          makePostView({
            format: "quote",
            title: "Marcus Aurelius",
            url: "https://example.com/meditations",
            quoteText: "What stands in the way becomes the way.",
            bodyHtml: "<p>Still true.</p>",
          }),
        ),
      ),
    );

    expect(content).toContain(
      "<figcaption>— " +
        '<a href="https://example.com/meditations">Marcus Aurelius</a>' +
        "</figcaption></figure>\n<hr/>\n<p>Still true.</p>",
    );
  });

  // The same fold the site's timeline applies: the first two replies as
  // context, the last three with the newest as the hero, the run between them
  // collapsed into a gap link.
  it("folds a long thread the way the timeline does", () => {
    const reply = (n: number) =>
      makePostView({
        id: `reply-${n}`,
        permalink: `/reply-${n}`,
        body: makeBody([`Reply ${n} body.`]),
        bodyHtml: `<p>Reply ${n} body.</p>`,
      });
    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          title: "Thread root",
          body: longBody,
          bodyHtml: "<p>Alpha</p><p>Delta</p>",
          threadReplies: [1, 2, 3, 4, 5, 6, 7].map(reply),
        }),
      ),
    );

    const summary = getSummary(xml);
    // Leading context.
    expect(summary).toContain("Reply 1 body.");
    expect(summary).toContain("Reply 2 body.");
    // The gap stands for replies 3 and 4, and opens the first of them.
    expect(summary).toContain(
      '<p><small><a href="https://example.com/reply-3">2 more posts</a></small></p>',
    );
    expect(summary).not.toContain("Reply 3 body.");
    expect(summary).not.toContain("Reply 4 body.");
    // Trailing context, then the hero.
    expect(summary).toContain("Reply 5 body.");
    expect(summary).toContain("Reply 6 body.");
    expect(summary).toContain("Reply 7 body.");

    // The content still carries every reply.
    const content = getContent(xml);
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      expect(content).toContain(`Reply ${n} body.`);
    }
  });

  // Up to six posts fit the fold, so a shorter thread hides nothing at all.
  it("hides nothing in a thread the fold fits whole", () => {
    const reply = (n: number) =>
      makePostView({
        id: `reply-${n}`,
        permalink: `/reply-${n}`,
        body: makeBody([`Reply ${n} body.`]),
        bodyHtml: `<p>Reply ${n} body.</p>`,
      });
    const summary = getSummary(
      defaultFeedRenderer(
        makeFeedData(
          makePostView({
            body: makeBody(["Root."]),
            bodyHtml: "<p>Root.</p>",
            threadReplies: [1, 2, 3, 4, 5].map(reply),
          }),
        ),
      ),
    );

    for (const n of [1, 2, 3, 4, 5]) {
      expect(summary).toContain(`Reply ${n} body.`);
    }
    expect(summary).not.toContain("more post");
  });

  it("writes the gap count in the singular for a single hidden post", () => {
    const reply = (n: number) =>
      makePostView({
        id: `reply-${n}`,
        permalink: `/reply-${n}`,
        body: makeBody([`Reply ${n}.`]),
        bodyHtml: `<p>Reply ${n}.</p>`,
      });
    // Six replies: two lead, three trail, one falls in the gap.
    const summary = getSummary(
      defaultFeedRenderer(
        makeFeedData(
          makePostView({
            body: makeBody(["Root."]),
            bodyHtml: "<p>Root.</p>",
            threadReplies: [1, 2, 3, 4, 5, 6].map(reply),
          }),
        ),
      ),
    );

    expect(summary).toContain(">1 more post</a>");
  });

  it("keeps a thread's root and newest reply without a gap when none is hidden", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          body: makeBody(["Root."]),
          bodyHtml: "<p>Root.</p>",
          threadReplies: [
            makePostView({
              id: "reply-1",
              permalink: "/reply-1",
              body: makeBody(["Only reply."]),
              bodyHtml: "<p>Only reply.</p>",
            }),
          ],
        }),
      ),
    );

    const summary = getSummary(xml);
    expect(summary).toContain("<p>Root.</p>");
    expect(summary).toContain("<p>Only reply.</p>");
    expect(summary).not.toContain("more post");
  });

  // The site renders a quote's commentary whole — `QuoteCard` passes `bodyHtml`
  // through and nothing clamps `.feed-quote-commentary` — so a summary that cut
  // it would not be the timeline's rendering.
  it("keeps a quote's commentary whole, however long it runs", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          format: "quote",
          title: "Marcus Aurelius",
          url: "https://example.com/meditations",
          quoteText: "What stands in the way becomes the way.",
          body: longBody,
          bodyHtml: "<p>Alpha</p><p>Bravo</p><p>Charlie</p><p>Delta</p>",
        }),
      ),
    );

    const summary = getSummary(xml);
    expect(summary).toContain("<p>Delta</p>");
    expect(summary).toBe(getContent(xml));
    expect(xml).not.toContain("<jant:truncated/>");
  });
});

/**
 * What an entry says about itself beyond its text: whether the timeline cuts
 * it, and which collections the author filed it under.
 */
describe("feed entry metadata", () => {
  function makeBody(paragraphs: string[]): string {
    return JSON.stringify({
      type: "doc",
      content: paragraphs.map((text) => ({
        type: "paragraph",
        content: [{ type: "text", text }],
      })),
    });
  }

  // `<summary>` is sent whenever there is text, so only this tells a consumer
  // whether the site would offer a "Read more".
  it("marks an entry whose summary text was cut", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          title: "A long read",
          body: makeBody([
            "Alpha ".repeat(90).trim(),
            "Omega ".repeat(90).trim(),
          ]),
          bodyHtml: "<p>Alpha</p><p>Omega</p>",
        }),
      ),
    );

    expect(xml).toContain("<jant:truncated/>");
  });

  it("leaves the mark off an entry the timeline shows in full", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          body: makeBody(["Short enough."]),
          bodyHtml: "<p>Short enough.</p>",
        }),
      ),
    );

    expect(xml).not.toContain("<jant:truncated/>");
  });

  it("marks an entry whose newest reply was cut", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          body: makeBody(["Root."]),
          bodyHtml: "<p>Root.</p>",
          threadReplies: [
            makePostView({
              id: "reply-1",
              permalink: "/reply-1",
              title: "A long reply",
              body: makeBody([
                "Alpha ".repeat(90).trim(),
                "Omega ".repeat(90).trim(),
              ]),
              bodyHtml: "<p>Alpha</p><p>Omega</p>",
            }),
          ],
        }),
      ),
    );

    expect(xml).toContain("<jant:truncated/>");
  });

  // A collection is a label the author chose, which is what `<category>` is
  // for — unlike the format, which no author typed.
  it("files an entry under its collections", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          collections: [
            { slug: "reading", title: "Reading", url: "/reading" },
            { slug: "notes", title: "Field Notes", url: "/notes" },
          ],
        }),
      ),
    );

    // A single collection lives in the root URL namespace and a site path
    // prefix makes it unguessable from the term, so the URL rides along.
    expect(xml).toContain(
      '<category term="reading" label="Reading" jant:page="https://example.com/reading"/>',
    );
    expect(xml).toContain(
      '<category term="notes" label="Field Notes" jant:page="https://example.com/notes"/>',
    );
  });

  it("emits no categories for a post in no collection", () => {
    expect(defaultFeedRenderer(makeFeedData(makePostView()))).not.toContain(
      "<category",
    );
  });
});

describe("feed attachment metadata", () => {
  it("describes an image with Media RSS instead of an enclosure", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          media: [
            makeMediaView({
              url: "https://example.com/media/photo.jpg",
              thumbnailUrl: "https://example.com/media/photo-thumb.jpg",
              mimeType: "image/jpeg",
              size: 245000,
              width: 1600,
              height: 1200,
              altText: "A quiet street",
              originalName: "photo.jpg",
            }),
          ],
        }),
      ),
    );

    expect(xml).toContain('xmlns:media="http://search.yahoo.com/mrss/"');
    expect(xml).toContain(
      '<media:content url="https://example.com/media/photo.jpg" ' +
        'type="image/jpeg" medium="image" fileSize="245000" ' +
        'width="1600" height="1200">',
    );
    expect(xml).toContain(
      '<media:description type="plain">A quiet street</media:description>',
    );
    expect(xml).toContain(
      '<media:thumbnail url="https://example.com/media/photo-thumb.jpg"/>',
    );
    // No enclosure for a picture the content already renders in full.
    expect(xml).not.toContain('rel="enclosure"');
  });

  // An enclosure is for a file the content cannot inline. Audio is exactly
  // that; a picture the reader is already looking at is not.
  it("encloses audio but not the image beside it, and describes both", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          media: [
            makeMediaView({
              id: "med_img",
              url: "https://example.com/media/photo.jpg",
              thumbnailUrl: "https://example.com/media/photo.jpg",
              mimeType: "image/jpeg",
              size: 245000,
            }),
            makeMediaView({
              id: "med_audio",
              url: "https://example.com/media/song.mp3",
              thumbnailUrl: "https://example.com/media/song.mp3",
              mimeType: "audio/mpeg",
              size: 5242880,
              durationSeconds: 201,
              originalName: "song.mp3",
            }),
          ],
        }),
      ),
    );

    expect(xml).toContain(
      '<link rel="enclosure" type="audio/mpeg" href="https://example.com/media/song.mp3"',
    );
    expect(xml).not.toContain('<link rel="enclosure" type="image/jpeg"');

    // Media RSS still describes both — it is a metadata layer, not a shelf.
    expect(xml).toContain('medium="image"');
    expect(xml).toContain('medium="audio"');
    expect(xml).toContain('duration="201"');
  });

  it("carries duration for timed media and resolves relative URLs", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          media: [
            makeMediaView({
              url: "/media/clip.mp4",
              thumbnailUrl: "/media/clip-poster.jpg",
              mimeType: "video/mp4",
              durationSeconds: 42.4,
              width: 1920,
              height: 1080,
            }),
          ],
        }),
      ),
    );

    expect(xml).toContain(
      '<media:content url="https://example.com/media/clip.mp4" ' +
        'type="video/mp4" medium="video" width="1920" height="1080" ' +
        'duration="42">',
    );
  });

  it("calls non-visual attachments documents", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          media: [
            makeMediaView({
              url: "https://example.com/media/spec.pdf",
              thumbnailUrl: "https://example.com/media/spec.pdf",
              mimeType: "application/pdf",
              originalName: "spec.pdf",
            }),
          ],
        }),
      ),
    );

    expect(xml).toContain('medium="document"');
    expect(xml).toContain('<media:title type="plain">spec.pdf</media:title>');
  });

  // Card and grid views need a representative image. Without one declared, a
  // reader has to scrape the first `<img>` out of the content HTML.
  it("declares a link preview as the entry's representative image", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          format: "link",
          url: "https://external.com/article",
          title: "An article",
          previewImageUrl: "/previews/article.jpg",
        }),
      ),
    );

    expect(xml).toContain('xmlns:media="http://search.yahoo.com/mrss/"');
    expect(xml).toContain(
      '<media:thumbnail url="https://example.com/previews/article.jpg"/>',
    );
    // A scraped thumbnail of someone else's page is not a published file, so
    // it must not tell podcast and download clients to fetch it.
    expect(xml).not.toContain('rel="enclosure"');
  });

  // The site lays a post's attachments out as one strip and marks the container
  // `data-post-media`. Carrying it into the feed lets a consumer style the
  // strip instead of reassembling it from the Media RSS elements.
  it("groups a post's attachments in one container", () => {
    const content =
      /<content type="html"><!\[CDATA\[([\s\S]*?)\]\]><\/content>/.exec(
        defaultFeedRenderer(
          makeFeedData(
            makePostView({
              bodyHtml: "<p>Look.</p>",
              media: [
                makeMediaView({
                  id: "med_a",
                  url: "https://example.com/media/a.webp",
                  thumbnailUrl: "https://example.com/media/a.webp",
                  mimeType: "image/webp",
                }),
                makeMediaView({
                  id: "med_b",
                  url: "https://example.com/media/b.webp",
                  thumbnailUrl: "https://example.com/media/b.webp",
                  mimeType: "image/webp",
                }),
              ],
            }),
          ),
        ),
      )?.[1];

    expect(content).toContain("<div data-post-media>");
    expect(content?.match(/<div data-post-media>/g)).toHaveLength(1);
    expect(content).toContain("a.webp");
    expect(content).toContain("b.webp");
  });

  // A flat list cannot say which post in a thread an attachment belongs to.
  // The content can, because each post's strip sits beside its own text.
  it("gives each post in a thread its own container", () => {
    const content =
      /<content type="html"><!\[CDATA\[([\s\S]*?)\]\]><\/content>/.exec(
        defaultFeedRenderer(
          makeFeedData(
            makePostView({
              bodyHtml: "<p>Root.</p>",
              media: [
                makeMediaView({
                  id: "med_root",
                  url: "https://example.com/media/root.webp",
                  thumbnailUrl: "https://example.com/media/root.webp",
                  mimeType: "image/webp",
                }),
              ],
              threadReplies: [
                makePostView({
                  id: "reply-1",
                  permalink: "/reply-1",
                  bodyHtml: "<p>Reply.</p>",
                  media: [
                    makeMediaView({
                      id: "med_reply",
                      url: "https://example.com/media/reply.webp",
                      thumbnailUrl: "https://example.com/media/reply.webp",
                      mimeType: "image/webp",
                    }),
                  ],
                }),
              ],
            }),
          ),
        ),
      )?.[1];

    expect(content?.match(/<div data-post-media>/g)).toHaveLength(2);
    // Each strip sits after its own post's text.
    expect(content?.indexOf("root.webp")).toBeLessThan(
      content?.indexOf("Reply.") ?? -1,
    );
    expect(content?.indexOf("Reply.")).toBeLessThan(
      content?.indexOf("reply.webp") ?? -1,
    );
  });

  // A markdown file is not worth opening raw — the browser downloads it or
  // dumps it unstyled — so a text attachment points at the page that renders
  // it while `url` stays the file.
  it("points a text attachment at the page that renders it", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          permalink: "/hn2v7",
          media: [
            makeMediaView({
              id: "med_txt",
              url: "https://cdn.example.com/files/med_txt.md",
              thumbnailUrl: "https://cdn.example.com/files/med_txt.md",
              mimeType: "text/markdown; charset=utf-8",
              size: 21,
              summary: "松松哈哈哈",
              originalName: "attached-text.md",
            }),
          ],
        }),
      ),
    );

    expect(xml).toContain('jant:page="https://example.com/hn2v7/text/med_txt"');
    // `url` stays the file, for fetching and for the enclosure.
    expect(xml).toContain('url="https://cdn.example.com/files/med_txt.md"');
    // A text attachment has no alt text; its excerpt is what the card prints.
    expect(xml).toContain(
      '<media:description type="plain">松松哈哈哈</media:description>',
    );
  });

  it("gives an attachment no page of its own when the file is the page", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makePostView({
          media: [
            makeMediaView({
              url: "https://example.com/media/photo.jpg",
              thumbnailUrl: "https://example.com/media/photo.jpg",
              mimeType: "image/jpeg",
            }),
          ],
        }),
      ),
    );

    expect(xml).not.toContain("jant:page");
  });

  it("leaves the Media RSS namespace out of a feed with no attachments", () => {
    const xml = defaultFeedRenderer(makeFeedData(makePostView()));
    expect(xml).not.toContain("xmlns:media");
    expect(xml).not.toContain("<media:content");
    expect(xml).not.toContain("<media:thumbnail");
  });
});

/**
 * A thread arrives as one entry, so both text constructs run several posts
 * together. These are the three things that let a consumer take it apart:
 * which entries are threads, where one post's words end, and which post owns
 * each file.
 */
describe("feed entry thread segmentation", () => {
  function makeBody(paragraphs: string[]): string {
    return JSON.stringify({
      type: "doc",
      content: paragraphs.map((text) => ({
        type: "paragraph",
        content: [{ type: "text", text }],
      })),
    });
  }

  function getSummary(xml: string): string | undefined {
    return /<summary type="html"><!\[CDATA\[([\s\S]*?)\]\]><\/summary>/.exec(
      xml,
    )?.[1];
  }

  function getContent(xml: string): string | undefined {
    return /<content type="html"><!\[CDATA\[([\s\S]*?)\]\]><\/content>/.exec(
      xml,
    )?.[1];
  }

  function makeReply(n: number, overrides: Partial<FeedPostView> = {}) {
    return makePostView({
      id: `reply-${n}`,
      permalink: `/reply-${n}`,
      slug: `reply-${n}`,
      body: makeBody([`Reply ${n} body.`]),
      bodyHtml: `<p>Reply ${n} body.</p>`,
      publishedAt: `2026-03-2${n}T00:00:00.000Z`,
      publishedAtFormatted: `Mar 2${n}, 2026`,
      ...overrides,
    });
  }

  function makeRoot(overrides: Partial<FeedPostView> = {}) {
    return makePostView({
      body: makeBody(["Root body."]),
      bodyHtml: "<p>Root body.</p>",
      ...overrides,
    });
  }

  // The root's own marker is what makes the rule "every marker ends the block
  // before it" hold. Without it the root and the first reply share a segment.
  it("closes the root's own block in a thread, not just the replies'", () => {
    const summary = getSummary(
      defaultFeedRenderer(
        makeFeedData(makeRoot({ threadReplies: [makeReply(1)] })),
      ),
    );

    expect(summary).toContain(
      '<p>Root body.</p>\n<p><small><a href="https://example.com/post-1" class="u-url"><time class="dt-published" datetime="2026-03-19T00:00:00.000Z">Mar 19, 2026</time></a></small></p>',
    );
    expect(summary).toContain(
      '<p>Reply 1 body.</p>\n<p><small><a href="https://example.com/reply-1" class="u-url"><time class="dt-published" datetime="2026-03-21T00:00:00.000Z">Mar 21, 2026</time></a></small></p>',
    );
  });

  // A reader prints <published> itself, so a lone post that also ended with
  // its own date would show it twice.
  it("leaves a standalone entry unmarked", () => {
    const xml = defaultFeedRenderer(makeFeedData(makeRoot()));

    expect(getSummary(xml)).not.toContain("dt-published");
    expect(getContent(xml)).not.toContain("dt-published");
    expect(xml).not.toContain("<jant:thread");
  });

  // The marker ends a block, so a post that contributed no block to the
  // summary — a photo with no caption — must not leave one behind.
  it("marks no block for a thread root with no text", () => {
    const summary = getSummary(
      defaultFeedRenderer(
        makeFeedData(
          makePostView({
            media: [
              makeMediaView({
                url: "https://example.com/media/photo.jpg",
                mimeType: "image/jpeg",
              }),
            ],
            threadReplies: [makeReply(1)],
          }),
        ),
      ),
    );

    expect(summary).not.toContain("https://example.com/post-1");
    expect(summary).toContain('href="https://example.com/reply-1"');
  });

  it("closes every reply's block in the content, in order", () => {
    const content = getContent(
      defaultFeedRenderer(
        makeFeedData(makeRoot({ threadReplies: [makeReply(1), makeReply(2)] })),
      ),
    );

    const markers = [...(content ?? "").matchAll(/class="u-url"/g)];
    expect(markers).toHaveLength(3);
    expect(content?.indexOf("Reply 1 body.")).toBeLessThan(
      content?.indexOf("Reply 2 body.") ?? -1,
    );
  });

  it("declares a thread's shape so a consumer need not read the HTML", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makeRoot({
          threadReplies: [1, 2, 3, 4, 5, 6, 7].map((n) => makeReply(n)),
        }),
      ),
    );

    // Seven replies: 1 and 2 lead, 5-7 trail, 3 and 4 fall in the gap.
    expect(xml).toContain(
      '<jant:thread posts="8" hidden="2" gap="https://example.com/reply-3" latest="https://example.com/reply-7">',
    );
  });

  // One reply is the hero, so nothing folds away and there is nowhere to send
  // a reader who wants the middle.
  it("declares no gap when a thread hides nothing", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(makeRoot({ threadReplies: [makeReply(1)] })),
    );

    expect(xml).toContain(
      '<jant:thread posts="2" hidden="0" latest="https://example.com/reply-1">',
    );
  });

  // `<jant:format>` describes the entry, which is the root. A reply that is a
  // Quote says so nowhere else — the `<blockquote>` in the content is not a
  // declaration a consumer laying the thread out itself can read.
  it("lists every post in the thread with its own format and date", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makeRoot({
          threadReplies: [
            makeReply(1, {
              format: "quote",
              title: "Marcus Aurelius",
              quoteText: "What stands in the way becomes the way.",
            }),
          ],
        }),
      ),
    );

    expect(xml).toContain(
      '<jant:post href="https://example.com/post-1" format="note" published="2026-03-19T00:00:00.000Z"/>',
    );
    expect(xml).toContain(
      '<jant:post href="https://example.com/reply-1" format="quote" published="2026-03-21T00:00:00.000Z"/>',
    );
    // The entry still declares the root's format, unchanged.
    expect(xml).toContain("<jant:format>note</jant:format>");
  });

  // A row carries what Atom would put on this post's entry. `<title>` and
  // `link[rel="alternate"]` only ever describe the root, so a titled reply and
  // a Link reply had nowhere to say either.
  it("gives a row the title, target and preview its own entry would carry", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makeRoot({
          threadReplies: [
            makeReply(1, {
              format: "link",
              title: "The AeroPress guide",
              url: "https://other.example/aeropress",
              previewImageUrl: "/media/preview.jpg",
            }),
            makeReply(2, { title: "A titled reply" }),
          ],
        }),
      ),
    );

    expect(xml).toContain(
      '<jant:post href="https://example.com/reply-1" format="link" published="2026-03-21T00:00:00.000Z"' +
        ' title="The AeroPress guide" url="https://other.example/aeropress"' +
        ' thumbnail="https://example.com/media/preview.jpg"/>',
    );
    expect(xml).toContain(
      '<jant:post href="https://example.com/reply-2" format="note" published="2026-03-22T00:00:00.000Z" title="A titled reply"/>',
    );
  });

  // The entry's own `<title>` is empty for a quote because the attribution is
  // not a title. A row follows the same rule.
  it("keeps a quote reply's attribution out of its row title", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makeRoot({
          threadReplies: [
            makeReply(1, {
              format: "quote",
              title: "Marcus Aurelius",
              quoteText: "What stands in the way becomes the way.",
            }),
          ],
        }),
      ),
    );

    expect(xml).toContain(
      '<jant:post href="https://example.com/reply-1" format="quote" published="2026-03-21T00:00:00.000Z"/>',
    );
    expect(xml).not.toContain('title="Marcus Aurelius"');
  });

  // Truncation lives in `<summary>`, which renders the root and the newest
  // reply. A folded post has no block to cut, so its row must stay silent
  // rather than claim it arrived whole.
  it("marks every cut post's row, and no folded post's", () => {
    const longBody = makeBody([
      "Alpha ".repeat(80).trim(),
      "Bravo ".repeat(80).trim(),
      "Charlie ".repeat(80).trim(),
      "Delta ".repeat(80).trim(),
    ]);
    const xml = defaultFeedRenderer(
      makeFeedData(
        makeRoot({
          threadReplies: [1, 2, 3, 4, 5, 6, 7].map((n) =>
            makeReply(n, { body: longBody }),
          ),
        }),
      ),
    );

    // Reply 1 leads and reply 7 is the hero: both render, so both can be cut.
    expect(xml).toContain(
      '<jant:post href="https://example.com/reply-1" format="note" published="2026-03-21T00:00:00.000Z" truncated="true"/>',
    );
    expect(xml).toContain(
      '<jant:post href="https://example.com/reply-7" format="note" published="2026-03-27T00:00:00.000Z" truncated="true"/>',
    );
    // Reply 3 is behind the gap. Its body is just as long, and its row says it
    // was folded rather than that it arrived whole.
    expect(xml).toContain(
      '<jant:post href="https://example.com/reply-3" format="note" published="2026-03-23T00:00:00.000Z" folded="true"/>',
    );
    // The entry still answers the single-card reader with one boolean.
    expect(xml).toContain("<jant:truncated/>");
  });

  // Every other decision on a row is declared. This one used to be left to a
  // consumer reading the summary's shape, which misreads a photo with no
  // caption: the site renders it, it contributes no text, and it comes out
  // looking exactly like a post the fold hid.
  it("declares which posts the fold hid", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makeRoot({
          threadReplies: [1, 2, 3, 4, 5, 6, 7].map((n) => makeReply(n)),
        }),
      ),
    );

    const folded = [...xml.matchAll(/<jant:post [^>]*folded="true"[^>]*\/>/g)];
    expect(folded).toHaveLength(2);
    // The same two the gap stands for, and the same count `@hidden` reports.
    expect(xml).toContain(
      '<jant:post href="https://example.com/reply-3" format="note" published="2026-03-23T00:00:00.000Z" folded="true"/>',
    );
    expect(xml).toContain(
      '<jant:post href="https://example.com/reply-4" format="note" published="2026-03-24T00:00:00.000Z" folded="true"/>',
    );
    expect(xml).toContain('hidden="2"');
  });

  // A caption-less photo is a normal Jant post. It renders on the site, so its
  // row must not claim the fold hid it — a consumer that believed otherwise
  // would drop its attachments and the post would vanish.
  it("leaves a rendered post with no text unfolded", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makeRoot({
          threadReplies: [
            makePostView({
              id: "reply-1",
              permalink: "/reply-1",
              slug: "reply-1",
              media: [
                makeMediaView({
                  url: "https://example.com/media/photo.jpg",
                  thumbnailUrl: "https://example.com/media/photo.jpg",
                  mimeType: "image/jpeg",
                }),
              ],
            }),
            makeReply(2),
          ],
        }),
      ),
    );

    expect(xml).toContain('hidden="0"');
    expect(xml).not.toContain('folded="true"');
    // It contributes nothing to the summary, which is exactly why the row has
    // to speak for it.
    expect(getSummary(xml)).not.toContain("https://example.com/reply-1");
    expect(xml).toContain('jant:post="https://example.com/reply-1"');
  });

  // A reply carries chrome the entry's own fields carry for the root, so a
  // consumer drawing native cards has to drop it before redrawing from the
  // row. Matching it by shape is fragile — a body can open with a link.
  it("wraps a reply's title and source line in a header element", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makeRoot({
          threadReplies: [
            makeReply(1, {
              format: "link",
              title: "The AeroPress guide",
              url: "https://other.example/aeropress",
            }),
          ],
        }),
      ),
    );

    expect(getSummary(xml)).toContain(
      '<header><p><a href="https://other.example/aeropress">other.example</a></p>' +
        '<h2><a href="https://other.example/aeropress">The AeroPress guide</a></h2></header>',
    );
    // The root's chrome stays in the entry's own fields, so its block has no
    // header to drop and a consumer needs no special case for it.
    expect(getSummary(xml)?.indexOf("<header>")).toBeGreaterThan(
      getSummary(xml)?.indexOf("Root body.") ?? -1,
    );
  });

  it("gives a reply with no title and no source no header at all", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(makeRoot({ threadReplies: [makeReply(1)] })),
    );

    expect(getSummary(xml)).not.toContain("<header>");
  });

  it("lists no thread rows on a lone post", () => {
    const xml = defaultFeedRenderer(makeFeedData(makeRoot()));

    expect(xml).not.toContain("<jant:post");
    expect(xml).not.toContain("jant:post=");
  });

  it("names the post carrying every attachment in a thread, the root's included", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makeRoot({
          media: [
            makeMediaView({
              id: "med_root",
              url: "https://example.com/media/beans.jpg",
              thumbnailUrl: "https://example.com/media/beans.jpg",
              mimeType: "image/jpeg",
            }),
          ],
          threadReplies: [
            makeReply(1, {
              media: [
                makeMediaView({
                  id: "med_reply",
                  url: "https://example.com/media/cup.jpg",
                  thumbnailUrl: "https://example.com/media/cup.jpg",
                  mimeType: "image/jpeg",
                }),
              ],
            }),
          ],
        }),
      ),
    );

    // The root's file names its post too. Guessing wrong here hangs a photo
    // under the wrong post, which is not what a missing attribute should mean.
    expect(xml).toContain(
      '<media:content url="https://example.com/media/beans.jpg" type="image/jpeg" medium="image" jant:post="https://example.com/post-1"/>',
    );
    expect(xml).toContain(
      '<media:content url="https://example.com/media/cup.jpg" type="image/jpeg" medium="image" jant:post="https://example.com/reply-1"/>',
    );
  });

  // A lone post's entry has exactly one post, so the attribute would only
  // repeat `<id>` on every file.
  it("leaves a lone post's attachment unattributed", () => {
    const xml = defaultFeedRenderer(
      makeFeedData(
        makeRoot({
          media: [
            makeMediaView({
              url: "https://example.com/media/beans.jpg",
              thumbnailUrl: "https://example.com/media/beans.jpg",
              mimeType: "image/jpeg",
            }),
          ],
        }),
      ),
    );

    expect(xml).toContain("<media:content");
    expect(xml).not.toContain("jant:post=");
  });
});
