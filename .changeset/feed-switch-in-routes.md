---
"@jant/core": patch
"create-jant": patch
---

With `RSS_FEEDS_ENABLED=false`, only feed routes answer 404. Every address ending in `/feed` used to, so a post or collection with a custom URL such as `notes/feed` became unreachable.

**Upgrade notes**

- No database migrations.
