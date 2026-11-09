import { describe, expect, it } from "vitest";
import {
  dayKeysEndingAt,
  formatDayKey,
  formatHourKey,
  hourKeysOfDay,
  isBotUserAgent,
  isHourKey,
  VIEW_INTERNAL_REFERRER,
  isDayKey,
  referrerHost,
  shiftDayKey,
  shouldCountView,
  VIEW_OVERFLOW_KEY,
  viewPageKind,
  viewPathKey,
  viewReferrer,
} from "../view-counting.js";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

/** A browser's top-level navigation, as every current engine sends it. */
function navigation(overrides: Record<string, string | null> = {}): Headers {
  const headers = new Headers({
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "cross-site",
    "user-agent": BROWSER_UA,
  });
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) headers.delete(name);
    else headers.set(name, value);
  }
  return headers;
}

function candidate(
  overrides: Partial<Parameters<typeof shouldCountView>[0]> = {},
) {
  return {
    method: "GET",
    status: 200,
    contentType: "text/html; charset=UTF-8",
    isAuthenticated: false,
    headers: navigation(),
    ...overrides,
  };
}

describe("shouldCountView", () => {
  it("counts a reader's navigation to an HTML page", () => {
    expect(shouldCountView(candidate())).toBe(true);
  });

  it("counts nothing but a successful GET of HTML", () => {
    expect(shouldCountView(candidate({ method: "HEAD" }))).toBe(false);
    expect(shouldCountView(candidate({ method: "POST" }))).toBe(false);
    expect(shouldCountView(candidate({ status: 404 }))).toBe(false);
    expect(shouldCountView(candidate({ status: 301 }))).toBe(false);
    expect(
      shouldCountView(candidate({ contentType: "application/atom+xml" })),
    ).toBe(false);
    expect(shouldCountView(candidate({ contentType: null }))).toBe(false);
  });

  it("never counts the signed-in author", () => {
    expect(shouldCountView(candidate({ isAuthenticated: true }))).toBe(false);
  });

  // The whole reason the Sec-Fetch headers are required: curl, HTTP libraries
  // and most crawlers send neither, and a browser's navigation sends both.
  it("requires a top-level navigation's Sec-Fetch headers", () => {
    expect(
      shouldCountView(
        candidate({ headers: navigation({ "sec-fetch-dest": null }) }),
      ),
    ).toBe(false);
    expect(
      shouldCountView(
        candidate({ headers: navigation({ "sec-fetch-mode": "cors" }) }),
      ),
    ).toBe(false);
    expect(
      shouldCountView(
        candidate({ headers: navigation({ "sec-fetch-dest": "iframe" }) }),
      ),
    ).toBe(false);
  });

  it("skips speculative loads", () => {
    for (const hint of [
      { "sec-purpose": "prefetch" },
      { "sec-purpose": "prefetch;prerender" },
      { purpose: "prefetch" },
      { "x-purpose": "preview" },
      { "x-moz": "prefetch" },
    ]) {
      expect(
        shouldCountView(candidate({ headers: navigation(hint) })),
        JSON.stringify(hint),
      ).toBe(false);
    }
  });

  it("skips a machine that says what it is", () => {
    expect(
      shouldCountView(
        candidate({
          headers: navigation({
            "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)",
          }),
        }),
      ),
    ).toBe(false);
    expect(
      shouldCountView(
        candidate({ headers: navigation({ "user-agent": null }) }),
      ),
    ).toBe(false);
  });
});

describe("isBotUserAgent", () => {
  it("names the machines a navigation check lets through", () => {
    for (const ua of [
      "Mozilla/5.0 (compatible; bingbot/2.0)",
      "HeadlessChrome/120.0",
      "python-requests/2.31",
      "curl/8.4.0",
      "Feedly/1.0",
      "facebookexternalhit/1.1",
      "",
    ]) {
      expect(isBotUserAgent(ua), ua).toBe(true);
    }
  });

  it("lets browsers through", () => {
    for (const ua of [
      BROWSER_UA,
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
    ]) {
      expect(isBotUserAgent(ua), ua).toBe(false);
    }
  });
});

