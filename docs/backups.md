# Backups and recovery

This page covers backup and recovery strategy for production deployments. For the syntax, flags, and archive layout of the export/import commands shipped by `@jant/core`, see [Export and import](export-and-import.md).

One core constraint: **a complete Jant backup must cover both the database and media storage**. Without the database you lose posts, collections, settings, and media metadata. Without media you keep the records pointing at the files but lose the files themselves. Neither one alone restores a working site.

A complete backup spans these layers:

- **Content**: `post` / `collection` / `nav_item` / `path_registry` / media records
- **Configuration**: `site_setting`
- **Auth**: `user` / `session` / `account` / `api_token` / `verification`
- **Binary**: the uploaded media files themselves (a local directory or an S3-compatible bucket)

## Deleted media recycle window

Jant keeps a built-in safety net for media deletions. When media is deleted — whether by a user, the compose-orphan cleanup sweep, or a post deletion — the database row is removed and the object's **original key is freed immediately**, so the original URL 404s right away (a buggy or accidental deletion surfaces at once rather than silently).

On storage backends that support server-side copy (S3-compatible, including Cloudflare R2 via its S3 API), the bytes are not lost: they are first moved to an internal `trash/` key recorded in the `storage_purge` table, and physically deleted only after a **30-day retention window** by the upload cleanup sweep (`jant uploads cleanup`). Within those 30 days the object is recoverable from its trash key. This matters most on object stores without versioning (for example Cloudflare R2 by default), which offer no undelete of their own.

On backends **without** server-side copy (the R2 Workers binding, local disk), deletion is immediate with no recycle window.

This is a recovery convenience, **not** a substitute for the database + media backups below: it only protects the bytes for a bounded window, doesn't help if the storage backend itself is lost, and doesn't cover full-site teardown (which deletes objects immediately).

## Choosing the right tool

| Need                                        | Use                                             |
| ------------------------------------------- | ----------------------------------------------- |
| Move content between Jant sites             | `site export` / `site import`                   |
| Restore the same IDs and storage keys as-is | `site snapshot export` / `site snapshot import` |
| Recover from production data loss           | Database backup + media backup                  |

`site export` and `site snapshot` are content-layer backups. They don't replace a backup plan for the underlying database and object storage themselves.

