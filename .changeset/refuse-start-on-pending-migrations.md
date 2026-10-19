---
"@jant/core": patch
---

`jant start`, and so the Docker image, refuses to start on a database that's missing a schema migration the installed `@jant/core` bundles. It exits with a message that names the missing migrations and says to run `jant migrate`. The server used to start, answer `500` on every page, `/signin` included, and pass both `/healthz` and `/readyz`. That happened when an update replaced the `jant` container without running `jant-migrate`, or when a Node site was restarted without `jant migrate`. On Node, `/readyz` now answers `503` in the same state, with the message in `checks.database.error`. Pending data backfills don't stop the server.

**Upgrade notes**

- No database migrations.
- A Node or Docker site that starts `jant start` before `jant migrate` now exits until `jant migrate` has run. The Compose file already runs `jant-migrate` first.
