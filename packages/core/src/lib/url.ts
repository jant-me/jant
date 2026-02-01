/**
 * URL Utilities
 */

/**
 * Extracts the hostname (domain) from a URL string.
 *
 * Parses a full URL and returns just the hostname portion (e.g., "example.com" from
 * "https://example.com/path"). Returns `null` if the URL is malformed or cannot be parsed.
 *
 * @param url - The full URL string to extract the domain from
 * @returns The hostname/domain if valid, or `null` if parsing fails
 *
 * @example
 * ```ts
 * const domain = extractDomain("https://www.example.com/path");
 * // Returns: "www.example.com"
 *
 * const invalid = extractDomain("not-a-url");
 * // Returns: null
 * ```
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
 * Normalizes a path by removing slashes and converting to lowercase.
 *
 * Trims whitespace, converts to lowercase, removes leading and trailing slashes,
 * and collapses multiple consecutive slashes into single slashes. Used to create
 * consistent path representations for routing and storage.
 *
 * @param path - The path string to normalize
 * @returns The normalized path string
 *
 * @example
 * ```ts
 * const normalized = normalizePath("  /About/Contact//  ");
 * // Returns: "about/contact"
 * ```
 */
export function normalizePath(path: string): string {
  return path
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/+/g, "/");
}

/**
 * Checks if a string is a full URL with HTTP or HTTPS protocol.
 *
 * Validates whether a string starts with "http://" or "https://", indicating it's
 * a full URL rather than a relative path. Useful for distinguishing between internal
 * paths and external URLs.
 *
 * @param str - The string to check
 * @returns `true` if the string starts with http:// or https://, `false` otherwise
 *
 * @example
 * ```ts
 * isFullUrl("https://example.com");  // Returns: true
 * isFullUrl("/about");               // Returns: false
 * isFullUrl("example.com");          // Returns: false
 * ```
 */
export function isFullUrl(str: string): boolean {
  return str.startsWith("http://") || str.startsWith("https://");
}

/**
 * Converts text to a URL-friendly slug.
 *
 * Transforms text into a lowercase, hyphen-separated slug by:
 * - Converting to lowercase
 * - Removing special characters (keeping only word characters, spaces, and hyphens)
 * - Replacing whitespace and underscores with hyphens
 * - Removing leading and trailing hyphens
 *
 * Used for generating clean URLs from titles and names.
 *
 * @param text - The text to convert to a slug
 * @returns The slugified string
 *
 * @example
 * ```ts
 * const slug = slugify("Hello World! This is a Test.");
 * // Returns: "hello-world-this-is-a-test"
 *
 * const slug = slugify("  Multiple   Spaces  ");
 * // Returns: "multiple-spaces"
 * ```
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
