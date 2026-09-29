---
"@jant/core": patch
"create-jant": patch
---

Saving a Thread draft again, or publishing it, keeps its attachments. Jant replaces the saved draft with the new version, and it used to delete the old draft's attachments, files included, before creating the new one from the same media IDs; the save then failed with `400`, and the draft and its images were gone. The attachments the new version keeps now move to it, and only the ones the author removed are deleted. When creating a Thread fails partway, the uploads its posts had attached are kept for a retry rather than deleted with them.

**Upgrade notes**

- No database migrations.
