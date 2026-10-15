---
"@jant/core": patch
"create-jant": patch
---

A new site installs 77 fewer packages, about 96 MB less. `@jant/core` now lists as dependencies only what its server and the `jant` CLI load. TipTap, Lit, the fonts, the emoji picker data, and the HEIC and video encoders were listed too, though only the prebuilt browser bundles inside `@jant/core` use them.

**Upgrade notes**

- No database migrations.
- If your site's own code imports one of these packages, add it to your site's `package.json`.
