---
"@jant/core": patch
"create-jant": patch
---

The theming reference is checked more strictly: each attribute it names must appear under that exact name, the `data-format`, `data-theme-mode`, and `data-theme` values must be real ones, and a variable counts as working only if a reader's page reads it.

**Upgrade notes**

- No database migrations.
