---
"@jant/core": patch
"create-jant": patch
---

The MCP post tools write posts the way `POST` and `PUT /api/posts` do.

- `jant_posts_update` works. It rejected every call with "Invalid tool arguments." because the post `id` was checked as part of the body.
- `jant_posts_create` keeps `language`, `translationOfId`, `pinnedAt`, `featuredAt`, and `collectionEntries`, and `jant_posts_update` keeps `language`, `pinnedAt`, `featuredAt`, and `collectionEntries`. They used to be dropped without an error.
- Creating, updating, or deleting a post through MCP starts a GitHub sync on a site that has one, as the HTTP endpoints do.
