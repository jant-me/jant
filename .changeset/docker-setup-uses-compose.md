---
"@jant/core": patch
"create-jant": patch
---

The Docker guide creates the admin account from the command line with `docker compose run --rm -T jant jant setup`. Its `docker run` example mounted the data directory but left out `.env`, so on a site configured for Postgres the account went into an SQLite file nobody reads, and the site stayed on its setup page. `docker compose run` gives the command the site's own settings and runs the migrations first.

**Upgrade notes**

- No database migrations.
