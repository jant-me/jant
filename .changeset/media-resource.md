---
"@jant/core": minor
"create-jant": minor
---

Uploaded files are a resource at `/api/media`: list them, read one, change its alt text, and delete it there. `/api/upload` only uploads.

The text attachment preview reads from its own page address, `/_/text/{id}`, and follows the rule the attachment's page `/{post}/text/{id}` already followed: the file must belong to a published post, and a private one only to the signed-in author.

**Upgrade notes**

- No database migrations.
- `GET /api/upload`, `GET /api/upload/:id`, `PATCH /api/upload/:id`, and `DELETE /api/upload/:id` are now `GET /api/media`, `GET /api/media/:id`, `PATCH /api/media/:id`, and `DELETE /api/media/:id`, with the same requests and responses. `POST /api/upload` is unchanged.
- The undocumented `GET /api/media/:id/content` is gone. It answered anyone who had a media ID, whatever the post it belonged to.
- The preview dialog now works on a site with `SITE_PATH_PREFIX`, and shows an uploaded plain-text file as text instead of reading its contents as HTML. The attachment page `/{post}/text/{id}` also opens for an uploaded plain-text file.
