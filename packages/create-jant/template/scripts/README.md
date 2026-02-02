# Demo Deployment Scripts

This directory contains scripts for managing the demo site at demo.jant.me.

## Setup

### 1. Create Cloudflare Resources

```bash
# Create D1 database
wrangler d1 create jant-demo-db
# Output: Created database 'jant-demo-db' with id: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# Create R2 bucket
wrangler r2 bucket create jant-demo-media
```

### 2. Update wrangler.demo.toml

Edit `templates/jant-site/wrangler.demo.toml` and replace the placeholder database_id:

```toml
[[d1_databases]]
binding = "DB"
database_name = "jant-demo-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"  # <-- Your actual ID
```

### 3. Set Secrets

```bash
# Set AUTH_SECRET for the demo worker
wrangler secret put AUTH_SECRET --config wrangler.demo.toml
# Enter a random string (32+ characters)
```

### 4. Configure GitHub Secrets

Add the following secrets to your GitHub repository:

| Secret | Description |
|--------|-------------|
| `CF_API_TOKEN` | Cloudflare API token with Workers, D1, and R2 permissions |
| `CF_ACCOUNT_ID` | Your Cloudflare account ID |
| `DEMO_AUTH_SECRET` | Same value as AUTH_SECRET above |

### 5. Set Custom Domain

In the Cloudflare dashboard:
1. Go to Workers & Pages > jant-demo
2. Settings > Triggers > Custom Domains
3. Add `demo.jant.me`

## Scripts

### `reset.sql`

Clears all user-created data:
- Posts, media, collections, redirects
- Sessions and verifications
- Preserves settings and user accounts

### `seed.sql`

Inserts demo data:
- Site settings (name, description, etc.)
- Sample posts (article, note, link, quote)
- Sample collection

## Workflows

### Deploy Demo (`.github/workflows/deploy-demo.yml`)

Triggers:
- Push to `main` branch (when core or template changes)
- Manual dispatch

Actions:
- Builds the project
- Deploys to Cloudflare Workers
- Runs database migrations

### Reset Demo (`.github/workflows/reset-demo.yml`)

Triggers:
- Daily at 00:00 UTC (cron)
- Manual dispatch (requires "reset" confirmation)

Actions:
- Clears all user data
- Re-inserts seed data

## Manual Operations

### Deploy manually

```bash
cd templates/jant-site
pnpm build
wrangler deploy --config wrangler.demo.toml
```

### Reset data manually

```bash
# Clear data
wrangler d1 execute jant-demo-db --remote --file=scripts/reset.sql

# Insert seed data
wrangler d1 execute jant-demo-db --remote --file=scripts/seed.sql
```

### Run migrations manually

```bash
wrangler d1 migrations apply jant-demo-db --remote
```
