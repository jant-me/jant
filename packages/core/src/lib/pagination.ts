/**
 * Pagination Utilities
 *
 * Pure utility functions for page-based pagination.
 */

/**
 * Computes which page numbers to display in a numbered pagination control.
 * Always includes: first page, last page, current page, and 1 page on each side of current.
 * Gaps between non-consecutive pages are represented by 0 (ellipsis marker).
 *
 * @param currentPage - The current active page (1-indexed)
 * @param totalPages - Total number of pages
 * @returns Array of page numbers, with 0 representing ellipsis gaps
 *
 * @example
 * ```ts
 * getPageNumbers(1, 5)    // [1, 2, 3, 4, 5]
 * getPageNumbers(1, 20)   // [1, 2, 0, 20]
 * getPageNumbers(10, 20)  // [1, 0, 9, 10, 11, 0, 20]
 * ```
 */
export function getPageNumbers(
  currentPage: number,
  totalPages: number,
): number[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const pages = new Set<number>();
  pages.add(1);
  pages.add(totalPages);
  pages.add(currentPage);
  if (currentPage > 1) pages.add(currentPage - 1);
  if (currentPage < totalPages) pages.add(currentPage + 1);

  const sorted = [...pages].sort((a, b) => a - b);

  // Insert 0 for gaps
  const result: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i] as number;
    if (i > 0 && current - (sorted[i - 1] as number) > 1) {
      result.push(0); // ellipsis marker
    }
    result.push(current);
  }

  return result;
}
