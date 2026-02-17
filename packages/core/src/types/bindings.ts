/**
 * Cloudflare Worker Bindings
 */

export interface Bindings {
  DB: D1Database;
  R2?: R2Bucket;
  SITE_URL: string;
  AUTH_SECRET?: string;
  R2_PUBLIC_URL?: string;
  IMAGE_TRANSFORM_URL?: string;
  DEMO_EMAIL?: string;
  DEMO_PASSWORD?: string;
  // Timeline
  PAGE_SIZE?: string;
  // Site configuration (optional - can be overridden in DB)
  SITE_NAME?: string;
  SITE_DESCRIPTION?: string;
  SITE_LANGUAGE?: string;
  // S3-compatible storage (alternative to R2)
  STORAGE_DRIVER?: string;
  S3_ENDPOINT?: string;
  S3_BUCKET?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  S3_REGION?: string;
  S3_PUBLIC_URL?: string;
  // RSS feed
  RSS_FEED_LIMIT?: string;
}
