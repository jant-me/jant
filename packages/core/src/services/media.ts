/**
 * Media Service
 *
 * Handles media upload and management with R2 storage
 */

import { eq, desc } from "drizzle-orm";
import type { Database } from "../db/index.js";
import { media } from "../db/schema.js";
import { now } from "../lib/time.js";
import type { Media } from "../types.js";

export interface MediaService {
  getById(id: number): Promise<Media | null>;
  list(limit?: number): Promise<Media[]>;
  create(data: CreateMediaData): Promise<Media>;
  delete(id: number): Promise<boolean>;
  getByR2Key(r2Key: string): Promise<Media | null>;
}

export interface CreateMediaData {
  postId?: number;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  r2Key: string;
  width?: number;
  height?: number;
  alt?: string;
}

export function createMediaService(db: Database): MediaService {
  function toMedia(row: typeof media.$inferSelect): Media {
    return {
      id: row.id,
      postId: row.postId,
      filename: row.filename,
      originalName: row.originalName,
      mimeType: row.mimeType,
      size: row.size,
      r2Key: row.r2Key,
      width: row.width,
      height: row.height,
      alt: row.alt,
      createdAt: row.createdAt,
    };
  }

  return {
    async getById(id) {
      const result = await db.select().from(media).where(eq(media.id, id)).limit(1);
      return result[0] ? toMedia(result[0]) : null;
    },

    async getByR2Key(r2Key) {
      const result = await db.select().from(media).where(eq(media.r2Key, r2Key)).limit(1);
      return result[0] ? toMedia(result[0]) : null;
    },

    async list(limit = 100) {
      const rows = await db.select().from(media).orderBy(desc(media.createdAt)).limit(limit);
      return rows.map(toMedia);
    },

    async create(data) {
      const timestamp = now();

      const result = await db
        .insert(media)
        .values({
          postId: data.postId ?? null,
          filename: data.filename,
          originalName: data.originalName,
          mimeType: data.mimeType,
          size: data.size,
          r2Key: data.r2Key,
          width: data.width ?? null,
          height: data.height ?? null,
          alt: data.alt ?? null,
          createdAt: timestamp,
        })
        .returning();

      return toMedia(result[0]!);
    },

    async delete(id) {
      const result = await db.delete(media).where(eq(media.id, id)).returning();
      return result.length > 0;
    },
  };
}
