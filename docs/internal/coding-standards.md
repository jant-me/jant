# Coding Standards

Detailed coding standards referenced from [CLAUDE.md](../../CLAUDE.md). The principles in CLAUDE.md take precedence if there is any conflict.

## Module Dependency Direction

```
routes -> services -> db
routes -> viewmodels -> ui
```

- Shared utilities/types may be imported anywhere if they do not introduce upward coupling.
- Shared app-level types (e.g. `AppVariables`) live in `src/types/app-context.ts`, not in composition roots.

### Forbidden Edges

- Routes must not import DB drivers/query builders or execute raw SQL.
- Services must not import route modules or UI/component modules.
- UI/components must not import services, DB modules, or route modules.
- Feature modules must not import shared types from `src/app.tsx` or other app composition roots.

## Versioned Product Defaults

- Built-in navigation metadata and append-only default profiles live in
  `packages/core/src/types/constants.ts`. Production, hosted, and dev/demo
  bootstrap paths must derive their seed rows from that shared source.
- Materialize the current navigation profile only while provisioning a site or
  recovering incomplete onboarding. After onboarding completes, navigation is
  user-owned state: default changes must not silently remove, re-add, update, or
  reorder persisted items.
- Keep older profile versions unchanged. Add a new version and advance
  `DEFAULT_NAVIGATION_PROFILE_VERSION` when the new-site template changes.

## Error Handling

### Service Error Taxonomy

Services throw typed domain errors with clear intent:

| Error                  | HTTP Status | When                            |
| ---------------------- | ----------- | ------------------------------- |
| `ValidationError`      | 400         | Invalid input                   |
| `UnauthorizedError`    | 401         | Not authenticated               |
| `ForbiddenError`       | 403         | Authenticated but not allowed   |
| `NotFoundError`        | 404         | Resource doesn't exist          |
| `ConflictError`        | 409         | State conflict (e.g. duplicate) |
| `RateLimitError`       | 429         | Too many requests               |
| `ExternalServiceError` | 500         | Third-party failure             |
| `SiteUnavailableError` | 503         | Site exists but is suspended    |

Unknown/unhandled errors map to `500`.

### Logging Policy

- Log expected/recoverable client errors at `info`/`warn`.
- Log server/fatal errors at `error` with context and stack.
- **Never** log secrets, tokens, password hashes, or raw credentials.

### Recoverable vs Fatal

- Recoverable errors return typed failures to the caller.
- Fatal startup/infrastructure errors fail fast with clear messages.

## Testing Strategy

See also: [testing-guide.md](./testing-guide.md) for practical patterns and helpers.

### Coverage Expectations

- **Service layer**: happy path + at least one meaningful failure/edge case per changed path.
- **Route layer**: request validation, auth/authorization behavior, error mapping, one success contract path.
- **UI layer**: complex state transitions and event contracts. Do not over-test static markup.

### Principles

- **Test what we own**: business logic, contracts, boundary behavior. Do not test third-party internals.
- **Regression policy**: every bug fix includes a test that fails before the fix.
- **Test environment**: in-memory SQLite helpers, fresh DB state per test (`beforeEach`).

## SQL Dialect Pitfalls (SQLite vs Postgres)

Tests run against SQLite only. Raw SQL fragments (`` sql`...` ``) that work on SQLite may fail silently on Postgres. When writing raw SQL, check this list:

| SQLite                                | Postgres                                         | Portable alternative                          |
| ------------------------------------- | ------------------------------------------------ | --------------------------------------------- |
| `MAX(a, b)` (scalar, multi-arg)       | Does not exist — `MAX` is aggregate-only         | `CASE WHEN a > b THEN a ELSE b END`           |
| `MIN(a, b)` (scalar, multi-arg)       | Does not exist                                   | `CASE WHEN a < b THEN a ELSE b END`           |
| `\|\|` always string concat           | `\|\|` errors if either side is non-text         | Cast to text first, or use `concat()`         |
| `INTEGER` auto-casts booleans         | `INTEGER` and `BOOLEAN` are distinct             | Use explicit `CASE` or `::int` casts          |
| `datetime('now')`                     | Does not exist                                   | Use `now()` from `lib/time.ts` (Unix seconds) |
| Unquoted column aliases OK            | Some reserved words clash                        | Always quote aliases or use `.as()`           |
| `ORDER BY x DESC` puts NULLs **last** | `ORDER BY x DESC` puts NULLs **first** (default) | `coalesce(x, <sentinel>)` or `NULLS LAST`     |

**Nullable sort keys**: whenever an `orderBy` references a column (or computed expression) that may be `NULL`, wrap it in `coalesce(expr, <sentinel>)` so the order is identical on SQLite and Postgres. This applies to flags stored as timestamps like `pinnedAt`, `featuredAt`, and nullable activity timestamps. Don't rely on engine defaults — SQLite puts NULLs last on `DESC`, Postgres puts them first, so `desc(posts.pinnedAt)` on Postgres sinks pinned rows to the bottom. Pick a sentinel that loses the comparison (e.g. `-1` for timestamp sort keys where real values are positive). The cursor and list paths in `src/services/post.ts` already follow this pattern (`coalesce(pinnedAt, -1)`, `coalesce(featuredAt, -1)`, `coalesce(sortTimestamp, -1)`); match it when adding new sorts. Aggregate expressions need the same treatment: prefer `MAX(coalesce(col, -1))` over `MAX(col)` when the result feeds an `orderBy`.

**Rule of thumb**: if you write a raw `sql` template that is more than a simple column reference, mentally run it through Postgres syntax before committing. Drizzle's typed query builder is dialect-safe; the risk lives in `sql` tagged templates and string interpolation inside `where`/`orderBy`. Because tests run on SQLite only, dialect-specific bugs like NULL ordering won't surface locally — they have to be caught by reading the query.

## URL Naming

### Path segments

Lowercase kebab-case, always (`/custom-urls`, `/api/internal/sites/post-counts`).

### Query parameter names

- Parameter names are camelCase. Single lowercase words are the degenerate case — and the strong preference.
- **Public, shareable URLs** (`/archive`, `/search`, feeds): parameter names MUST be single lowercase words. Don't reach for compound names — design the vocabulary instead. Fold presence flags into the value space of the dimension noun (`media=any|none|image,video`, `title=any|none`, `replies=any|none`) rather than adding `hasX` booleans.
- **Machine surfaces** (JSON APIs, dash, auth flows): compound camelCase names are fine where they map 1:1 to TypeScript fields (`uploadId`, `partNumber`, `returnTo`, `cursor`).
- Never snake_case, unless a third party dictates the name (GitHub's `installation_id`).

### Query parameter values

- Lowercase words; comma-separated lists for multi-values (`media=image,video`).
- Prefer semantic words over `1`/`0` on shareable URLs (`title=none`, not `hasTitle=0`).
- Internal values containing underscores get a URL alias (`visibility=hidden` in URLs ⇄ internal `latest_hidden`).

### Renames and compatibility

- Renaming a parameter on a shareable surface requires **accept-old / emit-new** parsing, kept indefinitely: old bookmarks, RSS subscriptions, and stored `path_registry.archive_query` values must keep working without data migration.
- HTML page routes additionally issue a **308 canonical redirect** that rewrites only the legacy spellings and preserves everything else (including unknown params like `utm_*`). Feeds and APIs never redirect — they accept both spellings silently: feed readers and API clients gain nothing from a redirect, and the flakiest of them mishandle it.
- Public API: accept both spellings, document the new one, mark the old one **Deprecated** in `docs/API.md`.
