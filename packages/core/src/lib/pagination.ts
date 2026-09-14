/**
 * Pagination Utilities
 *
 * Pure utility functions for page-based pagination.
 */

/**
 * Parses a page query param into a safe 1-indexed page number.
 *
 * Invalid, missing, or non-positive values fall back to page 1.
 *
 * @param pageParam - Raw page query value
 * @returns Safe page number
 */
export function parsePageNumber(pageParam?: string): number {
  if (!pageParam) {
    return 1;
  }

  return Math.max(1, parseInt(pageParam, 10) || 1);
}

/**
 * Formats a human-readable page label for paginated views.
 *
 * @param currentPage - Current 1-indexed page number
 * @param totalPages - Optional total page count
 * @returns Page label like "Page 2" or "Page 2 of 5"
 */
export function formatPageLabel(
  currentPage: number,
  totalPages?: number,
): string {
  if (totalPages && totalPages > 1) {
    return `Page ${String(currentPage)} of ${String(totalPages)}`;
  }

  return `Page ${String(currentPage)}`;
}

/** Slots a numbered pagination control fills once there are more pages. */
const PAGE_SLOT_COUNT = 7;

/**
 * Computes which page numbers to display in a numbered pagination control.
 *
 * Seven or fewer pages are all shown. Past that, the control always fills
 * exactly seven slots — the first page, the last page, and a three-page
 * window around the current page — so it keeps the same width, and the
 * Previous/Next links stay put, as the reader moves through pages. Skipped
 * pages are represented by 0 (ellipsis marker). An ellipsis always stands in
 * for at least two pages; where it would hide just one, that page is shown.
 *
 * @param currentPage - The current active page (1-indexed)
 * @param totalPages - Total number of pages
 * @returns Array of page numbers, with 0 representing ellipsis gaps
 *
 * @example
 * ```ts
 * getPageNumbers(1, 5)    // [1, 2, 3, 4, 5]
 * getPageNumbers(1, 19)   // [1, 2, 3, 4, 5, 0, 19]
 * getPageNumbers(10, 19)  // [1, 0, 9, 10, 11, 0, 19]
 * getPageNumbers(19, 19)  // [1, 0, 15, 16, 17, 18, 19]
 * ```
 */
export function getPageNumbers(
  currentPage: number,
  totalPages: number,
): number[] {
  if (totalPages <= PAGE_SLOT_COUNT) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  // The second slot holds page 2 or an ellipsis, and the second-to-last slot
  // holds page totalPages - 1 or an ellipsis, so the window around the current
  // page starts no earlier than page 3 and ends no later than totalPages - 2.
  const windowStart = Math.min(Math.max(currentPage - 1, 3), totalPages - 4);
  const windowEnd = windowStart + 2;

  return [
    1,
    windowStart === 3 ? 2 : 0,
    windowStart,
    windowStart + 1,
    windowEnd,
    windowEnd === totalPages - 2 ? totalPages - 1 : 0,
    totalPages,
  ];
}
