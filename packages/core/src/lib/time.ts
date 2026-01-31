/**
 * Time Utilities
 */

/**
 * Get current Unix timestamp in seconds
 */
export function now(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * One month in seconds
 */
const ONE_MONTH = 30 * 24 * 60 * 60;

/**
 * Check if a timestamp is within the last month
 */
export function isWithinMonth(timestamp: number): boolean {
  return now() - timestamp < ONE_MONTH;
}

/**
 * Format a timestamp as ISO 8601 date string (for datetime attribute)
 */
export function toISOString(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}

/**
 * Format a timestamp as a readable date (UTC)
 * Format: "Jan 15, 2024"
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
 * Format a timestamp as year-month for archive grouping
 * Format: "2024-01"
 */
export function formatYearMonth(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}