The commands below use the auto-detected runtime (local D1 or Node) by default. In production, pass `--remote` / `--node` explicitly. For flag semantics and environment variables, see [Export and import § Runtime targets](export-and-import.md#runtime-targets) and [Configuration](configuration.md).

## site snapshot

A snapshot is decoupled from the underlying deployment, which makes it useful as a portable recovery archive. The examples below cover the auto-detected runtime (D1 or Node, decided by environment variables) and remote Cloudflare D1:

```bash
mkdir -p backups
npx jant site snapshot export --output ./backups/jant-site-snapshot-$(date +%F).zip
npx jant site snapshot export --remote --config ./wrangler.toml --output ./backups/jant-site-snapshot-$(date +%F).zip
```

Node + Postgres deployments should set the target explicitly rather than relying on auto-detection:

```bash
DATABASE_URL=postgres://... npx jant site snapshot export --node --output ./backups/jant-site-snapshot-$(date +%F).zip
```

Restore requires explicit `--replace`:

```bash
npx jant site snapshot import --path ./backups/jant-site-snapshot-2026-03-30.zip --replace
npx jant site snapshot import --remote --config ./wrangler.toml --path ./backups/jant-site-snapshot-2026-03-30.zip --replace
```

Without `--replace`, the command refuses to run, preventing accidental overwrites. With `--replace`, content-scope tables in the target database are wiped and rewritten from the archive (`post`, `collection`, `nav_item`, `collection_directory_item`, `thread_collection`, `media`, `path_registry`). Auth tables — `user`, `session`, `api_token`, etc. — are not touched. For archive layout and the `--skip-objects` and `--allow-missing-objects` options, see [Export and import § Site snapshot](export-and-import.md#site-snapshot-site-snapshot).

## Docker and Node

### Default Docker Compose layout

The repo's bundled `compose.yml` puts local data at:

- `data/jant.sqlite`
- `data/media/`

Archiving a running SQLite file directly can produce an inconsistent snapshot. Stop the service before packing:

```bash
docker compose down
mkdir -p backups
tar -czf ./backups/jant-full-$(date +%F).tar.gz data/jant.sqlite data/media
docker compose up -d
```

Clean the old data before restoring — `tar -xzf` only overwrites same-named files, so leftover objects in `data/media/` would survive and turn into stale data:

```bash
docker compose down
rm -rf data/jant.sqlite data/media
tar -xzf ./backups/jant-full-2026-03-30.tar.gz
docker compose up -d
```

### Bare Node + SQLite + local media

In the default layout, the SQLite file lives at `DATA_DIR` (default `./data`) and the media directory at `LOCAL_STORAGE_PATH` (default `<DATA_DIR>/media`). Stop the process manager, then archive whatever paths your config actually uses:

```bash
set -a; source .env; set +a   # load DATA_DIR / LOCAL_STORAGE_PATH
mkdir -p backups
tar -czf "./backups/jant-full-$(date +%F).tar.gz" \
  "${DATA_DIR:-./data}/jant.sqlite" \
  "${LOCAL_STORAGE_PATH:-${DATA_DIR:-./data}/media}"
```

If `DATABASE_URL` overrides the SQLite path explicitly (for example `DATABASE_URL=file:/var/lib/jant/custom.sqlite`), archive whatever path the URL points at.

### Node + Postgres

```bash
set -a; source .env; set +a
mkdir -p backups
pg_dump "$DATABASE_URL" > ./backups/jant-db-$(date +%F).sql
```

If you're still on local media storage, archive the directory pointed at by `LOCAL_STORAGE_PATH` (default `<DATA_DIR>/media`):

```bash
tar -czf ./backups/jant-media-$(date +%F).tar.gz data/media
```

Stop the Jant process before restoring, and make sure the target database is empty — `pg_dump` doesn't include `CREATE DATABASE` by default, so you may need `dropdb && createdb` first. Concurrent writes will corrupt a database that's mid-restore:

```bash
psql "$DATABASE_URL" < ./backups/jant-db-2026-03-30.sql
```

### Node + S3-compatible storage

When media lives in S3, Backblaze B2, MinIO, Cloudflare R2, or any other S3-compatible object store, the backup splits into a database half and an object half.

Jant uses `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` at runtime, while the AWS CLI uses the `AWS_*` credential chain or `~/.aws/credentials`. The two **don't share state** — your backup script needs to either set credentials for the AWS CLI separately, or point at a pre-configured profile with `--profile`.

```bash
set -a; source .env; set +a
mkdir -p backups

# Database
pg_dump "$DATABASE_URL" > ./backups/jant-db-$(date +%F).sql

# Objects (AWS S3)
aws s3 sync "s3://$S3_BUCKET" "./backups/media-$(date +%F)/"

# Objects (S3-compatible, e.g. R2, B2, MinIO)
aws s3 sync "s3://$S3_BUCKET" "./backups/media-$(date +%F)/" \
  --endpoint-url "$S3_ENDPOINT" \
  --profile your-s3-compatible-profile
```

Reverse restore (push the local copy back to the bucket):

```bash
aws s3 sync "./backups/media-2026-03-30/" "s3://$S3_BUCKET"
```

If versioning is enabled on the bucket, **prefer console-based restore** — `aws s3 sync` doesn't pass `--delete` by default, but any later mistake can still propagate a "missing" file from your local copy back to production. In production, prefer the object store's own versioning or cross-region replication; treat local sync as a supplementary offline copy.

## Cloudflare Workers

Backup strategy for D1 + R2 deployments has two layers:

1. **Off-platform copies**: regularly export SQL and snapshots so a platform-level outage still leaves you with a recoverable archive.
2. **In-platform recovery**: D1 time-travel / point-in-time restore, plus R2 lifecycle and cross-bucket replication policies.

Off-platform copies use `--remote`. The target D1 and R2 binding are read from `wrangler.toml` (in scripted contexts, point at a specific file with `--config`):

```bash
mkdir -p backups
npx jant db export --remote --config ./wrangler.toml --output ./backups/jant-db-$(date +%F).sql
npx jant site snapshot export --remote --config ./wrangler.toml --output ./backups/jant-site-snapshot-$(date +%F).zip
```

`--remote` runs through the `wrangler` CLI, so the current shell needs `wrangler login` already completed or `CLOUDFLARE_API_TOKEN` set.

`db export` gives you a standalone database SQL file. `site snapshot export` gives you a content archive that includes the referenced objects. Neither replaces D1's recovery flow or R2's object retention policy.

## Recovery checklist

### Cloudflare

1. **Database**: load the SQL back with `wrangler d1 execute <db> --file=./backups/jant-db-*.sql --remote`, or roll back with D1 time-travel; for snapshots, use `npx jant site snapshot import --remote --replace`.
2. **Objects**: refill missing objects from R2 versioning or your offline copy.
3. **Deploy**: no redeploy needed if bindings haven't changed; only update `wrangler.toml` and redeploy when D1 or R2 has changed.
4. **Verify**: home page, collection pages, media URLs, settings page.

### Docker or Node

1. Stop the app.
2. Restore the database file or database service (see the matching section above for `psql < ...` or `tar -xzf`; clean old data first).
3. Restore the media files or media bucket.
4. Start the app.
5. Verify posts, collections, uploads, and the feed.

## Recovery drill

Run a complete restore in a staging environment at least once. Record both RPO (the data loss you can tolerate) and RTO (the recovery time you can tolerate).

Drill steps:

1. Restore the database in a clean environment.
2. Restore media.
3. Start Jant.
4. Open the home page, the settings page, and a sample of post URLs.
5. Verify attachments and collection pages.
6. Record duration and data loss; adjust the plan against your RPO / RTO targets.

A backup that hasn't been fully restored in a blank environment doesn't count as a working backup.

## What's next

- [Export and import](export-and-import.md) — syntax, flags, and archive structure for export/import commands
- [Automation and API](automation-and-api.md) — scripting and scheduling backups
- [GitHub sync](github-sync.md) — content-layer Git history copy
