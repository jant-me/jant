---
"@jant/core": patch
"create-jant": patch
---

The FAQ says how to get back into a self-hosted site after forgetting the password: `jant reset-password`, with `--remote` on Cloudflare or through `docker compose exec` on Docker, then the printed `/reset` link on the site. New projects' README runs the reset against the deployed site; `npm run reset-password` alone resets the local development database.

**Upgrade notes**

- No database migrations.
