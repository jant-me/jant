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
  IMAGE_TRANSFORM_URL?: string;
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
  id: string; // UUIDv7
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
  path: string | null;
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

// =============================================================================
// Configuration Types
// =============================================================================

import type { FC, PropsWithChildren } from "hono/jsx";

/**
 * Props for overridable theme components
 */
export interface BaseLayoutProps extends PropsWithChildren {
  title?: string;
  description?: string;
}

export interface PostCardProps {
  post: Post;
  showExcerpt?: boolean;
  showDate?: boolean;
}

export interface PostListProps {
  posts: Post[];
  emptyMessage?: string;
}

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  basePath: string;
}

export interface EmptyStateProps {
  title: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
}

/**
 * Theme component overrides
 */
export interface ThemeComponents {
  BaseLayout?: FC<BaseLayoutProps>;
  PostCard?: FC<PostCardProps>;
  PostList?: FC<PostListProps>;
  Pagination?: FC<PaginationProps>;
  EmptyState?: FC<EmptyStateProps>;
}

/**
 * Theme configuration
 */
export interface JantTheme {
  /** Theme name */
  name?: string;
  /** Component overrides */
  components?: ThemeComponents;
  /** CSS variable overrides */
  cssVariables?: Record<string, string>;
}

/**
 * Site configuration
 */
export interface SiteConfig {
  /** Site name */
  name?: string;
  /** Site description */
  description?: string;
  /** Default language */
  language?: string;
  /** Site URL (usually set via env) */
  url?: string;
}

/**
 * Feature toggles
 */
export interface FeatureConfig {
  /** Enable search (default: true) */
  search?: boolean;
  /** Enable RSS feed (default: true) */
  rss?: boolean;
  /** Enable sitemap (default: true) */
  sitemap?: boolean;
  /** Enable i18n (default: true) */
  i18n?: boolean;
}

/**
 * Main Jant configuration
 */
export interface JantConfig {
  /** Site configuration */
  site?: SiteConfig;
  /** Theme configuration */
  theme?: JantTheme;
  /** Feature toggles */
  features?: FeatureConfig;
}
