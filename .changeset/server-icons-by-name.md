---
"@jant/core": patch
"create-jant": patch
---

A new site no longer installs `lucide-static`, which takes about 60 MB. The server loaded all 1,700 Lucide icons to draw the 34 it uses. It now imports those 34 by name, and the build bundles them into `@jant/core`. The Worker you deploy is about 1.2 MB smaller, 120 KB gzipped.

**Upgrade notes**

- No database migrations.
- If your site's own code imports `lucide-static`, add it to your site's `package.json`.
