---
"@jant/core": minor
"create-jant": minor
---

An uploaded media item belongs to one post. Creating or updating a post with a `mediaId` that's attached to another post answers `409` with `CONFLICT`, over HTTP and MCP. It used to move the attachment off the other post without a word, and deleting the new post then deleted the file. The API reference now also says that deleting a post, or removing an attachment in an update, deletes the file.

**Upgrade notes**

- No database migrations.
- A script or agent that reuses a `mediaId` from another post, to make a translation for example, gets `409`. Upload the file again and attach the new ID.
