import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertPublicHttpUrl,
  assertResolvesPublic,
  fetchHtmlHead,
  fetchImageBytes,
  isPrivateAddress,
} from "../url-fetch.js";
import { ValidationError } from "../errors.js";

// Every host resolves to a public address unless a test says otherwise, so
// no test depends on real DNS.
const lookup = vi.hoisted(() =>
  vi.fn(async (_host: string, _options?: unknown) => [
    { address: "93.184.215.14", family: 4 },
  ]),
);
vi.mock("node:dns/promises", () => ({ lookup, default: { lookup } }));

describe("assertPublicHttpUrl", () => {
  it("accepts public http(s) URLs", () => {
    expect(assertPublicHttpUrl("https://example.com/a.png").href).toBe(
      "https://example.com/a.png",
    );
    expect(assertPublicHttpUrl("http://cdn.example.com/b.jpg").hostname).toBe(
      "cdn.example.com",
    );
  });

  it.each([
    ["ftp scheme", "ftp://example.com/a.png"],
    ["data scheme", "data:image/png;base64,AAAA"],
    ["embedded credentials", "https://user:pass@example.com/a.png"],
    ["localhost", "http://localhost/a.png"],
    ["sub.localhost", "http://api.localhost/a.png"],
    ["0.0.0.0", "http://0.0.0.0/a.png"],
    ["loopback v4", "http://127.0.0.1/a.png"],
    ["private 10/8", "http://10.0.0.5/a.png"],
    ["private 172.16/12", "http://172.16.5.5/a.png"],
    ["private 192.168/16", "http://192.168.1.1/a.png"],
    ["CGNAT 100.64/10", "http://100.64.0.1/a.png"],
    ["link-local / metadata", "http://169.254.169.254/latest/meta-data"],
    ["loopback v6", "http://[::1]/a.png"],
    ["link-local v6", "http://[fe80::1]/a.png"],
    ["ULA v6", "http://[fd00::1]/a.png"],
    ["v4-mapped private v6", "http://[::ffff:10.0.0.1]/a.png"],
    ["trailing-dot localhost", "http://localhost./a.png"],
    ["v4-compatible loopback v6", "http://[::7f00:1]/a.png"],
    ["NAT64 loopback", "http://[64:ff9b::7f00:1]/a.png"],
    ["6to4 private", "http://[2002:a00:1::1]/a.png"],
    ["multicast v4", "http://224.0.0.1/a.png"],
  ])("rejects %s", (_label, url) => {
    expect(() => assertPublicHttpUrl(url)).toThrow(ValidationError);
  });

  it("rejects a non-URL string", () => {
    expect(() => assertPublicHttpUrl("not a url")).toThrow(ValidationError);
  });
});

describe("isPrivateAddress", () => {
  it.each([
    "8.8.8.8",
    "2606:4700::1111",
    "64:ff9b::808:808",
    "2002:808:808::1",
  ])("treats %s as public", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });

  it.each(["127.0.0.1", "::1", "fc00::1", "not:an:address::::"])(
    "treats %s as private",
    (address) => {
      expect(isPrivateAddress(address)).toBe(true);
    },
  );
});

describe("assertResolvesPublic", () => {
  it("refuses a name that resolves to a private address", async () => {
    lookup.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);

    await expect(
      assertResolvesPublic(new URL("http://127.0.0.1.nip.io/a.png")),
    ).rejects.toThrow("private address");
  });

  it("refuses a name when any of its addresses is private", async () => {
    lookup.mockResolvedValueOnce([
      { address: "93.184.215.14", family: 4 },
      { address: "::1", family: 6 },
    ]);

    await expect(
      assertResolvesPublic(new URL("https://example.com/a.png")),
    ).rejects.toThrow("private address");
  });

  it("accepts a name that resolves only to public addresses", async () => {
    await expect(
      assertResolvesPublic(new URL("https://example.com/a.png")),
    ).resolves.toBeUndefined();
  });
});

