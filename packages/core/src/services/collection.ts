/**
 * Collection Service
 *
 * Manages collections and post-collection relationships
 */

import { eq, desc, and } from "drizzle-orm";
import type { Database } from "../db/index.js";
import { collections, postCollections, posts } from "../db/schema.js";
import { now } from "../lib/time.js";
import type { Collection, Post } from "../types.js";

export interface CollectionService {
  getById(id: number): Promise<Collection | null>;
  getBySlug(slug: string): Promise<Collection | null>;
  list(): Promise<Collection[]>;
  create(data: CreateCollectionData): Promise<Collection>;
  update(id: number, data: UpdateCollectionData): Promise<Collection | null>;
  delete(id: number): Promise<boolean>;
  addPost(collectionId: number, postId: number): Promise<void>;
  removePost(collectionId: number, postId: number): Promise<void>;
  getPosts(collectionId: number): Promise<Post[]>;
  getCollectionsForPost(postId: number): Promise<Collection[]>;
}

export interface CreateCollectionData {
  title: string;
  slug: string;
  description?: string;
}

export interface UpdateCollectionData {
  title?: string;
  slug?: string;
  description?: string;
}

export function createCollectionService(db: Database): CollectionService {
  function toCollection(row: typeof collections.$inferSelect): Collection {
    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      description: row.description,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  function toPost(row: typeof posts.$inferSelect): Post {
    return {
      id: row.id,
      type: row.type as Post["type"],
      visibility: row.visibility as Post["visibility"],
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
      const result = await db.select().from(collections).where(eq(collections.id, id)).limit(1);
      return result[0] ? toCollection(result[0]) : null;
    },

    async getBySlug(slug) {
      const result = await db
        .select()
        .from(collections)
        .where(eq(collections.slug, slug))
        .limit(1);
      return result[0] ? toCollection(result[0]) : null;
    },

    async list() {
      const rows = await db.select().from(collections).orderBy(desc(collections.createdAt));
      return rows.map(toCollection);
    },

    async create(data) {
      const timestamp = now();

      const result = await db
        .insert(collections)
        .values({
          title: data.title,
          slug: data.slug,
          description: data.description ?? null,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning();

      return toCollection(result[0]!);
    },

    async update(id, data) {
      const existing = await this.getById(id);
      if (!existing) return null;

      const timestamp = now();
      const updates: Partial<typeof collections.$inferInsert> = { updatedAt: timestamp };

      if (data.title !== undefined) updates.title = data.title;
      if (data.slug !== undefined) updates.slug = data.slug;
      if (data.description !== undefined) updates.description = data.description;

      const result = await db
        .update(collections)
        .set(updates)
        .where(eq(collections.id, id))
        .returning();

      return result[0] ? toCollection(result[0]) : null;
    },

    async delete(id) {
      // Delete all post-collection relationships first
      await db.delete(postCollections).where(eq(postCollections.collectionId, id));

      const result = await db.delete(collections).where(eq(collections.id, id)).returning();
      return result.length > 0;
    },

    async addPost(collectionId, postId) {
      const timestamp = now();

      // Upsert the relationship
      await db
        .insert(postCollections)
        .values({
          postId,
          collectionId,
          addedAt: timestamp,
        })
        .onConflictDoNothing();
    },

    async removePost(collectionId, postId) {
      await db
        .delete(postCollections)
        .where(
          and(eq(postCollections.collectionId, collectionId), eq(postCollections.postId, postId))
        );
    },

    async getPosts(collectionId) {
      const rows = await db
        .select({ post: posts })
        .from(postCollections)
        .innerJoin(posts, eq(postCollections.postId, posts.id))
        .where(eq(postCollections.collectionId, collectionId))
        .orderBy(desc(postCollections.addedAt));

      return rows.map((r) => toPost(r.post));
    },

    async getCollectionsForPost(postId) {
      const rows = await db
        .select({ collection: collections })
        .from(postCollections)
        .innerJoin(collections, eq(postCollections.collectionId, collections.id))
        .where(eq(postCollections.postId, postId));

      return rows.map((r) => toCollection(r.collection));
    },
  };
}
