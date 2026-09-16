# Make `db-node-bootstrap-shell` set up the Node database

`db-node-bootstrap-shell` migrates the Node database, then runs
`dev-auth-bootstrap`, which writes credentials to `.dev.vars` and sets up the
local **Wrangler D1** database. The Node database is left at `/setup`, and
`.env.node` gets no credentials. Broken since the task was added for symmetry
in 4bc0bfe8 (2026-04-21). It is not documented anywhere.

## Decision: fix (confirmed with user)

Nothing else gives you an empty, set-up Node site with dev credentials:

- `db-node-rebuild-demo` and `db-node-load-demo` both add demo content, and
  rebuild-demo works only with SQLite.
- `jant setup` sets up the site, but doesn't write `AUTH_SECRET` or
  `DEV_API_TOKEN`, so `/__dev/login` and `import-local` can't be used.
- Browser `/setup` can't be driven by an agent without a token.
- `sync-dev-password.ts` tells a user with no admin to run
  `db-node-rebuild-demo`, which wipes their database. A working shell task is
  the non-destructive answer.

Removal would leave the gap above, plus a hint that wipes the database.

## Base and coordination

Depends on work that isn't on `main` yet:

- `preview` 72880b6b: `dev/run-script.mjs`, `dev-scripts.test.ts`.
- `preview` 76e976df: `setUpNodeInstance`, `jant setup`.
- Uncommitted in the main checkout (session "Fix db-node-load-demo's stale
  site import step"): `dev/script-env.ts`, plus edits to both demo scripts.
- Uncommitted in worktree sweet-mendel (session "Type-check packages/core dev
  scripts in CI"): more edits to both demo scripts, plus `tsconfig.dev.json`.

## Plan

- [ ] Wait for both sessions to commit (user's call), then rebase this branch
      onto the branch where their work lands.
- [ ] `dev/node-dev-site.ts` (outside `dev/scripts/`, not a runnable script):
      the dev-shell steps both demo scripts duplicate today — resolve the dev
      password (arg, `$DEMO_PASSWORD`, env file, default), build the runtime
      env, write `AUTH_SECRET`/`DEV_API_TOKEN`/`DEMO_*` through
      `script-env.ts`, and set up the site with `setUpNodeInstance` (dev email,
      default name and language).
- [ ] `dev/scripts/bootstrap-node-dev.ts`: `[password] [--check]`; migrate,
      set up, print env file, database, outcome, sign-in URL, and auto-login
      URL. On `already-set-up`, the account is left unchanged (same as
      `jant setup`); point to `dev-auth-sync` for a password mismatch.
- [ ] `reset-node-dev.ts`, `import-node-demo-site-export.ts`: use the shared
      module.
- [ ] `db-node-clean`: a runnable script that deletes what the env resolves to
      (SQLite file + `-wal`/`-shm`, `LOCAL_STORAGE_PATH`), SQLite only, using
      the same shared code as rebuild-demo's reset.
- [ ] mise: `db-node-bootstrap-shell` runs the script through the runner, with
      an accurate description.
- [ ] `sync-dev-password.ts`: point a missing admin at
      `db-node-bootstrap-shell`.
- [ ] Test: `db-node-clean` on a temp dir removes the database and media and
      nothing else.
- [ ] Test: run the task's script against a temp SQLite DB
      (`JANT_ENV_FILE=""`): owner account, completed onboarding, default nav;
      second run reports `already-set-up` and changes nothing.
- [ ] Docs: CONTRIBUTING (Local Development Data, Database command list,
      Local Postgres "empty site" path).
- [ ] Verify: task end to end against a temp dir with `.env.node` backed up
      and byte-identical afterwards; `check-tests`, `check-lint`,
      `check-format`, `check-copy`.

## Found while investigating

- (In scope, per user) `db-node-clean` removes `packages/core/.data` and `.media`, but the Node
  default is `packages/core/data` (media in `data/media`), and it ignores
  `DATABASE_URL`/`LOCAL_STORAGE_PATH`. It deletes nothing on a default setup.
  Added in the same commit.
