---
"@jant/core": patch
"create-jant": patch
---

`POST /api/nav-items` checks that a collection item's `collectionId` is a collection ID, as the reference already said. A malformed ID, or the ID of something else, answers `400` rather than `404`.

**Upgrade notes**

- No database migrations.
