---
"@jant/core": patch
"create-jant": patch
---

Collection endpoints answer for targets that don't exist. Deleting a directory item that isn't there returns `404`, not `200`. Removing, pinning, or unpinning a Thread in a Collection that doesn't exist returns `404`, as adding one already did, and pinning a Thread that isn't in the Collection returns `409` instead of reporting success with nothing pinned.

**Upgrade notes**

- No database migrations.