describe("fetchImageBytes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function pngBytes(length = 64): Uint8Array {
    const bytes = new Uint8Array(length);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return bytes;
  }

  it("returns the bytes and content-type on success", async () => {
    const bytes = pngBytes();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(bytes, {
            headers: { "content-type": "image/png" },
          }),
      ),
    );

    const result = await fetchImageBytes(new URL("https://example.com/a.png"), {
      maxBytes: 1024,
      timeoutMs: 5000,
    });

    expect(result.contentType).toBe("image/png");
    expect(result.bytes.byteLength).toBe(bytes.byteLength);
  });

  it("sends a Referer matching the image origin (hotlink protection)", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(pngBytes(), { headers: { "content-type": "image/png" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchImageBytes(
      new URL("https://img9.doubanio.com/view/photo/p1.webp"),
      { maxBytes: 1024, timeoutMs: 5000 },
    );

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as
      Record<string, string> | undefined;
    expect(headers?.Referer).toBe("https://img9.doubanio.com/");
  });

  it("rejects via the Content-Length precheck", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(pngBytes(16), {
            headers: {
              "content-type": "image/png",
              "content-length": "999999",
            },
          }),
      ),
    );

    await expect(
      fetchImageBytes(new URL("https://example.com/a.png"), {
        maxBytes: 1024,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(/too large/i);
  });

  it("aborts when the streamed body exceeds maxBytes (no Content-Length)", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(2048));
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(stream, {
            headers: { "content-type": "image/png" },
          }),
      ),
    );

    await expect(
      fetchImageBytes(new URL("https://example.com/a.png"), {
        maxBytes: 1024,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(/too large/i);
  });

  it("re-validates redirect targets and rejects a hop to a private address", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: "http://169.254.169.254/" },
          }),
      ),
    );

    await expect(
      fetchImageBytes(new URL("https://example.com/a.png"), {
        maxBytes: 1024,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("follows a redirect to a public target", async () => {
    const bytes = pngBytes();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example.com/final.png" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(bytes, { headers: { "content-type": "image/png" } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchImageBytes(new URL("https://example.com/a.png"), {
      maxBytes: 1024,
      timeoutMs: 5000,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.bytes.byteLength).toBe(bytes.byteLength);
  });
});

describe("fetchHtmlHead", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const options = { maxBytes: 4096, timeoutMs: 5000 };

  /** A response whose body arrives in the given chunks. */
  function streamed(chunks: string[], contentType = "text/html"): Response {
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
          controller.close();
        },
      }),
      { headers: { "content-type": contentType } },
    );
  }

  it("stops reading at </head>, even split across chunks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamed([
          '<html><head><meta property="og:type" content="video.other"></he',
          "ad><body>",
          "x".repeat(10_000),
        ]),
      ),
    );

    const { html } = await fetchHtmlHead(
      new URL("https://example.com/"),
      options,
    );

    expect(html).toBe(
      '<html><head><meta property="og:type" content="video.other">',
    );
  });

  it("stops at <body> when the head is never closed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamed(['<meta name="a" content="b"><body class="x">']),
      ),
    );

    const { html } = await fetchHtmlHead(
      new URL("https://example.com/"),
      options,
    );

    expect(html).toBe('<meta name="a" content="b">');
  });

  it("returns a truncated head instead of failing at maxBytes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamed(["<head>", "y".repeat(10_000)])),
    );

    const { html } = await fetchHtmlHead(
      new URL("https://example.com/"),
      options,
    );

    expect(html.length).toBe(options.maxBytes);
    expect(html.startsWith("<head>")).toBe(true);
  });

  it("refuses a response that isn't HTML", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamed(["%PDF-1.7"], "application/pdf")),
    );

    await expect(
      fetchHtmlHead(new URL("https://example.com/paper.pdf"), options),
    ).rejects.toThrow(/not HTML/);
  });

  it("refuses an error status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Forbidden", { status: 403 })),
    );

    await expect(
      fetchHtmlHead(new URL("https://example.com/"), options),
    ).rejects.toThrow("Couldn't fetch the page (HTTP 403).");
  });

  it("reports the URL after redirects", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(null, {
            status: 302,
            headers: { location: "https://www.example.com/video/1/" },
          }),
        )
        .mockResolvedValueOnce(streamed(["<head></head>"])),
    );

    const { url } = await fetchHtmlHead(new URL("https://ex.am/1"), options);

    expect(url.toString()).toBe("https://www.example.com/video/1/");
  });

  it("refuses a redirect to a private address", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(null, {
            status: 301,
            headers: { location: "http://127.0.0.1:8080/admin" },
          }),
      ),
    );

    await expect(
      fetchHtmlHead(new URL("https://example.com/"), options),
    ).rejects.toThrow("That URL points to a private address.");
  });

  it("sends no Referer", async () => {
    const fetchMock = vi.fn(async () => streamed(["<head></head>"]));
    vi.stubGlobal("fetch", fetchMock);

    await fetchHtmlHead(new URL("https://example.com/"), options);

    const headers = (fetchMock.mock.calls[0] as unknown[] | undefined)?.[1] as
      { headers?: Record<string, string> } | undefined;
    expect(headers?.headers?.Referer).toBeUndefined();
    expect(headers?.headers?.Accept).toMatch(/^text\/html/);
  });
});
