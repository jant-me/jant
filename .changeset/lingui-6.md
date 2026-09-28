---
"@jant/core": patch
"create-jant": patch
---

Jant's translations run on Lingui 6, up from 5, and `@jant/core` no longer depends on `@lingui/react`, which nothing imported. Every page reads the same as before.

**Upgrade notes**

- No database migrations.
