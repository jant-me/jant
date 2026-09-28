---
"@jant/core": minor
"create-jant": minor
---

Jant checks environment values at startup. A switch takes `true` or `false` in any case, a number has to be a whole number in its range, and a variable with a fixed set of values has to name one of them; `SITE_ORIGIN` has to be an `http://` or `https://` origin. A value outside that stops the site from serving and is named on the configuration error page, in `/readyz`, and, on Node and Docker, in the message the process exits with.

The site and `GET /api/settings` now read these values the same way. `PUBLIC_API_ENABLED=TRUE` turned the public API off while the settings API reported it on, and a page size the site couldn't use ran as 50 while the settings API reported 25.

**Upgrade notes**

- No database migrations.
- Check your environment before upgrading. Values that used to be ignored or read as a default now stop the site: `STORAGE_DRIVER=S3` (use `s3`), `TRUST_PROXY=1` (use `true`), `DISCOVER=featured` (use `latest` or `off`), a `PAGE_SIZE` above `100`, a `SITE_ORIGIN` without `https://` or with a path (put the path in `SITE_PATH_PREFIX`), and a `SLUG_ID_LENGTH` outside `3` to `32`.
