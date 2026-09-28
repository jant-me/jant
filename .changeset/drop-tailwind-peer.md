---
"@jant/core": patch
"create-jant": patch
---

`@jant/core` no longer asks for `tailwindcss` as a peer dependency. Its stylesheets ship built, so a site never needed it installed.

**Upgrade notes**

- No database migrations.
- You can remove `tailwindcss` from a site's dependencies if nothing else in the project uses it.
