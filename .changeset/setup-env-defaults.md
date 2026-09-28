---
"@jant/core": patch
"create-jant": patch
---

`SITE_LANGUAGE` and `TIME_ZONE` set in the environment now reach a new site. Setup offers `SITE_LANGUAGE` as the site's language, and leaves the time zone to `TIME_ZONE` instead of storing the browser's. Before, setup always stored both, which outranked the environment for good.

**Upgrade notes**

- No database migrations.
- A site set up before this keeps the language and time zone setup stored. Change them in Settings, or reset them in the Config Editor to follow the environment.