describe("referrerHost", () => {
  it("keeps the host alone, lowercased, without www", () => {
    expect(
      referrerHost("https://www.Example.com/some/post?utm=1", "blog.example"),
    ).toBe("example.com");
    expect(referrerHost("https://news.ycombinator.com/", "blog.example")).toBe(
      "news.ycombinator.com",
    );
  });

  it("is direct for no referrer or a non-web scheme, and the site's own for its own host", () => {
    expect(referrerHost(null, "blog.example")).toBe("");
    expect(referrerHost("", "blog.example")).toBe("");
    expect(referrerHost("https://blog.example/other", "blog.example")).toBe(
      VIEW_INTERNAL_REFERRER,
    );
    expect(referrerHost("https://www.blog.example/", "blog.example")).toBe(
      VIEW_INTERNAL_REFERRER,
    );
    expect(referrerHost("https://blog.example/", "www.blog.example")).toBe(
      VIEW_INTERNAL_REFERRER,
    );
    expect(referrerHost("ftp://files.example/", "blog.example")).toBe("");
    expect(referrerHost("not a url", "blog.example")).toBe("");
  });

  it("folds a host to the address its source is listed under", () => {
    expect(referrerHost("https://old.reddit.com/r/blogs", "blog.example")).toBe(
      "reddit.com",
    );
    expect(referrerHost("https://t.co/abc", "blog.example")).toBe("x.com");
    expect(referrerHost("https://www.google.co.uk/", "blog.example")).toBe(
      "google.com",
    );
    expect(referrerHost("https://mail.google.com/mail/", "blog.example")).toBe(
      "mail.google.com",
    );
  });

  it("names the Android app a link was opened from", () => {
    expect(
      referrerHost(
        "android-app://com.google.android.googlequicksearchbox/",
        "blog.example",
      ),
    ).toBe("google.com");
    expect(referrerHost("android-app://com.example.app/", "blog.example")).toBe(
      "com.example.app",
    );
    expect(referrerHost("android-app://", "blog.example")).toBe("");
  });
});

describe("viewReferrer", () => {
  const ownHost = "blog.example";
  const at = (query: string) => `https://blog.example/some-post${query}`;
  const hn = "https://news.ycombinator.com/";

  it("files a tagged link under its tag, whatever the browser reports", () => {
    expect(
      viewReferrer({
        referer: null,
        requestUrl: at("?utm_source=chatgpt.com"),
        ownHost,
      }),
    ).toBe("chatgpt.com");
    expect(
      viewReferrer({
        referer: "https://t.co/abc",
        requestUrl: at("?ref=newsletter"),
        ownHost,
      }),
    ).toBe("newsletter");
    // utm_source is tried before ref.
    expect(
      viewReferrer({
        referer: null,
        requestUrl: at("?ref=second&utm_source=first"),
        ownHost,
      }),
    ).toBe("first");
  });

  it("normalizes a tag the way it normalizes a host", () => {
    expect(
      viewReferrer({
        referer: null,
        requestUrl: at("?utm_source=WWW.ChatGPT.com."),
        ownHost,
      }),
    ).toBe("chatgpt.com");
    expect(
      viewReferrer({
        referer: null,
        requestUrl: at("?utm_source=%20Hacker_News%20"),
        ownHost,
      }),
    ).toBe("hacker_news");
  });

  it("ignores a tag that is not a name and falls back to the referrer", () => {
    for (const value of [
      "Product%20Hunt",
      "a%2Fb",
      "%3Cb%3Ex",
      "a".repeat(64),
      "",
    ]) {
      expect(
        viewReferrer({
          referer: hn,
          requestUrl: at(`?utm_source=${value}`),
          ownHost,
        }),
      ).toBe("news.ycombinator.com");
    }
    expect(
      viewReferrer({
        referer: null,
        requestUrl: at("?utm_source=Product%20Hunt"),
        ownHost,
      }),
    ).toBe("");
  });

  it("treats a tag naming the site itself as direct", () => {
    expect(
      viewReferrer({
        referer: hn,
        requestUrl: at("?utm_source=www.blog.example"),
        ownHost,
      }),
    ).toBe("");
  });

  it("uses the referrer host when the link carries no tag", () => {
    expect(viewReferrer({ referer: hn, requestUrl: at(""), ownHost })).toBe(
      "news.ycombinator.com",
    );
    expect(
      viewReferrer({ referer: null, requestUrl: at("?page=2"), ownHost }),
    ).toBe("");
  });

  it("files a view from the site itself as internal, by Referer or by Sec-Fetch-Site", () => {
    expect(
      viewReferrer({
        referer: "https://blog.example/",
        requestUrl: at(""),
        ownHost,
      }),
    ).toBe(VIEW_INTERNAL_REFERRER);
    for (const fetchSite of ["same-origin", "same-site"]) {
      expect(
        viewReferrer({ referer: null, requestUrl: at(""), ownHost, fetchSite }),
      ).toBe(VIEW_INTERNAL_REFERRER);
    }
    // Another site that withholds its Referer is not the site itself, and
    // neither is a typed address.
    for (const fetchSite of ["cross-site", "none", null, undefined]) {
      expect(
        viewReferrer({ referer: null, requestUrl: at(""), ownHost, fetchSite }),
      ).toBe("");
    }
    // A tag still wins over the site's own Referer.
    expect(
      viewReferrer({
        referer: "https://blog.example/",
        requestUrl: at("?ref=newsletter"),
        ownHost,
      }),
    ).toBe("newsletter");
  });

  it("folds a tag the way it folds a host", () => {
    expect(
      viewReferrer({
        referer: hn,
        requestUrl: at("?utm_source=twitter"),
        ownHost,
      }),
    ).toBe("x.com");
    expect(
      viewReferrer({ referer: null, requestUrl: at("?ref=t.co"), ownHost }),
    ).toBe("x.com");
    expect(
      viewReferrer({
        referer: null,
        requestUrl: at("?utm_source=ig"),
        ownHost,
      }),
    ).toBe("instagram.com");
    expect(
      viewReferrer({
        referer: null,
        requestUrl: at("?ref=newsletter"),
        ownHost,
      }),
    ).toBe("newsletter");
  });
});

