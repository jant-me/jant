import { describe, it, expect } from "vitest";
import {
  extractDomain,
  extractDisplayDomain,
  isFullUrl,
  isSafeAbsoluteUrl,
  normalizePath,
  sanitizeRichTextHref,
  sanitizeUrl,
  stripSitePathPrefix,
  slugify,
  toSameSitePath,
} from "../url.js";

describe("extractDomain", () => {
  it("extracts hostname from HTTPS URL", () => {
    expect(extractDomain("https://example.com/path")).toBe("example.com");
  });

  it("extracts hostname from HTTP URL", () => {
    expect(extractDomain("http://example.com")).toBe("example.com");
  });

  it("includes www subdomain", () => {
    expect(extractDomain("https://www.example.com/path")).toBe(
      "www.example.com",
    );
  });

  it("handles URLs with ports", () => {
    expect(extractDomain("http://localhost:3000/api")).toBe("localhost");
  });

  it("handles URLs with query params and hash", () => {
    expect(extractDomain("https://example.com/path?q=1#section")).toBe(
      "example.com",
    );
  });

  it("returns null for invalid URLs", () => {
    expect(extractDomain("not-a-url")).toBe(null);
    expect(extractDomain("")).toBe(null);
  });

  it("handles complex subdomains", () => {
    expect(extractDomain("https://blog.sub.example.com")).toBe(
      "blog.sub.example.com",
    );
  });
});

describe("extractDisplayDomain", () => {
  it("strips www prefix", () => {
    expect(extractDisplayDomain("https://www.example.com/path")).toBe(
      "example.com",
    );
  });

  it("strips m prefix", () => {
    expect(extractDisplayDomain("https://m.wikipedia.org/wiki/Test")).toBe(
      "wikipedia.org",
    );
  });

  it("strips mobile prefix", () => {
    expect(extractDisplayDomain("https://mobile.twitter.com/user")).toBe(
      "twitter.com",
    );
  });

  it("keeps other subdomains", () => {
    expect(extractDisplayDomain("https://blog.example.com")).toBe(
      "blog.example.com",
    );
  });

  it("returns domain as-is when no common prefix", () => {
    expect(extractDisplayDomain("https://example.com")).toBe("example.com");
  });

  it("returns null for invalid URLs", () => {
    expect(extractDisplayDomain("not-a-url")).toBe(null);
  });
});

describe("normalizePath", () => {
  it("converts to lowercase", () => {
    expect(normalizePath("About")).toBe("about");
    expect(normalizePath("HELLO")).toBe("hello");
  });

  it("removes leading and trailing slashes", () => {
    expect(normalizePath("/about/")).toBe("about");
    expect(normalizePath("///about///")).toBe("about");
  });

  it("collapses multiple slashes", () => {
    expect(normalizePath("about//contact")).toBe("about/contact");
    expect(normalizePath("a///b////c")).toBe("a/b/c");
  });

  it("trims whitespace", () => {
    expect(normalizePath("  about  ")).toBe("about");
  });

  it("handles combined transformations", () => {
    expect(normalizePath("  /About/Contact//  ")).toBe("about/contact");
  });

  it("returns empty string for root path", () => {
    expect(normalizePath("/")).toBe("");
    expect(normalizePath("///")).toBe("");
  });

  it("handles empty input", () => {
    expect(normalizePath("")).toBe("");
    expect(normalizePath("  ")).toBe("");
  });
});

describe("isFullUrl", () => {
  it("returns true for https URLs", () => {
    expect(isFullUrl("https://example.com")).toBe(true);
  });

  it("returns true for http URLs", () => {
    expect(isFullUrl("http://example.com")).toBe(true);
  });

  it("returns false for relative paths", () => {
    expect(isFullUrl("/about")).toBe(false);
    expect(isFullUrl("about")).toBe(false);
  });

  it("returns false for domain-only strings", () => {
    expect(isFullUrl("example.com")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isFullUrl("")).toBe(false);
  });

  it("returns false for other protocols", () => {
    expect(isFullUrl("ftp://example.com")).toBe(false);
    expect(isFullUrl("mailto:test@test.com")).toBe(false);
  });
});

describe("toSameSitePath", () => {
  it("returns the path for a same-host absolute URL", () => {
    expect(
      toSameSitePath("https://example.com/about", "https://example.com"),
    ).toBe("/about");
  });

  it("preserves query and hash", () => {
    expect(
      toSameSitePath(
        "https://example.com/about?x=1#top",
        "https://example.com",
      ),
    ).toBe("/about?x=1#top");
  });

  it("ignores scheme and port differences (same host)", () => {
    expect(
      toSameSitePath("https://example.com/about", "http://example.com:8787"),
    ).toBe("/about");
  });

  it("returns / for the bare same-host origin", () => {
    expect(toSameSitePath("https://example.com", "https://example.com")).toBe(
      "/",
    );
  });

  it("returns null for a different host", () => {
    expect(
      toSameSitePath("https://other.com/about", "https://example.com"),
    ).toBeNull();
  });

  it("returns null for relative paths", () => {
    expect(toSameSitePath("/about", "https://example.com")).toBeNull();
  });

  it("returns null when no site origin is configured", () => {
    expect(toSameSitePath("https://example.com/about", "")).toBeNull();
  });
});

