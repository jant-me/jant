# Site-Aware Core Implementation Plan

This document turns the approved site-aware core design into an execution plan.

It is intentionally SQLite-first. PostgreSQL support and `jant-cloud` come
after this work lands cleanly in `@jant/core`.

## Scope

This phase will:

- introduce site-aware core tables and site-scoped content tables
- keep self-hosted UX single-site by default
- prepare core for future hosted mode without adding cloud-only tables
- preserve current route/service boundaries

This phase will not:

- add PostgreSQL runtime support
- add `jant-cloud`
- add full hosted SSO
- add team management UI
- expose multi-site creation in self-hosted UX

## Locked Decisions

- `site.id` uses TypeID with `sit_` prefix
- `site.key` remains `key`, not `slug`
- self-hosted mode remains a single-site product experience
- instance mode is controlled by `SITE_RESOLUTION_MODE`
- valid values are:
  - `single-site`
  - `host-based`
- `site_member` belongs in core
- `user/account/session/verification` remain global auth tables inside one core
  instance
- object storage keys use `site.id`, not `site.key`
- storage key prefixes are:
  - `media/{siteId}/files/...`
  - `media/{siteId}/posters/...`
  - `media/{siteId}/assets/...`
  - `sites/{siteId}/exports/...`
  - `sites/{siteId}/snapshots/...`
- self-hosted default site is identified by being the only site in the
  instance, not by a magic `id`, `key`, or `is_default` flag

## Execution Strategy

Do the work in this order:

1. schema
2. site resolution and app context
3. site-scoped services
4. setup/auth/bootstrap changes
5. storage/export/snapshot changes
6. tests and rehearsal

Do not start with routes. Routes should mostly stay thin and adapt to the new
runtime context once the service layer is ready.

## Phase 1: Schema Foundation

### Add New Tables

Add to [`schema.ts`](/Users/green/project/jant/2/packages/core/src/db/schema.ts):

- `site`
- `site_domain`
- `site_member`
- `site_setting`

Recommended first version:

`site`

- `id`
- `key`
- `status`
- `created_at`
- `updated_at`

`site_domain`

- `id`
- `site_id`
- `host`
- `path_prefix`
- `kind`
- `redirect_to_primary`
- `created_at`
- `updated_at`

`site_member`

- `site_id`
- `user_id`
- `role`
- `created_at`
- `updated_at`

`site_setting`

- `site_id`
- `key`
- `value`
- `updated_at`

### Add `site_id` To Existing Tables

Add required `site_id` to:

- `post`
- `media`
- `collection`
- `path_registry`
- `collection_directory_item`
- `thread_collection`
- `nav_item`
- `api_token`

Keep `user/account/session/verification` global.

### Rebuild Indexes And Uniqueness

Every uniqueness rule that currently assumes one global site must become
site-scoped.

Examples:

- `path_registry.path` becomes unique per site, not globally
- `nav_item.position` becomes unique per site
- `nav_item.system_key` becomes unique per site
- `collection_directory_item.position` becomes unique per site
- `api_token.token_hash` can stay globally unique, but should also carry
  `site_id` for ownership and revocation

Hot-path indexes should put `site_id` early in the index definition.

Examples to revisit:

- post feed and archive indexes
- path lookup indexes
- media by post indexes
- collection ordering indexes

### Bootstrap Migration Assumption

Because breaking changes are allowed here, do not design around preserving the
old global schema. The new schema should be the canonical model.

## Phase 2: Site Resolution And Runtime Context

### Add Site Resolution Mode

Add a new env/config helper:

- `SITE_RESOLUTION_MODE`

Expected behavior:

- `single-site`
  - bootstrap exactly one site if none exists
  - all requests resolve to that only site
  - if multiple sites exist, fail fast with a clear startup/runtime error
- `host-based`
  - resolve `Host` and optional `path_prefix` against `site_domain`

Likely files:

- [`app.tsx`](/Users/green/project/jant/2/packages/core/src/app.tsx)
- [`env.ts`](/Users/green/project/jant/2/packages/core/src/lib/env.ts)
- [`app-context.ts`](/Users/green/project/jant/2/packages/core/src/types/app-context.ts)
- [`resolve-config.ts`](/Users/green/project/jant/2/packages/core/src/lib/resolve-config.ts)
- runtime factory files under [`runtime`](/Users/green/project/jant/2/packages/core/src/runtime)

### Extend Request Context

Add to app variables:

- `currentSite`
- `currentSiteDomain`

Potentially also:

- `siteResolutionMode`

### Keep Public URL Handling Separate

Do not mix up:

- public request URL
- site routing resolution
- storage public URL base

`SITE_ORIGIN` should no longer be treated as the live truth for the current site,
and `SITE_PATH_PREFIX` should remain deploy-time configuration rather than site
identity.

## Phase 3: Service Layer Refactor

### Change Service Construction

Current service construction is global:

- [`services/index.ts`](/Users/green/project/jant/2/packages/core/src/services/index.ts)

Refactor to create services in two layers:

- instance/global services
- site-scoped services

Recommended split:

- global:
  - auth identity helpers
  - site lookup/bootstrap services
- site-scoped:
  - posts
  - media
  - collections
  - paths
  - nav items
  - settings
  - api tokens
  - search
  - bootstrap

### Add Core Site Services

Create explicit site-domain services rather than burying site lookup in config
middleware.

Recommended new services:

- `sites`
- `siteDomains`
- `siteMembers`

### Refactor Existing Services

Services currently written against global tables need one of two changes:

