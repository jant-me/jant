---
"@jant/core": minor
"create-jant": minor
---

Theme color variables are named for what they color, and the theming reference lists the ones that decide how a post reads.

- `--site-elevated-bg` is gone: it was the page color under another name, so its rules now read `--site-page-bg`.
- `--site-nav-hover-bg` is `--site-subtle-bg`, since it also fills feed cards and code blocks.
- `--search-mark-bg` and `--search-mark-color` are `--site-search-mark-bg` and `--site-search-mark-color`.
- The reference now lists `--site-reading-body` (post body text, which built-in themes set, so `--foreground` alone doesn't reach it), `--site-reading-caption`, the `--site-content-link` variables that color links, the footnote rail's `--site-footnote-text` and `--site-footnote-marker`, and `--type-body-size`. It no longer says `--site-accent` colors links.

**Upgrade notes**

- No database migrations.
- In custom CSS, rename `--site-elevated-bg` to `--site-page-bg`, `--site-nav-hover-bg` to `--site-subtle-bg`, and `--search-mark-*` to `--site-search-mark-*`. To recolor links, set `--site-content-link`.
