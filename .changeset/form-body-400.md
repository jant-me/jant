---
"@jant/core": patch
---

`POST /api/upload` and `POST /api/settings/avatar` answer `400` to a body that isn't form data, where they answered `500`.

**Upgrade notes**

- No database migrations.
