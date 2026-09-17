import { describe, it, expect } from "vitest";
import { getMediaUrl, getImageUrl, getPublicUrlForProvider } from "../image.js";

describe("getPublicUrlForProvider", () => {
  it("returns r2PublicUrl for r2 provider", () => {
    const result = getPublicUrlForProvider(
      "r2",
      "https://r2.example.com",
      "https://s3.example.com",
    );
    expect(result).toBe("https://r2.example.com");
  });

  it("returns s3PublicUrl for s3 provider", () => {
    const result = getPublicUrlForProvider(
      "s3",
      "https://r2.example.com",
      "https://s3.example.com",
    );
    expect(result).toBe("https://s3.example.com");
  });

  it("returns undefined when r2 provider has no r2PublicUrl", () => {
    const result = getPublicUrlForProvider(
      "r2",
      undefined,
      "https://s3.example.com",
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined when s3 provider has no s3PublicUrl", () => {
    const result = getPublicUrlForProvider(
      "s3",
      "https://r2.example.com",
      undefined,
    );
    expect(result).toBeUndefined();
  });

  it("returns localPublicUrl for local provider", () => {
    const result = getPublicUrlForProvider(
      "local",
      "https://r2.example.com",
      "https://s3.example.com",
      "https://media.example.com",
    );
    expect(result).toBe("https://media.example.com");
  });

  it("defaults to r2PublicUrl for unknown providers", () => {
    const result = getPublicUrlForProvider(
      "unknown",
      "https://r2.example.com",
      "https://s3.example.com",
    );
    expect(result).toBe("https://r2.example.com");
  });
});

describe("getMediaUrl", () => {
  it("returns local proxy URL when no publicUrl provided", () => {
    const result = getMediaUrl("media/01902a9f-1a2b-7c3d.webp");
    expect(result).toBe("/media/01902a9f-1a2b-7c3d.webp");
  });

  it("returns a prefixed local proxy URL when the site is mounted below root", () => {
    const result = getMediaUrl(
      "media/01902a9f-1a2b-7c3d.webp",
      undefined,
      "/blog",
    );
    expect(result).toBe("/blog/media/01902a9f-1a2b-7c3d.webp");
  });

  it("returns CDN URL when publicUrl is provided", () => {
    const result = getMediaUrl(
      "media/01902a9f-1a2b-7c3d.webp",
      "https://cdn.example.com",
    );
    expect(result).toBe(
      "https://cdn.example.com/media/01902a9f-1a2b-7c3d.webp",
    );
  });
});

describe("getImageUrl", () => {
  it("returns original URL when no transform URL provided", () => {
    const result = getImageUrl("/media/test.jpg", undefined, { width: 200 });
    expect(result).toBe("/media/test.jpg");
  });

  it("returns transformed URL with options", () => {
    const result = getImageUrl(
      "/media/test.jpg",
      "https://example.com/cdn-cgi/image",
      { width: 200, quality: 80, format: "auto" },
    );
    expect(result).toBe(
      "https://example.com/cdn-cgi/image/width=200,quality=80,format=auto/media/test.jpg",
    );
  });

  it("returns original URL when no options provided", () => {
    const result = getImageUrl(
      "/media/test.jpg",
      "https://example.com/cdn-cgi/image",
    );
    expect(result).toBe("/media/test.jpg");
  });

  // Cloudflare cannot fetch `…/width=200//media/test.jpg` (err=9404): the
  // source path after the options must not start with a second slash.
  it("never joins a root-relative source with a double slash", () => {
    expect(
      getImageUrl(
        "/blog/media/test.jpg",
        "https://example.com/cdn-cgi/image/",
        {
          width: 200,
        },
      ),
    ).toBe("https://example.com/cdn-cgi/image/width=200/blog/media/test.jpg");
  });

  it("keeps an absolute source as it is", () => {
    expect(
      getImageUrl(
        "https://media.example.com/media/test.jpg",
        "https://example.com/cdn-cgi/image",
        { width: 200 },
      ),
    ).toBe(
      "https://example.com/cdn-cgi/image/width=200/https://media.example.com/media/test.jpg",
    );
  });
});
