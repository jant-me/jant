import { describe, it, expect, vi, afterEach } from "vitest";
import {
  now,
  isWithinMonth,
  toISOString,
  formatDate,
  formatTime,
  formatRelativeTime,
  formatRelativeAge,
  formatYearMonth,
  startOfMonthIn,
  calendarPeriodsIn,
} from "../time.js";

describe("now", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns current time in seconds", () => {
    const before = Math.floor(Date.now() / 1000);
    const result = now();
    const after = Math.floor(Date.now() / 1000);
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });

  it("returns an integer (not milliseconds)", () => {
    const result = now();
    expect(Number.isInteger(result)).toBe(true);
    // Should be in seconds, not milliseconds (less than 10 billion)
    expect(result).toBeLessThan(10_000_000_000);
  });
});

describe("isWithinMonth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true for a timestamp within the last 30 days", () => {
    const recent = now() - 60 * 60; // 1 hour ago
    expect(isWithinMonth(recent)).toBe(true);
  });

  it("returns true for current timestamp", () => {
    expect(isWithinMonth(now())).toBe(true);
  });

  it("returns false for a timestamp older than 30 days", () => {
    const old = now() - 31 * 24 * 60 * 60; // 31 days ago
    expect(isWithinMonth(old)).toBe(false);
  });

  it("returns false for timestamp exactly at 30-day boundary", () => {
    // 30 days = 2592000 seconds
    const boundary = now() - 30 * 24 * 60 * 60;
    expect(isWithinMonth(boundary)).toBe(false);
  });

  it("returns true for timestamp just under 30 days", () => {
    const justUnder = now() - (30 * 24 * 60 * 60 - 1);
    expect(isWithinMonth(justUnder)).toBe(true);
  });
});

describe("toISOString", () => {
  it("converts Unix timestamp to ISO string", () => {
    // Feb 1, 2024 00:00:00 UTC
    expect(toISOString(1706745600)).toBe("2024-02-01T00:00:00.000Z");
  });

  it("converts epoch 0", () => {
    expect(toISOString(0)).toBe("1970-01-01T00:00:00.000Z");
  });

  it("handles timestamps with time components", () => {
    // 2024-01-15T12:30:00Z = 1705321800
    expect(toISOString(1705321800)).toBe("2024-01-15T12:30:00.000Z");
  });
});

describe("formatDate", () => {
  it("formats as MMM DD, YYYY", () => {
    expect(formatDate(1706745600)).toBe("Feb 1, 2024");
  });

  it("formats epoch start", () => {
    expect(formatDate(0)).toBe("Jan 1, 1970");
  });

  it("uses UTC timezone consistently", () => {
    // Dec 31, 2023 23:59:59 UTC
    const timestamp = 1704067199;
    expect(formatDate(timestamp)).toBe("Dec 31, 2023");
  });

  it("supports formatting in a configured site timezone", () => {
    // 2024-02-01T00:30:00Z
    const timestamp = 1706747400;
    expect(formatDate(timestamp, "America/New_York")).toBe("Jan 31, 2024");
  });
});

describe("formatTime", () => {
  it("formats as HH:MM in 24-hour format", () => {
    // 2024-01-15T12:30:00Z = 1705321800
    expect(formatTime(1705321800)).toBe("12:30");
  });

  it("zero-pads hours and minutes", () => {
    // 2024-02-01T00:00:00Z = 1706745600
    expect(formatTime(1706745600)).toBe("00:00");
  });

  it("formats evening time correctly", () => {
    // 2024-02-01T23:05:00Z = 1706828700
    expect(formatTime(1706828700)).toBe("23:05");
  });

  it("formats single-digit hour with padding", () => {
    // 2024-02-01T09:07:00Z = 1706778420
    expect(formatTime(1706778420)).toBe("09:07");
  });

  it("supports formatting in a configured site timezone", () => {
    // 2024-02-01T00:30:00Z
    const timestamp = 1706747400;
    expect(formatTime(timestamp, "America/New_York")).toBe("19:30");
  });
});

