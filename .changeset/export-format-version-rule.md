---
"@jant/core": patch
"create-jant": patch
---

The site export's format version now rises whenever `site import` starts reading something new, so an older Jant refuses a newer export instead of importing it and dropping the fields it doesn't know. Compatibility says so.

**Upgrade notes**

- No database migrations.
