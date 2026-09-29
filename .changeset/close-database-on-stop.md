---
"@jant/core": patch
"create-jant": patch
---

`jant start` closes the server and the database when it gets `SIGTERM` or `SIGINT`. It used to ignore both: Docker stops a container with `SIGTERM`, and as PID 1 the process kept running until Docker killed it ten seconds later, with SQLite's latest writes still in `jant.sqlite-wal`. A backup that copied `jant.sqlite` after `docker compose down`, as the backup guide said to, missed them. Closing the database now writes them into `jant.sqlite`. Requests still running get five seconds before their connections are cut.

The backup guide archives every `jant.sqlite*` file, and deletes them all before a restore: a `jant.sqlite-wal` left from before would be applied to the restored database and corrupt it.

**Upgrade notes**

- No database migrations.
- If you back up a SQLite site by copying `jant.sqlite`, copy `jant.sqlite-wal` too when it's there, and delete both before restoring. See the backup guide.
