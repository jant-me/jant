---
"@jant/core": minor
"create-jant": minor
---

Every path in a site export starts with a slash. A custom URL's `path` in `data/jant.toml` was written without one, unlike its `to`, the root aliases, and the API. `jant site import` reads both spellings.

**Upgrade notes**

- No database migrations.
