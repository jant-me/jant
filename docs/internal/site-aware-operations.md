# Site-Aware Operations Design

This document defines the operational boundary for `jant` after the core became
site-aware.

The runtime and service layer now understand `site`, `site_domain`,
`site_member`, and site-scoped content tables. The remaining risk is no longer
the main app. It is the surrounding toolchain:

- CLI commands
- local seed/reset scripts
- remote demo scripts
- snapshot/export helpers
- validation and verification scripts

Without a clear scope model, these tools can silently operate on every site in
the database instead of the intended one.

## Goals

- make destructive tooling safe in shared multi-site databases
- preserve simple single-site UX for self-hosted users
- keep demo and reseed workflows ergonomic
- separate `jant core` operations from future `jant-cloud` platform operations

## Scope Model

There are exactly three operation scopes.

### 1. Instance-Scoped

Instance-scoped commands operate on the database or runtime container as a
whole.

Examples:

- schema migration
- backfills
- health checks
- boot diagnostics
- local development instance reset

Rules:

- these commands are allowed to touch every site in the database
- they must not be routed through normal `site` selection
- they should be rare and explicit
- if destructive, they must be clearly named as instance-level operations
- they should be forbidden against shared remote production databases unless
  the intent is truly database-wide

### 2. Site-Scoped

Site-scoped commands operate on exactly one `site`.

Examples:

- `site export`
- `site import`
- `site snapshot export`
- `site snapshot import`
- content reset for a specific site
- storage cleanup for a specific site
- site verification and site-specific smoke checks
- demo site reseed/export workflows

Rules:

- they must resolve exactly one target site
- they must never silently widen to “all sites”
- if a site cannot be resolved, they must fail with a clear error
- destructive commands should use `site_id` and storage prefix filters, never
  table-wide `DELETE`

### 3. Platform-Scoped

Platform-scoped commands belong in `jant-cloud`, not in `jant core`.

Examples:

- create site
- delete site
- suspend site
- move site between cells
- purge all objects for a site
- run all-sites maintenance jobs

Rules:

- these commands can coordinate both control-plane data and core data
- they are not self-hosted concerns
- they should not leak into ordinary `jant` CLI UX

## Default Rule

After site-aware core, **all content-facing operational commands default to
site scope**.

A command should be instance-scoped only when its primary purpose is database
or runtime administration rather than site content management.

If a command asks “which posts/media/settings should I touch?”, it is almost
certainly site-scoped.

## Self-Hosted Product Boundary

Self-hosted Jant remains a single-site product experience.

This means:

- self-hosted users should rarely need to specify a site manually
- most site-scoped commands should auto-resolve the only site in
  `single-site` mode
- this does not make the command instance-scoped
- it is still conceptually site-scoped, just with implicit resolution

That distinction matters because the same command must remain safe when used
against a shared host-based database.

## CLI Resolution Contract

Site-scoped CLI commands resolve their site in this order:

1. explicit `--site <key|id>`
2. explicit `--host <host>`, with `--path-prefix` for a prefixed domain
3. explicit `--url <url>`
4. single-site mode with exactly one site in the instance
5. otherwise fail

Passing more than one of `--site`, `--host`, and `--url` is an error, not a
precedence question.

Host-based mode always needs a selector, even when the database holds one site
today. A hosted database holds every tenant, so a fallback to "the only site"
works until the second tenant signs up and then fails. Without a selector the
command stops before it queries anything, and the error names the three flags.

Two resolvers implement the contract, with the same messages:

- `resolveCliSite()` in `packages/core/src/runtime/site.ts`, through the site
  service, for `createNodeCliRuntime()`
- `resolveCliSite()` in `packages/core/bin/lib/site-selection.js`, in raw SQL,
  for the D1 path and snapshot tooling

`parseCliSiteSelector()` in the same bin file turns the flags into the selector
both take. Neither resolver may call the site service's single-site lookups
(`getOnlySite`, `resolveSingleSite`, `ensureSingleSite`) in host-based mode:
their error tells the operator to restore `SITE_RESOLUTION_MODE=host-based`,
which is only true in single-site mode.

There is no environment variable for the target site. `JANT_SITE` already names
the site URL in the public agent skill (`docs/skill.md`), and an exported
variable that silently picks a tenant is the wrong default for commands like
`reset-password`.

## Import / Snapshot Boundary

### Site Import

`site import` should always target an existing site.

Rules:

