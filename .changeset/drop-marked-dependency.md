---
"@jant/core": patch
"create-jant": patch
---

`@jant/core` no longer lists `marked` as a dependency of its own. Nothing imported it directly; the editor's Markdown support installs the version it needs.

**Upgrade notes**

- No database migrations.
