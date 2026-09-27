---
"@jant/core": patch
"create-jant": patch
---

Search leaves out private posts for anyone who isn't signed in. `GET /api/search` and the `/search` page filtered on publishing status only, so a private post, or a reply in a private Thread, came back to anyone who searched for words in it: its title, an excerpt around the match, its link or quote source, its slug, and its publish date.

**Upgrade notes**

- This is a security fix. On a site with private posts, anyone who could reach `/search` or `GET /api/search` could read those fields. No database migrations.
- `GET /api/search` leaves out private posts for every caller, as `/api/public/*` does. A session or Bearer token doesn't add them.
- The `/search` page includes private posts for the signed-in author, as the archive and collection pages do.
- The `jant_search_posts` MCP tool includes private posts, and each result now carries `visibility`.
- `GET /api/search` clamps `limit` to 1–50. A negative value, such as `limit=-1`, used to return every match on SQLite and fail on Postgres; a value below 1 now returns one result.