describe("formatRelativeTime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns '1m' for timestamps less than 60 seconds ago", () => {
    expect(formatRelativeTime(now() - 10)).toBe("1m");
    expect(formatRelativeTime(now() - 59)).toBe("1m");
  });

  it("returns minutes for timestamps under 1 hour", () => {
    expect(formatRelativeTime(now() - 60)).toBe("1m");
    expect(formatRelativeTime(now() - 300)).toBe("5m");
    expect(formatRelativeTime(now() - 3540)).toBe("59m");
  });

  it("returns hours for timestamps under 24 hours", () => {
    expect(formatRelativeTime(now() - 3600)).toBe("1h");
    expect(formatRelativeTime(now() - 7200)).toBe("2h");
    expect(formatRelativeTime(now() - 82800)).toBe("23h");
  });

  it("returns days for timestamps up to 7 days", () => {
    expect(formatRelativeTime(now() - 86400)).toBe("1d");
    expect(formatRelativeTime(now() - 3 * 86400)).toBe("3d");
    expect(formatRelativeTime(now() - 7 * 86400)).toBe("7d");
  });

  it("returns 'MMM D' for timestamps older than 7 days", () => {
    // Use a fixed timestamp to get a predictable date
    // Feb 1, 2024 00:00:00 UTC
    const feb1 = 1706745600;
    // Mock now() to return Feb 16, 2024
    vi.spyOn(Date, "now").mockReturnValue((feb1 + 15 * 86400) * 1000);
    expect(formatRelativeTime(feb1)).toBe("Feb 1");
  });

  it("uses the configured timezone for older calendar labels", () => {
    // 2024-02-01T00:30:00Z
    const timestamp = 1706747400;
    vi.spyOn(Date, "now").mockReturnValue((timestamp + 15 * 86400) * 1000);
    expect(formatRelativeTime(timestamp, "America/New_York")).toBe("Jan 31");
  });
});

describe("formatRelativeAge", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("adds 'ago' to recent compact labels", () => {
    expect(formatRelativeAge(now() - 60)).toBe("1m ago");
    expect(formatRelativeAge(now() - 3600)).toBe("1h ago");
    expect(formatRelativeAge(now() - 3 * 86400)).toBe("3d ago");
  });

  it("keeps calendar labels for older timestamps", () => {
    const feb1 = 1706745600;
    vi.spyOn(Date, "now").mockReturnValue((feb1 + 15 * 86400) * 1000);
    expect(formatRelativeAge(feb1)).toBe("Feb 1");
  });
});

describe("formatYearMonth", () => {
  it("formats as YYYY-MM", () => {
    expect(formatYearMonth(1706745600)).toBe("2024-02");
  });

  it("zero-pads single-digit months", () => {
    // Jan 15, 2024
    expect(formatYearMonth(1705276800)).toBe("2024-01");
  });

  it("handles December correctly", () => {
    // Dec 15, 2023
    expect(formatYearMonth(1702598400)).toBe("2023-12");
  });

  it("formats epoch start", () => {
    expect(formatYearMonth(0)).toBe("1970-01");
  });

  it("supports formatting in a configured site timezone", () => {
    // 2024-02-01T00:30:00Z
    const timestamp = 1706747400;
    expect(formatYearMonth(timestamp, "America/New_York")).toBe("2024-01");
  });
});

describe("startOfMonthIn", () => {
  it("starts a year at local midnight in a zone ahead of UTC", () => {
    // 2024-12-31T16:00:00Z
    expect(startOfMonthIn(2025, 1, "Asia/Shanghai")).toBe(1735660800);
  });

  it("uses the offset in force at the boundary, across daylight saving", () => {
    // EST in January, EDT by April
    expect(startOfMonthIn(2024, 1, "America/New_York")).toBe(1704085200);
    expect(startOfMonthIn(2024, 4, "America/New_York")).toBe(1711944000);
    // Summer time on New Year's Day in the southern hemisphere
    expect(startOfMonthIn(2024, 1, "Pacific/Auckland")).toBe(1704020400);
  });

  it("handles offsets that aren't whole hours", () => {
    expect(startOfMonthIn(2024, 1, "Asia/Kathmandu")).toBe(1704046500);
  });

  it("reads month 13 as January of the next year", () => {
    expect(startOfMonthIn(2024, 13, "UTC")).toBe(
      startOfMonthIn(2025, 1, "UTC"),
    );
  });
});

describe("calendarPeriodsIn", () => {
  // 2024-12-31T17:00:00Z, already 2025 in Shanghai
  const newYearInShanghai = 1735664400;

  it("covers a span with the zone's calendar years", () => {
    expect(
      calendarPeriodsIn(1704067200, newYearInShanghai, "year", "Asia/Shanghai"),
    ).toEqual([
      { key: "2024", start: startOfMonthIn(2024, 1, "Asia/Shanghai") },
      { key: "2025", start: 1735660800 },
    ]);
    expect(
      calendarPeriodsIn(1704067200, newYearInShanghai, "year", "UTC").map(
        (period) => period.key,
      ),
    ).toEqual(["2024"]);
  });

  it("covers a span with every month between, across a year", () => {
    const keys = calendarPeriodsIn(
      startOfMonthIn(2024, 11, "UTC"),
      startOfMonthIn(2025, 2, "UTC"),
      "month",
      "UTC",
    ).map((period) => period.key);
    expect(keys).toEqual(["2024-11", "2024-12", "2025-01", "2025-02"]);
  });
});
