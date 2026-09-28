---
"@jant/core": patch
"create-jant": patch
---

`DEV_API_TOKEN` works only for a request that comes from the machine Jant runs on. It used to be enough for the request to name a local host, and the `Host` header is the client's to write, so on a Node server reachable from outside, anyone who knew the token could use it.

**Upgrade notes**

- No database migrations.
- `DEV_API_TOKEN` is a local debugging aid. Remove it from production configuration.
