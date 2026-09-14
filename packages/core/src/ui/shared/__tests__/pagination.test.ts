import { describe, it, expect } from "vitest";
import { getPageNumbers, parsePageNumber } from "../../../lib/pagination.js";

describe("getPageNumbers", () => {
  it("returns all pages when totalPages <= 7", () => {
    expect(getPageNumbers(1, 1)).toEqual([1]);
    expect(getPageNumbers(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(getPageNumbers(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("shows the first five pages near the start", () => {
    // Page 1 of 19: 1, 2, 3, 4, 5, ..., 19
    expect(getPageNumbers(1, 19)).toEqual([1, 2, 3, 4, 5, 0, 19]);
    expect(getPageNumbers(2, 19)).toEqual([1, 2, 3, 4, 5, 0, 19]);
    // Page 4 shows page 2 rather than an ellipsis standing in for it alone
    expect(getPageNumbers(4, 19)).toEqual([1, 2, 3, 4, 5, 0, 19]);
  });

  it("shows ellipsis on both sides for middle pages", () => {
    // Page 10 of 19: 1, ..., 9, 10, 11, ..., 19
    expect(getPageNumbers(5, 19)).toEqual([1, 0, 4, 5, 6, 0, 19]);
    expect(getPageNumbers(10, 19)).toEqual([1, 0, 9, 10, 11, 0, 19]);
    expect(getPageNumbers(15, 19)).toEqual([1, 0, 14, 15, 16, 0, 19]);
  });

  it("shows the last five pages near the end", () => {
    // Page 19 of 19: 1, ..., 15, 16, 17, 18, 19
    expect(getPageNumbers(16, 19)).toEqual([1, 0, 15, 16, 17, 18, 19]);
    expect(getPageNumbers(18, 19)).toEqual([1, 0, 15, 16, 17, 18, 19]);
    expect(getPageNumbers(19, 19)).toEqual([1, 0, 15, 16, 17, 18, 19]);
  });

  it("handles the smallest range that needs an ellipsis", () => {
    expect(getPageNumbers(4, 8)).toEqual([1, 2, 3, 4, 5, 0, 8]);
    expect(getPageNumbers(5, 8)).toEqual([1, 0, 4, 5, 6, 7, 8]);
  });

  it("keeps seven slots and never hides a single page behind an ellipsis", () => {
    for (const totalPages of [8, 9, 19, 120]) {
      for (let currentPage = 1; currentPage <= totalPages; currentPage++) {
        const pages = getPageNumbers(currentPage, totalPages);
        const shown = pages.filter((page) => page !== 0);

        expect(pages).toHaveLength(7);
        expect(shown[0]).toBe(1);
        expect(shown[shown.length - 1]).toBe(totalPages);
        expect(shown).toContain(currentPage);
        pages.forEach((page, i) => {
          const prev = pages[i - 1] ?? Number.NaN;
          if (page === 0) {
            const next = pages[i + 1] ?? Number.NaN;
            expect(next - prev).toBeGreaterThanOrEqual(3);
          } else if (i > 0 && prev !== 0) {
            expect(page).toBe(prev + 1);
          }
        });
      }
    }
  });
});

describe("parsePageNumber", () => {
  it("returns 1 when the page param is missing", () => {
    expect(parsePageNumber()).toBe(1);
  });

  it("clamps invalid values to 1", () => {
    expect(parsePageNumber("0")).toBe(1);
    expect(parsePageNumber("-5")).toBe(1);
    expect(parsePageNumber("abc")).toBe(1);
  });

  it("returns the parsed page number for valid values", () => {
    expect(parsePageNumber("2")).toBe(2);
    expect(parsePageNumber("10")).toBe(10);
  });
});
