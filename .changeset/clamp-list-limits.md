---
"@jant/core": minor
"create-jant": minor
---

A list's `limit` past either end of its range now reads as that end on every endpoint and MCP tool, as search already did: `limit=500` on a list of at most 100 returns 100, and `limit=0` returns one. Other lists answered `400`. A `limit` that isn't an integer answers `400` everywhere, search included, where it used to fall back to 20.

**Upgrade notes**

- No database migrations.
- Search error messages name the parameter: `Query parameter 'q' is longer than 200 characters` replaces `Query too long`.
