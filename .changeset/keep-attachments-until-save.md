---
"@jant/core": patch
"create-jant": patch
---

Removing an attachment while editing a post no longer deletes it at once. The editor used to delete the file as soon as it was removed, so discarding the edit left the post without it. Saving the edit deletes it, as before; discarding the edit keeps it. A file uploaded during the edit and removed again is still deleted at once.

**Upgrade notes**

- No database migrations.
