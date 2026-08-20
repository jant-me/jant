/**
 * Positions in the collections directory.
 *
 * The directory is one ordered list — manual collections, smart collections,
 * dividers, and links share it — ordered by a fractional index, so a move
 * rewrites a single row instead of renumbering the list.
 *
 * Two services write into that list: `collection` places manual collections
 * along with the author's dividers and links, `smart-collection` places smart
 * collections. The append rule lives here so the second writer cannot invent a
 * different one.
 */

import { eq, sql } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import type { Database } from "../db/index.js";
import type { DatabaseSchema } from "../db/schema-bundle.js";

type DirectoryItemsTable = DatabaseSchema["collectionDirectoryItems"];

/**
 * How many times a writer retries after two rows land on the same position.
 *
 * `(site_id, position)` is unique, so a concurrent append can lose the race;
 * the next attempt reads the new last position and appends after it.
 */
export const DIRECTORY_POSITION_RETRY_ATTEMPTS = 5;

/**
 * The position of the last row in a site's collections directory.
 *
 * @param db - Database handle
 * @param table - The `collection_directory_item` table for this dialect
 * @param siteId - Site the directory belongs to
 * @returns The largest position, or `null` when the directory is empty
 * @example
 * ```ts
 * const last = await getLastDirectoryPosition(db, directoryItems, siteId);
 * ```
 */
export async function getLastDirectoryPosition(
  db: Database,
  table: DirectoryItemsTable,
  siteId: string,
): Promise<string | null> {
  const rows = await db
    .select({ position: table.position })
    .from(table)
    .where(eq(table.siteId, siteId))
    .orderBy(sql`${table.position} DESC`)
    .limit(1);
  return rows[0]?.position ?? null;
}

/**
 * A position that puts a new row at the end of the directory.
 *
 * @param db - Database handle
 * @param table - The `collection_directory_item` table for this dialect
 * @param siteId - Site the directory belongs to
 * @returns A fractional index greater than every existing position
 * @example
 * ```ts
 * const position = await getAppendDirectoryPosition(db, directoryItems, siteId);
 * ```
 */
export async function getAppendDirectoryPosition(
  db: Database,
  table: DirectoryItemsTable,
  siteId: string,
): Promise<string> {
  return generateKeyBetween(
    await getLastDirectoryPosition(db, table, siteId),
    null,
  );
}
