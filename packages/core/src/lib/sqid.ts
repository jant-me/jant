/**
 * Sqids - Short unique IDs for URLs
 *
 * Encodes numeric IDs to short strings like "jR3k"
 */

import Sqids from "sqids";

const sqids = new Sqids({
  minLength: 4,
});

/**
 * Encode a numeric ID to a short string
 */
export function encode(id: number): string {
  return sqids.encode([id]);
}

/**
 * Decode a short string back to a numeric ID
 * Returns null if invalid
 */
export function decode(str: string): number | null {
  try {
    const ids = sqids.decode(str);
    return ids[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Check if a string is a valid sqid
 */
export function isValidSqid(str: string): boolean {
  return decode(str) !== null;
}
