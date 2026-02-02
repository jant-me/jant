-- Migration: Change media.id from integer to UUIDv7 (text)
-- SQLite doesn't support altering primary key types, so we recreate the table

-- Create new table with text id
CREATE TABLE media_new (
  id TEXT PRIMARY KEY NOT NULL,
  post_id INTEGER REFERENCES posts(id),
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  alt TEXT,
  created_at INTEGER NOT NULL
);

-- Migrate existing data (generate UUIDv7-like ids from old integer ids)
-- For existing data, we use a deterministic format based on timestamp + old id
INSERT INTO media_new (id, post_id, filename, original_name, mime_type, size, r2_key, width, height, alt, created_at)
SELECT
  printf('%08x-%04x-7%03x-%04x-%012x',
    created_at,
    (id >> 16) & 0xFFFF,
    id & 0x0FFF,
    0x8000 | (RANDOM() & 0x3FFF),
    ABS(RANDOM())
  ) as id,
  post_id, filename, original_name, mime_type, size, r2_key, width, height, alt, created_at
FROM media;

-- Drop old table and rename new one
DROP TABLE media;
ALTER TABLE media_new RENAME TO media;
