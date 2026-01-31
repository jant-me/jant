/**
 * Jant Type Definitions
 */

// =============================================================================
// Content Types
// =============================================================================

export const POST_TYPES = ["note", "article", "link", "quote", "image", "page"] as const;
export type PostType = (typeof POST_TYPES)[number];

export const VISIBILITY_LEVELS = ["featured", "quiet", "unlisted", "draft"] as const;
export type Visibility = (typeof VISIBILITY_LEVELS)[number];


// =============================================================================
// Cloudflare Bindings
// =============================================================================

export interface Bindings {
  DB: D1Database;
  R2?: R2Bucket;
  SITE_URL: string;
  AUTH_SECRET?: string;
  R2_PUBLIC_URL?: string;
}


// =============================================================================
// Entity Types
// =============================================================================

export interface Post {
  id: number;
  type: PostType;
  visibility: Visibility;
  title: string | null;
  path: string | null;
  content: string | null;
  contentHtml: string | null;
  sourceUrl: string | null;
  sourceName: string | null;
  sourceDomain: string | null;
  replyToId: number | null;
  threadId: number | null;
  deletedAt: number | null;
  publishedAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface Media {
  id: number;
  postId: number | null;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  r2Key: string;
  width: number | null;
  height: number | null;
  alt: string | null;
  createdAt: number;
}

export interface Collection {
  id: number;
  title: string;
  slug: string;
  description: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface PostCollection {
  postId: number;
  collectionId: number;
  addedAt: number;
}

export interface Redirect {
  id: number;
  fromPath: string;
  toPath: string;
  type: 301 | 302;
  createdAt: number;
}

export interface Setting {
  key: string;
  value: string;
  updatedAt: number;
}

// =============================================================================
// Operation Types
// =============================================================================

export interface CreatePost {
  type: PostType;
  visibility?: Visibility;
  title?: string;
  path?: string;
  content?: string;
  sourceUrl?: string;
  sourceName?: string;
  replyToId?: number;
  publishedAt?: number;
}

export interface UpdatePost {
  type?: PostType;
  visibility?: Visibility;
  title?: string | null;
  path?: string | null;
  content?: string | null;
  sourceUrl?: string | null;
  sourceName?: string | null;
  publishedAt?: number;
}
