---
"@jant/core": patch
"create-jant": patch
---

Configuration reference fix: `DATA_DIR` defaults to the directory of a SQLite `DATABASE_URL` when one is set, not always `./data`. `DISCOVER` is documented with the values it takes, `latest` and `off`.

**Upgrade notes**

- No database migrations.
