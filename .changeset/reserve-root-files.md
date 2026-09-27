---
"@jant/core": minor
"create-jant": minor
---

Every path Jant answers at the site root is now reserved, so no post, collection, or custom URL can take an address that a system route would shadow. Newly reserved: `sites`, `robots.txt`, `manifest.webmanifest`, `favicon.ico`, `apple-touch-icon.png`, and every `sitemap.xml` or `sitemap-*.xml` name.

**Upgrade notes**

- No database migrations.
- An address that already uses one of these names was never reachable, since the system route answered first. It stays stored, and saving a new one is refused.
