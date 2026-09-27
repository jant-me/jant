---
"@jant/core": minor
"create-jant": minor
---

`POST /api/upload` always answers JSON. It used to answer a request that sent `Accept: text/event-stream` with Datastar patches for an upload screen that no longer exists.

**Upgrade notes**

- No database migrations.
- A client that asked `POST /api/upload` for `text/event-stream` gets the JSON response instead.
