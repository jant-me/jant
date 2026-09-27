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

## Migration Rehearsal

- Use `mise run db-wrangler-rehearse` to upgrade a local D1 from the site 0.3.39 wrote, the oldest release that upgrades in place. `mise run check-sqlite-rehearsal` and `check-pg-rehearsal` do the same on the Node runtime.
- Fixtures live in `packages/core/src/db/rehearsal-fixtures/` and stay independent from demo/preview site seeds.
- Remote CI rehearsal is configured separately in `.github/workflows/migration-rehearsal.yml`.
- Remote rehearsal uses a dedicated disposable D1 database and replays the fixture through the Cloudflare D1 API instead of relying only on Wrangler file uploads.
- See `docs/internal/migration-rehearsal.md` for activation and snapshot refresh steps.
