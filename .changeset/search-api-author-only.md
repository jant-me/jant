---
"@jant/core": minor
"create-jant": minor
---

`GET /api/search` is the author's search: it needs a session or API token, finds private posts and replies in a private Thread, and each result carries `visibility`, as the `jant_search_posts` MCP tool does. Readers search on the `/search` page, where the search rate limit now applies.

**Upgrade notes**

- No database migrations.
- A request to `GET /api/search` without a session or token gets `401`. Jant has no anonymous search API anymore; readers use the `/search` page. `PUBLIC_API_ENABLED` no longer affects `/api/search`.
- `RATE_LIMIT_SEARCH_PER_MIN` now limits signed-out readers on the `/search` page. The search API and the signed-in author aren't limited.