describe("isSafeAbsoluteUrl", () => {
  it("accepts http and https URLs", () => {
    expect(isSafeAbsoluteUrl("https://example.com")).toBe(true);
    expect(isSafeAbsoluteUrl("http://example.com")).toBe(true);
  });

  it("accepts mailto URLs", () => {
    expect(isSafeAbsoluteUrl("mailto:test@example.com")).toBe(true);
  });

  it("rejects missing protocols", () => {
    expect(isSafeAbsoluteUrl("example.com")).toBe(false);
  });

  it("rejects relative paths", () => {
    expect(isSafeAbsoluteUrl("/about")).toBe(false);
  });

  it("rejects unsupported protocols", () => {
    expect(isSafeAbsoluteUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeAbsoluteUrl("ftp://example.com")).toBe(false);
  });
});

describe("URL sanitizers", () => {
  it("keeps action protocols scoped to rich-text links", () => {
    expect(sanitizeRichTextHref("tel:+15551234567")).toBe("tel:+15551234567");
    expect(sanitizeRichTextHref("sms:xxxxx@xx.com")).toBe("sms:xxxxx@xx.com");

    expect(sanitizeUrl("tel:+15551234567")).toBe("");
    expect(sanitizeUrl("sms:xxxxx@xx.com")).toBe("");
  });

  it("rejects executable protocols in every context", () => {
    expect(sanitizeRichTextHref("javascript:alert(1)")).toBe("");
    expect(sanitizeRichTextHref("data:text/html,<h1>Hi</h1>")).toBe("");
    expect(sanitizeUrl("javascript:alert(1)")).toBe("");
  });
});

describe("slugify", () => {
  it("converts text to lowercase hyphenated slug", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("removes special characters", () => {
    expect(slugify("Hello World! This is a Test.")).toBe(
      "hello-world-this-is-a-test",
    );
  });

  it("collapses multiple spaces", () => {
    expect(slugify("Multiple   Spaces")).toBe("multiple-spaces");
  });

  it("trims leading/trailing whitespace and hyphens", () => {
    expect(slugify("  Multiple   Spaces  ")).toBe("multiple-spaces");
  });

  it("replaces underscores with hyphens", () => {
    expect(slugify("hello_world")).toBe("hello-world");
  });

  it("handles already-slugified text", () => {
    expect(slugify("already-a-slug")).toBe("already-a-slug");
  });

  it("handles empty string", () => {
    expect(slugify("")).toBe("");
  });

  it("transliterates accented characters", () => {
    expect(slugify("café & résumé")).toBe("cafe-and-resume");
  });

  it("converts Chinese characters to pinyin", () => {
    expect(slugify("书评")).toBe("shu-ping");
  });

  it("handles mixed Chinese and English text", () => {
    expect(slugify("我的 Blog")).toBe("wo-de-blog");
  });

  it("handles CJK characters with spaces", () => {
    expect(slugify("电影 评论")).toBe("dian-ying-ping-lun");
  });

  it("romanizes Korean titles", () => {
    expect(slugify("안녕하세요 세계")).toBe("annyeonghaseyo-segye");
    expect(slugify("개발 일지 3일차")).toBe("gaebal-ilji-3ilcha");
  });

  it("romanizes kana-only Japanese titles", () => {
    expect(slugify("カタカナタイトル")).toBe("katakanataitoru");
    expect(slugify("ハンバーガー")).toBe("hanbaga");
  });

  it("keeps Latin words in mostly-kana Japanese titles", () => {
    expect(slugify("React入門ガイド")).toBe("react-gaido");
  });

  it("returns empty for kanji-heavy Japanese titles instead of garbling them", () => {
    // Kanji carries the meaning; without a reading dictionary any output
    // would be gibberish, so callers should fall back to a random ID.
    expect(slugify("日本語のタイトルです")).toBe("");
    expect(slugify("東京タワーに行った")).toBe("");
    expect(slugify("こんにちは世界")).toBe("");
  });

  it("returns empty for scripts with no usable transliteration", () => {
    expect(slugify("שלום עולם")).toBe("");
    expect(slugify("สวัสดีชาวโลก")).toBe("");
  });

  it("returns empty when most of the title is untransliterable", () => {
    expect(slugify("שלום world")).toBe("");
  });

  it("returns empty for emoji-only titles", () => {
    expect(slugify("🎉🎉")).toBe("");
  });
});

describe("stripSitePathPrefix", () => {
  it("rewrites prefixed asset paths into the internal asset namespace", () => {
    expect(stripSitePathPrefix("/blog/_assets/client.css", "/blog")).toBe(
      "/_assets/client.css",
    );
  });

  it("rejects paths outside the configured site prefix", () => {
    expect(stripSitePathPrefix("/_assets/client.css", "/blog")).toBe(null);
  });
});
