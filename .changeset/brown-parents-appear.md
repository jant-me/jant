---
"@jant/core": patch
"create-jant": patch
---

Paging through `GET /api/public/posts` with `collection` no longer depends on the Thread a cursor was taken on. `nextCursor` now records the position itself, as it does without `collection`. If that Thread is deleted, unpublished, or taken out of the collection between requests, the walk continues; it used to end on an empty page. A `cursor` the request can't resume from returns `400` instead of an empty page: one that can't be read, one from a list in a different order, or the ID of a post that isn't in the collection or that the caller can't see. `nextCursor` is `null` on the last page instead of leading to an empty one.

`nextCursor` is a different string now. Clients that pass it back unchanged, as the API reference says, need no change, and a Thread root's ID is still accepted as `cursor`. Under the [compatibility promise](https://jant.me/docs/compatibility) this is a bug fix: the documented contract, pass `nextCursor` back for the next page, is unchanged, and each behavior that changed broke it.
