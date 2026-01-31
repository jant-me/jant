/**
 * Drizzle Schema
 *
 * Database schema for Jant
 */

import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

// =============================================================================
// Posts
// =============================================================================

export const posts = sqliteTable("posts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type", { enum: ["note", "article", "link", "quote", "image", "page"] }).notNull(),
  visibility: text("visibility", { enum: ["featured", "quiet", "unlisted", "draft"] })
    .notNull()
    .default("quiet"),
  title: text("title"),
  path: text("path"),
  content: text("content"),
  contentHtml: text("content_html"),
  sourceUrl: text("source_url"),
  sourceName: text("source_name"),
  sourceDomain: text("source_domain"),
  replyToId: integer("reply_to_id"),
  threadId: integer("thread_id"),
  deletedAt: integer("deleted_at"),
  publishedAt: integer("published_at").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// =============================================================================
// Media
// =============================================================================

export const media = sqliteTable("media", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  postId: integer("post_id").references(() => posts.id),
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  r2Key: text("r2_key").notNull(),
  width: integer("width"),
  height: integer("height"),
  alt: text("alt"),
  createdAt: integer("created_at").notNull(),
});

// =============================================================================
// Collections
// =============================================================================

export const collections = sqliteTable("collections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// =============================================================================
// Post-Collections (Many-to-Many)
// =============================================================================

export const postCollections = sqliteTable(
  "post_collections",
  {
    postId: integer("post_id")
      .notNull()
      .references(() => posts.id),
    collectionId: integer("collection_id")
      .notNull()
      .references(() => collections.id),
    addedAt: integer("added_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.postId, table.collectionId] })]
);

// =============================================================================
// Redirects
// =============================================================================

export const redirects = sqliteTable("redirects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fromPath: text("from_path").notNull().unique(),
  toPath: text("to_path").notNull(),
  type: integer("type", { mode: "number" }).notNull().default(301),
  createdAt: integer("created_at").notNull(),
});

// =============================================================================
// Settings (Key-Value)
// =============================================================================

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// =============================================================================
// better-auth tables
// Note: Using { mode: "timestamp" } so drizzle auto-converts Date <-> integer
// =============================================================================

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  role: text("role").default("admin"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});
