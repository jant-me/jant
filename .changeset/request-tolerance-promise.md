---
"@jant/core": patch
"create-jant": patch
---

Compatibility promises that the HTTP API and MCP ignore a request field or parameter they don't recognize. The API reference names the one exception: a smart collection's `selection` answers `400` for an unknown condition, since dropping it would widen the collection.

**Upgrade notes**

- No database migrations.
