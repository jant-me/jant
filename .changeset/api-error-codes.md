---
"@jant/core": minor
"create-jant": minor
---

Every API error answers `{ error, code }`, the shape the API reference documents.

**Upgrade notes**

- No database migrations.
- A request body that isn't JSON answers `400` with `VALIDATION_ERROR`, instead of `500`.
- An unknown `/api` path, and `/api/public/*` while `PUBLIC_API_ENABLED=false`, answer JSON `404` with `NOT_FOUND`, instead of plain text.
- An error the server didn't expect carries `code: "INTERNAL_ERROR"`.
- Upload, avatar, Telegram webhook, and storage errors carry codes: `VALIDATION_ERROR`, `CONFIGURATION_ERROR` when file storage isn't set up, `MEDIA_QUOTA_EXCEEDED`, and `EXTERNAL_SERVICE_ERROR` when a write fails. The Telegram webhook's unknown-bot message is now "Telegram bot not found".
- `RATE_LIMIT` is gone from the documented codes: no API endpoint returns it.
