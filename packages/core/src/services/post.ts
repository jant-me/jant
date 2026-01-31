/**
 * Post Service
 *
 * CRUD operations for posts with Thread support
 */

import { eq, and, isNull, desc, or, inArray, sql } from "drizzle-orm";
import type { Database } from "../db/index.js";
import { posts } from "../db/schema.js";
import { now } from "../lib/time.js";
import { extractDomain } from "../lib/url.js";
import { render as renderMarkdown } from "../lib/markdown.js";
import type { PostType, Visibility, Post, CreatePost, UpdatePost } from "../types.js";

export interface PostFilters {
  type?: PostType;
  visibility?: Visibility | Visibility[];
  includeDeleted?: boolean;
  threadId?: number;
  limit?: number;
  cursor?: number; // post id for cursor pagination
}

export interface PostService {
  getById(id: number): Promise<Post | null>;
  getByPath(path: string): Promise<Post | null>;
  list(filters?: PostFilters): Promise<Post[]>;
  create(data: CreatePost): Promise<Post>;
  update(id: number, data: UpdatePost): Promise<Post | null>;
  delete(id: number): Promise<boolean>;
  getThread(rootId: number): Promise<Post[]>;
  updateThreadVisibility(rootId: number, visibility: Visibility): Promise<void>;
}

export function createPostService(db: Database): PostService {
  // Helper to map DB row to Post type
  function toPost(row: typeof posts.$inferSelect): Post {
    return {
      id: row.id,
      type: row.type as PostType,
      visibility: row.visibility as Visibility,
      title: row.title,
      path: row.path,
      content: row.content,
      contentHtml: row.contentHtml,
      sourceUrl: row.sourceUrl,
      sourceName: row.sourceName,
      sourceDomain: row.sourceDomain,
      replyToId: row.replyToId,
      threadId: row.threadId,
      deletedAt: row.deletedAt,
      publishedAt: row.publishedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  return {
    async getById(id) {
      const result = await db
        .select()
        .from(posts)
        .where(and(eq(posts.id, id), isNull(posts.deletedAt)))
        .limit(1);
      return result[0] ? toPost(result[0]) : null;
    },

    async getByPath(path) {
      const result = await db
        .select()
        .from(posts)
        .where(and(eq(posts.path, path), isNull(posts.deletedAt)))
        .limit(1);
      return result[0] ? toPost(result[0]) : null;
    },

    async list(filters = {}) {
      const conditions = [];

      // Visibility filter
      if (filters.visibility) {
        if (Array.isArray(filters.visibility)) {
          conditions.push(inArray(posts.visibility, filters.visibility));
        } else {
          conditions.push(eq(posts.visibility, filters.visibility));
        }
      }

      // Type filter
      if (filters.type) {
        conditions.push(eq(posts.type, filters.type));
      }

      // Thread filter
      if (filters.threadId) {
        conditions.push(eq(posts.threadId, filters.threadId));
      }

      // Exclude deleted unless specified
      if (!filters.includeDeleted) {
        conditions.push(isNull(posts.deletedAt));
      }

      // Cursor pagination
      if (filters.cursor) {
        conditions.push(sql`${posts.id} < ${filters.cursor}`);
      }

      const query = db
        .select()
        .from(posts)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(posts.publishedAt), desc(posts.id))
        .limit(filters.limit ?? 100);

      const rows = await query;
      return rows.map(toPost);
    },

    async create(data) {
      const timestamp = now();

      // Process content
      const contentHtml = data.content ? renderMarkdown(data.content) : null;

      // Extract domain from source URL
      const sourceDomain = data.sourceUrl ? extractDomain(data.sourceUrl) : null;

      // Handle thread relationship
      let threadId: number | null = null;
      let visibility = data.visibility ?? "quiet";

      if (data.replyToId) {
        const parent = await this.getById(data.replyToId);
        if (parent) {
          // thread_id = parent's thread_id or parent's id (if parent is root)
          threadId = parent.threadId ?? parent.id;
          // Inherit visibility from root
          const root = parent.threadId ? await this.getById(parent.threadId) : parent;
          if (root) {
            visibility = root.visibility;
          }
        }
      }

      const result = await db
        .insert(posts)
        .values({
          type: data.type,
          visibility,
          title: data.title ?? null,
          path: data.path ?? null,
          content: data.content ?? null,
          contentHtml,
          sourceUrl: data.sourceUrl ?? null,
          sourceName: data.sourceName ?? null,
          sourceDomain,
          replyToId: data.replyToId ?? null,
          threadId,
          publishedAt: data.publishedAt ?? timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning();

      return toPost(result[0]!);
    },

    async update(id, data) {
      const existing = await this.getById(id);
      if (!existing) return null;

      const timestamp = now();
      const updates: Partial<typeof posts.$inferInsert> = { updatedAt: timestamp };

      if (data.type !== undefined) updates.type = data.type;
      if (data.title !== undefined) updates.title = data.title;
      if (data.path !== undefined) updates.path = data.path;
      if (data.publishedAt !== undefined) updates.publishedAt = data.publishedAt;
      if (data.sourceUrl !== undefined) {
        updates.sourceUrl = data.sourceUrl;
        updates.sourceDomain = data.sourceUrl ? extractDomain(data.sourceUrl) : null;
      }
      if (data.sourceName !== undefined) updates.sourceName = data.sourceName;

      if (data.content !== undefined) {
        updates.content = data.content;
        updates.contentHtml = data.content ? renderMarkdown(data.content) : null;
      }

      // Handle visibility change - cascade to thread if this is root
      if (data.visibility !== undefined && data.visibility !== existing.visibility) {
        updates.visibility = data.visibility;
        // If this is a root post, cascade visibility to all thread posts
        if (!existing.threadId) {
          await this.updateThreadVisibility(id, data.visibility);
        }
      }

      const result = await db.update(posts).set(updates).where(eq(posts.id, id)).returning();

      return result[0] ? toPost(result[0]) : null;
    },

    async delete(id) {
      const existing = await this.getById(id);
      if (!existing) return false;

      const timestamp = now();

      // If this is a thread root, soft delete all posts in the thread
      if (!existing.threadId) {
        await db
          .update(posts)
          .set({ deletedAt: timestamp, updatedAt: timestamp })
          .where(or(eq(posts.id, id), eq(posts.threadId, id)));
      } else {
        // Just delete this single post
        await db
          .update(posts)
          .set({ deletedAt: timestamp, updatedAt: timestamp })
          .where(eq(posts.id, id));
      }

      return true;
    },

    async getThread(rootId) {
      const rows = await db
        .select()
        .from(posts)
        .where(
          and(or(eq(posts.id, rootId), eq(posts.threadId, rootId)), isNull(posts.deletedAt))
        )
        .orderBy(posts.createdAt);

      return rows.map(toPost);
    },

    async updateThreadVisibility(rootId, visibility) {
      const timestamp = now();
      await db
        .update(posts)
        .set({ visibility, updatedAt: timestamp })
        .where(eq(posts.threadId, rootId));
    },
  };
}
