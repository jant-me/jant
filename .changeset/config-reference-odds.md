---
"@jant/core": patch
"create-jant": patch
---

Configuration reference fixes: `DATA_DIR` defaults to the directory of a SQLite `DATABASE_URL` when one is set, not always `./data`; `DISCOVER` takes `latest` or `off`, and `featured` stops the site at startup as other unusable values do. A stored `featured` choice from an earlier release is still honored.

**Upgrade notes**

- No database migrations.
- Replace `DISCOVER=featured` in the environment with `latest` or `off`.
