---
"@jant/core": minor
"create-jant": minor
---

Remove the two public lists deprecated in 0.9: the `GET /api/public/posts` list and `GET /api/public/archive`. `GET /api/public/threads` replaces both. `GET /api/public/posts/:slug` stays. The 0.9 notes said 1.0.1; the removal comes a release earlier, so 1.x starts without them.

**Upgrade notes**

- No database migrations.
- Requests to the `GET /api/public/posts` list and to `GET /api/public/archive` return `404`. Use `GET /api/public/threads` for what the first listed, and `GET /api/public/threads?visibility=any&sort=published` for the archive. Their Threads carry each root post in the same shape, under `root`.
- Responses no longer carry the `Deprecation` and `Link` headers that announced the removal.
