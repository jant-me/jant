---
"@jant/core": minor
"create-jant": minor
---

Jant checks environment values at startup. A switch takes `true` or `false` in any case, a number has to be a whole number in its range, and a variable with a fixed set of values has to name one of them; `SITE_ORIGIN` has to be an `http://` or `https://` origin. A value outside that stops the site from serving and is named on the configuration error page, in `/readyz`, and, on Node and Docker, in the message the process exits with.

The site and `GET /api/settings` now read these values the same way. `PUBLIC_API_ENABLED=TRUE` turned the public API off while the settings API reported it on, and a page size the site couldn't use ran as 50 while the settings API reported 25.

**Upgrade notes**

- No database migrations.
- Check your environment before upgrading: any value the Settings pages would refuse now stops the site. Values that used to be ignored or read as a default and now stop it include:
  - a switch set to `1`, `0`, `yes`, or `on`, such as `NOINDEX=1` or `PUBLIC_API_ENABLED=1` (use `true` or `false`; `1` used to read as off)
  - `STORAGE_DRIVER=S3` (use `s3`) and `DISCOVER=featured` (use `latest` or `off`)
  - a number outside its range or with a fraction: `PAGE_SIZE` or `ARCHIVE_PAGE_SIZE` above `100`, `RSS_FEED_LIMIT` above `200`, `SUMMARY_MAX_CHARS=0`, `UPLOAD_MAX_FILE_SIZE_MB=0.5`, a `SLUG_ID_LENGTH` outside `3` to `32`
  - a `SITE_ORIGIN` without `https://` or with a path (put the path in `SITE_PATH_PREFIX`)
  - a `SITE_LANGUAGE` that isn't a language tag, such as `zh_CN` (use `zh-CN`), and a `MAIN_RSS_FEED` or `DASHBOARD_LANGUAGE` outside its options
- The error page, `/readyz`, and the Node exit message name each variable and what it takes.
