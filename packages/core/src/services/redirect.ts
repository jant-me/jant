/**
 * Redirect Service
 *
 * URL redirect management for path changes
 */

import { eq } from "drizzle-orm";
import type { Database } from "../db/index.js";
import { redirects } from "../db/schema.js";
import { now } from "../lib/time.js";
import { normalizePath } from "../lib/url.js";
import type { Redirect } from "../types.js";

export interface RedirectService {
  getByPath(fromPath: string): Promise<Redirect | null>;
  create(fromPath: string, toPath: string, type?: 301 | 302): Promise<Redirect>;
  delete(id: number): Promise<boolean>;
  list(): Promise<Redirect[]>;
}

export function createRedirectService(db: Database): RedirectService {
  function toRedirect(row: typeof redirects.$inferSelect): Redirect {
    return {
      id: row.id,
      fromPath: row.fromPath,
      toPath: row.toPath,
      type: row.type as 301 | 302,
      createdAt: row.createdAt,
    };
  }

  return {
    async getByPath(fromPath) {
      const normalized = normalizePath(fromPath);
      const result = await db
        .select()
        .from(redirects)
        .where(eq(redirects.fromPath, normalized))
        .limit(1);
      return result[0] ? toRedirect(result[0]) : null;
    },

    async create(fromPath, toPath, type = 301) {
      const timestamp = now();
      const normalizedFrom = normalizePath(fromPath);

      // Delete existing redirect from this path if any
      await db.delete(redirects).where(eq(redirects.fromPath, normalizedFrom));

      const result = await db
        .insert(redirects)
        .values({
          fromPath: normalizedFrom,
          toPath,
          type,
          createdAt: timestamp,
        })
        .returning();

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- DB insert with .returning() always returns inserted row
      return toRedirect(result[0]!);
    },

    async delete(id) {
      const result = await db.delete(redirects).where(eq(redirects.id, id)).returning();
      return result.length > 0;
    },

    async list() {
      const rows = await db.select().from(redirects);
      return rows.map(toRedirect);
    },
  };
}
