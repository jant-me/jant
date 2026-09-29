---
"@jant/core": patch
"create-jant": patch
---

The README and overview no longer call the GitHub Sync repository a full backup. It holds the site's writing, and media files stay in the site's storage, so someone relying on it alone would lose every image and attachment with the storage. Both now say so and link the backup guide.

**Upgrade notes**

- No database migrations.
