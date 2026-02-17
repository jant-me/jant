# Deployment

Jant runs on Cloudflare Workers. This guide walks you through deploying your site.

## Prerequisites

1. A Cloudflare account
2. Wrangler CLI installed (`pnpm add -g wrangler`)
3. Logged in to Wrangler (`wrangler login`)

## Create Resources

### D1 Database

```bash
wrangler d1 create jant-db
```

Copy the database ID and update `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "jant-db"
database_id = "your-database-id"
```

### R2 Bucket (for media)

```bash
wrangler r2 bucket create jant-media
```

Update `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "R2"
bucket_name = "jant-media"
```

**Recommended:** Enable public access on your R2 bucket and set `R2_PUBLIC_URL` in `wrangler.toml`. This allows media files to be served directly from Cloudflare's CDN instead of being proxied through your Worker.

1. Go to Cloudflare Dashboard → R2 → `jant-media` → Settings → Public access
2. Enable public access (custom domain or `r2.dev` subdomain)
3. Add the URL to `wrangler.toml`:

```toml
[vars]
R2_PUBLIC_URL = "https://media.yourdomain.com"
```

> Without `R2_PUBLIC_URL`, media uploads still work — files are served through a Worker proxy route (`/media/:id`), but this is slower and uses more Worker CPU.

## Configure Secrets

```bash
# Required: Auth secret (must be at least 32 characters!)
# Generate one with: openssl rand -base64 32
wrangler secret put AUTH_SECRET

# Required: Your site URL
wrangler secret put SITE_URL
```

> **Important**: `AUTH_SECRET` must be at least 32 characters. If it's shorter, authentication will fail with "AUTH_SECRET not configured".

## Run Migrations

```bash
# Apply database migrations
wrangler d1 migrations apply DB
```

## Deploy

```bash
pnpm run deploy
```

Your site is now live at `https://your-worker.workers.dev`.

## Custom Domain

1. Go to Cloudflare Dashboard → Workers → Your Worker
2. Click "Custom Domains"
3. Add your domain

## Environment Variables

Set these in `wrangler.toml` under `[vars]`:

```toml
[vars]
SITE_URL = "https://yourdomain.com"
```

Or use secrets for sensitive values:

```bash
wrangler secret put AUTH_SECRET
```

See [Configuration](configuration.md) for all available options.

## Updating

Pull the latest changes and redeploy:

```bash
git pull
pnpm run deploy
```

Database migrations run automatically on deploy.
