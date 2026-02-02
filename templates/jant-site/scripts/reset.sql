-- Reset script for Jant demo site
-- Clears all user-created data while preserving schema

-- Clear FTS index first (to avoid foreign key issues)
DELETE FROM posts_fts;

-- Clear join tables
DELETE FROM post_collections;

-- Clear main tables
DELETE FROM media;
DELETE FROM posts;
DELETE FROM collections;
DELETE FROM redirects;

-- Clear sessions (keep users for demo login capability)
DELETE FROM session;
DELETE FROM verification;

-- Reset auto-increment counters
DELETE FROM sqlite_sequence WHERE name IN ('posts', 'media', 'collections', 'redirects');

-- Note: Settings and users are preserved
-- Seed data will be re-inserted by seed.sql
