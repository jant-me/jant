# Contributing to Jant

Thanks for your interest in contributing to Jant! This guide covers everything you need to get started.

## Table of Contents

- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Tech Stack](#tech-stack)
- [Commands Reference](#commands-reference)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Code Style](#code-style)
- [Database](#database)
- [Internationalization (i18n)](#internationalization-i18n)
- [Pull Request Process](#pull-request-process)
- [Release Process](#release-process)

## Development Setup

### Prerequisites

- [mise](https://mise.jdx.dev/) — manages Node.js (v24) and pnpm automatically

```bash
# Install mise (macOS/Linux)
curl https://mise.run | sh
```

### Getting Started

```bash
# Clone the repo
git clone https://github.com/jant-me/jant.git
cd jant

# Install toolchain (Node.js + pnpm, versions defined in mise.toml)
mise install

# Install dependencies
pnpm install

# Start development server (defaults to http://localhost:3000)
mise run dev

# Override the dev port
PORT=9030 mise run dev
```

`mise run dev` automatically runs database migrations before starting the server — no manual migration step needed.
Prefer `localhost` for browser auth flows. `jant.localtest.me` is still accepted by `/__dev/login`, but some browsers upgrade `*.localtest.me` to HTTPS, which breaks local HTTP dev ports.

### Environment Setup

For browser or agent debugging, Jant can prepare local auth helpers for you:

```bash
mise run dev-auth-bootstrap
```

This creates or updates `packages/core/.dev.vars`, ensures a local credential admin exists, marks onboarding complete when needed, and prints both the sign-in URL and the local-only auto-login URL. Use the printed `http://localhost:19xxx/...` URL for browser testing.

`mise run dev-debug` runs this automatically before starting the first free debug port beginning at `19020`.

If you only need the bare minimum, create `.dev.vars` in `packages/core/`:

```
AUTH_SECRET=your-secret-at-least-32-chars
```

Or start from [packages/core/.dev.vars.example](/Users/green/project/jant/main/packages/core/.dev.vars.example) when you want the full list of supported local development variables with inline explanations.

## Project Structure

```
jant/
├── packages/
│   ├── core/                  # @jant/core — main framework library
│   │   ├── src/
│   │   │   ├── index.ts       # Entry point (exports createApp)
│   │   │   ├── preset.css     # CSS preset (basecoat + @source auto-scan)
│   │   │   ├── app.tsx        # Hono app factory
│   │   │   ├── types.ts       # Single source of truth for types
│   │   │   ├── db/            # Drizzle schema & migrations
│   │   │   ├── services/      # Business logic (service layer)
│   │   │   ├── routes/        # Route handlers
│   │   │   ├── theme/         # UI (components, layouts)
│   │   │   ├── lib/           # Utilities
│   │   │   ├── i18n/          # Internationalization
│   │   │   └── middleware/    # Hono middleware
│   │   └── vitest.config.ts
│   └── create-jant/           # create-jant — CLI scaffolding tool
│       └── template/          # ⚠️ Auto-generated, do NOT edit directly
├── sites/
│   └── demo/                  # Demo site + user template source
│       ├── index.js           # App entry
│       ├── package.json       # Dependencies
│       └── wrangler.toml      # Cloudflare config (with @create-jant annotations)
├── docs/                      # Documentation
└── .changeset/                # Changesets for versioning
```

### Packages

| Package                         | Purpose                                                            | Has Vite/Wrangler? |
| ------------------------------- | ------------------------------------------------------------------ | ------------------ |
| `packages/core`                 | Library + dev environment (Vite HMR)                               | Yes                |
| `sites/demo`                    | Demo site + user template source (with `@create-jant` annotations) | No                 |
| `packages/create-jant/template` | User project starter (auto-generated from `sites/demo`)            | No                 |

**Important**: Development and testing happens in `packages/core`, which has a Vite dev server with HMR. `sites/demo` is both the live demo and the source for user templates — `create-jant` processes `@create-jant` annotations in `wrangler.toml` to strip demo-specific config.

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Framework**: Hono (v4)
- **Build**: Vite library mode + SWC + @cloudflare/vite-plugin
- **CSS**: Tailwind CSS v4 + [BaseCoat](https://basecoat.dev)
- **Database**: D1 (SQLite) + Drizzle ORM
- **Auth**: better-auth
- **i18n**: @lingui/core + @lingui/swc-plugin
- **Interactions**: Datastar v1.0.0-RC.7 (vendored)
- **Code Quality**: ESLint + Prettier + husky + lint-staged
- **Validation**: Zod
- **Testing**: Vitest + better-sqlite3 (in-memory)

### Key Architecture Decisions

- **Service layer**: All database operations go through `src/services/`. Services are stateless and accept a database connection.
- **Type system**: All types defined in `types.ts`. Use `const` assertions for enums, Zod schemas in `lib/schemas.ts` for runtime validation only.
- **Route naming**: Always use `xxxRoutes` suffix (e.g., `postsRoutes`, `homeRoutes`).
- **IDs**: Sqids for URLs (`/p/jR3k`), integers in the database.
- **Time**: Unix timestamps (seconds), utilities in `lib/time.ts`.
- **Soft delete**: Posts use a `deleted_at` field.
- **CSS**: Use BaseCoat semantic classes (`.btn`, `.card`, `.input`, etc.) before reaching for Tailwind utilities. Tailwind is for layout, spacing, and typography only.
- **Configuration**: Environment variables for runtime config, `createApp()` only for build-time theme/UI customization.

## Commands Reference

All commands are run via `mise run <command>`. You never need to `cd` into subdirectories.

### Development

```bash
mise run dev              # Start Vite dev server (defaults to 3000; set PORT to override)
mise run dev-debug        # Start debug server on the first free port from 19020 and prepare local auth helpers
mise run dev-auth-bootstrap # Sync local demo credentials + print auth debug URLs
mise run build            # Build @jant/core (lib + client assets)
```

### Code Quality

```bash
mise run check-lint       # Run ESLint
mise run check-types      # Run TypeScript type checking (all packages)
mise run fix-format       # Format code with Prettier
mise run check-format     # Check formatting without writing
```

### Testing

```bash
mise run check-tests          # Run all tests (must pass before committing)
mise run check-tests-watch    # Run tests in watch mode
mise run check-tests-coverage # Run tests with coverage report
```

### Database

```bash
mise run db-schema-generate        # Generate Drizzle migrations (from core schema)
mise run db-wrangler-migrate       # Apply migrations (local Wrangler/D1) — usually not needed, dev auto-runs this
mise run db-wrangler-load-demo     # Reload the canonical demo snapshot into the current local DB shell
mise run db-wrangler-rebuild-demo  # Recreate the local Wrangler DB shell and load the canonical demo snapshot
mise run db-wrangler-clean         # Delete local Wrangler/D1 database (.wrangler) — alias: `clean`
```

### Auth Debugging

When you need to debug authenticated UI with Chrome DevTools MCP, Codex, or any other browser agent:

```bash
mise run dev-debug
```

Then use one of these:

- Browser or Chrome MCP: open the `http://localhost:19xxx/__dev/login?token=YOUR_TOKEN&redirect=/settings` URL printed by `mise run dev-debug`, then continue on `http://localhost:19xxx/settings`.
- HTTP agent: request that same localhost URL directly, capture the `Set-Cookie` header from the `302` response, and reuse it on later requests.

### i18n

```bash
mise run i18n-refresh     # Extract + AI translate + compile (needs OPENAI_API_KEY)
mise run i18n-extract     # Extract messages from source
mise run i18n-compile     # Compile PO files to JS
mise run i18n-build       # Extract and compile only (without AI translation)
mise run i18n-translate   # Auto-translate all locales using AI (needs OPENAI_API_KEY)
```

### Release

```bash
mise run changeset          # Create a changeset for your changes
mise run changeset-status   # Show pending changesets
mise run release-version    # Apply changesets (bump versions, generate CHANGELOG)
mise run release-publish    # Build and publish packages to npm (CI only)
mise run release-publish-dry # Dry run publish
```

### Utilities

```bash
mise run clean-build      # Clean build artifacts (dist, .wrangler)
mise run clean-deps       # Remove all node_modules and reinstall
mise run clean-reset      # Nuclear reset — delete everything and start fresh
mise run auth-reset-token # Generate password reset link (local)
```

### CI

```bash
mise run check-ci         # Run all CI checks (lint + typecheck + test + build + i18n + template)
```

## Development Workflow

### Making Changes

1. **Create a branch:**

   ```bash
   git checkout -b feat/my-feature
   ```

2. **Start the dev server:**

   ```bash
   mise run dev
   ```

3. **Make your changes** — edit files in `packages/core/src/` (the library) or `packages/core/` (the dev environment).

4. **Write tests** for any new functionality or bug fixes (see [Testing](#testing)).

5. **Run checks:**

   ```bash
   mise run check-tests && mise run check-lint && mise run check-types
   ```

6. **Create a changeset** (if your changes affect published packages):

   ```bash
   mise run changeset
   ```

7. **Commit and push:**

   ```bash
   git add .
   git commit -m "feat: add my feature"
   git push origin feat/my-feature
   ```

The pre-commit hook automatically runs ESLint, Prettier, and i18n extraction/compilation on staged files.

### Worktree Workflow (Optional)

Instead of switching branches, you can use git worktrees to work on multiple features simultaneously. Each worktree is a sibling directory of `main/`:

```
/Users/you/project/jant/
├── main/              # Main worktree (main branch)
├── feat-login/        # Feature worktree
├── fix-auth/          # Bugfix worktree
└── review-feat-login/ # Review worktree
```

#### Creating a Feature Worktree

```bash
mise run worktree-create feat/login       # Creates ../feat-login/ on feat/login branch
mise run worktree-create fix/auth develop # Creates ../fix-auth/ branched from develop
```

This creates the worktree, copies `.dev.vars`, and runs `pnpm install`.

#### Reviewing a Remote Branch

```bash
mise run worktree-review feat/login # Creates ../review-feat-login/ from origin/feat/login
```

Fetches the latest remote state, creates a worktree, and installs dependencies.

#### Listing Worktrees

```bash
mise run worktree-list            # Lists all git worktrees
```

#### Cleaning Up

```bash
mise run worktree-remove feat/login # Removes ../feat-login/ worktree and deletes the branch
```

#### Port Conflicts

Each worktree is a full copy of the project. If you run `mise run dev` in multiple worktrees, you'll get port conflicts. `mise run dev-debug` searches for the first free port starting at `19020`, so use the printed debug URL for that worktree instead of assuming a fixed port.

## Testing

Every new feature, bug fix, or logic change must include tests. Run `mise run check-tests` to verify all tests pass.

### Framework

- **Vitest** — configured in `packages/core/vitest.config.ts`
- **better-sqlite3** — in-memory SQLite for service integration tests (matches D1 in production)

### Test Structure

Tests are colocated with source code in `__tests__/` directories:

```
packages/core/src/
├── lib/
│   ├── time.ts
│   └── __tests__/
│       └── time.test.ts          ← unit tests next to source
├── services/
│   ├── post.ts
│   └── __tests__/
│       └── post.test.ts          ← service integration tests
├── routes/api/
│   ├── posts.ts
│   └── __tests__/
│       └── posts.test.ts         ← route handler tests
└── __tests__/helpers/
    ├── db.ts                     ← in-memory SQLite with migrations
    └── app.ts                    ← test Hono app with mock services/auth
```

### What to Test

| Layer                 | What to test                                            | Test helper            |
| --------------------- | ------------------------------------------------------- | ---------------------- |
| `lib/` pure functions | Input/output, edge cases, boundary values               | None needed            |
| `lib/schemas.ts` Zod  | Valid inputs, invalid inputs, error messages            | None needed            |
| `services/`           | CRUD operations, business logic, relationships          | `createTestDatabase()` |
| `routes/api/`         | HTTP status codes, request validation, auth enforcement | `createTestApp()`      |
| `middleware/`         | Auth redirect/401 behavior, error handling              | Hono `app.request()`   |

### Test Helpers

```typescript
// In-memory SQLite database for service tests
import { createTestDatabase } from "../../__tests__/helpers/db.js";
const { db } = createTestDatabase(); // without FTS
const { db } = createTestDatabase({ fts: true }); // with FTS5 for search tests

// Test Hono app with real services for route tests
import { createTestApp } from "../../__tests__/helpers/app.js";
const { app, services } = createTestApp({ authenticated: true });
app.route("/api/posts", postsApiRoutes);
const res = await app.request("/api/posts");
```

### Testing Rules

1. Each test gets a **fresh database** — use `beforeEach` with `createTestDatabase()` for isolation.
2. Test happy paths, edge cases, and error cases.
3. Don't test third-party library internals (better-auth, Drizzle ORM, etc.).
4. Don't test JSX rendering — focus on logic.
5. `mise run check-tests` must pass before submitting a PR.

## Code Style

### General Principles

- **TypeScript strict mode**: No `any` types, all exports are typed.
- **Simple over clever**: Prefer readable code.
- **Single responsibility**: Keep files focused.
- **Zero ESLint warnings**: All warnings must be resolved.

### Naming Conventions

- Routes: `xxxRoutes` (e.g., `postsRoutes`)
- Services: `xxxService` functions
- Components: PascalCase (e.g., `PostList`)

### UI Guidelines

- Use [BaseCoat](https://basecoat.dev) semantic CSS classes (`.btn`, `.card`, `.input`, `.alert`, `.badge`, `.field`) for components.
- Use Tailwind only for layout (flex, grid, gap), spacing (p, m), and typography (text-size, font-weight).
- All user-facing strings must use the i18n `t()` function.

### Documentation

- JSDoc comments for all utility functions in `src/lib/`.
- Include `@param`, `@returns`, and `@example` tags.
- Comments in English.

### Pre-commit Hooks

The project uses **husky** + **lint-staged** to automatically:

- Run ESLint --fix and Prettier --write on staged files.
- Run i18n extract + compile when `.ts`/`.tsx` files are staged (keeps locale files in sync).

## Database

### Migrations

Migrations are managed by Drizzle ORM. The schema lives in `packages/core/src/db/`.

```bash
# After changing the schema:
mise run db-schema-generate # Generate migration files
mise run dev              # Migrations auto-apply on dev server start
```

You rarely need to run `mise run db-wrangler-migrate` manually — both `dev` and `dev-debug` auto-apply migrations.

### Local Development Data

The local development workflow is intentionally simple:

1. **Recreate the local Cloudflare D1 shell** when you want a clean slate:

   ```bash
   mise run db-wrangler-rebuild-demo
   ```

   This recreates the local database, runs migrations, bootstraps the local shell, and loads the canonical demo snapshot from `sites/demo-source/canonical/snapshot/`.

2. **Recreate the local Node SQLite shell** when you are using the Node runtime:

   ```bash
   mise run db-node-rebuild-demo
   ```

   This resets the configured local SQLite database and local media directory, writes missing dev auth values to `packages/core/.env.node`, bootstraps the local shell, and loads the canonical demo snapshot. This workflow is only for single-site Node development with SQLite and local filesystem storage.

3. **Import the canonical demo site export** into an empty local Node database when you want the portable `site import` path instead of snapshot restore:

   ```bash
   mise run db-node-load-demo
   ```

   This migrates the configured local Node database, bootstraps the local shell, and imports `sites/demo-source/canonical/site-export/`. It is intended for single-site local PostgreSQL or SQLite development with local filesystem storage, and it refuses to run against a non-empty content database.

4. **Reload just the canonical demo snapshot** into the current local shell:

   ```bash
   mise run db-wrangler-load-demo
   ```

The canonical snapshot remains the primary development truth source. The
canonical `site-export/` fixture is a derived portability fixture for `jant site
export/import` round-trips and local Node database seeding. The old local SQL
export/import workflow was removed to keep the site-aware tool chain smaller
and less ambiguous.

### Local Postgres

Node development defaults to SQLite, which needs no setup. Reach for Postgres when you
are working on dialect-specific behavior — `src/db/pg/schema.ts`, the migrations under
`src/db/migrations/pg/`, or a bug that only reproduces on Postgres.

If you do not already run Postgres, start one. The container creates the user,
password, and database from these variables on first boot, so nothing else has to be
provisioned:

```bash
docker run -d --name jant-postgres \
  -e POSTGRES_USER=jant \
  -e POSTGRES_PASSWORD=jant \
  -e POSTGRES_DB=jant_dev \
  -p 5432:5432 \
  postgres:18-alpine
```

Those three values are the whole connection string. Put it in
`packages/core/.env.node`:

```bash
DATABASE_URL=postgres://jant:jant@localhost:5432/jant_dev
```

Then migrate, and optionally load the canonical demo site:

```bash
mise run db-node-migrate
mise run db-node-load-demo
```

Already running Postgres? Jant never creates the database itself — `DATABASE_URL` has
to point at one that exists — so create it with your own credentials and use those in
the URL:

```bash
createdb jant_dev
```

Give each worktree its own database. Sharing one mixes the content of two sites, and
the failure is silent. Add the extra ones to the running container, naming them after
the worktree so a stale `DATABASE_URL` cannot write into the wrong site:

```bash
docker exec jant-postgres createdb -U jant jant_dev_2
```

The Postgres dialect is covered on every push by the `pg-smoke` job in
`.github/workflows/ci.yml`, which runs `mise run check-pg-smoke` against a throwaway
Postgres service container. To reproduce that locally, point both variables at a
database you can afford to lose — the smoke test drops and recreates it:

```bash
PG_SMOKE_ADMIN_DATABASE_URL=postgres://jant:jant@localhost:5432/postgres \
PG_SMOKE_DATABASE_URL=postgres://jant:jant@localhost:5432/jant_pg_smoke \
mise run check-pg-smoke
```

### Reset

```bash
mise run db-wrangler-clean   # Delete local Wrangler/D1 database only (alias: `clean`)
mise run db-node-clean       # Delete local Node SQLite database and media storage
mise run clean-reset         # Nuclear reset — everything (node_modules, dist, db, cache, lockfile)
```

After any reset, just run `mise run dev` — migrations are applied automatically.

## Internationalization (i18n)

Jant uses [Lingui](https://lingui.dev/) for i18n with an SWC plugin for compile-time macro transforms.

### Adding Translatable Strings

Wrap user-facing strings with Lingui message descriptors and always include a context comment:

```tsx
import { msg } from "@lingui/core/macro";
import { useLingui } from "../src/i18n/context.js";

const { i18n } = useLingui();
return (
  <h1>
    {i18n._(
      msg({
        message: "Settings",
        comment: "@context: Page title",
      }),
    )}
  </h1>
);
```

For interpolated values, keep the runtime data in `values`:

```tsx
i18n._(
  msg({
    message: "Found {count} results",
    comment: "@context: Search results count",
  }),
  { count },
);
```

### Workflow

The i18n workflow is mostly automatic:

1. Add `msg()` descriptors and `i18n._()` calls in your code.
2. Commit — the pre-commit hook automatically extracts and compiles messages, then stages the updated locale files.
3. For AI-powered translation to other languages, run `mise run i18n-refresh` (requires `OPENAI_API_KEY`).

### Language

The site language is a site-wide setting (from `settings.SITE_LANGUAGE` in the database), defaulting to `"en"`. It is not per-user — all visitors see the same language.

## Pull Request Process

### Before Submitting

1. Run all checks:

   ```bash
   mise run check-tests && mise run check-lint && mise run check-types
   ```

2. If changing published packages, add a changeset:

   ```bash
   mise run changeset
   ```

3. Update documentation if needed.

### PR Guidelines

- Use clear, descriptive titles.
- Reference related issues.
- Include screenshots for UI changes.
- Keep PRs focused on a single concern.

### CI Checks

All PRs must pass:

- ESLint (no errors or warnings)
- TypeScript (no errors)
- Tests (all passing)
- Build (successful)
- i18n catalogs in sync

### Review Process

1. Submit PR to `main` branch.
2. Wait for CI checks to pass.
3. Address review feedback.
4. Merge when approved.

## Release Process

We use [Changesets](https://github.com/changesets/changesets) for version management.

### Creating a Changeset

After making changes that should be released:

```bash
mise run changeset
```

This will prompt you to:

1. Select changed packages
2. Choose bump type (major/minor/patch)
3. Write a change summary

### Version Types (SemVer)

| Type    | When to use                         | Example           |
| ------- | ----------------------------------- | ----------------- |
| `patch` | Bug fixes, typos                    | `1.0.0` → `1.0.1` |
| `minor` | New features (backwards compatible) | `1.0.0` → `1.1.0` |
| `major` | Breaking changes                    | `1.0.0` → `2.0.0` |

### Release Workflow

1. Make changes and create a changeset (`mise run changeset`).
2. Open a PR and merge to `main`.
3. A Release PR is auto-created (or updated) by the bot.
4. Merge the Release PR to publish to npm automatically.

```bash
# Check pending changesets
mise run changeset-status

# Dry run publish (no actual publish)
mise run release-publish-dry
```

For detailed release documentation, see [docs/RELEASING.md](docs/RELEASING.md).

**Packages published**: `@jant/core` (framework), `create-jant` (scaffolding CLI).

## Getting Help

- [GitHub Issues](https://github.com/jant-me/jant/issues) — Bug reports and feature requests
- [Documentation](https://jant.me/docs) — Guides and API reference

## License

By contributing, you agree that your contributions will be licensed under the project's AGPL-3.0-or-later terms.
