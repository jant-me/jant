---
"@jant/core": patch
"create-jant": patch
---

A site export and GitHub Sync include every post. They read at most 10,000 posts, replies included, and silently left out the rest of a larger site.

**Upgrade notes**

- No database migrations.
