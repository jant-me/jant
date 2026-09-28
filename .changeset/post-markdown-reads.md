---
"@jant/core": minor
"create-jant": minor
---

Every API read that returns posts takes `content=markdown`, which returns `bodyMarkdown` in place of `body`, `bodyHtml`, and `bodyText`. It worked on the public API only; `GET /api/posts`, `GET /api/posts/:id`, the `/api/threads` reads, and their MCP tools now take it too. `GET /api/posts/:id/content` and `jant_posts_get_content` are removed.

**Upgrade notes**

- No database migrations.
- Replace `GET /api/posts/:id/content` with `GET /api/posts/:id?content=markdown` and read `bodyMarkdown`. Replace `jant_posts_get_content` with `jant_posts_get` and `content: "markdown"`.
