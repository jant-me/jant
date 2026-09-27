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

Fixtures:

- `v0.3.39` (`packages/core/src/db/rehearsal-fixtures/v0.3.39.json`, baseline
  `0004_perpetual_eternity`): a site written by @jant/core 0.3.39 itself, the
  oldest release `docs/compatibility.md` says upgrades in place. It holds every
  post format, a Thread whose reply is in a collection its root isn't,
  each visibility and a draft, a post deleted on 0.3.39, attachments of each
  kind, navigation, and custom URLs. This is the default, locally, remotely,
  and in CI.
- `pinned-reply-memberships` (baseline `0026_absent_rhodey`, written by hand):
  collection memberships with positions and pinned times on a root and its
  reply, which releases after 0.3.39 could set and the Thread migration must
  merge. `src/db/__tests__/migration-rehearsal.test.ts` rehearses both.

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

If the remote fixture import hits a transient network error, rehearsal retries the whole fixture import from the start, after deleting from every table the seed writes, children first, so the batches that went through aren't inserted twice.

## GitHub Actions Activation

The workflow lives at `.github/workflows/migration-rehearsal.yml`.

It is path-gated for migration-related changes on `push` and `pull_request`, and also runs on `workflow_dispatch` and nightly `schedule`.

To enable the remote job, configure:

- GitHub secret `CF_API_TOKEN`
- GitHub secret `CF_ACCOUNT_ID`
- GitHub variable `CF_MIGRATION_REHEARSAL_DB_ID`
- GitHub variable `CF_MIGRATION_REHEARSAL_DB_NAME`

The rehearsal database should be a dedicated remote D1 database used only for CI resets and migration playback.

## Node runtime: Postgres and SQLite

Hosted Jant runs on Postgres and the Docker image on SQLite, both through the
Node runtime, whose migrator is Drizzle's rather than the D1 runner above.
`dev/scripts/node-rehearsal.mjs` rehearses that path for a manifest whose
`dialect` is `pg` or `sqlite`:

1. Create a throwaway database: the one named by `PG_REHEARSAL_DATABASE_URL`
   (recreated from `PG_REHEARSAL_ADMIN_DATABASE_URL`), or a temporary SQLite
   file.
2. Apply the migrations up to `baseMigrationTag`, through a copy of the
   migrations folder whose journal stops there.
3. Load the seed.
4. Run `jant migrate --node`: every later migration, then every backfill.
5. Check that every migration is recorded, and the manifest's assertions.
6. Serve the upgraded database and read the manifest's `pages` as a
   signed-out reader: each page's status, redirect target, and text it must
   and must not show.

`mise run check-pg-rehearsal` runs `pg-v0.3.39` (baseline
`0002_breezy_lockjaw`) in the `PG Smoke` CI job, against its Postgres
service. `mise run check-sqlite-rehearsal` runs `v0.3.39`, the D1 fixture's
seed, in `check-ci`; it needs no database. `jant db rehearse` reads a
manifest's seed and assertions and ignores `dialect` and `pages`.

The seeds leave out `data_migration`, which the backfill runner creates, so
each rehearsal also reruns every backfill over real data; backfills must be
idempotent anyway.

Run it locally against a disposable Postgres:

```sh
docker run -d --name jant-pg -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:17
PG_REHEARSAL_ADMIN_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres \
PG_REHEARSAL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/jant_pg_rehearsal \
mise run check-pg-rehearsal
```

A migration that changes what the assertions count updates the manifest in
the same change, saying why.

## Building a seed from a release

`dev/scripts/build-rehearsal-seeds.mjs` builds both `v<version>` seeds from a
published release: it installs `@jant/core@<version>` from npm, migrates a
SQLite file and a new Postgres database with that release's own `jant migrate`,
starts its `jant start` on each, writes the site through its API, and dumps the
data as `INSERT` statements with declared columns, parents first. Auth
secrets, rate limits, migration bookkeeping, `data_migration`, and SQLite's
search index are left out; each rehearsal reruns every backfill and the
search triggers refill the index.

```sh
cd packages/core
node dev/scripts/build-rehearsal-seeds.mjs \
  --pg-admin-url postgresql://postgres:postgres@127.0.0.1:55432/postgres \
  --version 0.3.39
```

A committed seed is never rebuilt: later migrations are rehearsed against
exactly that data. To move the promise's baseline, build seeds for the new
version, write their manifests with the counts the upgrade must end at, and
point the defaults at them. The script writes the same site against any
release whose API accepts it; an older or newer one may need `writeSite`
adjusted, which changes nothing for seeds already committed.

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
3. Copy the snapshot into `packages/core/src/db/rehearsal-fixtures/` as a new fixture, with a manifest whose `baseMigrationTag` is the latest migration tag on `main`. Existing seeds stay as they are.
4. Verify with `node ./bin/jant.js db rehearse --local --fixture <manifest>`.
5. Commit the new fixture in a separate change when possible.

The content-lab snapshot is written to `sites/content-lab/scripts/content-lab-snapshot.sql` and stays out of Git by default.

If you want a one-off export command from another site directory with the right `wrangler.toml`, use:

```sh
pnpm exec jant db export --remote --output scripts/rehearsal-snapshot.sql
```

If the content-lab site uses a non-default Wrangler environment, pass `--config`, `--env`, and `--database` explicitly.
