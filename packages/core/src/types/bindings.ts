/// <reference types="@cloudflare/workers-types/latest" />

import type BetterSqlite3 from "better-sqlite3";
import type { Database } from "../db/index.js";
import type { DatabaseDialect } from "../db/dialect.js";
import type { RawQueryClient } from "../db/raw-query.js";
import type { DatabaseSchema } from "../db/schema-bundle.js";

/**
 * Application runtime bindings.
 *
 * Scalar env values may arrive as strings, numbers, or booleans depending on
 * the host runtime and config file format.
 */

type EnvBindingValue = string | number | boolean;

export interface NodeDatabaseBinding {
  db: Database;
  dialect: DatabaseDialect;
  rawQuery: RawQueryClient;
  schema: DatabaseSchema;
  close?: () => Promise<void> | void;
}

export interface Bindings {
  DB?: D1Database;
  R2?: R2Bucket;
  NODE_DATABASE?: NodeDatabaseBinding;
  NODE_SQLITE?: BetterSqlite3.Database;
  SITE_ORIGIN?: EnvBindingValue;
  SITE_PATH_PREFIX?: EnvBindingValue;
  DEFAULT_THEME?: EnvBindingValue;
  AUTH_SECRET?: EnvBindingValue;
  SITE_NAME?: EnvBindingValue;
  SITE_DESCRIPTION?: EnvBindingValue;
  SITE_LANGUAGE?: EnvBindingValue;
  DASHBOARD_LANGUAGE?: EnvBindingValue;
  MAIN_RSS_FEED?: EnvBindingValue;
  ARCHIVE_DEFAULT_LAYOUT?: EnvBindingValue;
  TIME_ZONE?: EnvBindingValue;
  SITE_FOOTER?: EnvBindingValue;
  NOINDEX?: EnvBindingValue;
  PUBLIC_API_ENABLED?: EnvBindingValue;
  RSS_FEEDS_ENABLED?: EnvBindingValue;
  R2_PUBLIC_URL?: EnvBindingValue;
  IMAGE_TRANSFORM_URL?: EnvBindingValue;
  DEMO_EMAIL?: EnvBindingValue;
  DEMO_PASSWORD?: EnvBindingValue;
  DEMO_MODE?: EnvBindingValue;
  DEV_API_TOKEN?: EnvBindingValue;
  INTERNAL_ADMIN_TOKEN?: EnvBindingValue;
  HOSTED_CONTROL_PLANE_BASE_URL?: EnvBindingValue;
  HOSTED_CONTROL_PLANE_DOMAIN_CHECK_SECRET?: EnvBindingValue;
  HOSTED_CONTROL_PLANE_INTERNAL_BASE_URL?: EnvBindingValue;
  HOSTED_CONTROL_PLANE_PROVIDER_NAME?: EnvBindingValue;
  HOSTED_CONTROL_PLANE_SSO_SECRET?: EnvBindingValue;
  HOSTED_CONTROL_PLANE_INTERNAL_TOKEN?: EnvBindingValue;
  // Telegram bot integration
  TELEGRAM_BOT_TOKENS?: EnvBindingValue;
  TELEGRAM_WEBHOOK_SECRET?: EnvBindingValue;
  // Timeline
  PAGE_SIZE?: EnvBindingValue;
  SEARCH_PAGE_SIZE?: EnvBindingValue;
  ARCHIVE_PAGE_SIZE?: EnvBindingValue;
  // Site configuration (optional - can be overridden in DB)
  SHOW_JANT_BRANDING_ON_HOME?: EnvBindingValue;
  // S3-compatible storage (alternative to R2)
  STORAGE_DRIVER?: EnvBindingValue;
  DATA_DIR?: EnvBindingValue;
  S3_ENDPOINT?: EnvBindingValue;
  S3_BUCKET?: EnvBindingValue;
  S3_ACCESS_KEY_ID?: EnvBindingValue;
  S3_SECRET_ACCESS_KEY?: EnvBindingValue;
  S3_REGION?: EnvBindingValue;
  S3_PUBLIC_URL?: EnvBindingValue;
  LOCAL_STORAGE_PATH?: EnvBindingValue;
  LOCAL_PUBLIC_URL?: EnvBindingValue;
  TRUST_PROXY?: EnvBindingValue;
  // Upload
  UPLOAD_MAX_FILE_SIZE_MB?: EnvBindingValue;
  // Summary extraction
  SUMMARY_MAX_PARAGRAPHS?: EnvBindingValue;
  SUMMARY_MAX_CHARS?: EnvBindingValue;
  // Slug generation
  SLUG_ID_LENGTH?: EnvBindingValue;
  // RSS feed
  RSS_FEED_LIMIT?: EnvBindingValue;
  RSS_PUBLISH_DELAY_SECONDS?: EnvBindingValue;
  // Node runtime database URL. SQLite uses file: URLs; Postgres uses
  // postgres:/postgresql: URLs.
  DATABASE_URL?: string;
  SITE_RESOLUTION_MODE?: EnvBindingValue;
  CORS_ORIGINS?: EnvBindingValue;
  HOST?: string;
  PORT?: string;
}
