---
"@jant/core": patch
"create-jant": patch
---

Clearing an image's alt text while editing a post now takes effect on save. The editor left an empty alt text out of the save, and an attachment sent without `alt` keeps what it had, so the old text stayed on the post.

Cleared alt text is stored as none, the same as a file uploaded without any: `PUT /api/media/:id` and a post's `attachments` with an empty `alt` now answer `alt: null`, where they answered `""`.

**Upgrade notes**

- No database migrations.
