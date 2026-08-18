# Archive: configurable default layout + `view` → `layout`

## Why

`/archive` is the "All" entry in the Featured / Latest / All nav trio. The other
two render as `TimelineFeed`; archive was the only one defaulting to a different
layout (grid), so every reader who wants to read had to click the toggle first.

Two changes:

1. Make the default layout a site setting (`ARCHIVE_DEFAULT_LAYOUT`), defaulting
   to `list`. Env var + Config Editor, same shape as `MAIN_RSS_FEED`.
2. Rename the URL param `view` → `layout`, freeing `view` for the saved-selection
   concept coming next.

Month markers in list view were built and then dropped — see "Reverted" below.

## URL semantics

`layout` absent = site default. Both toggle buttons emit an explicit
`layout=grid` / `layout=list`, so a shared link keeps its layout even if the site
default later changes. `buildFilterUrl` no longer special-cases either value,
which keeps all 26 call sites untouched.

`view` is kept readable **indefinitely**, per the coding-standards rule that
param renames on shareable URLs require accept-old/emit-new parsing. Two layers,
because they cover different traffic:

- `legacyArchiveParamsRedirect()` 308s `/archive?view=X` → `?layout=X`, joining
  the existing `hasMedia`/`hasTitle`/`hasReplies` rewrites. A `view` value the
  page cannot render is dropped rather than carried forward.
- `parseArchiveParams()` reads `layout` then falls back to `view`. This is what
  actually keeps stored `path_registry.archive_query` overrides alive — the
  redirect deliberately never sees them.

`layout` wins when a URL carries both. Only `layout` is ever emitted.

## Tasks

- [x] `CONFIG_FIELDS.ARCHIVE_DEFAULT_LAYOUT` (enum, default `list`) + `AppConfig`
- [x] `types/bindings.ts`, `lib/resolve-config.ts` (`parseArchiveLayout`)
- [x] `ui/dash/settings/ConfigEditorContent.tsx`: description + option labels
- [x] Export/sync projections: `routes/api/export.ts`, `services/export.ts`
      (interface + both TOML writers → `archive_default_layout`),
      `lib/github-sync-site-config.ts`, `services/site-admin.ts`, fixtures
- [x] Docs: `docs/configuration.md` (both tables + compat note), `docs/API.md`
- [x] `ArchiveView` → `ArchiveLayout`, moved to `types/constants.ts`
- [x] `ArchiveFilters.view` → `.layout`, `defaultView` → `defaultLayout`,
      `ViewToggle` → `LayoutToggle`, toggle aria-label "View mode" → "Layout"
- [x] Dual parse + canonical redirect
- [x] Tests: route-level compat cases, component layout cases, config resolution

## Reverted

List-view month markers were built and then dropped at the author's request.
Removing them also removed the orphaned `.archive-list-groups` /
`.archive-list-month-header` CSS that `97c3d163` left behind, so list view is now
back to a flat `TimelineFeed` with no dead styles attached.

`formatYearMonthLabel` in `lib/time.ts` was introduced for the markers and was
**kept**: `toArchiveGroups` and `toArchiveGroupsWithMedia` each carried their own
copy of the same `toLocaleDateString` call, and both now read one function. It is
cleanly separable if it should go too.

Two pre-existing tests in `archive-params.test.ts` asserted month headers through
the default layout; they now ask for `?layout=grid` explicitly, since month
headers are a grid affordance.

## Verification

`check-tests` (3621 passed), `check-lint`, `check-types`, `check-copy`,
`i18n-build` (100% zh-Hans/zh-Hant). Live checks against the demo snapshot:
default renders list; `?view=grid|list` 308s to `?layout=`; both spellings keeps
`layout`; an unrenderable `view` value is dropped; `?layout=grid` is canonical;
a seeded `path_registry` row with `archive_query = "view=grid"` renders grid with
no redirect.

`check-format` reports 11 unformatted files — all pre-existing, identical count
with these changes stashed.

## Separate, pre-existing

`?sort=updated` renders month labels out of order whenever `thread_updated_at` is
NULL: `ORDER BY coalesce(thread_updated_at, -1) DESC` collapses every NULL row to
one key and falls through to `id DESC`, while the row mapper in
`services/post.ts` reports `threadUpdatedAt: row.threadUpdatedAt ??
row.lastActivityAt ?? row.publishedAt ?? row.updatedAt`. So the page is ordered
by id but labelled by a real published date.

Backfill `0005_split_thread_activity_from_quiet_replies.sql` populates the
column; applying its step 2 to the local D1 made the grid perfectly monotonic.
The gap is that `sites/demo-source/canonical/snapshot` ships without it, so local
dev shows a scrambled updated sort. Worth refreshing the snapshot.

## Also fixed: Wrangler JSON parsing under a proxy

Wrangler writes "Proxy environment variables detected. We'll use your proxy for
fetch requests." to **stdout**, so a bare `JSON.parse` of `--json` output throws
for anyone with `HTTPS_PROXY` / `ALL_PROXY` set. `mise run dev-debug` died this
way (`SyntaxError: Unexpected token 'P', "Proxy envi"...`).

`bin/lib/d1-query.js` already had a private `extractJson` guard on its success
paths. It is now `extractWranglerJson` in its own module,
`bin/lib/wrangler-json.js`, and every Wrangler JSON consumer goes through it:

- `bin/lib/d1-query.js` — success paths plus `parseWranglerError`, which was
  unguarded and silently degraded to dumping raw output under a proxy
- `dev/scripts/dev-auth-db.mjs` — the one that broke `dev-debug`
- `scripts/nuke-db.mjs`, `scripts/lib/remote-site-ops.mjs`,
  `scripts/demo-source/lib/runtime.mjs`, `scripts/demo-public/lib/runtime.mjs`

The helper lives in its own file rather than in `wrangler-cli.js` on purpose:
`d1-query.test.ts` and `r2-query.test.ts` stub `wrangler-cli.js` wholesale, so a
pure function placed there comes back `undefined` under test. Spawning and
parsing are now separate modules — the first is stubbable, the second never is.

Verified by starting `dev-debug` with the proxy vars exported: the notice appears
in the log twice, no `SyntaxError`, server serves. Full suite 3621 passed.
