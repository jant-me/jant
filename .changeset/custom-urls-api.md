---
"@jant/core": minor
"create-jant": minor
---

The custom URLs API pages and names things the way the rest of the API does.

**Upgrade notes**

- No database migrations.
- `GET /api/custom-urls` pages with `limit` (default and maximum `100`) and `cursor`, answering `{ customUrls, nextCursor }`. The `page` parameter and the `total`, `page`, and `totalPages` fields are gone.
- `path` in responses has its leading slash, as `toPath` already did and requests already allowed.
- `targetId` in a create request takes the post's or collection's TypeID as well as its slug. A target that doesn't exist answers `404` either way; an unknown TypeID used to fail with `500`.
- Responses carry `archiveQuery`, and the docs describe the `archive` addresses the list already returned.
