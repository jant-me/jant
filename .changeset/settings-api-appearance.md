---
"@jant/core": minor
"create-jant": minor
---

`GET /api/settings` reports every setting the API can change, and `PUT /api/settings` writes the appearance settings: `THEME`, `FONT_THEME`, `THEME_MODE`, `CUSTOM_CSS`, and `SHOW_HEADER_AVATAR`, each checked as its settings screen checks it. `GET` also reports `MULTILINGUAL_ENABLED` and `ADDITIONAL_LANGUAGES`. `PUT /api/settings/import` now restores only those two languages, and answers as `PUT /api/settings` does. `jant_settings_get` and `jant_settings_update` follow the same rules, and now report values set by environment variables, as the HTTP endpoints do.

**Upgrade notes**

- No database migrations.
- Send appearance settings to `PUT /api/settings`. `PUT /api/settings/import` lists them in `rejectedKeys`, and answers `400` when a request has no language key.
- A theme or font theme ID Jant doesn't have now answers `400`; `THEME_MODE` takes `auto`, `light`, or `dark`, and `SHOW_HEADER_AVATAR` takes `"true"` or `"false"`. `PUT /api/settings/import` stored any value.
- `PUT /api/settings/import` answers `{ settings, rejectedKeys }` in place of `{ success, rejectedKeys }`.
- `jant site import` restores appearance in a request of its own: an export whose theme this Jant no longer has keeps the target site's appearance and prints a warning, where the import used to stop.
