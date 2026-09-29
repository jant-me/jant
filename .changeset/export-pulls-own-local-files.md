---
"@jant/core": patch
"create-jant": patch
---

`jant site export` downloads the files of the site it exports even when that site is on a private address, such as `--url http://127.0.0.1:3000` on the machine that runs it. The check that keeps an export from fetching private addresses refused the site's own files too, so an export of a site on this machine kept the avatar as a link to `127.0.0.1`, and the import that read it couldn't bring the avatar along. Other private addresses are still refused, and `jant site pull-media`, which reads its addresses from the export file, refuses them all.

**Upgrade notes**

- No database migrations.
