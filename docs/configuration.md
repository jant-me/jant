# Configuration

Jant is configured through environment variables and dashboard settings.

## Environment Variables

Set these in `wrangler.toml` or as Cloudflare secrets.

### Required

| Variable      | Description                                              |
| ------------- | -------------------------------------------------------- |
| `SITE_URL`    | Your site's public URL (e.g., `https://myblog.com`)      |
| `AUTH_SECRET` | Random string, 32+ characters. Used for session signing. |

### Storage

Jant supports two storage backends for media uploads: **Cloudflare R2** (default) and **S3-compatible** services.

#### R2 (Default)

| Variable        | Where           | Description                                         |
| --------------- | --------------- | --------------------------------------------------- |
| `R2_PUBLIC_URL` | `wrangler.toml` | Public URL for R2 bucket (**strongly recommended**) |

R2 uses the `[[r2_buckets]]` binding in `wrangler.toml`. No additional configuration is needed beyond creating the bucket.

> **Recommended:** Configure `R2_PUBLIC_URL` for best performance. Without it, every media request is proxied through your Worker — the Worker fetches the file from R2 and streams it to the client, adding latency and consuming CPU time. With `R2_PUBLIC_URL` set, media is served directly from Cloudflare's CDN edge, which is faster and reduces Worker usage.
>
> **Setup:** Go to Cloudflare Dashboard → R2 → Your Bucket → Settings → Public access. Enable public access (via custom domain or `r2.dev` subdomain), then set the URL in `wrangler.toml`:
>
> ```toml
> [vars]
> R2_PUBLIC_URL = "https://media.yourdomain.com"
> ```

#### S3-Compatible Storage

Use any S3-compatible service (AWS S3, Backblaze B2, MinIO, DigitalOcean Spaces, etc.) as an alternative to R2.

| Variable               | Where           | Description                                                  |
| ---------------------- | --------------- | ------------------------------------------------------------ |
| `STORAGE_DRIVER`       | `wrangler.toml` | Set to `"s3"` to enable S3 storage                           |
| `S3_ENDPOINT`          | `wrangler.toml` | S3 endpoint URL (e.g., `https://s3.us-east-1.amazonaws.com`) |
| `S3_BUCKET`            | `wrangler.toml` | Bucket name                                                  |
| `S3_REGION`            | `wrangler.toml` | Bucket region (defaults to `"auto"`)                         |
| `S3_PUBLIC_URL`        | `wrangler.toml` | Public URL for accessing uploaded files                      |
| `S3_ACCESS_KEY_ID`     | `.dev.vars`     | Access key ID (secret — never commit)                        |
| `S3_SECRET_ACCESS_KEY` | `.dev.vars`     | Secret access key (secret — never commit)                    |

**Setup:**

1. Set environment variables in `wrangler.toml`:

   ```toml
   [vars]
   STORAGE_DRIVER = "s3"
   S3_ENDPOINT = "https://s3.us-east-1.amazonaws.com"
   S3_BUCKET = "my-bucket"
   S3_REGION = "us-east-1"
   S3_PUBLIC_URL = "https://cdn.example.com"
   ```

2. Add secrets to `.dev.vars` (local) or `wrangler secret put` (production):

   ```bash
   # .dev.vars
   S3_ACCESS_KEY_ID=your-access-key
   S3_SECRET_ACCESS_KEY=your-secret-key
   ```

3. Remove the `[[r2_buckets]]` section from `wrangler.toml` — it's not needed with S3.

> **Note:** When using `create-jant`, select "S3-compatible" during setup to have this configured automatically.

### Image Transformations (Optional)

For automatic thumbnail generation and image optimization:

| Variable              | Description                        |
| --------------------- | ---------------------------------- |
| `IMAGE_TRANSFORM_URL` | Base URL for image transformations |

**Cloudflare Image Transformations Setup:**

1. Go to Cloudflare Dashboard → Images → Transformations
2. Enable transformations for the zone that serves your images
3. Set `IMAGE_TRANSFORM_URL` to **the domain where your images are hosted**, plus `/cdn-cgi/image`

**Use the domain that serves your images:**

- If you set `R2_PUBLIC_URL` to a custom domain (recommended), use that domain:

  ```toml
  [vars]
  R2_PUBLIC_URL = "https://media.yourdomain.com"
  IMAGE_TRANSFORM_URL = "https://media.yourdomain.com/cdn-cgi/image"
  ```

- If you didn't set `R2_PUBLIC_URL` (images are proxied through your Worker), use your site domain:

  ```toml
  [vars]
  IMAGE_TRANSFORM_URL = "https://yourdomain.com/cdn-cgi/image"
  ```

> **Why?** Cloudflare Image Transformations can only transform images on the same domain by default. If the domain in `IMAGE_TRANSFORM_URL` doesn't match where the images are served, transformations will fail.

When enabled, the dashboard displays optimized thumbnails instead of full images. Without this setting, original images are shown (still works fine).

**Note:** Images are automatically processed client-side before upload:

- EXIF orientation correction
- Resize to max 1920px
- Metadata stripped (GPS, device info removed)
- Converted to WebP at 85% quality

## Dashboard Settings

These can be changed in `/dash/settings`:

| Setting            | Description                             |
| ------------------ | --------------------------------------- |
| `SITE_NAME`        | Your site's display name                |
| `SITE_DESCRIPTION` | Short description for meta tags and RSS |
| `SITE_LANGUAGE`    | Primary language (`en`, `zh`, etc.)     |
| `THEME`            | Color theme name                        |

## Reserved Paths

These paths are reserved by Jant and cannot be used as page slugs:

```
featured, signin, signout, setup, dash, api, feed, search, archive,
notes, articles, links, quotes, media, pages, p, c, static, assets
```

## Configuration Files

### wrangler.toml

Non-sensitive environment variables are defined in `wrangler.toml` and committed to git:

```toml
name = "my-jant-blog"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[vars]
SITE_URL = "https://myblog.com"

# Optional: Site configuration (can be overridden in dashboard)
# SITE_NAME = "My Blog"
# SITE_DESCRIPTION = "A personal blog"
# SITE_LANGUAGE = "en"

# Optional: R2 and image optimization
# R2_PUBLIC_URL = "https://media.myblog.com"
# IMAGE_TRANSFORM_URL = "https://media.myblog.com/cdn-cgi/image"

# Optional: S3-compatible storage (alternative to R2)
# Set STORAGE_DRIVER = "s3" and configure the options below.
# When using S3, the [[r2_buckets]] section can be removed.
# STORAGE_DRIVER = "s3"
# S3_ENDPOINT = "https://s3.us-east-1.amazonaws.com"
# S3_BUCKET = "my-bucket"
# S3_REGION = "us-east-1"
# S3_PUBLIC_URL = "https://cdn.example.com"

[[d1_databases]]
binding = "DB"
database_name = "jant-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

[[r2_buckets]]
binding = "R2"
bucket_name = "jant-media"
```

### .dev.vars (Local Development)

Sensitive secrets are stored in `.dev.vars` (NOT committed to git):

```bash
# .dev.vars
AUTH_SECRET=your-32-plus-character-secret-here
```

Copy from `.dev.vars.example` and fill in your actual values.

### Production Secrets

For production, set secrets via Cloudflare:

```bash
# Set production secret
wrangler secret put AUTH_SECRET
# Enter your secret when prompted
```
