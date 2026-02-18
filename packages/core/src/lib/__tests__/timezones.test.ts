import { describe, it, expect } from "vitest";
import { TIMEZONES, mapIanaToTimezone } from "../timezones.js";

describe("TIMEZONES", () => {
  it("contains expected timezone entries", () => {
    expect(TIMEZONES.length).toBeGreaterThan(30);
    const utc = TIMEZONES.find((tz) => tz.value === "UTC");
    expect(utc).toBeDefined();
    expect(utc?.offset).toBe("+00:00");
  });

  it("each entry has required fields", () => {
    for (const tz of TIMEZONES) {
      expect(tz.value).toBeTruthy();
      expect(tz.label).toBeTruthy();
      expect(tz.offset).toBeTruthy();
      expect(tz.iana.length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate values", () => {
    const values = TIMEZONES.map((tz) => tz.value);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("mapIanaToTimezone", () => {
  it("maps Asia/Shanghai to Beijing", () => {
    expect(mapIanaToTimezone("Asia/Shanghai")).toBe("Beijing");
  });

  it("maps America/New_York to Eastern Time", () => {
    expect(mapIanaToTimezone("America/New_York")).toBe(
      "Eastern Time (US & Canada)",
    );
  });

  it("maps Europe/London to London", () => {
    expect(mapIanaToTimezone("Europe/London")).toBe("London");
  });

  it("maps Asia/Tokyo to Tokyo", () => {
    expect(mapIanaToTimezone("Asia/Tokyo")).toBe("Tokyo");
  });

  it("returns UTC for unknown timezone", () => {
    expect(mapIanaToTimezone("Unknown/Zone")).toBe("UTC");
  });

  it("returns UTC for empty string", () => {
    expect(mapIanaToTimezone("")).toBe("UTC");
  });

  it("maps Pacific/Honolulu to Hawaii", () => {
    expect(mapIanaToTimezone("Pacific/Honolulu")).toBe("Hawaii");
  });

  it("maps Australia/Sydney to Sydney", () => {
    expect(mapIanaToTimezone("Australia/Sydney")).toBe("Sydney");
  });
});
