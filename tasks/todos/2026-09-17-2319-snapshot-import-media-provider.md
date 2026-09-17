# Snapshot import records media under the target's storage driver

## Problem

On the Docker demo (2026-09-17), 8 of 9 images on the home page return 404.

- `jant site snapshot import` uploads every object into the **target** storage, but
  restores the `media` rows verbatim, `provider` included. The canonical snapshot
  was exported from demo-source (Workers, R2), so all 10 rows say `r2` while the
  bytes now sit in an S3 bucket.
- `provider` is the program's record of where a file's bytes live, and several
  paths rely on it:
  - public URL selection (`getPublicUrlForProvider` in `view.ts`, `api-posts.ts`,
    `media-helpers.ts`): `r2` rows look for `R2_PUBLIC_URL`, unset on an S3
    instance, and fall back to a root-relative `/media/...`
  - the `(provider, storage_key)` unique index and `getByStorageKey(key, provider)`
    (avatar and favicon replacement): an `r2` row is not found, so a second row
    for the same object is inserted
  - `storage_purge` entries copy the row's provider, and the sweep only purges
    entries for the active driver: trashed objects of `r2` rows on an S3
    instance are never purged
- `getImageUrl` joins `${transformUrl}/${params}/${originalUrl}`. A root-relative
  `originalUrl` produces `…/fit=scale-down//media/...`, which Cloudflare rejects
  (`cf-resized: err=9404`); the same URL with a single slash returns the image.
  Its JSDoc example claims it absolutizes relative URLs; it does not.

Anyone importing a snapshot across drivers (Workers R2 → Docker or hosted S3)
hits the first bug. Changing demo-source or the snapshot file would only move it:
the Workers demo imports the same snapshot for rollback.

## Plan

- [x] `bin/lib/site-snapshot.js`: a SQL builder that sets `media.provider` for a
      site to a validated storage driver, with a test
- [x] `site snapshot import`: run it in the same atomic statement as the import.
      Node context reports the driver it uploads through
      (`getConfiguredStorageDriver`); D1 context uploads through wrangler R2, so
      `r2`
- [x] `dev/scripts/reset-node-dev.ts` has its own copy of the import: same fix
- [x] CLI test: a snapshot whose rows say `r2`, imported into local storage, ends
      with `provider = 'local'`
- [x] `getImageUrl`: no double slash for root-relative sources; fix the JSDoc;
      tests
- [x] Docs: note in `docs/export-and-import.md` (en, zh-Hans) that imported media
      is recorded under the importing instance's storage, if the page covers
      storage
- [x] `mise run check-tests`, `mise run check-lint`, `mise run check-copy`
- [ ] After merge: redeploy the demo (`gh workflow run reset-demo-studio.yml`),
      confirm every home-page image returns 200

## Results (2026-09-17)

- `buildMediaProviderSql` runs after the snapshot's inserts in the same atomic
  statement, in the CLI import (Node: `getConfiguredStorageDriver`, now exported
  from `dist/node.js`; D1: `r2`) and in `reset-node-dev.ts`.
- `getImageUrl` drops the leading slash of a root-relative source and a trailing
  slash on the transform URL. The existing test asserted the double-slash output;
  it now asserts the fixed one.
- New tests: the CLI imports a hand-built snapshot whose row says `r2` into local
  storage and the row ends as `local` (fails with `expected 'r2' to be 'local'`
  when the import change is reverted); `buildMediaProviderSql` escapes the site id
  and refuses a non-driver; `getImageUrl` with a prefixed root-relative source and
  with an absolute source.
- End to end with the real canonical snapshot and the built CLI (`migrate`,
  `setup`, `site snapshot import`, `start`; local storage with `LOCAL_PUBLIC_URL`
  and `IMAGE_TRANSFORM_URL`): all 10 media rows recorded as `local`, and the 8
  home-page images are `…/cdn-cgi/image/<options>/https://<public>/media/...`.
- `mise run check-tests` passes (types, lint, 327 files / 4463 tests);
  `mise run check-copy` passes. Docs: `export-and-import.md` (en, zh-Hans).

## Coordination

`claude/youthful-hugle-82f0c2` (d8308811, not on main) rewrites most of
`reset-node-dev.ts` but leaves `importCanonicalSnapshot` unchanged, so the edit
here should merge cleanly.

## Not in scope

Rows already wrong on existing instances (for example a hosted site imported from
Workers). Check with a read-only
`SELECT provider, count(*) FROM media GROUP BY provider` before deciding on a
data fix.
