---
"@jant/core": minor
"create-jant": minor
---

A site export keeps the custom URLs that point at a Collection, and `jant site import` adds them again. A Collection's page lists them under `aliases`, and the exported Hugo site redirects from each. They used to be left out, so those addresses answered `404` on the imported site.

**Upgrade notes**

- No database migrations.
