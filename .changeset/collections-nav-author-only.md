---
"@jant/core": minor
"create-jant": minor
---

`GET /api/collections`, `GET /api/collections/:id`, and `GET /api/nav-items` are author endpoints, like the rest of the collection and navigation API. Readers see Collections on `/collections` and the navigation in the page header. With an API token, collection and smart collection counts now include private Threads, as they already did in a signed-in browser.

**Upgrade notes**

- No database migrations.
- These three reads return `401` without a session or API token, whatever `PUBLIC_API_ENABLED` says. `PUBLIC_API_ENABLED` now only affects `/api/public/*`.
