import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLinkPreviewIconImageOptions,
  getLinkPreviewProvider,
  getLinkPreviewProviderLabel,
  parseLinkPageHead,
  resolveLinkPreview,
  sniffRasterImage,
} from "../link-preview.js";

// Every host resolves to a public address, so no test depends on real DNS.
const lookup = vi.hoisted(() =>
  vi.fn(async (_host: string, _options?: unknown) => [
    { address: "93.184.215.14", family: 4 },
  ]),
);
vi.mock("node:dns/promises", () => ({ lookup, default: { lookup } }));

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const ICO = [0x00, 0x00, 0x01, 0x00];

/** A file of `length` bytes that starts with `signature`. */
function file(signature: number[], length = 64): Uint8Array {
  const bytes = new Uint8Array(Math.max(length, signature.length));
  bytes.set(signature);
  return bytes;
}

/** The `<head>` of Bilibili's video page, cut to the tags that matter. */
const BILIBILI_HEAD = `<!DOCTYPE html><html><head>
<meta charset="UTF-8">
<title>【官方 MV】Never Gonna Give You Up - Rick Astley_哔哩哔哩_bilibili</title>
<meta data-vue-meta="true" property="og:type" content="video.other">
<meta data-vue-meta="true" property="og:image" content="//i1.hdslb.com/bfs/archive/5242750857121e05146d5d5b13a47a2a6dd36e98.jpg@1200w_630h">
<meta data-vue-meta="true" property="og:video" content="https://player.bilibili.com/player.html?bvid=BV1GJ411x7h7">
<link rel="shortcut icon" href="https://i0.hdslb.com/bfs/static/jinkela/long/images/favicon.ico">
<link data-vue-meta="true" rel="apple-touch-icon" href="https://i1.hdslb.com/bfs/archive/5242750857121e05146d5d5b13a47a2a6dd36e98.jpg@57w_57h">
<script>window.__INITIAL_STATE__ = '<meta property="og:image" content="https://wrong.example/">';</script>`;

const GITHUB_HEAD = `<head>
<meta property="og:type" content="profile">
<meta property="og:image" content="https://avatars.githubusercontent.com/u/1">
<link rel="fluid-icon" href="https://github.com/fluidicon.png" title="GitHub">
<link rel="mask-icon" href="https://github.githubassets.com/assets/pinned-octocat.svg" color="#000000">
<link rel="alternate icon" class="js-site-favicon" type="image/png" href="https://github.githubassets.com/favicons/favicon.png">
<link rel="icon" class="js-site-favicon" type="image/svg+xml" href="https://github.githubassets.com/favicons/favicon.svg">
</head>`;

