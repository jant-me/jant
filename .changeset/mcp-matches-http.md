---
"@jant/core": minor
"create-jant": minor
---

MCP tools answer what their HTTP endpoints return. `jant_posts_get` adds `threadPosition`, as `GET /api/posts/:id` does, which now documents it. The post list tools and `jant_posts_create` and `jant_posts_update` leave out `collectionIds`, as the HTTP list, create, and update do; read a post to get them. `jant_settings_update` includes `rejectedKeys` only when some were rejected.

**Upgrade notes**

- No database migrations.
- An agent that read `collectionIds` from a list, create, or update result calls `jant_posts_get` for them.
