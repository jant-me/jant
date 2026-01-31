/**
 * URL Utilities
 */

/**
 * Extract domain from a URL
 */
export function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return null;
  }
}

/**
 * Normalize a path (remove leading/trailing slashes, lowercase)
 */
export function normalizePath(path: string): string {
  return path
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/+/g, "/");
}

/**
 * Check if a string looks like a full URL (starts with http:// or https://)
 */
export function isFullUrl(str: string): boolean {
  return str.startsWith("http://") || str.startsWith("https://");
}

/**
 * Generate a slug from a title
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
