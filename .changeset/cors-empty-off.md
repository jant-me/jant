---
"@jant/core": patch
"create-jant": patch
---

An empty `CORS_ORIGINS` turns cross-origin API access off, as the configuration reference says. It used to be read as unset, which allows every origin.

**Upgrade notes**

- No database migrations.
- If you set `CORS_ORIGINS=` to an empty value, cross-origin requests to the API now get no CORS headers. Leave the variable out, or set it to `*`, to keep allowing every origin.
