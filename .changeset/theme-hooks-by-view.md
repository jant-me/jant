---
"@jant/core": patch
"create-jant": patch
---

The theming reference says which views carry which post hooks: the feed, a post's page, and a collection carry all of them; a search result carries the `<article>` attributes only; an archive grid tile carries `data-post` and `data-format`.

**Upgrade notes**

- No database migrations.
