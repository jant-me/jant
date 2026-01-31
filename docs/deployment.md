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

## Configure Secrets

```bash
# Required: Auth secret (generate a random 32+ character string)
wrangler secret put AUTH_SECRET

# Required: Your site URL
wrangler secret put SITE_URL
```

## Run Migrations

```bash
# Apply database migrations
wrangler d1 migrations apply DB
```

## Deploy

```bash
pnpm deploy
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
pnpm deploy
```

Database migrations run automatically on deploy.
