---
"@jant/core": patch
"create-jant": patch
---

Feed entries now carry the `<category>` that [Reading a Jant feed](https://jant.me/docs/feed-reading) describes, one for each Collection the entry's Thread is in. The renderer wrote them, but no feed passed it the Collections, so no feed ever had one. Each category's `jant:page` is the address the Collection's page answers at: its first custom URL when it has one, otherwise its slug.

**Upgrade notes**

- No database migrations.
