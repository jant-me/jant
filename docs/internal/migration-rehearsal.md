# Migration Rehearsal

This project keeps a dedicated D1 migration rehearsal flow separate from normal CI.

## Why

- Local tests already validate migration metadata and fresh local D1 imports.
- The missing layer is a real remote D1 upgrade path.
- The rehearsal database must stay disposable and reproducible. Do not point CI at preview, demo, or a long-lived manually edited database.

## Fixture Model

The rehearsal command rebuilds a D1 database in four steps:

1. Reset the target D1 database.
2. Apply schema migrations up to a recorded baseline tag.
3. Import a frozen SQL snapshot compatible with that baseline.
4. Run current schema migrations and backfills.

Current fixture:

- Manifest: `packages/core/src/db/rehearsal-fixtures/demo-current.json`
- Seed SQL: `packages/core/src/db/rehearsal-fixtures/demo-current.sql`

Run it locally:

```sh
mise run db-wrangler-rehearse
```

Run it against the dedicated remote rehearsal database:

```sh
mise run db-remote-rehearse
```

Remote execution uses two different paths on purpose:

- Schema migrations are replayed statement-by-statement against remote D1 so rehearsal does not depend on Wrangler uploading a synthetic merged SQL file.
- Fixture seed imports are sent to the Cloudflare D1 `/query` API in small SQL batches. This avoids Wrangler's file-upload path, which proved flaky for larger fixture imports on some networks.

Local remote rehearsal reads these environment variables:

- `CLOUDFLARE_ACCOUNT_ID` (or legacy `CF_ACCOUNT_ID`)
- `CLOUDFLARE_API_TOKEN`
- `CF_MIGRATION_REHEARSAL_DB_ID`
- `CF_MIGRATION_REHEARSAL_DB_NAME`
- Optional: `MIGRATION_REHEARSAL_FIXTURE`

It loads `packages/core/.env` first, then `packages/core/.env.local`, and finally lets explicit shell environment variables override either file.

If the remote fixture import hits a transient network error, rehearsal retries the whole fixture import from the start. The current frozen fixture is safe to replay because it begins by clearing the content tables before re-inserting rows.

## GitHub Actions Activation

The workflow lives at `.github/workflows/migration-rehearsal.yml`.

It is path-gated for migration-related changes on `push` and `pull_request`, and also runs on `workflow_dispatch` and nightly `schedule`.

To enable the remote job, configure:

- GitHub secret `CF_API_TOKEN`
- GitHub secret `CF_ACCOUNT_ID`
- GitHub variable `CF_MIGRATION_REHEARSAL_DB_ID`
- GitHub variable `CF_MIGRATION_REHEARSAL_DB_NAME`

The rehearsal database should be a dedicated remote D1 database used only for CI resets and migration playback.

## Production table cutovers

Migration rehearsal proves that a known fixture upgrades correctly. It does not
make a destructive table replacement safe while the old application is still
writing. A migration that copies rows into a replacement table and then drops
the source table requires a write maintenance window unless it was deliberately
designed as a multi-release expand/backfill/cutover change.

Before such a migration:

1. Stop or drain every application instance that can write the source table.
2. Record a database recovery point (for D1, a Time Travel bookmark) and keep an
   off-platform backup appropriate to the deployment.
3. Run `jant migrate` and keep writes stopped while its post-migration
   verification runs.
4. Deploy the application version that reads the replacement schema.
5. Verify the migrated row count and application health before resuming writes.

This matters especially for Cloudflare deployments because `jant deploy`
applies remote migrations before uploading the new Worker. The old Worker can
remain active during that interval. Preflight and postflight checks detect bad
references, invalid Thread roots, and count mismatches, but they cannot prevent
a concurrent old-version write from racing a destructive cutover.

For D1, rehearse with production-scale row counts as well as representative
data. If a single copy or aggregation may approach D1's query-duration limit,
replace the one-shot migration with a staged, resumable backfill.

## Content-Lab Workflow

Use a separate long-lived Worker plus D1 database for manual content entry and visual review. That environment is for humans, not for CI resets.

Recommended loop:

1. Capture or curate real content in the content-lab Worker.
2. Run `mise run db-content-lab-export`.
3. Copy the snapshot into `packages/core/src/db/rehearsal-fixtures/`.
4. Update the fixture manifest's `baseMigrationTag` to the latest migration tag on `main`.
5. Verify with `mise run db-wrangler-rehearse`.
6. Commit the refreshed fixture in a separate change when possible.

The content-lab snapshot is written to `sites/content-lab/scripts/content-lab-snapshot.sql` and stays out of Git by default.

If you want a one-off export command from another site directory with the right `wrangler.toml`, use:

```sh
pnpm exec jant db export --remote --output scripts/rehearsal-snapshot.sql
```

If the content-lab site uses a non-default Wrangler environment, pass `--config`, `--env`, and `--database` explicitly.
