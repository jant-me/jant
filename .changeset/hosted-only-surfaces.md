---
"@jant/core": patch
"create-jant": patch
---

Compatibility, Configuration, and Command line say which surfaces serve only the hosted service or local debugging and can change in any release: `SITE_RESOLUTION_MODE`, the `HOSTED_CONTROL_PLANE_*` variables, `DEV_API_TOKEN`, the `DEMO_*` variables, `--site`, `--host`, and `--path-prefix` when they pick a site from a shared database, and `/api/palette`.

**Upgrade notes**

- No database migrations.
