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
 * "MMM DD, YYYY" (e.g., "Jan 15, 2024"). Uses the provided timezone and defaults
 * to UTC when no explicit timezone is given.
 *
 * @param timestamp - Unix timestamp in seconds to format
 * @param timeZone - IANA timezone identifier used for display
 * @returns Formatted date string in "MMM DD, YYYY" format
 *
 * @example
 * ```ts
 * const readable = formatDate(1706745600);
 * // Returns: "Feb 1, 2024"
 * ```
 */
export function formatDate(timestamp: number, timeZone = "UTC"): string {
  return new Date(timestamp * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone,
  });
}

/**
 * Formats a Unix timestamp as a year-month string for grouping.
 *
 * Converts a Unix timestamp (in seconds) to a "YYYY-MM" format string, useful for
 * grouping posts by month in archives or creating month-based URLs. Uses the
 * provided timezone and defaults to UTC when no explicit timezone is given.
 *
 * @param timestamp - Unix timestamp in seconds to format
 * @param timeZone - IANA timezone identifier used for display
 * @returns Year-month string in "YYYY-MM" format
 *
 * @example
 * ```ts
 * const yearMonth = formatYearMonth(1706745600);
 * // Returns: "2024-02"
 * ```
 */
/**
 * Formats a Unix timestamp as a 24-hour time string (HH:MM).
 *
 * Converts a Unix timestamp (in seconds) to a zero-padded time string in
 * 24-hour format. Uses the provided timezone and defaults to UTC when no
 * explicit timezone is given.
 *
 * @param timestamp - Unix timestamp in seconds to format
 * @param timeZone - IANA timezone identifier used for display
 * @returns Formatted time string in "HH:MM" format
 *
 * @example
 * ```ts
 * const time = formatTime(1706745600);
 * // Returns: "00:00"
 * ```
 */
export function formatTime(timestamp: number, timeZone = "UTC"): string {
  const date = new Date(timestamp * 1000);
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).formatToParts(date);
  const hours = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minutes = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hours}:${minutes}`;
}

/**
 * Formats a Unix timestamp as a short relative time string.
 *
 * Returns compact labels like "1m", "5h", "3d" for recent timestamps,
 * and falls back to "MMM D" (e.g. "Feb 1") for anything older than 7 days.
 *
 * @param timestamp - Unix timestamp in seconds
 * @param timeZone - IANA timezone identifier used for older calendar labels
 * @returns Short relative time string
 *
 * @example
 * ```ts
 * // Assuming current time is Feb 16, 2026
 * formatRelativeTime(now() - 30);       // "1m"  (30 seconds → rounds up)
 * formatRelativeTime(now() - 3600);     // "1h"
 * formatRelativeTime(now() - 86400);    // "1d"
 * formatRelativeTime(now() - 604800);   // "7d"
 * formatRelativeTime(now() - 864000);   // "Feb 6"
 * ```
 */
export function formatRelativeTime(
  timestamp: number,
  timeZone = "UTC",
): string {
  const seconds = now() - timestamp;

  if (seconds < 60) return "1m";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(seconds / 3600);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(seconds / 86400);
  if (days <= 7) return `${days}d`;

  // Older than 7 days: show "MMM D" (e.g. "Feb 1")
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone,
  });
}

/**
 * Formats a Unix timestamp as a compact English relative age label.
 *
 * Returns labels like "1m ago", "5h ago", "3d ago" for recent timestamps,
 * and falls back to "MMM D" (e.g. "Feb 1") for anything older than 7 days.
 * This helper intentionally stays English-only for ultra-compact UI metadata.
 *
 * @param timestamp - Unix timestamp in seconds
 * @param timeZone - IANA timezone identifier used for older calendar labels
 * @returns Compact relative age label
 *
 * @example
 * ```ts
 * // Assuming current time is Feb 16, 2026
 * formatRelativeAge(now() - 60);      // "1m ago"
 * formatRelativeAge(now() - 3600);    // "1h ago"
 * formatRelativeAge(now() - 86400);   // "1d ago"
 * formatRelativeAge(now() - 864000);  // "Feb 6"
 * ```
 */
export function formatRelativeAge(timestamp: number, timeZone = "UTC"): string {
  const relative = formatRelativeTime(timestamp, timeZone);
  return /^[0-9]+[mhd]$/.test(relative) ? `${relative} ago` : relative;
}

export function formatYearMonth(timestamp: number, timeZone = "UTC"): string {
  const date = new Date(timestamp * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    timeZone,
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  return `${year}-${month}`;
}

/**
 * Formats a "YYYY-MM" grouping key as a readable month label.
 *
 * The label is always en-US, matching the archive's other month copy — the
 * grid header and the list marker read from this one function so their labels
 * cannot drift apart.
 *
 * @param yearMonth - Year-month string in "YYYY-MM" format
 * @returns Month label such as "February 2024", or null when the key is malformed
 *
 * @example
 * ```ts
 * const label = formatYearMonthLabel("2024-02");
 * // Returns: "February 2024"
 * ```
 */
export function formatYearMonthLabel(yearMonth: string): string | null {
  const [year, month] = yearMonth.split("-");
  if (!year || !month) return null;

  const yearNumber = parseInt(year, 10);
  const monthNumber = parseInt(month, 10);
  if (!Number.isInteger(yearNumber) || !Number.isInteger(monthNumber)) {
    return null;
  }

  return new Date(yearNumber, monthNumber - 1).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
  });
}
