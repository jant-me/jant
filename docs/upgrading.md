# Upgrading

## Before you upgrade

Back up the database and media; see [Backups and recovery](backups.md). On a 0.x release, go through [Upgrading from 0.x](#upgrading-from-0x) first.

## Upgrade

### Cloudflare

```bash
npm install @jant/core@latest
```

Commit `package.json` and the lockfile and push to `main`, or run `npm run deploy`.

### Docker Compose

```bash
docker compose pull
docker compose up -d
```

### Docker without Compose

Pull the new image and run the migrations, then start a new container from the image:

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

Check these environment variables:

- Switches such as `NOINDEX` take `true` or `false`, not `1` or `yes`.
- `RATE_LIMIT_DISABLED=true` is now `RATE_LIMIT_ENABLED=false`.
- `SITE_ORIGIN` holds only the origin, such as `https://example.com`. A subpath goes in `SITE_PATH_PREFIX`.
- An empty `CORS_ORIGINS` turns cross-origin access off. Remove the line to allow every origin.

If you let Jant Discover list only your featured posts, the upgrade turns that off. To stay listed, tick **Allow Jant Discover to list my site** again under **Settings → General**.

### Cloudflare sites

In the same commit as the new `@jant/core`, replace the deploy workflow and `AGENTS.md` with the current ones:

```bash
curl -fsSL -o .github/workflows/deploy.yml https://raw.githubusercontent.com/jant-me/jant-starter/main/.github/workflows/deploy.yml
curl -fsSL -o AGENTS.md https://raw.githubusercontent.com/jant-me/jant-starter/main/AGENTS.md
rm -rf .agents/skills .claude/skills
```

For a pnpm or Yarn project, copy the workflow from a new project made with the same package manager.

Add `keep_vars = true` near the top of `wrangler.toml`, before the first `[section]`, then check that the variables you set in the Cloudflare dashboard are still there.

### Docker and Node

- Without Compose, behind a reverse proxy, set `TRUST_PROXY=true`.
- Rename `.env.node` to `.env`.

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
