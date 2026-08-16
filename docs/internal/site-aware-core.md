# Site-Aware Core Design

This document defines the target shape for turning `@jant/core` into a
site-aware application while keeping self-hosted usage simple.

The goal of this change is to make multi-site support a core capability of the
domain model before adding PostgreSQL support or a hosted control plane.

## Status

- Stage: design-approved target architecture
- Scope: `@jant/core` only
- Out of scope for this phase:
  - PostgreSQL runtime support
  - `jant-cloud` control plane implementation
  - billing, subscriptions, and platform administration UI

## Goals

- Keep self-hosted Jant easy to run as a single-site app
- Make the core schema and service layer natively support multiple sites
- Keep site content, site settings, and site permissions scoped to one site
- Preserve a clean path to future hosted SaaS and future Postgres support

## Non-Goals

- This phase does not try to implement full platform SSO
- This phase does not try to implement team management UI
- This phase does not optimize for per-site physical isolation
- This phase does not introduce platform-only tables into `@jant/core`

## Tenancy Model

`@jant/core` becomes a site-aware application with three layers:

- Instance:
  - One deployed Jant application
  - One runtime config surface
  - One database
- Site:
  - One blog space with its own content, settings, domains, and members
- User:
  - A login identity inside a core instance
  - May belong to one or more sites through membership

Self-hosted is not a different architecture. It is the single-site special
case:

- One instance
- One default site
- One owner by default

## Core Entities

### `site`

`site` is the primary tenant container.

Recommended fields:

- `id`
- `key`
- `status`
- `created_at`
- `updated_at`

Recommended semantics:

- `id`
  - immutable primary key
  - TypeID with `sit_` prefix
  - used for foreign keys, storage paths, and durable internal references
- `key`
  - human-readable machine handle
  - unique within the instance
  - used for default hosted subdomains and operator-facing references
  - should be treated as stable, but not as the immutable identity
- `status`
  - minimal enum for lifecycle and request gating
  - start with `active` and `suspended`

Do not put mutable presentation fields such as site name, description, theme,
or language on `site`. Those belong in site-scoped settings.

### `site_domain`

`site_domain` describes how a request maps to a site.

Recommended fields:

- `id`
- `site_id`
- `host`
- `path_prefix`
- `kind`
- `redirect_to_primary`
- `created_at`
- `updated_at`

Recommended semantics:

- `host`
  - globally unique within the instance
- `path_prefix`
  - optional
  - allows a self-hosted site to live under a subpath
  - hosted mode should prefer host-based routing first
- `kind`
  - `primary` or `alias`
- `redirect_to_primary`
  - whether alias requests should 301 to the site's primary domain

`site_domain` belongs in core, not in `jant-cloud`, because content routing
depends on it.

### `site_setting`

Site-facing settings should be stored in a site-scoped table rather than in a
global `setting` table.

Recommended fields:

- `site_id`
- `key`
- `value`
- `updated_at`

Recommended primary key:

- `(site_id, key)`

This table replaces the current assumption that one instance has one site-wide
settings namespace.

### `site_member`

`site_member` belongs in core and is the basis for future team support.

Recommended fields:

- `site_id`
- `user_id`
- `role`
- `created_at`
- `updated_at`

Recommended primary key:

- `(site_id, user_id)`

Recommended initial roles:

- `owner`
- `admin`
- `editor`

Even if the first product version only exposes one owner per site, the schema
should support multiple members from day one.

## Tables That Must Become Site-Scoped

These content and site-owned tables should gain a `site_id` column and
site-aware uniqueness/indexes:

- `post`
- `media`
- `collection`
- `path_registry`
- `collection_directory_item`
- `thread_collection`
- `nav_item`
- `site_setting`
- `api_token`

Notes:

- `user`, `account`, `session`, and `verification` remain global auth tables
  inside one core instance.
- Site access is modeled through `site_member`, not by attaching a required
  `site_id` to `user`.
- Auth flows still need site-awareness in service logic because permissions are
  evaluated against the current site.

## Identity and Membership Boundaries

The identity model is described in more detail in
[identity-model.md](./identity-model.md).

The short version:

- `user` is a global identity record inside a core instance
- `site_member` binds users to specific sites
- site permissions live in core
- future platform identities live in `jant-cloud`

## Configuration Split

The application must stop treating environment variables as the source of truth
for the current site.

