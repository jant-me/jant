-- FTS5 Full-Text Search for posts
-- This creates a virtual table that indexes post titles and content

CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
  title,
  content,
  content='posts',
  content_rowid='id'
);
--> statement-breakpoint

-- Populate FTS table with existing posts
INSERT INTO posts_fts(rowid, title, content)
SELECT id, COALESCE(title, ''), COALESCE(content, '') FROM posts WHERE deleted_at IS NULL;
--> statement-breakpoint

-- Trigger to keep FTS in sync on INSERT
CREATE TRIGGER posts_fts_insert AFTER INSERT ON posts
WHEN NEW.deleted_at IS NULL
BEGIN
  INSERT INTO posts_fts(rowid, title, content)
  VALUES (NEW.id, COALESCE(NEW.title, ''), COALESCE(NEW.content, ''));
END;
--> statement-breakpoint

-- Trigger to keep FTS in sync on UPDATE
CREATE TRIGGER posts_fts_update AFTER UPDATE ON posts
BEGIN
  DELETE FROM posts_fts WHERE rowid = OLD.id;
  INSERT INTO posts_fts(rowid, title, content)
  SELECT NEW.id, COALESCE(NEW.title, ''), COALESCE(NEW.content, '')
  WHERE NEW.deleted_at IS NULL;
END;
--> statement-breakpoint

-- Trigger to remove from FTS on DELETE
CREATE TRIGGER posts_fts_delete AFTER DELETE ON posts
BEGIN
  DELETE FROM posts_fts WHERE rowid = OLD.id;
END;
