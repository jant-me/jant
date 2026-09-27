---
"@jant/core": patch
"create-jant": patch
---

Paging through `GET /api/posts`, `GET /api/public/posts` without `collection`, `GET /api/public/archive`, and the `jant_posts_list` MCP tool no longer depends on the post a cursor was taken on. `nextCursor` now records the position itself. If that post is deleted between requests, the walk continues; it used to end on an empty page. If its publish date is edited, the next page starts where the last one ended; it used to start from the post's new place, skipping or repeating posts. Passing a private post's or a draft's ID as `cursor` on a public endpoint returns `400`, as an unknown ID does, where it used to reveal whether the post existed and roughly when it was published. A cursor that can't be read, or that comes from a list in a different order, also returns `400`, and `nextCursor` is `null` on the last page instead of leading to an empty one.

`nextCursor` is a different string now. Clients that pass it back unchanged, as the API reference says, need no change, and a post ID is still accepted as `cursor`. Under the [compatibility promise](https://jant.me/docs/compatibility) this is a bug fix: the documented contract, pass `nextCursor` back for the next page, is unchanged, and each behavior that changed broke it.
