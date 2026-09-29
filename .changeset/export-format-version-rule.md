---
"@jant/core": minor
"create-jant": minor
---

The site export's format version now rises whenever `site import` starts reading something new, so an older Jant refuses a newer export instead of importing it and dropping the fields it doesn't know. Compatibility says so. This release's import reads the time zone, main feed, languages, and a Collection page's `description`, so exports now carry format version 2.

**Upgrade notes**

- No database migrations.
- An export from this release doesn't import into 0.10.0 or earlier: the import stops before writing anything and asks you to upgrade `@jant/core`. Exports from earlier releases still import here.
