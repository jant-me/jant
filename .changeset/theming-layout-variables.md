---
"@jant/core": patch
"create-jant": patch
---

The theming reference lists the layout variables that shape reader pages: `--layout-body-max-width` for the page frame and `--site-feed-rhythm` for the space between posts. It listed `--content-max-width`, `--site-padding`, and `--content-gap`, which reader pages don't use, so the "wider content area" example changed nothing. `--site-column-outline` and `--fw-bold`, which only the signed-in author's interface reads, are no longer listed.

**Upgrade notes**

- No database migrations.
- Custom CSS that set `--content-max-width` to widen the page had no effect; set `--layout-body-max-width` instead.
