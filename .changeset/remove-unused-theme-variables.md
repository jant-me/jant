---
"@jant/core": minor
"create-jant": minor
---

The theming page stops listing eight CSS variables that no Jant style reads, so setting them changed nothing: `--card-radius`, `--card-padding`, `--card-border-width`, `--card-shadow`, `--site-media-outline`, `--site-accent-text`, `--fw-light`, and `--fw-extrabold`.

**Upgrade notes**

- No database migrations.
- These variables are no longer defined, except `--site-media-outline`, which the exported Hugo theme still reads. Custom CSS that set them had no effect, and still has none. Custom CSS that read them with `var()` gets the fallback you gave, or the property's initial value.
- The "turn posts into cards" example is gone from the theming page; the variables it set did nothing.
