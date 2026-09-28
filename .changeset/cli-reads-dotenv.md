---
"@jant/core": minor
"create-jant": minor
---

`jant start` and the `jant` commands read `.env` in the current directory, the file the Node and Docker docs and templates use. The commands used to look for `.env.node`, and `jant start` read no file. `JANT_ENV_FILE` names a different file, or none when empty; it is now in the configuration reference.

**Upgrade notes**

- No database migrations.
- If you kept CLI settings in `.env.node`, rename it to `.env`, or set `JANT_ENV_FILE=.env.node`.
