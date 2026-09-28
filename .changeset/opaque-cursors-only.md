---
"@jant/core": minor
"create-jant": minor
---

Post and Thread lists take only the `nextCursor` they hand out. A post ID is no longer read as a cursor, and a Thread's fold carries `gap.cursor`, which lists the replies the fold hides.

**Upgrade notes**

- No database migrations.
- A post ID passed as `cursor` to `GET /api/posts`, `GET /api/threads`, `GET /api/public/threads`, a Thread's posts, or the matching MCP tools now answers `400`. Pass `nextCursor` back as it is.
- To open a fold's hidden replies, pass `fold.gap.cursor` to the Thread's posts in place of the last `leading` reply's ID.
