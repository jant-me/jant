---
"@jant/core": minor
"create-jant": minor
---

The Docker image puts `jant` on the `PATH`, as the command-line docs say: `docker compose exec jant jant setup --help` works. `node bin/jant.js` keeps working. From 1.0.1, each release also moves a major-version tag, `owenyoung/jant:1`, so a compose file pinned to it stays on 1.x.

**Upgrade notes**

- No database migrations.
