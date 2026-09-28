---
"@jant/core": minor
"create-jant": minor
---

On a site with `SITE_PATH_PREFIX`, the relay URLs `POST /api/uploads/init` returns start with the prefix, like every other URL the API returns. Clients had to add it themselves.

**Upgrade notes**

- No database migrations.
- A client that added the prefix to `transport.url` itself sends to it as given now.
