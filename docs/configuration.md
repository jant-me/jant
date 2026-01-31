# Configuration

Jant is configured through environment variables and dashboard settings.

## Environment Variables

Set these in `wrangler.toml` or as Cloudflare secrets.

### Required

| Variable | Description |
|----------|-------------|
| `SITE_URL` | Your site's public URL (e.g., `https://myblog.com`) |
| `AUTH_SECRET` | Random string, 32+ characters. Used for session signing. |

### Storage

| Variable | Description |
|----------|-------------|
| `R2_BUCKET` | Cloudflare R2 bucket name for media storage |
| `R2_PUBLIC_URL` | Public URL for R2 bucket (if using custom domain) |

### Optional: Cloudflare Images

For automatic image optimization:

| Variable | Description |
|----------|-------------|
| `CF_IMAGES_ACCOUNT_ID` | Your Cloudflare account ID |
| `CF_IMAGES_API_TOKEN` | Images API token |

## Dashboard Settings

These can be changed in `/dash/settings`:

| Setting | Description |
|---------|-------------|
| `SITE_NAME` | Your site's display name |
| `SITE_DESCRIPTION` | Short description for meta tags and RSS |
| `SITE_LANGUAGE` | Primary language (`en`, `zh`, etc.) |
| `THEME` | Color theme name |

## Reserved Paths

These paths are reserved by Jant and cannot be used as page slugs:

```
featured, signin, signout, setup, dash, api, feed, search, archive,
notes, articles, links, quotes, media, pages, p, c, static, assets
```

## Example wrangler.toml

```toml
name = "my-jant-blog"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[vars]
SITE_URL = "https://myblog.com"

[[d1_databases]]
binding = "DB"
database_name = "jant-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

[[r2_buckets]]
binding = "R2"
bucket_name = "jant-media"
```
