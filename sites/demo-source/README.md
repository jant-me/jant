# Demo Source

`sites/demo-source` is the authoring site for the public demo.

Use this Worker to write, edit, and curate the official demo content. Its
output is the canonical site snapshot committed in
`sites/demo-source/canonical/snapshot/`.

Private means only the author can write here. Reading is open, the way every
Jant site is — so `wrangler.toml` sets `NOINDEX = "true"` to keep the official
demo content from being indexed twice, once under a hostname that is not its
public face.

Repo automation still lives in the root `mise.toml` because the rebuild flow
crosses both `sites/demo-source` and `sites/demo`, and `sites/demo` also serves
as the starter template source. The operational docs live with each site.

## Role

- `demo-source` is the authoring environment.
- `demo-public` is the disposable public runtime at `sites/demo`.
- `content-lab` stays focused on rehearsal and CI data, not demo publishing.

## Required Resources

Before deploying, replace the placeholder values in `sites/demo-source/wrangler.toml`:

- `SITE_ORIGIN`
- `SITE_PATH_PREFIX` if you want a subpath deploy
- `database_id`
- `bucket_name` if you want a different R2 bucket name
- Optional: `R2_PUBLIC_URL`
- Optional: `IMAGE_TRANSFORM_URL`

You also need:

- a dedicated D1 database for demo-source
- a dedicated R2 bucket for demo-source media
- `AUTH_SECRET` configured in Cloudflare and in your local `.dev.vars` when developing locally

## Commands

```sh
pnpm --filter jant-demo-source dev
pnpm --filter jant-demo-source deploy
pnpm --filter jant-demo-source export-canonical
```

Or use the repo-level tasks:

```sh
mise run dev-demo-source
mise run deploy-demo-source
mise run demo-source-export-canonical
mise run demo-source-export-canonical-site-export
mise run db-demo-source-migrate
mise run demo-source-reset
```

## GitHub Actions deploy

`sites/demo-source` deploys from the repo root workflow
[`deploy-demo-source.yml`](../../.github/workflows/deploy-demo-source.yml),
which is `workflow_dispatch` only — run it by hand from the Actions tab. Pushing
to `main` does not deploy it, so the deployed Worker stays on whatever code was
current the last time someone ran it.

Configure these repository secrets before relying on CI deploys:

- `CF_API_TOKEN`
- `CF_ACCOUNT_ID`

## Environment Files for Repo Tasks

The repo-level `mise` tasks and helper scripts now auto-load a small set of
`.env` files before they call Wrangler or the Jant CLI.

Precedence is:

1. shell environment
2. `sites/demo-source/.env.local`
3. `sites/demo-source/.env`
4. repo root `.env.repo.local`
5. repo root `.env.repo`
6. legacy repo root `.env.local`
7. legacy repo root `.env`

Recommended split:

- repo root `.env.repo.local`: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
  Start from [`.env.repo.example`](../../.env.repo.example).
- [`.env.example`](.env.example):
  copy to `.env.local` only if you want local overrides such as
  `DEMO_SOURCE_URL`

## Publishing Flow

1. Edit the official demo content in `demo-source`.
2. Export a fresh canonical snapshot:

   ```sh
   mise run demo-source-export-canonical
   ```

3. Optional: refresh the canonical `site-export/` fixture for `jant site import`
   testing and local Node/Postgres bootstrapping. This one goes over HTTP
   against the deployed `demo-source` site, so it needs `JANT_API_TOKEN` and it
   reads the live site rather than the snapshot you just committed — deploy
   first if the two have to agree:

   ```sh
   mise run demo-source-export-canonical-site-export
   ```

4. Review and commit `sites/demo-source/canonical/snapshot/` and, when
   refreshed, `sites/demo-source/canonical/site-export/`.
5. Rebuild the public demo from the canonical snapshot:

   ```sh
   mise run demo-rebuild
   ```

The nightly reset workflow for `demo` should use the same canonical snapshot.

## Resetting demo-source

If you want to wipe `demo-source` and return it to an empty migrated schema:

```sh
mise run demo-source-reset
```

That task will:

1. delete currently referenced demo-source storage objects
2. drop all remote D1 tables
3. re-run remote migrations

After that, either finish with `/setup` in the browser or import a site archive
or snapshot into the empty instance.
