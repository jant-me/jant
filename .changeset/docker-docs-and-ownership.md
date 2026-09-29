---
"@jant/core": patch
"create-jant": patch
---

The Docker image no longer gives its app user `/usr/local/bin`, where the `node` binary lives. The Docker guides say the Compose file, not the image, applies migrations, show the migrate step before `docker run`, hand `./data` to the container's user on Linux, back up before an update, and stop using the placeholder `AUTH_SECRET` the startup check refuses.

**Upgrade notes**

- No database migrations.
- If you run the image with `docker run` rather than the Compose file, run `jant migrate` in it after each image update; the app refuses to start on a database that isn't migrated.
