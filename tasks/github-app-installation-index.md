# GitHub App: Installation Index + Webhook Dispatch

Rework the GitHub App integration so installation ownership is a proper
relational concept, webhooks can drive state changes, and reinstalling to
an already-known account does not leave the UI stuck.

## Context & Why

Three problems today:

1. **Reinstall-same-account dead end.** Clicking "Install" in settings
   always redirects to `https://github.com/apps/{slug}/installations/new`.
   If the App is already installed on that GitHub account, GitHub shows
   its Configure page and never redirects back with `installation_id`, so
   Jant can't proceed. (Real example: user hits Disconnect — which leaves
   the GitHub App installed — then tries to reconnect. Dead end.)

2. **No App-level event handling.** Core's webhook route
   (`routes/api/github-sync.tsx`) only processes `push` events. Every
   `installation` / `installation_repositories` / `installation.deleted`
   event is silently dropped (`return c.json({ ok: true, skipped: ... })`).
   Jant can't react to users removing repos, uninstalling the App, or
   installing on a new account until they manually re-run the OAuth flow.

3. **JSON-as-table.** Each site stores its known installations as a JSON
   list in the `GITHUB_SYNC_APP_INSTALLATIONS` settings value. This is
   fine for one site but can't support the real relationship: **one
   GitHub account (installation) ↔ many Jant sites**. A user with two
   blogs syncing different repos from the same GitHub account today has
   no proper model.

## Design Decisions

### 1. New relational table `github_app_installation` (both dialects)

Junction table, many-to-many:

```sql
CREATE TABLE github_app_installation (
  installation_id  TEXT    NOT NULL,
  site_id          TEXT    NOT NULL,
  account_login    TEXT    NOT NULL,
  account_type     TEXT    NOT NULL,       -- 'User' | 'Organization'
  added_at         INTEGER NOT NULL,
  PRIMARY KEY (installation_id, site_id)
);
CREATE INDEX github_app_installation_by_installation
  ON github_app_installation (installation_id);
CREATE INDEX github_app_installation_by_site
  ON github_app_installation (site_id);
```

**Lives in both** `src/db/schema.ts` (SQLite) and `src/db/pg/schema.ts`
(Postgres). Self-hosted SQLite — single site or multi-site — benefits
from the same relational modelling; no special case.

Postgres FK: `site_id REFERENCES site(id) ON DELETE CASCADE`. SQLite
has no `site` table (self-hosted is single-site or uses its own host
resolution without a registry), so no FK there; application-level only.

### 2. Deprecate `GITHUB_SYNC_APP_INSTALLATIONS` entirely

Pre-1.0, single user — no migration needed. Delete:

- Key definition in `types/config.ts`
- All reader/writer helpers in `lib/github-sync-installations.ts`
- Callsite in `routes/dash/settings.tsx:1507`
- Any picker UI code that reads the JSON list

Replace with a new service `services/github-app-installations.ts`:

```ts
listInstallationsForSite(siteId): Installation[]
listSitesForInstallation(installationId): SiteId[]
upsertInstallation(installationId, siteId, account): void
removeInstallation(installationId, siteId): void
removeInstallationEverywhere(installationId): void
```

### 3. Keep per-site active-sync settings

