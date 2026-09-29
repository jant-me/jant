---
"@jant/core": minor
"create-jant": minor
---

Collection endpoints answer for targets that don't exist. Deleting a directory item that isn't there returns `404`, not `200`. Removing, pinning, or unpinning a Thread in a Collection that doesn't exist returns `404`, as adding one already did, and pinning a Thread that isn't in the Collection returns `409` instead of reporting success with nothing pinned.

**Upgrade notes**

- No database migrations.
- A client that treated `200` as success for these calls gets `404` for a Collection or directory item that doesn't exist, and `409` for pinning a Thread the Collection doesn't hold.
