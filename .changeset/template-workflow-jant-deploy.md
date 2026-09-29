---
"@jant/core": minor
"create-jant": minor
---

The deploy workflow new projects get runs `jant deploy`. It ran `wrangler d1 migrations apply` and `wrangler deploy` itself, which skipped the data backfills `jant migrate` runs and uploaded unprefixed assets for a site under `SITE_PATH_PREFIX`, so its styles and scripts 404ed.

**Upgrade notes**

- No database migrations.
- A project created before this release keeps the old workflow. In `.github/workflows/deploy.yml`, replace the "Run migrations" and "Deploy to Cloudflare Workers" steps with one step that runs `npx jant deploy` (`pnpm exec jant deploy`, or `yarn jant deploy`) with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set from the same secrets. Then run `npx jant migrate --remote` once, or push, to apply backfills the old workflow skipped.
