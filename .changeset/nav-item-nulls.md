---
"@jant/core": minor
"create-jant": minor
---

A navigation item response carries every field, as directory items and custom URLs do: `systemKey`, `collectionId`, `smartCollectionId`, `postId`, and `targetTitle` are `null` where they don't apply to the item's type, instead of left out.

**Upgrade notes**

- No database migrations.
- A client that tests for these fields with `"collectionId" in item` or `!== undefined` should test the value, or the item's `type`.