These stay in settings (they're per-site runtime state, not "list of
known installations"):

- `GITHUB_SYNC_APP_INSTALLATION_ID` — currently active pick
- `GITHUB_SYNC_AUTH_MODE` / `REPO` / `WEBHOOK_ID` / `WEBHOOK_SECRET` /
  `LAST_PUSH_SHA` / `ENABLED`

### 4. New internal route: App-level webhook

```
POST /api/_internal/github-app-webhook
```

- Not host-bound (mounted on the app root before any `resolveRequestSite`
  middleware that might 404 on unknown hosts)
- Verifies `X-Hub-Signature-256` with `GITHUB_APP_WEBHOOK_SECRET`
- Event dispatch:
  - `installation.created` → `upsertInstallation` for the site that
    initiated (see §6)
  - `installation.deleted` → `removeInstallationEverywhere`, clear
    `GITHUB_SYNC_APP_INSTALLATION_ID` in every affected site's settings,
    set `GITHUB_SYNC_ENABLED=false`
  - `installation_repositories.removed` → for each affected site, if
    `GITHUB_SYNC_REPO` is in the removed list, clear repo selection and
    set `GITHUB_SYNC_ENABLED=false` (keep installation link)
  - `installation.suspend` / `unsuspend` → toggle
    `GITHUB_SYNC_ENABLED` on each affected site
  - All other events → 200 OK, skip

### 5. Install-route predicate (Option 1 from the discussion)

In `GET /settings/github-sync/app/install`, before redirecting to GitHub:

- If `listInstallationsForSite(currentSiteId)` returns ≥1 installation,
  render the repo picker page directly instead of the GitHub round-trip
- The picker offers "Install on another account" as an action that
  actually triggers the GitHub redirect

Fixes the reinstall-same-account dead end without needing any webhook.

### 6. Initial installation attribution

Webhook `installation.created` has no hint of which Jant site triggered
the install. Attribution happens in the OAuth callback, not the webhook:

- Webhook arrives first (often before the browser redirect finishes).
  Its job on `installation.created` is just to log — we can't bind
  site_id yet.
- OAuth callback in `routes/dash/settings.tsx:1505-1515` is where we
  know `currentSiteId` and `installation_id`. That's where
  `upsertInstallation(installationId, siteId, account)` runs.

So in practice `installation.created` webhook events are informational
only — the callback-side upsert is the source of truth for new bindings.

### 7. Jant-Cloud passthrough

Hosted mode adds a thin forwarder in `jant-cloud`, mirroring the
existing OAuth callback passthrough pattern.

**GitHub App webhook URL (in GitHub App settings):**

- Self-hosted: `https://{site}/api/_internal/github-app-webhook`
- Hosted: `https://{jant-cloud}/api/github/app-webhook`

**jant-cloud route** (new, in `apps/app/app/routes/api/`):

```
POST /api/github/app-webhook
```

- Reads body as raw bytes (HMAC verification is signature-of-raw-bytes;
  parsing to JSON first breaks it)
- Reads `X-Hub-Signature-256`, `X-GitHub-Event`, `X-GitHub-Delivery`
- Forwards to `${JANT_CORE_INTERNAL_ADMIN_URL}/api/_internal/github-app-webhook`
  with those headers preserved + `Authorization: Bearer ${INTERNAL_ADMIN_TOKEN}`
- Returns core's status + body verbatim
- **Does NOT verify the GitHub signature itself** — core does. jant-cloud
  stays a dumb proxy. No new secret-sharing surface (jant-cloud doesn't
  need `GITHUB_APP_WEBHOOK_SECRET`).

**Core endpoint acceptance:**

- Always verifies `X-Hub-Signature-256` against `GITHUB_APP_WEBHOOK_SECRET`
- If `INTERNAL_ADMIN_TOKEN` is configured in env, also requires
  `Authorization: Bearer ...` match (defense in depth for hosted).
  Self-hosted users won't set this; signature alone is enough there.

## Implementation Plan

Ordered so each step leaves the tree in a working state.

### Core (`packages/core`)

1. **Schema + migrations**
   - Update `src/db/schema.ts` (SQLite) and `src/db/pg/schema.ts`
     (Postgres) with `githubAppInstallation` table + indexes
   - `mise run db-schema-generate` for SQLite
   - `mise run db-schema-generate-pg` for Postgres (or hand-write if
     auto-generation produces "no changes")
   - Verify migrations apply on fresh local D1 and local Postgres

2. **Service layer**
   - Create `src/services/github-app-installations.ts` with the 5
     methods listed in §2
   - Add to `services` wiring (`src/services/index.ts` or equivalent)
   - Unit tests against in-memory SQLite

3. **Rewire OAuth callback**
   - `routes/dash/settings.tsx:1505-1515` — swap
     `upsertStoredInstallation` for
     `services.githubAppInstallations.upsertInstallation`
   - Repo picker data source: query the new service by `siteId`
   - Delete `src/lib/github-sync-installations.ts` and its callers

4. **Remove deprecated settings key**
   - `types/config.ts` — remove `GITHUB_SYNC_APP_INSTALLATIONS`
   - Remove any leftover imports or JSON parse/stringify helpers
   - Grep for `GITHUB_SYNC_APP_INSTALLATIONS` — should be zero hits

5. **Install-route predicate (§5)**
   - In `routes/dash/settings.tsx:1425-1453`, before `buildInstallUrl`,
     check `listInstallationsForSite(currentSiteId)`
   - If non-empty: render the picker page directly, pre-populated
   - If empty: current behaviour (redirect to GitHub)
   - Picker's "Install on another account" link continues to trigger
     the real redirect

6. **App-level webhook endpoint**
   - New file `routes/api/github-app-webhook.ts` (internal; separate
     from the existing push-webhook file)
   - Route: `POST /api/_internal/github-app-webhook`, mounted at app
     root without host resolution
   - Verify `X-Hub-Signature-256` with `GITHUB_APP_WEBHOOK_SECRET`
   - If `INTERNAL_ADMIN_TOKEN` env present, also check bearer
   - Event dispatch per §4
   - Integration test: fixture payloads for each event type

7. **Docs**
   - Update `docs/configuration.md`: document `GITHUB_APP_WEBHOOK_SECRET`
     is now consumed by two webhook endpoints (push + app)
   - Update any user-facing GitHub sync docs mentioning the install flow

### Jant-Cloud (the `jant-cloud` repo)

8. **Passthrough route**
   - New file `apps/app/app/routes/api/github-app-webhook.ts`
   - Register in `routes.ts` alongside existing
     `api/github/install-callback`
   - Reads raw body bytes (not `.json()`)
   - Forwards to `env.JANT_CORE_INTERNAL_ADMIN_URL +
'/api/_internal/github-app-webhook'`
   - Headers to preserve: `Content-Type`, `X-Hub-Signature-256`,
     `X-GitHub-Event`, `X-GitHub-Delivery`
   - Adds `Authorization: Bearer ${env.INTERNAL_ADMIN_TOKEN}`
   - Returns upstream status + body verbatim
   - Logs `X-GitHub-Delivery` for traceability

9. **GitHub App configuration (ops, not code)**
   - Update GitHub App webhook URL to the jant-cloud endpoint
   - Subscribe to events: `Installation`, `Installation repositories`
   - Confirm `Active` checkbox stays enabled
   - `GITHUB_APP_WEBHOOK_SECRET` remains set on core only (unchanged)

## Verification

- `mise run check-tests` (core)
- `mise run check-lint` (core)
- Manual smoke tests:
  1. Fresh site, Install App on new GitHub account → picker appears,
     can pick repo, sync works
  2. Disconnect in Jant, click Install again → picker appears
     immediately (no GitHub round-trip, §5 working)
  3. From GitHub side, Uninstall App → webhook clears
     `GITHUB_SYNC_APP_INSTALLATION_ID` across all bound sites
  4. From GitHub side, remove the synced repo from the installation →
     affected sites' sync disables, installation link persists
  5. Same GitHub account bound to two sites → modifying the installation
     fans out to both

## Open Questions Before Starting

1. Does `jant-cloud` already expose `INTERNAL_ADMIN_TOKEN` verification
   on its outbound forwards, or does it only use `JANT_CORE_INTERNAL_ADMIN_TOKEN`
   inbound to core? (Pick whichever pattern matches existing flows so
   we don't fork conventions.)

2. When `installation.deleted` fires, do we also want to delete the
   GitHub-side **push webhook** (now orphaned) proactively, or leave it
   as gone-with-the-repo? Proposal: do nothing — when the installation
   is gone, access is gone; GitHub will garbage-collect its own side.

ok, 按照你的建议。

3. Should the install-predicate in §5 skip the GitHub round-trip even
   when the user is actively clicking "Install"? Or should it be opt-in
   (e.g., a "Reconnect existing installation" button)? Proposal: skip
   unconditionally when installations exist — simpler flow, user can
   still reach GitHub via "Install on another account".

   ok, 按照你的建议。

## Review

(To be filled after implementation.)
