---
"@jant/core": patch
"create-jant": patch
---

A reply has the same address in every feed. The archive, collection, and smart collection feeds named a reply by its slug where the latest and featured feeds used its custom URL, so a reader following two feeds could see one reply as two posts.

**Upgrade notes**

- No database migrations.
