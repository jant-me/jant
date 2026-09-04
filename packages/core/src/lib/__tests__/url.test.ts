import { describe, it, expect } from "vitest";
import {
  extractDomain,
  extractDisplayDomain,
  isFullUrl,
  isSafeAbsoluteUrl,
  looksLikeAddress,
  normalizePath,
  sanitizeRichTextHref,
  sanitizeUrl,
  stripSitePathPrefix,
  toInternalPath,
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

describe("looksLikeAddress", () => {
  it("recognizes what a browser would have produced", () => {
    expect(looksLikeAddress("/about")).toBe(true);
    expect(looksLikeAddress("  https://example.com/about  ")).toBe(true);
  });

  it("leaves search words alone", () => {
    // The line that keeps a picker's search box a search box: "about" is a
    // word someone is looking for, not the page /about.
    expect(looksLikeAddress("about")).toBe(false);
    expect(looksLikeAddress("coffee notes")).toBe(false);
    expect(looksLikeAddress("example.com")).toBe(false);
  });
});

describe("toInternalPath", () => {
  const SITE = {
    siteOrigins: ["https://example.com"],
    sitePathPrefix: "/blog",
    languagePrefixes: ["zh-hans", "en"],
  };

  it("reads a path, a full URL, and a prefixed URL as the same page", () => {
    expect(toInternalPath("/about", SITE)).toBe("/about");
    expect(toInternalPath("about", SITE)).toBe("/about");
    expect(toInternalPath("https://example.com/blog/about", SITE)).toBe(
      "/about",
    );
    expect(toInternalPath("/blog/about", SITE)).toBe("/about");
    // A typed path without the deployment prefix still means this site.
    expect(toInternalPath("/about", SITE)).toBe("/about");
  });

  it("strips a language prefix, because a view is not another page", () => {
    expect(toInternalPath("/en/about", SITE)).toBe("/about");
    expect(toInternalPath("https://example.com/blog/zh-hans/about", SITE)).toBe(
      "/about",
    );
    // The prefix alone is that view's home.
    expect(toInternalPath("/en", SITE)).toBe("/");
  });

  it("keeps a first segment that only looks like a language", () => {
    // A single-language site is free to have a post at /en — nothing is
    // serving a view there.
    expect(toInternalPath("/en/about", { sitePathPrefix: "" })).toBe(
      "/en/about",
    );
  });

  it("matches any host the site answers on", () => {
    const origins = {
      siteOrigins: ["https://example.com", "https://alias.dev"],
    };
    expect(toInternalPath("https://alias.dev/about", origins)).toBe("/about");
    // Scheme and port differ in dev; the host is what decides.
    expect(toInternalPath("http://example.com:8787/about", origins)).toBe(
      "/about",
    );
  });

  it("refuses everything that is not a page on this site", () => {
    expect(toInternalPath("https://other.com/about", SITE)).toBeNull();
    expect(toInternalPath("mailto:hi@example.com", SITE)).toBeNull();
    expect(toInternalPath("tel:+15551234567", SITE)).toBeNull();
    expect(toInternalPath("//other.com/about", SITE)).toBeNull();
    expect(toInternalPath("#section", SITE)).toBeNull();
    expect(toInternalPath("   ", SITE)).toBeNull();
    // A full URL inside our host but outside the deployment.
    expect(
      toInternalPath("https://example.com/other-app/about", SITE),
    ).toBeNull();
  });

  it("drops the query unless the caller is navigating", () => {
    expect(toInternalPath("/about?ref=x#top", SITE)).toBe("/about");
    expect(
      toInternalPath("/about?ref=x#top", { ...SITE, keepQuery: true }),
    ).toBe("/about?ref=x#top");
  });

  it("normalizes trailing slashes and relative steps", () => {
    expect(toInternalPath("/about/", SITE)).toBe("/about");
    expect(toInternalPath("/collections/../about", SITE)).toBe("/about");
    expect(toInternalPath("/", SITE)).toBe("/");
  });
});
