---
"@jant/core": patch
"create-jant": patch
---

The feed reference says what an entry's dates mean: `<published>` is always the post's own publication date, in every feed; `<updated>` moves with edits, replies, and, in a collection's feed, the collection taking the post in. It also documents the feed-level elements, such as `title`, `author`, `id`, `updated`, and the `hreflang` alternates, which only the internal notes described.

**Upgrade notes**

- No database migrations.
