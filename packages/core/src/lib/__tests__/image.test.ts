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
    const result = getMediaUrl("media/2025/01/01902a9f-1a2b-7c3d.webp");
    expect(result).toBe("/media/2025/01/01902a9f-1a2b-7c3d.webp");
  });

  it("returns CDN URL when publicUrl is provided", () => {
    const result = getMediaUrl(
      "media/2025/01/01902a9f-1a2b-7c3d.webp",
      "https://cdn.example.com",
    );
    expect(result).toBe(
      "https://cdn.example.com/media/2025/01/01902a9f-1a2b-7c3d.webp",
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
      "https://example.com/cdn-cgi/image/width=200,quality=80,format=auto//media/test.jpg",
    );
  });

  it("returns original URL when no options provided", () => {
    const result = getImageUrl(
      "/media/test.jpg",
      "https://example.com/cdn-cgi/image",
    );
    expect(result).toBe("/media/test.jpg");
  });
});
