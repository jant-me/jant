---
"@jant/core": minor
"create-jant": minor
---

`GET /api/media` and `jant_media_list` page with an opaque cursor, as the post and Thread lists do, and `nextCursor` is `null` on the last page. The cursor used to be the last media ID, and a full last page handed back one that led to an empty page.

**Upgrade notes**

- No database migrations.
- Pass `nextCursor` back as it is. A media ID is no longer accepted as `cursor` and answers `400`.
