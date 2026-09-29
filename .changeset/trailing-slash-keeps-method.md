---
"@jant/core": minor
"create-jant": minor
---

A request whose path ends in `/` other than a read gets `308` to the path without it, not `301`. After a `301`, `fetch`, `curl -L`, and most HTTP libraries resend a `POST` as a `GET`, so `POST /api/posts/` answered `200` with the post list and created nothing. `308` keeps the method and body. `GET` and `HEAD` still get `301`.

**Upgrade notes**

- No database migrations.
