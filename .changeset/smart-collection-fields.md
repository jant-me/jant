---
"@jant/core": minor
"create-jant": minor
---

Smart collections name their order `sortOrder`, as collections do, with the same values, and their endpoints return the object itself.

**Upgrade notes**

- No database migrations.
- In smart collection requests and responses, `sort` is now `sortOrder`. A request that still sends `sort` has it ignored, and the default order applies.
- `GET`, `POST`, and `PUT /api/smart-collections[/:id]` return the smart collection object, no longer wrapped in `{ "smartCollection": … }`. The list keeps `{ "smartCollections": […] }`.
- `jant site import` from this release works with sites before and after the change. An older `jant` can't import smart collections into a site on this release; update `@jant/core` first.
