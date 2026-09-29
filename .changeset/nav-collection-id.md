---
"@jant/core": minor
"create-jant": minor
---

`POST /api/nav-items` checks that a collection item's `collectionId` is a collection ID, as the reference already said. A malformed ID, or the ID of something else, answers `400` rather than `404`.

**Upgrade notes**

- No database migrations.
- A malformed or wrong-kind `collectionId` answers `400` where it answered `404`.