- inject `siteId` at construction time
- or require `siteId` in each public method

Prefer construction-time scoping where possible. It keeps route code thinner
and makes accidental cross-site queries harder.

## Phase 4: Auth And Setup

### Setup Flow

Current setup creates the first user and writes global settings.

Refactor setup so it:

1. ensures the default site exists
2. creates the first user
3. creates one `site_member` row with role `owner`
4. writes initial site settings into `site_setting`
5. creates default system nav for that site
6. marks onboarding complete for that site

Likely files:

- [`routes/auth/setup.tsx`](/Users/green/project/jant/2/packages/core/src/routes/auth/setup.tsx)
- [`services/bootstrap.ts`](/Users/green/project/jant/2/packages/core/src/services/bootstrap.ts)
- [`services/auth.ts`](/Users/green/project/jant/2/packages/core/src/services/auth.ts)
- [`auth.ts`](/Users/green/project/jant/2/packages/core/src/auth.ts)

### Deletion Semantics

Current auth deletion wipes the whole instance.

That must be replaced with clearer semantics:

- user deletion
- site deletion
- site suspension

Do not keep `deleteAllData()` as the long-term meaning of "delete account".
For this phase, it is acceptable to:

- keep the destructive reset only in single-site mode
- rename and scope it explicitly so it cannot be mistaken for future multi-site
  account deletion semantics

## Phase 5: Config, Storage, Export, Snapshot

### Move Global Settings To Site Settings

Current settings service is globally keyed:

- [`settings.ts`](/Users/green/project/jant/2/packages/core/src/services/settings.ts)

Refactor it to read/write `site_setting` by `(site_id, key)`.

### Storage Keys

Refactor helpers in [`upload.ts`](/Users/green/project/jant/2/packages/core/src/lib/upload.ts):

- `generateStorageKey(siteId, originalFilename)`
- `getPosterStorageKey(siteId, mediaId)`
- `getSiteStorageKey(siteId, kind, filename)`

Do not derive the live object key from database identifiers later. Store the
actual key in the database.

### Export

`site export` should continue to feel single-site.

Implementation rule:

- export uses the current resolved site only

Likely files:

- [`routes/api/export.ts`](/Users/green/project/jant/2/packages/core/src/routes/api/export.ts)
- [`services/export.ts`](/Users/green/project/jant/2/packages/core/src/services/export.ts)
- [`bin/commands/site/export.js`](/Users/green/project/jant/2/packages/core/bin/commands/site/export.js)

CLI behavior:

- auto-resolve the current site when possible
- allow explicit `--url`, `--host`, or `--site` only when needed

### Snapshot

`site snapshot` must become site-scoped.

Implementation rules:

- snapshot SQL exports only rows for the current site
- snapshot replace deletes only rows for the target site
- auth/session/platform shell state stays out of snapshots
- storage manifest includes only current-site object keys

Likely files:

- [`site-snapshot.js`](/Users/green/project/jant/2/packages/core/bin/lib/site-snapshot.js)
- [`bin/commands/site/snapshot/export.js`](/Users/green/project/jant/2/packages/core/bin/commands/site/snapshot/export.js)
- [`bin/commands/site/snapshot/import.js`](/Users/green/project/jant/2/packages/core/bin/commands/site/snapshot/import.js)
- [`docs/backups.md`](/Users/green/project/jant/2/docs/backups.md)

## Phase 6: Tests And Verification

### Must-Have Tests

- schema and migration tests
- setup flow creates:
  - one site
  - one owner membership
  - site-scoped settings
- service tests prove one site's data cannot leak into another site's queries
- path uniqueness is per-site
- nav uniqueness is per-site
- export only includes current-site content
- snapshot export/import only touches one site

### Existing Tests Likely To Need Updates

- export service tests
- site import/export CLI tests
- site snapshot CLI tests
- migration rehearsal and canonical snapshot tests
- auth tests around setup and account deletion

### Verification Commands

At minimum for implementation phases:

- `mise run check-tests`
- `mise run check-lint`

Use narrower targeted tests while iterating, but do not finish the feature
without the full checks.

## File-Level Work Order

Recommended concrete order:

1. [`schema.ts`](/Users/green/project/jant/2/packages/core/src/db/schema.ts)
2. [`services/index.ts`](/Users/green/project/jant/2/packages/core/src/services/index.ts)
3. new site/site-domain/site-member services
4. [`app-context.ts`](/Users/green/project/jant/2/packages/core/src/types/app-context.ts)
5. runtime creation and site resolution
6. [`settings.ts`](/Users/green/project/jant/2/packages/core/src/services/settings.ts)
7. content services (`post`, `path`, `media`, `collection`, `navigation`,
   `api-token`, `search`)
8. setup/auth/bootstrap flow
9. storage helpers and export/snapshot commands
10. docs and tests

## Team Agent Guidance

Do not parallelize yet.

This work is still in the schema-and-boundary stage, where inconsistent mental
models are more dangerous than slow execution.

Parallel workers become useful only after the schema and service-construction
shape is committed. At that point, safe splits are:

- worker 1: schema + migrations + schema tests
- worker 2: runtime + app context + config resolution
- worker 3: settings/storage/export/snapshot

## Recommended Immediate Next Step

Start implementation with the schema and service-construction layer.

That means:

1. update the SQLite schema to add `site`, `site_domain`, `site_member`,
   `site_setting`, and `site_id`
2. refactor `createServices()` into a site-aware construction model
3. only then move upward into runtime and routes
