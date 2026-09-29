---
"@jant/core": patch
"create-jant": patch
---

The backup guide's Cloudflare recovery steps work as written. They loaded a `db export` file back with `wrangler d1 execute`, but the file holds rows, not tables: loaded into the site's database it stops on a duplicate key, and into a new one on a missing table. The guide now starts with D1 time travel, and for a SQL file creates a new database, runs `jant migrate --remote` on it, loads the file, and deploys.

**Upgrade notes**

- No database migrations.
