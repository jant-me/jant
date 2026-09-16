# Content-Lab Worker

`sites/content-lab` is a long-lived Jant environment for manual content entry, visual QA, and collecting real-ish data before freezing a migration rehearsal snapshot.

This site is not part of CI reset flows. Treat it as a human-facing staging space.
It is not the publishing source for the public demo. That role belongs to
`sites/demo-source`.

## Purpose

- Enter and edit real content through the actual UI.
- Check layouts, media handling, and authoring flows with non-demo data.
- Export a content snapshot that can later be curated into `packages/core/src/db/rehearsal-fixtures/`.

## Required Resources

Before deploying, replace the placeholder values in `sites/content-lab/wrangler.toml`:

- `SITE_ORIGIN`
- `SITE_PATH_PREFIX` if you want a subpath deploy
- `database_id`
- `bucket_name` if you want a different R2 bucket name
- Optional: `R2_PUBLIC_URL`
- Optional: `IMAGE_TRANSFORM_URL`

Wrangler can read your Cloudflare account from `CLOUDFLARE_ACCOUNT_ID`, so this file does not hardcode `account_id`.

You also need:

- a dedicated D1 database for content-lab
- a dedicated R2 bucket for uploaded media
- `AUTH_SECRET` configured in Cloudflare and in your local `.dev.vars` when developing locally

## Commands

```sh
pnpm --filter jant-content-lab dev
pnpm --filter jant-content-lab deploy
pnpm --filter jant-content-lab export
```

Or use the repo-level tasks:

```sh
mise run dev-content-lab
mise run deploy-content-lab
mise run db-content-lab-export
mise run db-content-lab-clean
```

## GitHub Actions deploy

`sites/content-lab` deploys from the repo root workflow
[`deploy-content-lab.yml`](../../.github/workflows/deploy-content-lab.yml),
which is `workflow_dispatch` only — run it by hand from the Actions tab. Pushing
to `main` does not deploy it.

Configure these repository secrets before relying on CI deploys:

- `CF_API_TOKEN`
- `CF_ACCOUNT_ID`

## Snapshot Workflow

1. Add or edit content in the content-lab Worker.
2. Run `mise run db-content-lab-export`.
3. Review the generated `sites/content-lab/scripts/content-lab-snapshot.sql`.
4. Copy the curated snapshot into `packages/core/src/db/rehearsal-fixtures/`.
5. Update the fixture manifest's `baseMigrationTag`.
6. Verify with `mise run db-wrangler-rehearse`.

The exported snapshot is intentionally ignored by Git. It is a working artifact, not a canonical fixture.
