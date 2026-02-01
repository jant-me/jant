-- Rename slug to path in collections table
ALTER TABLE collections RENAME COLUMN slug TO path;
