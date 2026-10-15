---
"@jant/core": patch
"create-jant": patch
---

When Wrangler fails during `jant deploy`, or any other `jant` command that runs Wrangler against D1 or R2, the error now shows what Wrangler reported. Behind a proxy, Wrangler prints a "Proxy environment variables detected" warning on every run, and the error showed that warning in place of the cause, such as `Couldn't find a D1 DB with name or binding 'DB'`.

**Upgrade notes**

- No database migrations.