describe("parseLinkPageHead", () => {
  it("reads a video page: kind, thumbnail, and the declared icon first", () => {
    const metadata = parseLinkPageHead(
      BILIBILI_HEAD,
      new URL("https://www.bilibili.com/video/BV1GJ411x7h7/"),
    );

    expect(metadata.video).toBe(true);
    expect(metadata.imageUrl).toBe(
      "https://i1.hdslb.com/bfs/archive/5242750857121e05146d5d5b13a47a2a6dd36e98.jpg@1200w_630h",
    );
    // The page's apple-touch-icon is the video's own cover, so the declared
    // favicon comes before it.
    expect(metadata.iconUrls).toEqual([
      "https://i0.hdslb.com/bfs/static/jinkela/long/images/favicon.ico",
      "https://i1.hdslb.com/bfs/archive/5242750857121e05146d5d5b13a47a2a6dd36e98.jpg@57w_57h",
      "https://www.bilibili.com/favicon.ico",
    ]);
  });

  it("doesn't take a page with an image for a video", () => {
    const metadata = parseLinkPageHead(
      GITHUB_HEAD,
      new URL("https://github.com/anthropics"),
    );

    expect(metadata.video).toBe(false);
    expect(metadata.imageUrl).toBe("https://avatars.githubusercontent.com/u/1");
  });

  it("skips SVG icons and Safari's mask-icon", () => {
    const metadata = parseLinkPageHead(
      GITHUB_HEAD,
      new URL("https://github.com/anthropics"),
    );

    expect(metadata.iconUrls).toEqual([
      "https://github.githubassets.com/favicons/favicon.png",
      "https://github.com/favicon.ico",
    ]);
  });

  it.each([
    ["og:type video.movie", '<meta property="og:type" content="video.movie">'],
    ["og:type video", '<meta property="og:type" content="video">'],
    [
      "og:video:url",
      '<meta property="og:video:url" content="https://example.com/embed/1">',
    ],
    [
      "og:video:secure_url",
      '<meta property="og:video:secure_url" content="https://example.com/embed/1">',
    ],
  ])("takes %s for a video", (_label, tag) => {
    expect(
      parseLinkPageHead(`<head>${tag}</head>`, new URL("https://example.com/"))
        .video,
    ).toBe(true);
  });

  it("doesn't take a player card for a video", () => {
    const metadata = parseLinkPageHead(
      '<meta property="og:type" content="music.song"><meta name="twitter:card" content="player">',
      new URL("https://example.com/track"),
    );

    expect(metadata.video).toBe(false);
  });

  it("orders icons by declared size, preferring 32 to 256 px", () => {
    const metadata = parseLinkPageHead(
      `<link rel="icon" href="/16.png" sizes="16x16">
       <link rel="icon" href="/32.png" sizes="32x32">
       <link rel="icon" href="/144.png" sizes="144x144">
       <link rel="icon" href="/512.png" sizes="512x512">
       <link rel="icon" href="/plain.png">
       <link rel="shortcut icon" href="/old.ico">`,
      new URL("https://example.com/a/b"),
    );

    expect(metadata.iconUrls).toEqual([
      "https://example.com/144.png",
      "https://example.com/32.png",
      "https://example.com/512.png",
      "https://example.com/plain.png",
      "https://example.com/old.ico",
      "https://example.com/16.png",
      "https://example.com/favicon.ico",
    ]);
  });

  it("resolves relative URLs against <base>, wherever it sits", () => {
    const metadata = parseLinkPageHead(
      `<link rel="icon" href="icon.png">
       <base href="https://cdn.example.com/site/">
       <meta property="og:type" content="video.other">
       <meta property="og:image" content="thumb.jpg">`,
      new URL("https://example.com/watch/1"),
    );

    expect(metadata.imageUrl).toBe("https://cdn.example.com/site/thumb.jpg");
    expect(metadata.iconUrls).toEqual([
      "https://cdn.example.com/site/icon.png",
      "https://example.com/favicon.ico",
    ]);
  });

  it("decodes entities and ignores tags in comments and scripts", () => {
    const metadata = parseLinkPageHead(
      `<!-- <meta property="og:type" content="video.other"> -->
       <meta content="https://example.com/i?a=1&amp;b=2" property='og:image'>
       <script>var x = '<meta property="og:video" content="x">';</script>`,
      new URL("https://example.com/"),
    );

    expect(metadata.video).toBe(false);
    expect(metadata.imageUrl).toBe("https://example.com/i?a=1&b=2");
  });

  it("leaves out an image that isn't http(s)", () => {
    const metadata = parseLinkPageHead(
      '<meta property="og:image" content="javascript:alert(1)"><meta name="twitter:image" content="/t.png">',
      new URL("https://example.com/"),
    );

    expect(metadata.imageUrl).toBe("https://example.com/t.png");
  });

  it("falls back to /favicon.ico when the page names no icon", () => {
    expect(
      parseLinkPageHead("<head></head>", new URL("https://example.com/a"))
        .iconUrls,
    ).toEqual(["https://example.com/favicon.ico"]);
  });
});

