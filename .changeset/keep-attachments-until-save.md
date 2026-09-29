---
"@jant/core": patch
"create-jant": patch
---

Removing an attachment while editing a post no longer deletes it at once. The editor used to delete the file as soon as it was removed, so discarding the edit left the post without it. Saving the edit deletes it, the post's last attachment included; discarding the edit keeps it. A file uploaded during the edit and removed again is still deleted at once.

An edit that was interrupted, by a closed tab or a failed save, now comes back with the post's attachments. It used to come back without them, and saving it could delete them.

**Upgrade notes**

- No database migrations.
