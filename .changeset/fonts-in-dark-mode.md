---
"@jant/core": patch
"create-jant": patch
---

A font set in custom CSS on `:root`, such as `--font-body`, now applies in dark mode as well. The font theme's variables were also written into the dark-mode blocks, which outrank `:root`, so the font theme won whenever the page was dark.

**Upgrade notes**

- No database migrations.
