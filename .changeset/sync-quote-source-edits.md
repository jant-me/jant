---
"@jant/core": patch
"create-jant": patch
---

Editing a quote's `source_name` or `source_url` in a GitHub Sync repository updates the quote in Jant. The webhook passed them under names the post service ignored, so the edit was dropped.

**Upgrade notes**

- No database migrations.
