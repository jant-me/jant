---
"@jant/core": minor
"create-jant": minor
---

Each MCP tool's input schema in `tools/list` is generated from the schema the tool checks its arguments with, so the two can't disagree. `jant_posts_create` now lists `language`, `translationOfId`, `pinnedAt`, `featuredAt`, and `collectionEntries`, which it accepted but didn't advertise, and `jant_threads_list` lists `any` among its `visibility` values.

**Upgrade notes**

- No database migrations.
