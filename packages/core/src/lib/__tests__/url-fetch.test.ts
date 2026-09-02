import { afterEach, describe, expect, it, vi } from "vitest";
import { assertPublicHttpUrl, fetchImageBytes } from "../url-fetch.js";
import { ValidationError } from "../errors.js";

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
  ])("rejects %s", (_label, url) => {
    expect(() => assertPublicHttpUrl(url)).toThrow(ValidationError);
  });

  it("rejects a non-URL string", () => {
    expect(() => assertPublicHttpUrl("not a url")).toThrow(ValidationError);
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
