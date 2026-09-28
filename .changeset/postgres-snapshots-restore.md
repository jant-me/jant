---
"@jant/core": patch
"create-jant": patch
---

A snapshot taken from a Postgres database restores into one. `jant site snapshot import` sent SQLite's `PRAGMA` to Postgres, and the export wrote booleans as `1` and `0`, which Postgres refuses for a boolean column, so every Postgres restore failed. `jant db export` on Postgres writes the same literals Postgres reads, timestamps included.

**Upgrade notes**

- No database migrations.
- A snapshot exported from Postgres before this release can't be restored, since its `db.sql` has `1` and `0` in boolean columns. Export a new one.
