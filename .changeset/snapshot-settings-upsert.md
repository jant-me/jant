---
"@jant/core": patch
"create-jant": patch
---

A snapshot writes its settings so that a later Jant can restore it over any site. Each setting row replaces the target's row with the same key, so a snapshot carrying a setting the importing version doesn't know no longer fails halfway, after its files were uploaded. A snapshot in a newer format than the installed Jant reads now says to upgrade `@jant/core`.

**Upgrade notes**

- No database migrations.
