---
name: jant-site-ops
description: Operate a standalone Jant site from the command line. Use for local development, deploys, migrations, password resets, site export/import, snapshot recovery, SQL export, and static asset preparation.
---

# Jant Site Operations

Use this skill when the task is operational rather than purely editorial.

## Run Commands From the Site Root

All commands below assume the current working directory is the site root created by `create-jant`.

## Day-to-Day Commands

```bash
npm run dev
npm run deploy
npm run reset-password
```

What they do:

- `npm run dev`: run local migrations, then start Wrangler dev
- `npm run deploy`: run remote migrations and deploy to Cloudflare
- `npm run reset-password`: generate a password reset token for the local site

## CLI Commands

```bash
npx jant migrate --local
npx jant migrate --remote --config ./wrangler.toml
npx jant site export --url https://your-site.example --output ./jant-site-export.zip
npx jant site import --url https://your-site.example --path ./jant-site-export.zip --dry-run
npx jant site snapshot export --output ./jant-site-snapshot.zip
npx jant site snapshot import --path ./jant-site-snapshot.zip --replace
npx jant db export --output ./jant-export.sql
```

## Pick the Right Export Format

- `site export`: portable content archive for migration or static inspection
- `site snapshot export`: recovery archive that preserves Jant IDs and storage keys
- `db export`: raw SQL dump only

Do not treat those as interchangeable.

## Deployment Guidance

Prefer:

```bash
npm run deploy
```

Avoid calling `wrangler deploy` directly for the normal site workflow. Jant's deploy command handles migrations and asset preparation first.

## Media Utilities

Useful commands when working with exported sites or static archives:

```bash
npx jant site pull-media --help
npx jant assets prepare
npx jant uploads cleanup --help
```

Use `assets prepare` when you need the publishable asset directory assembled locally.

## Authentication

`site export` and `site import` always target a deployed site URL and require an API token:

```bash
export JANT_API_TOKEN=jnt_your_token
npx jant site export --url https://your-site.example --output ./jant-site-export.zip
```

For D1-oriented commands like snapshot export and `db export`, pass `--remote` and your Wrangler config when needed.

## Gotchas

1. `site import` expects an empty target site unless you are explicitly using snapshot restore semantics.
2. Snapshot import currently requires `--replace`.
3. A SQL dump is not a complete backup unless you also preserve media objects.
4. Run operations from the project root. The CLI expects local config and installed `@jant/core`.