describe("viewPathKey", () => {
  it("drops the language view prefix and trailing slashes", () => {
    expect(viewPathKey("/", "")).toBe("/");
    expect(viewPathKey("/archive/", "")).toBe("/archive");
    expect(viewPathKey("/en", "/en")).toBe("/");
    expect(viewPathKey("/en/archive", "/en")).toBe("/archive");
    expect(viewPathKey("/english", "/en")).toBe("/english");
  });
});

describe("day keys", () => {
  it("files a moment under the site's own calendar day", () => {
    // 2026-11-08T20:00:00Z is already the 9th in Shanghai.
    const timestamp = Date.UTC(2026, 10, 8, 20) / 1000;
    expect(formatDayKey(timestamp, "UTC")).toBe("2026-11-08");
    expect(formatDayKey(timestamp, "Asia/Shanghai")).toBe("2026-11-09");
    expect(formatDayKey(timestamp, "America/Los_Angeles")).toBe("2026-11-08");
  });

  it("falls back to UTC for a time zone it does not know", () => {
    const timestamp = Date.UTC(2026, 10, 8, 20) / 1000;
    expect(formatDayKey(timestamp, "Mars/Olympus")).toBe("2026-11-08");
  });

  it("moves across month and year ends", () => {
    expect(shiftDayKey("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDayKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDayKey("2026-11-08", -29)).toBe("2026-10-10");
  });

  it("lists a window oldest first, the last day included", () => {
    expect(dayKeysEndingAt("2026-11-08", 3)).toEqual([
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
    ]);
  });

  it("recognizes its own format", () => {
    expect(isDayKey("2026-11-08")).toBe(true);
    expect(isDayKey("2026-11-8")).toBe(false);
    expect(isDayKey("yesterday")).toBe(false);
  });
});

describe("viewPageKind", () => {
  it("tells a key's kind from its shape", () => {
    expect(viewPageKind("/")).toBe("path");
    expect(viewPageKind("/collections/a+b")).toBe("path");
    expect(viewPageKind("pst_01h455vb4pex5vsknk084sn02q")).toBe("post");
    expect(viewPageKind("col_01h455vb4pex5vsknk084sn02q")).toBe("collection");
    expect(viewPageKind("smc_01h455vb4pex5vsknk084sn02q")).toBe(
      "smartCollection",
    );
    expect(viewPageKind(VIEW_OVERFLOW_KEY)).toBe("overflow");
  });

  it("knows no other shape", () => {
    expect(viewPageKind("nonsense")).toBeNull();
    expect(viewPageKind("med_01h455vb4pex5vsknk084sn02q")).toBeNull();
    expect(viewPageKind("pst_not-an-id")).toBeNull();
    expect(viewPageKind("")).toBeNull();
  });
});

describe("hour keys", () => {
  it("names the hour a moment falls in, in the site's zone", () => {
    // 2025-11-08T00:00:00Z.
    expect(formatHourKey(1_762_560_000, "UTC")).toBe("2025-11-08T00");
    expect(formatHourKey(1_762_560_000, "Asia/Shanghai")).toBe("2025-11-08T08");
    expect(formatHourKey(1_762_560_000, "America/Los_Angeles")).toBe(
      "2025-11-07T16",
    );
    // An unknown zone falls back to UTC rather than failing a view.
    expect(formatHourKey(1_762_560_000, "Nowhere/Nope")).toBe("2025-11-08T00");
  });

  it("lists a day's 24 hours in order", () => {
    const hours = hourKeysOfDay("2026-11-09");
    expect(hours).toHaveLength(24);
    expect(hours[0]).toBe("2026-11-09T00");
    expect(hours[23]).toBe("2026-11-09T23");
    expect(isHourKey("2026-11-09T14")).toBe(true);
    expect(isHourKey("2026-11-09")).toBe(false);
  });
});
