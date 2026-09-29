---
"@jant/core": patch
"create-jant": patch
---

`jant db export` works on Cloudflare D1 again. It listed D1's own `_cf_KV` table (`_cf_METADATA` in local D1), which D1 refuses to read, so the export stopped with `not authorized: SQLITE_AUTH` before writing anything. The backup guide's `npx jant db export --remote` failed on every D1 site. The export now leaves D1's tables out.

**Upgrade notes**

- No database migrations.
- If your D1 backups rely on `jant db export --remote`, check that recent runs produced a file: before this release they all failed.
