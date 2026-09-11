import { describe, expect, it } from "vitest";
import {
  FEED_LIMIT_MAX,
  getFeedEntryUpdatedAt,
  getRssPublishedBefore,
  parseFeedLimit,
} from "../feed-policy.js";

describe("parseFeedLimit", () => {
  it("keeps the site's length when the parameter is absent", () => {
    expect(parseFeedLimit(undefined, 50)).toBe(50);
  });

  it("honours a request above or below the site's length", () => {
    expect(parseFeedLimit("200", 50)).toBe(200);
    expect(parseFeedLimit("5", 50)).toBe(5);
    expect(parseFeedLimit("050", 50)).toBe(50);
  });

  it("gives the most there is to a request past the ceiling", () => {
    expect(parseFeedLimit(String(FEED_LIMIT_MAX), 50)).toBe(FEED_LIMIT_MAX);
    expect(parseFeedLimit(String(FEED_LIMIT_MAX + 1), 50)).toBe(FEED_LIMIT_MAX);
    expect(parseFeedLimit("99999999999999999999", 50)).toBe(FEED_LIMIT_MAX);
  });

  it("ignores anything that is not a positive whole number", () => {
    for (const raw of ["", "0", "-3", "1.5", "abc", "10abc", " 10", "1e3"]) {
      expect(parseFeedLimit(raw, 50)).toBe(50);
    }
  });
});

describe("feed policy", () => {
  it("makes the exact delay boundary eligible", () => {
    expect(getRssPublishedBefore(300, 1_000)).toBe(701);
    expect(getRssPublishedBefore(0, 1_000)).toBe(1_001);
  });

  it("uses the latest eligible content or membership update", () => {
    expect(
      getFeedEntryUpdatedAt(
        { publishedAt: 100, updatedAt: 100 },
        [
          { publishedAt: 100, updatedAt: 100 },
          { publishedAt: 300, updatedAt: 250 },
        ],
        [200, 400],
      ),
    ).toBe("1970-01-01T00:06:40.000Z");
  });
});
