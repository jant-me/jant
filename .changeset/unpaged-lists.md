---
"@jant/core": patch
"create-jant": patch
---

The API reference says the lists that return everything in one response (collections, smart collections, navigation items, and a post's other versions) keep doing so for a request that doesn't ask for a page, even if they gain pages later.

**Upgrade notes**

- No database migrations.
