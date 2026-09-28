---
"@jant/core": minor
"create-jant": minor
---

`PUT /api/posts/:id` and `jant_posts_update` check the fields they get against the post's format, as create does: `sourceName` on a note answers `400` instead of replacing the note's title. The update schema no longer lists `path`, `replyToId`, `quietReply`, and `translationOfId`, which it accepted and never applied.

**Upgrade notes**

- No database migrations.
- An update that sends a field its post's format doesn't take, such as `url` on a note or `title` on a quote, answers `400`.
- `path`, `replyToId`, `quietReply`, and `translationOfId` in an update are ignored, as before; they are no longer documented as accepted.
