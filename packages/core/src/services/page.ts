/**
 * Page Service
 *
 * CRUD operations for standalone pages (about, now, etc.)
 */

import { eq, desc, sql } from "drizzle-orm";
import type { Database } from "../db/index.js";
import { pages, navItems } from "../db/schema.js";
import { now } from "../lib/time.js";
import { render as renderMarkdown } from "../lib/markdown.js";
import type { Page, Status, CreatePage, UpdatePage } from "../types.js";

export interface PageService {
  getById(id: number): Promise<Page | null>;
  getBySlug(slug: string): Promise<Page | null>;
  list(): Promise<Page[]>;
  listNotInNav(): Promise<Page[]>;
  create(data: CreatePage): Promise<Page>;
  update(id: number, data: UpdatePage): Promise<Page | null>;
  delete(id: number): Promise<boolean>;
}

export function createPageService(db: Database): PageService {
  function toPage(row: typeof pages.$inferSelect): Page {
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      body: row.body,
      bodyHtml: row.bodyHtml,
      status: row.status as Status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  return {
    async getById(id) {
      const result = await db
        .select()
        .from(pages)
        .where(eq(pages.id, id))
        .limit(1);
      return result[0] ? toPage(result[0]) : null;
    },

    async getBySlug(slug) {
      const result = await db
        .select()
        .from(pages)
        .where(eq(pages.slug, slug))
        .limit(1);
      return result[0] ? toPage(result[0]) : null;
    },

    async list() {
      const rows = await db.select().from(pages).orderBy(desc(pages.createdAt));
      return rows.map(toPage);
    },

    async listNotInNav() {
      const rows = await db
        .select()
        .from(pages)
        .where(
          sql`${pages.id} NOT IN (SELECT ${navItems.pageId} FROM ${navItems} WHERE ${navItems.pageId} IS NOT NULL)`,
        )
        .orderBy(desc(pages.createdAt));
      return rows.map(toPage);
    },

    async create(data) {
      const timestamp = now();

      const bodyHtml = data.body ? renderMarkdown(data.body) : null;

      const result = await db
        .insert(pages)
        .values({
          slug: data.slug,
          title: data.title ?? null,
          body: data.body ?? null,
          bodyHtml,
          status: data.status ?? "published",
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning();

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- DB insert with .returning() always returns inserted row
      return toPage(result[0]!);
    },

    async update(id, data) {
      const existing = await this.getById(id);
      if (!existing) return null;

      const timestamp = now();
      const updates: Partial<typeof pages.$inferInsert> = {
        updatedAt: timestamp,
      };

      if (data.slug !== undefined) updates.slug = data.slug;
      if (data.title !== undefined) updates.title = data.title;
      if (data.status !== undefined) updates.status = data.status;

      if (data.body !== undefined) {
        updates.body = data.body;
        updates.bodyHtml = data.body ? renderMarkdown(data.body) : null;
      }

      // If slug changed, update related nav_items
      if (data.slug !== undefined && data.slug !== existing.slug) {
        await db
          .update(navItems)
          .set({ url: `/${data.slug}`, updatedAt: timestamp })
          .where(eq(navItems.pageId, id));
      }

      // If title changed, update related nav_items label
      if (data.title !== undefined && data.title !== existing.title) {
        await db
          .update(navItems)
          .set({ label: data.title ?? existing.slug, updatedAt: timestamp })
          .where(eq(navItems.pageId, id));
      }

      const result = await db
        .update(pages)
        .set(updates)
        .where(eq(pages.id, id))
        .returning();

      return result[0] ? toPage(result[0]) : null;
    },

    async delete(id) {
      // nav_items with page_id FK have ON DELETE CASCADE, so they auto-delete
      const result = await db.delete(pages).where(eq(pages.id, id)).returning();
      return result.length > 0;
    },
  };
}
