---
"@jant/core": patch
"create-jant": patch
---

On Postgres, a search made only of punctuation, such as `'''`, no longer fails. The `/search` page showed "search failed" and `/api/search` answered 500. It now runs the same substring search a query too short for full-text search does.

**Upgrade notes**

- No database migrations.