### Environment Only

These remain instance-level or infrastructure-level configuration:

- database connection settings
- auth secret and internal service secrets
- storage driver selection and credentials
- public base URLs for storage/CDN
- upload and pagination limits
- summary extraction limits
- slug random length
- platform URL for future hosted mode

### Site-Scoped Database Settings

These become site settings:

- site name
- site description
- site language
- time zone
- footer
- branding toggles
- home/feed defaults
- theme selection
- font theme
- theme mode
- custom CSS
- avatar and favicon keys
- `noindex`

### Bootstrap Defaults

For self-hosted mode, environment variables may still seed the first default
site on startup or on first setup. They should not overwrite the database on
every request.

## Request Model

Every request must resolve a current site before business services run.

Recommended runtime flow:

1. Parse the public request URL
2. Resolve `site_domain` by `host` and optional `path_prefix`
3. Load the current `site`
4. Create site-scoped services and config
5. Execute routes against the current site context

Recommended app context additions:

- `currentSite`
- `currentSiteDomain`

Recommended instance mode setting:

- `SITE_RESOLUTION_MODE=single-site`
  - self-hosted default
  - requests always resolve to the only site in the instance
- `SITE_RESOLUTION_MODE=host-based`
  - hosted / multi-site mode
  - requests resolve through `site_domain`

### Self-Hosted Default Site

Self-hosted mode should bootstrap one default site automatically.

Recommended rules:

- create a default site if none exists
- default `site.key` is `default`
- seed its primary domain/path from self-hosted bootstrap env if present
- setup creates the first owner membership for that site

## Storage Model

Storage should be shared per environment, not per site bucket by default.

Recommended object key layout:

- `media/{siteId}/files/{mediaId}.{ext}`
- `media/{siteId}/posters/{mediaId}.webp`
- `media/{siteId}/assets/avatar/{mediaId}.{ext}`
- `media/{siteId}/assets/favicon/apple-touch-icon.png`
- `sites/{siteId}/exports/...`
- `sites/{siteId}/snapshots/...`

Rules:

- use immutable `site.id` in object keys, not `site.key`
- keep storage driver configuration instance-level
- site-scoped files are isolated by prefix

This keeps self-hosted simple and avoids per-site bucket sprawl in hosted mode.

## Constraint and Index Rules

Every hot lookup that is currently global must become site-aware.

Examples:

- `path_registry.path`:
  - change from global unique to `unique(site_id, path)`
- `nav_item.system_key`:
  - change from global unique to per-site unique
- `collection_directory_item.position`:
  - change from global unique to per-site unique
- `api_token.token_hash`:
  - if kept globally unique, still include `site_id` in service logic
  - if possible, prefer per-site uniqueness

For content queries, site-aware indexes should put `site_id` first whenever
requests always filter by site.

## Post Thread Integrity

`post` has self-referential relations (`reply_to_id`, `thread_id`) and should
enforce same-site integrity.

Recommended direction:

- add `site_id` to `post`
- add supporting uniqueness needed for composite self-FKs
- ensure replies and thread roots cannot cross site boundaries

This is more important than filtering by `site_id` in service code.

## Exports, Imports, and Snapshots

All content export and snapshot flows should become site-scoped.

Rules:

- `site export` operates on the current site only
- `site snapshot` operates on the current site only
- auth and instance-level shell state stay out of snapshots
- storage manifests only include keys under the current site's prefix

## Implementation Phases

### Phase 1: Schema and Context

- add `site`, `site_domain`, `site_setting`, `site_member`
- add `site_id` where needed
- add `currentSite` and `currentSiteDomain` to app context

### Phase 2: Settings, Paths, and Storage

- move global settings logic to site-scoped settings
- scope path and nav uniqueness to site
- change storage key generation to site-prefixed keys

### Phase 3: Auth and Membership

- replace single-author assumptions with site membership checks
- make setup create an owner for the default site
- prepare core auth for future hosted SSO handoff

### Phase 4: Search and Export

- ensure search is always site-scoped
- make export/import/snapshot flows site-aware

## Decisions Locked By This Document

- Self-hosted remains a first-class deployment mode
- Core becomes site-aware before platform features are added
- Site domains and site memberships belong in core
- Storage uses shared infrastructure with immutable site-id prefixes
- `site.key` is a stable handle, not the immutable identity
