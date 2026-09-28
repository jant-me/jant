---
"@jant/core": minor
"create-jant": minor
---

A site export and import keep the time zone, the main feed, and the site's languages. `data/jant.toml` gains `time_zone`, and `jant site import` restores `time_zone`, `main_rss_feed`, `additional_languages`, and `multilingual_enabled`; the last three were written before but only the theme read them. `PUT /api/settings/import` takes `ADDITIONAL_LANGUAGES` and `MULTILINGUAL_ENABLED` and applies them with the same checks as adding a language in Settings.

**Upgrade notes**

- No database migrations.
- Importing an older export now restores its main feed and languages, which used to be left at the target site's values.
