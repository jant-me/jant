---
"@jant/core": patch
"create-jant": patch
---

Custom CSS overrides the built-in color and font theme, as the theming docs say. The theme wrote its values with a doubled `:root:root` selector, so `:root { --primary: … }` in custom CSS lost to it in light mode, and to the dark defaults in dark mode.

**Upgrade notes**

- No database migrations.
- The theme and Jant's defaults now use `:root` for light values, and `:root[data-theme-mode="dark"]` or, under `@media (prefers-color-scheme: dark)`, `:root:not([data-theme-mode="light"])` for dark ones. Custom CSS that uses the same selectors wins. Custom CSS that worked around the old behavior with `:root:root` still wins.
- A site set to always dark now shows its theme's own search highlight colors and dashboard background, as a site following a dark system preference already did.
