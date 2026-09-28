---
"@jant/core": minor
"create-jant": minor
---

`DELETE /api/settings/:key` answers with what `GET /api/settings` returns, the reset setting's fallback included. It also returned `setting`, the settings screen's own state for the row (`mode`, `display`, `locked`, `settingsPath`), which no longer travels in the API. The compose shortcut discovery endpoint leaves the API reference: it records a hint the editor shows once, and isn't meant for clients.

**Upgrade notes**

- No database migrations.
- Read the reset value from `settings[key]`. A linked setting such as `THEME` isn't listed there; after a reset it takes its default.
