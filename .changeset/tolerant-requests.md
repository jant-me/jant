---
"@jant/core": minor
"create-jant": minor
---

The API ignores a request field or query parameter it doesn't know, on every endpoint. Post bodies and attachments, and the Thread lists' query parameters, used to answer `400` for one; other endpoints already ignored them. A value it can't read, in a field it knows, still answers `400`. MCP tools ignore unknown parameters the same way, and Compatibility now promises both. The one exception is a smart collection's `selection`, which answers `400` for an unknown condition, since dropping it would widen the collection.

**Upgrade notes**

- No database migrations.
- A misspelled field or parameter no longer answers `400`; it has no effect. Check what a response returns rather than relying on an error.
