# Upgrading

Migrations run in order on deploy, so you can skip versions. They only go forward: the way back from an upgrade is a backup taken before it.

## Before you upgrade

Back up the database and media; see [Backups and recovery](backups.md). On a 0.x release, also go through [Upgrading from 0.x](#upgrading-from-0x).

## Upgrade

### Cloudflare

```bash
npm install @jant/core@latest
```

Commit `package.json` and the lockfile and push to `main`, or run `npm run deploy`. Install with `@latest`: `npm update` stays inside the version range in `package.json` and never reaches a new major version.

### Docker Compose

```bash
docker compose pull
docker compose up -d
```

`up` runs the migrations before it starts the site.

### Docker without Compose

Pull the new image and run the migrations with the same data directory, then start a new container from it:

```bash
docker pull owenyoung/jant:latest
docker run --rm -e AUTH_SECRET=<auth-secret> -v "$(pwd)/data:/var/lib/jant" owenyoung/jant:latest jant migrate
```

### Node

Install the new `@jant/core`, run `jant migrate`, then restart `jant start`.

### Hosted Jant

The service upgrades your site.

## Upgrading from 0.x

### Everyone

From 0.11, a variable set to a value it doesn't take stops the site at startup. Check these:

- Switches such as `NOINDEX` take `true` or `false`, not `1` or `yes`.
- `RATE_LIMIT_DISABLED=true` is now `RATE_LIMIT_ENABLED=false`.
- `SITE_ORIGIN` holds only the origin, such as `https://example.com`. A subpath goes in `SITE_PATH_PREFIX`.
- An empty `CORS_ORIGINS` turns cross-origin access off. Remove the line to allow every origin.

A site that offered Jant Discover its featured posts is now off the directory. Turn Discover on again under Settings → General.

### Cloudflare sites

In the same commit as the new `@jant/core`, replace the deploy workflow and `AGENTS.md` with the current ones. A workflow from before 0.11 skips every deploy:

```bash
curl -fsSL -o .github/workflows/deploy.yml https://raw.githubusercontent.com/jant-me/jant-starter/main/.github/workflows/deploy.yml
curl -fsSL -o AGENTS.md https://raw.githubusercontent.com/jant-me/jant-starter/main/AGENTS.md
rm -rf .agents/skills .claude/skills
```

The workflow installs with npm. A project made with pnpm or Yarn copies it from a new project made the same way.

Add `keep_vars = true` near the top of `wrangler.toml`, before the first `[section]`. Without it, every deploy deletes the variables you set in the Cloudflare dashboard. Set any that are already gone again.

### Docker and Node

- Behind a reverse proxy, set `TRUST_PROXY=true`, or every visitor shares one sign-in rate limit. `compose.yml` already sets it.
- `jant start` and the `jant` commands read `.env` in the working directory. Rename `.env.node` to `.env`.

### Custom CSS

| Before                | Now                       |
| --------------------- | ------------------------- |
| `--site-elevated-bg`  | `--site-page-bg`          |
| `--site-nav-hover-bg` | `--site-subtle-bg`        |
| `--search-mark-*`     | `--site-search-mark-*`    |
| `--content-max-width` | `--layout-body-max-width` |
| `--content-gap`       | `--site-feed-rhythm`      |

`data-page` is on `<body>`, so a selector that joined it with another attribute needs a space: `[data-page="post"] article[data-post]`.

### Scripts

| Before                               | Now                            |
| ------------------------------------ | ------------------------------ |
| `jant export`                        | `jant db export`               |
| `jant import-site`                   | `jant site import`             |
| `jant site export <url>`             | `jant site export --url <url>` |
| `jant site export --directory <dir>` | `--output <dir>`               |
| `/api/upload/:id`                    | `/api/media/:id`               |
| `GET /api/public/posts` (the list)   | `GET /api/public/threads`      |

`GET /api/search` needs an API token, and `nextCursor` goes back as it came. The [release notes](https://github.com/jant-me/jant/releases) for 0.8 to 0.11 list every API change.