- import is content restoration into a chosen site
- it should not create a new site container
- if no site exists yet, the operator should complete `/setup` first

This matches the current product model: setup creates the site, import fills
its content.

### Site Snapshot Import

Default behavior should also target an existing site.

Rules:

- `site snapshot import` should restore one site into one existing target site
- it should not silently create a new site by default
- if future disaster recovery needs site creation, that should be an explicit
  separate mode such as `--create-site`, and only in carefully constrained
  environments

Mode-specific rule:

- `single-site` mode should auto-remap a snapshot into the only initialized
  site when the embedded `site_id` differs
- `host-based` mode should stay strict by default and require an explicit
  `--remap-site` for cross-site restores
- reserve site creation for setup or future platform tooling

Special case:

- trusted cross-environment content publishing workflows may use an explicit
  remap mode such as `--remap-site`
- remap mode should rewrite snapshot `site_id` and storage keys to the resolved
  target site
- this is appropriate for curated workflows like demo content promotion, not
  general disaster recovery
- internal publish scripts should still pass `--remap-site` explicitly even in
  `single-site` mode so their intent stays visible in code review and logs

## Storage Boundary

Storage cleanup must follow the same scope model as content cleanup.

Rules:

- object enumeration should come from `media` and `site_setting`
- it must be filtered to one `site_id`
- object keys should also be validated to match the expected site prefix
- no storage cleanup script should enumerate objects for every site unless it
  is clearly a platform or instance operation

Recommended key sources:

- `media.storage_key`
- `media.poster_key`
- `site_setting` values for avatar/favicon/site assets

The old `setting` table should not appear in any site-aware storage scripts.

For demo-public specifically, keep storage cleanup as a dedicated operational
step separate from snapshot import. Demo maintenance needs the freedom to
purge viewer-uploaded junk and orphaned objects without changing the product
contract of `site snapshot import`.

## Script Classification

### Should Be Site-Scoped

These scripts should operate on exactly one site and must be updated
accordingly:

- `scripts/demo-public/clear-storage.mjs`
- `scripts/demo-source/clear-storage.mjs`
- `scripts/demo-public/clear-content.mjs`
- `sites/content-lab/scripts/clear-content.mjs`
- `sites/content-lab/scripts/export-content-lab.mjs`
- `scripts/demo-public/verify.mjs`

Implementation rule:

- all content queries and deletes must filter by `site_id`
- all asset queries must read from `site_setting`, not legacy `setting`

### Should Stay Instance-Scoped But Be Explicitly Marked

The old local SQL seed/export workflow should be removed instead of carried
forward. Local development should use:

- migrations
- shell bootstrap
- canonical snapshot import

### Should Move Out Of Core Over Time

Anything that truly means “operate across all sites” should eventually move to
`jant-cloud` or a platform-only admin surface.

Examples:

- delete every site
- purge all storage for the deployment
- bulk reseed every managed demo
- fleet-wide verification

## Recommended Naming Convention

Naming should reveal scope.

Good patterns:

- `site export`
- `site snapshot export`
- `site verify`
- `site clear-storage`
- `instance reset-local`
- `instance seed-local`

Bad pattern:

- a generic `reset` or `export` command whose scope depends on hidden runtime
  assumptions

## Safe Defaults

For all destructive site-scoped tooling:

- require an explicit site when not in single-site mode
- print the resolved site before executing
- fail if the query would touch rows without a `site_id` predicate

For all instance-scoped tooling:

- require local/dev mode unless a future explicit `--force-instance` flag is
  provided

## Current Audit Findings

### P1

- remote clear-storage scripts still query legacy `setting`
- local seed/reset/export scripts still reflect the old global schema
- remote content reset scripts still use table-wide deletes

### P2

- remote export/verify helpers still assume one-site-per-database

## Recommended Execution Order

1. add shared helpers for site-scoped SQL selection in ops scripts
2. fix all remote site scripts to filter by `site_id`
3. migrate storage scripts from `setting` to `site_setting`
4. quarantine local dev instance scripts behind explicit naming and docs
5. only after that, decide whether any remaining instance-wide tools belong in
   `jant core` or should move to `jant-cloud`

## Decision Summary

- self-hosted UX stays simple
- operational safety wins over convenience
- content tools are site-scoped by default
- instance-wide destructive scripts are local/dev-only unless clearly promoted
  into platform tooling
- future all-sites operations belong in `jant-cloud`, not in ordinary core
  scripts
