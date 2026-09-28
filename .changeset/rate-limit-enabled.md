---
"@jant/core": minor
"create-jant": minor
---

`RATE_LIMIT_ENABLED` replaces `RATE_LIMIT_DISABLED`, named and defaulting like the other `_ENABLED` switches. `false` turns off every limit: search, sign-in, and setup. `RATE_LIMIT_SEARCH_PER_MIN=0` now leaves search unlimited; it used to be read as 30.

**Upgrade notes**

- No database migrations.
- Replace `RATE_LIMIT_DISABLED=true` with `RATE_LIMIT_ENABLED=false`. `RATE_LIMIT_DISABLED` is no longer read, so the limits apply until you do.
