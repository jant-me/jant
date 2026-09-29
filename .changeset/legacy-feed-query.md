---
"@jant/core": patch
"create-jant": patch
---

Every old feed address carries its query string to the feed it redirects to. `/feed/latest/atom.xml`, `/feed/all/atom.xml`, `/feed/featured`, `/feed/featured/atom.xml`, and `/feed/atom.xml` dropped it, so a subscription to `/feed/latest/atom.xml?format=note` got every format.

**Upgrade notes**

- No database migrations.
