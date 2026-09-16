# Type-check the TypeScript dev scripts

`dev/scripts/*.ts` run through `dev/run-script.mjs`, and
`src/__tests__/dev-scripts.test.ts` loads each one. Loading cannot see a named
import the module no longer exports: Vite's runner leaves it `undefined` until
the call. Nothing type-checks the scripts either — `tsconfig.server.json`
includes only `src/**/*`. So renaming an export in `src/` that a script uses
passes CI. A probe config with the scripts added reports 16 errors.

## Decision: `allowJs`, with JSDoc on the JS exports the scripts call

The scripts import three JS modules: `bin/lib/site-snapshot.js`,
`bin/lib/site-selection.js`, `dev/scripts/dev-auth-db.mjs`.

- `.d.ts` sidecars: precise types, but a second list of exports that nothing
  ties to the JS. Rename an export in `site-snapshot.js` and the stale
  declaration still passes — the same blind spot, moved one module over.
- `allowJs` (without `checkJs`): the compiler reads the exports from the JS the
  runner executes, so a missing export fails. Types come from JSDoc where it
  exists and inference where it does not; an untyped parameter is an implicit
  `any` that tsc does not report in a TS caller. So the exports the scripts
  call get JSDoc types (the convention for library functions anyway;
  `resolveCliSite` already has them), and a one-off compiler-API scan confirms
  no `any`-typed expression is left in the scripts.

## Plan

- [x] `packages/core/tsconfig.dev.json`: extends `tsconfig.server.json`,
      `allowJs`, includes `dev/**/*.ts` and `src/types/**/*.d.ts` (the `?raw`
      module declarations `services/export.ts` needs). Reference it from
      `tsconfig.json`.
- [x] JSDoc types in `bin/lib/site-snapshot.js` for what `reset-node-dev.ts`
      calls, including a `SnapshotMeta` typedef and an assertion signature on
      `assertSnapshotMeta` so `JSON.parse` output narrows from `unknown`.
- [x] `bin/lib/site-selection.js`: `getCliSiteResolutionMode` and
      `resolveCliSite` accept anything carrying `SITE_RESOLUTION_MODE`, not
      only a string record — `Bindings` is passed today.
- [x] `generate-brand-assets.ts`: `.js` import extension; copy the PNG into an
      `ArrayBuffer` instead of slicing a possibly shared buffer; replace the
      hand-rolled argument loop with `node:util` `parseArgs`, as the other
      scripts do.
- [x] `import-node-demo-site-export.ts` and `reset-node-dev.ts`: `query`
      returns `results ?? []` (`RawQueryStatement.all` marks it optional).
      `reset-node-dev.ts` parses `meta.json` as `unknown`.
- [x] `import-node-demo-site-export.ts`: child-process env built from the
      scalar settings in `Bindings`, not by spreading `Bindings`.
- [x] AGENTS.md dev-script rule and the `dev-scripts.test.ts` header name
      `tsconfig.dev.json`.
- [x] Guard check: an import of a missing export from `src/` in a dev script
      fails `check-types`; same for a missing export from `bin/lib`.
- [ ] Verify: `check-types`, `check-lint`, `check-tests`; `run-script.mjs
      --check` still loads every script; `brand-export` to a temp dir still
      writes all assets and rejects a bad argument.
      Open: `src/db/__tests__/demo-canonical-snapshot.test.ts` did not finish
      in this worktree (see Results). Run it where Wrangler can reach npm.

## Results

- `check-types` and `check-lint` pass. `tsc -b` runs the new project: the
  16 probe errors are gone, and `dev/entry.ts` checks clean too.
- Guard mutations, each fails `tsc -b` with TS2305/TS2724: importing a missing
  export from `src/lib/time.js`, from `bin/lib/site-snapshot.js`, and from
  `dev/scripts/dev-auth-db.mjs`.
- Compiler-API scan of `dev/scripts/*.ts` for `any`-typed expressions: before
  the JSDoc, `reset-node-dev.ts` carried `any` through `JSON.parse` and every
  `site-snapshot.js` call. After, the only hits are the `JSON.parse` calls
  themselves, assigned straight to `unknown`, plus checker noise (the `NodeJS`
  namespace in a type name, a property key in a destructuring pattern).
- `run-script.mjs --check` loads all four scripts from the repo root.
- `generate-brand-assets.ts`: export to a temp dir writes all 14 files,
  identical to the committed script's output except zip entry timestamps.
  Regenerating `jant-branding-generated.ts` gives the committed file byte for
  byte after Prettier. `--export-dir` with no value, `--export-dir=`, and an
  unknown option each fail; `--help` prints usage and exits 0.
- vitest without `demo-canonical-snapshot.test.ts`: 325 files, 4452 tests
  pass. That file hangs here in and out of the sandbox: every
  `wrangler d1 execute --local` child holds an established, stalled
  connection to `registry.npmjs.org` and never exits, even for `SELECT 1`
  against a freshly migrated database. The `bin/lib` changes on its path are
  JSDoc only.
