---
"@jant/core": patch
"create-jant": patch
---

The feed references list every change that moves an entry's `<id>`, the post's address: a new slug, a first custom URL added or removed, a new domain, and a new `SITE_PATH_PREFIX`. They named only the slug and the domain. `<jant:id>` stays the same through all of them.

**Upgrade notes**

- No database migrations.
