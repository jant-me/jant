/**
 * Time Utilities
 */

/**
 * Gets the current Unix timestamp in seconds.
 *
 * Returns the number of seconds since the Unix epoch (January 1, 1970 00:00:00 UTC).
 * This is the standard time format used throughout the application for consistency
 * and database storage.
 *
 * @returns Current Unix timestamp in seconds (not milliseconds)
 *
 * @example
 * ```ts
 * const timestamp = now();
 * // Returns: 1706745600 (example value for Feb 1, 2024)
 * ```
 */
export function now(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * One month in seconds
 */
const ONE_MONTH = 30 * 24 * 60 * 60;

/**
 * Checks if a Unix timestamp is within the last 30 days.
 *
 * Compares the given timestamp to the current time to determine if it falls within
 * the last month (defined as 30 days). Useful for highlighting recent posts or
 * filtering time-sensitive content.
 *
 * @param timestamp - Unix timestamp in seconds to check
 * @returns `true` if the timestamp is within the last 30 days, `false` otherwise
 *
 * @example
 * ```ts
 * const recentPost = 1706745600;  // Recent timestamp
 * if (isWithinMonth(recentPost)) {
 *   // Show "new" badge
 * }
 * ```
 */
export function isWithinMonth(timestamp: number): boolean {
  return now() - timestamp < ONE_MONTH;
}

/**
 * Converts a Unix timestamp to an ISO 8601 date-time string.
 *
 * Formats a Unix timestamp (in seconds) as an ISO 8601 string suitable for HTML
 * `datetime` attributes and API responses. The output includes full date, time,
 * and timezone information in UTC.
 *
 * @param timestamp - Unix timestamp in seconds to convert
 * @returns ISO 8601 formatted string (e.g., "2024-02-01T12:00:00.000Z")
 *
 * @example
 * ```ts
 * const isoDate = toISOString(1706745600);
 * // Returns: "2024-02-01T00:00:00.000Z"
 * ```
 */
export function toISOString(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}

/**
 * Formats a Unix timestamp as a human-readable date string.
 *
 * Converts a Unix timestamp (in seconds) to a localized date string in the format
 * "MMM DD, YYYY" (e.g., "Jan 15, 2024"). Always uses UTC timezone to ensure
 * consistent display regardless of server or client location.
 *
 * @param timestamp - Unix timestamp in seconds to format
 * @returns Formatted date string in "MMM DD, YYYY" format
 *
 * @example
 * ```ts
 * const readable = formatDate(1706745600);
 * // Returns: "Feb 1, 2024"
 * ```
 */
export function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Formats a Unix timestamp as a year-month string for grouping.
 *
 * Converts a Unix timestamp (in seconds) to a "YYYY-MM" format string, useful for
 * grouping posts by month in archives or creating month-based URLs. Always uses
 * UTC timezone for consistency.
 *
 * @param timestamp - Unix timestamp in seconds to format
 * @returns Year-month string in "YYYY-MM" format
 *
 * @example
 * ```ts
 * const yearMonth = formatYearMonth(1706745600);
 * // Returns: "2024-02"
 * ```
 */
export function formatYearMonth(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}
