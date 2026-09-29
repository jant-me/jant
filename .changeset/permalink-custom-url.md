---
"@jant/core": patch
"create-jant": patch
---

A post's `permalink` in `GET /api/public/posts/:slug`, `GET /api/public/threads` (the post objects and a fold's `gap`), `GET /api/search`, and `jant_posts_search` is its first custom URL when it has one, the address its page and its feed entry's `<id>` use. It was always `/{slug}`, which only redirects there.

**Upgrade notes**

- No database migrations.
