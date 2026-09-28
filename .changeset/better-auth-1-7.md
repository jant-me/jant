---
"@jant/core": patch
"create-jant": patch
---

Jant depends on better-auth 1.7.6, up from 1.6.27, and takes its patch releases (`~1.7.6`). Sign-in, sessions and the account tables are unchanged: 1.7.3 dropped the `issuer` column that 1.7.0 through 1.7.2 required.

**Upgrade notes**

- No database migrations.