describe("getLinkPreviewProvider", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube"],
    ["https://youtu.be/dQw4w9WgXcQ", "youtube"],
    ["https://www.bilibili.com/video/BV1GJ411x7h7/", "bilibili"],
    ["https://m.bilibili.com/video/BV1GJ411x7h7", "bilibili"],
    ["https://b23.tv/BV1GJ411x7h7", "bilibili"],
    ["https://vimeo.com/76979871", "vimeo"],
    ["https://player.vimeo.com/video/76979871", "vimeo"],
  ])("names %s", (url, provider) => {
    expect(getLinkPreviewProvider(url)).toBe(provider);
  });

  it.each(["https://notyoutube.com/", "https://example.com/", "not a url"])(
    "names nothing for %s",
    (url) => {
      expect(getLinkPreviewProvider(url)).toBeNull();
    },
  );

  it("has a label for every provider it names", () => {
    for (const provider of ["youtube", "bilibili", "vimeo"]) {
      expect(getLinkPreviewProviderLabel(provider)).toBeTruthy();
    }
  });
});

describe("sniffRasterImage", () => {
  it.each([
    [PNG, "image/png"],
    [JPEG, "image/jpeg"],
    [[0x47, 0x49, 0x46, 0x38, 0x39, 0x61], "image/gif"],
    [
      [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
      "image/webp",
    ],
    [
      [0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66],
      "image/avif",
    ],
    [ICO, "image/x-icon"],
  ])("recognizes %#", (signature, contentType) => {
    expect(sniffRasterImage(file(signature))?.contentType).toBe(contentType);
  });

  it("refuses SVG and HTML", () => {
    const encode = (text: string) => new TextEncoder().encode(text);
    expect(
      sniffRasterImage(encode('<svg xmlns="http://www.w3.org/2000/svg">')),
    ).toBeNull();
    expect(sniffRasterImage(encode("<!DOCTYPE html>"))).toBeNull();
  });
});

describe("getLinkPreviewIconImageOptions", () => {
  it("scales a raster icon down and passes an .ico through", () => {
    expect(
      getLinkPreviewIconImageOptions("media/s/previews/p-icon-a.png"),
    ).toEqual({ width: 64, format: "auto", fit: "scale-down" });
    expect(
      getLinkPreviewIconImageOptions("media/s/previews/p-icon-a.ico"),
    ).toBeUndefined();
  });
});

describe("resolveLinkPreview", () => {
  type Route = (url: string) => Response | Promise<Response>;
  let routes: Map<string, Route>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    routes = new Map();
    fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      const route = routes.get(url);
      return route ? route(url) : new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const html = (body: string) => () =>
    new Response(body, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  const image =
    (bytes: Uint8Array, type = "image/png") =>
    () =>
      new Response(bytes, { headers: { "content-type": type } });

  it("resolves a video page to its thumbnail, provider, and icon", async () => {
    routes.set(
      "https://b23.tv/BV1GJ411x7h7",
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://www.bilibili.com/video/BV1GJ411x7h7/" },
        }),
    );
    routes.set(
      "https://www.bilibili.com/video/BV1GJ411x7h7/",
      html(BILIBILI_HEAD),
    );
    routes.set(
      "https://i1.hdslb.com/bfs/archive/5242750857121e05146d5d5b13a47a2a6dd36e98.jpg@1200w_630h",
      image(file(JPEG, 20000), "image/jpeg"),
    );
    routes.set(
      "https://i0.hdslb.com/bfs/static/jinkela/long/images/favicon.ico",
      image(file(ICO), "image/x-icon"),
    );

    const preview = await resolveLinkPreview("https://b23.tv/BV1GJ411x7h7");

    expect(preview.kind).toBe("video");
    expect(preview.provider).toBe("bilibili");
    expect(preview.image?.contentType).toBe("image/jpeg");
    expect(preview.icon?.contentType).toBe("image/x-icon");
  });

  it("gives a page that isn't a video only its icon", async () => {
    routes.set("https://github.com/anthropics", html(GITHUB_HEAD));
    routes.set(
      "https://github.githubassets.com/favicons/favicon.png",
      image(file(PNG)),
    );

    const preview = await resolveLinkPreview("https://github.com/anthropics");

    expect(preview).toMatchObject({ kind: null, provider: null, image: null });
    expect(preview.icon?.contentType).toBe("image/png");
    // The profile picture is never fetched.
    expect(fetchMock).not.toHaveBeenCalledWith(
      "https://avatars.githubusercontent.com/u/1",
      expect.anything(),
    );
  });

  it("names no provider for a video site it doesn't know", async () => {
    routes.set(
      "https://videos.example/watch/1",
      html(
        '<meta property="og:type" content="video.other"><meta property="og:image" content="/t.jpg">',
      ),
    );
    routes.set("https://videos.example/t.jpg", image(file(JPEG), "image/jpeg"));

    const preview = await resolveLinkPreview("https://videos.example/watch/1");

    expect(preview.kind).toBe("video");
    expect(preview.provider).toBeNull();
  });

  it("never reads a YouTube page", async () => {
    routes.set(
      "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
      image(file(JPEG, 1000), "image/jpeg"), // the grey placeholder
    );
    routes.set(
      "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      image(file(JPEG, 20000), "image/jpeg"),
    );
    routes.set(
      "https://www.youtube.com/favicon.ico",
      image(file(ICO), "image/x-icon"),
    );

    const preview = await resolveLinkPreview("https://youtu.be/dQw4w9WgXcQ");

    expect(preview.kind).toBe("video");
    expect(preview.provider).toBe("youtube");
    expect(preview.image?.bytes.byteLength).toBe(20000);
    expect(preview.icon?.contentType).toBe("image/x-icon");
    const fetched = fetchMock.mock.calls.map(([url]) => String(url));
    expect(fetched.some((url) => url.includes("youtube.com/watch"))).toBe(
      false,
    );
    expect(fetched.some((url) => url.includes("youtu.be"))).toBe(false);
  });

  it("still tries /favicon.ico when the page can't be read", async () => {
    routes.set(
      "https://walled.example/post",
      () => new Response("Forbidden", { status: 403 }),
    );
    routes.set(
      "https://walled.example/favicon.ico",
      image(file(ICO), "image/x-icon"),
    );

    const preview = await resolveLinkPreview("https://walled.example/post");

    expect(preview.image).toBeNull();
    expect(preview.icon?.contentType).toBe("image/x-icon");
  });

  it("refuses an icon that isn't a raster image", async () => {
    routes.set(
      "https://example.com/",
      html('<link rel="icon" href="/icon.png">'),
    );
    routes.set(
      "https://example.com/icon.png",
      html("<html>not an image</html>"),
    );
    routes.set(
      "https://example.com/favicon.ico",
      () =>
        new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', {
          headers: { "content-type": "image/x-icon" },
        }),
    );

    const preview = await resolveLinkPreview("https://example.com/");

    expect(preview.icon).toBeNull();
  });

  it("doesn't take an .ico for a video thumbnail", async () => {
    routes.set(
      "https://videos.example/watch/2",
      html(
        '<meta property="og:video" content="/embed/2"><meta property="og:image" content="/t.ico">',
      ),
    );
    routes.set(
      "https://videos.example/t.ico",
      image(file(ICO), "image/x-icon"),
    );

    const preview = await resolveLinkPreview("https://videos.example/watch/2");

    expect(preview.kind).toBeNull();
    expect(preview.image).toBeNull();
  });

  it("refuses a private address without fetching it", async () => {
    const preview = await resolveLinkPreview("http://169.254.169.254/latest");

    expect(preview).toEqual({
      image: null,
      kind: null,
      provider: null,
      icon: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
