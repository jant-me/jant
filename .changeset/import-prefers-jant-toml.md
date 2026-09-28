---
"@jant/core": patch
"create-jant": patch
---

`jant site import` takes the site's name, description, language, theme, and display flags from `data/jant.toml`, and falls back to `hugo.toml` only for exports that don't have the value there. It read `hugo.toml` first, so a `hugo.toml` edited to build the static site changed what an import restored.

**Upgrade notes**

- No database migrations.
