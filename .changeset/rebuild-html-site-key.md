---
"@jant/core": patch
"create-jant": patch
---

`jant posts rebuild-html --site` takes the site's key or ID, as the database commands' `--site` does. It took only the ID.

**Upgrade notes**

- No database migrations.
