---
"@jant/core": patch
"create-jant": patch
---

`jant_posts_delete` lists only `id` as its parameter. It borrowed `jant_posts_get`'s schema and advertised a `content` parameter it never read.

**Upgrade notes**

- No database migrations.
