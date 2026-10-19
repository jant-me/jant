# Testing Guide

This document captures project testing conventions and common helpers.

## Stack

- Runner: Vitest v4
- Config: `packages/core/vitest.config.ts`
- Placement: colocate tests in `__tests__/` next to the source under test

## Core Test Helpers

### Service Tests (in-memory SQLite)

```ts
import { createTestDatabase } from "../../__tests__/helpers/db.js";

const { db } = createTestDatabase(); // without FTS
const { db } = createTestDatabase({ fts: true }); // with FTS5
```

Usage notes:

- Use `createTestDatabase()` for service/repository behavior.
- Enable `fts: true` only for tests that require FTS behavior.
- Use a fresh database per test (`beforeEach`) to avoid state coupling.

### Route Tests (test Hono app)

```ts
import { createTestApp } from "../../__tests__/helpers/app.js";

const { app, services } = createTestApp({ authenticated: true });
app.route("/api/posts", postsApiRoutes);
const res = await app.request("/api/posts");
```

Usage notes:

- Use `createTestApp()` for HTTP contract testing.
- Route tests should focus on validation, auth, status mapping, and response shape.
- Mock/stub service behavior when testing route-specific logic.

## Scope Guidance

- Test behavior and contracts we own.
- Do not test third-party internals or framework rendering internals.
- For bug fixes, add a regression test that fails before the fix.

## Manual End-to-End Checks

For changes that affect generated site agent scaffolding, content CLI commands,
uploads/media automation, or the MCP endpoint, see
`docs/internal/agent-automation-testing.md`.

## Public Surface

- `src/__tests__/helpers/public-surface.ts` reads the second level of `docs/compatibility.md` from the code into one manifest: public commands and their options, environment variables and settings with the values they take, reserved paths, API endpoints and response fields, MCP tools and their parameters, the elements and attributes a feed writes, and the export's front-matter fields and `data/jant.toml` keys.
- `src/__tests__/fixtures/public-surface.json` is head's manifest. A change to the surface fails `public-surface.test.ts` until `mise run update-public-surface` rewrites the file; commit it with the change, so review shows the surface diff.
- What the code has but the docs don't promise stays out through lists in the helper: undocumented `/api/` routes (`UNDOCUMENTED_API_ROUTES`), the `DEMO_*` variables, the options that pick one site from several, and theme-only export fields (`THEME_ONLY_EXPORT_FIELDS`). `api-docs.test.ts` and `export-docs.test.ts` hold the route and field lists to the docs, so a new route is either documented in `docs/API.md` or added to the list.
- Each release freezes its manifest into `fixtures/releases/<version>/public-surface.json` (`docs/RELEASING.md`). Head's manifest has to hold every name the newest frozen manifest of its major holds; a removal or rename passes only while a pending changeset makes the next release major. 0.x has no baseline.
- Not covered: request fields and query parameters, field types and meanings, value ranges, and error codes.
- `helpers/rich-sites.ts` builds the sites the manifest reads feed and export names from: every kind of content a feed or an export writes something for. `feed-docs.test.ts` and `export-docs.test.ts` use the same sites.

## Migration Rehearsal

- Use `mise run db-wrangler-rehearse` to upgrade a local D1 from the site 0.3.39 wrote, older than any site still running. `mise run check-sqlite-rehearsal` and `check-pg-rehearsal` do the same on the Node runtime.
- Fixtures live in `packages/core/src/db/rehearsal-fixtures/` and stay independent from demo/preview site seeds.
- Remote CI rehearsal is configured separately in `.github/workflows/migration-rehearsal.yml`.
- Remote rehearsal uses a dedicated disposable D1 database and replays the fixture through the Cloudflare D1 API instead of relying only on Wrangler file uploads.
- See `docs/internal/migration-rehearsal.md` for activation and snapshot refresh steps.
