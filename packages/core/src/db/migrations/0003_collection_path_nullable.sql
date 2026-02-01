-- Make collections.path nullable
-- SQLite doesn't support ALTER COLUMN, so we need to recreate the table

PRAGMA foreign_keys=OFF;

CREATE TABLE collections_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  path TEXT UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO collections_new SELECT * FROM collections;

DROP TABLE collections;

ALTER TABLE collections_new RENAME TO collections;

PRAGMA foreign_keys=ON;
