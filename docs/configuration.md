# Configuration

Jant configuration comes from two places:

- **Environment variables**: control infrastructure and runtime behavior
- **Settings page**: site name, appearance, time zone, and other options you can adjust online

Most single-site installs only need one value: `AUTH_SECRET`. Everything else is on-demand.

## Environment variables

Use:

- `wrangler.toml` for non-sensitive Cloudflare values
- `.dev.vars` for local Cloudflare secrets
- `.env` or process environment variables for Node and Docker

### Required

Every runtime requires this variable:

| Variable      | Description                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| `AUTH_SECRET` | Key better-auth uses to sign session cookies. At least 32 characters. Don't commit it to version control. |

- Cloudflare local development: put it in `.dev.vars`
- Cloudflare production: set it as a Worker secret with `npx wrangler secret put AUTH_SECRET`
- Node and Docker: put it in `.env` or process environment variables

### Public URL and subpath

In most cases, you don't need to set either of these. Jant derives the origin from the request host and mounts at the root path by default.

| Variable           | Description                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `SITE_ORIGIN`      | Fixed public origin, e.g. `https://example.com`. Affects absolute URLs in RSS, sitemap, exports, auth callbacks, etc. |
| `SITE_PATH_PREFIX` | Public path prefix, e.g. `/blog`. Affects all routes and static asset paths.                                          |

Set them only when:

- **The site sits behind a reverse proxy that doesn't pass Host correctly, so the auto-derived host is wrong**: set `SITE_ORIGIN=https://example.com`
- **Mounted under a subpath** (e.g. `example.com/blog`): set `SITE_PATH_PREFIX=/blog`
- **You want to pin the domain explicitly**

### Node and Docker

Under Node and Docker, Jant chooses the database runtime from `DATABASE_URL`:

- `file:` means SQLite
- `postgres:` or `postgresql:` means Postgres

Minimal SQLite example:

```env
AUTH_SECRET=your-32-plus-character-secret
SITE_ORIGIN=https://your-jant.example
DATABASE_URL=file:./data/jant.sqlite
```

Minimal Postgres example:

```env
AUTH_SECRET=your-32-plus-character-secret
SITE_ORIGIN=https://your-jant.example
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DBNAME
```

Common Node and Docker variables:

| Variable             | Default                  | Description                                                                                    |
| -------------------- | ------------------------ | ---------------------------------------------------------------------------------------------- |
| `DATA_DIR`           | `./data`                 | Base directory for default SQLite and local media paths                                        |
| `LOCAL_STORAGE_PATH` | `<DATA_DIR>/media`       | Override the local media directory                                                             |
| `LOCAL_PUBLIC_URL`   | unset                    | Public base URL when media is served outside Jant; leave unset to use Jant's `/media/*` routes |
| `HOST`               | `127.0.0.1` on bare Node | Bind address for `jant start`                                                                  |
| `PORT`               | `3000`                   | Bind port for `jant start`                                                                     |
| `TRUST_PROXY`        | `false`                  | Trust forwarded headers from the reverse proxy                                                 |

The official Docker image already defaults `DATA_DIR` to `/var/lib/jant`, and Docker Compose commonly sets `TRUST_PROXY=true`.

### Feed defaults (optional)

| Variable                    | Default    | Description                                                     |
| --------------------------- | ---------- | --------------------------------------------------------------- |
| `MAIN_RSS_FEED`             | `featured` | Controls what `/feed` returns: `featured` or `latest`           |
| `RSS_FEEDS_ENABLED`         | `true`     | Publishes the site, archive, and Collection Atom feeds          |
| `RSS_PUBLISH_DELAY_SECONDS` | `300`      | Wait before published posts and replies enter Jant's Atom feeds |

`featured` is the default on purpose. Jant assumes many posts should remain on the site without automatically becoming the default subscriber feed.

Posts remain immediately visible on the website. The delay only affects Jant's
dynamic Atom feeds and gives authors time to correct or unpublish new content
before feed readers can fetch it. It accepts an integer from `0` to `7200`
seconds and can also be changed at runtime in Config Editor. Set it to `0` to
disable the delay. The environment variable remains the fallback after a
runtime override is reset. Feed response caching may make the observed delay
slightly longer than the configured minimum.

Set `RSS_FEEDS_ENABLED=false` to make canonical and legacy feed URLs return
`404` and hide built-in feed discovery and navigation. A successful response
already in the Worker cache can remain visible for up to 60 seconds.

### Public API access (optional)

| Variable             | Default | Description                                                    |
| -------------------- | ------- | -------------------------------------------------------------- |
| `PUBLIC_API_ENABLED` | `true`  | Allows published content to be read without a session or token |

When disabled, `/api/public/*` returns `404` to every caller; authenticated
clients can use `/api/posts` instead. Collection, navigation, and search JSON
reads return `401` to anonymous requests but remain available to browser
sessions and Bearer API tokens. Public HTML pages, including `/search`, are
unchanged.

### Pagination (optional)

| Variable            | Default              | Description                              |
| ------------------- | -------------------- | ---------------------------------------- |
| `PAGE_SIZE`         | `50`                 | Default page size for timelines and APIs |
| `SEARCH_PAGE_SIZE`  | inherits `PAGE_SIZE` | Override search pagination only          |
| `ARCHIVE_PAGE_SIZE` | inherits `PAGE_SIZE` | Override archive pagination only         |

Set `SEARCH_PAGE_SIZE` and `ARCHIVE_PAGE_SIZE` only when search or archive really needs a different page size from the rest of the site.
All three values accept integers from `1` to `100`. They can also be changed at
runtime in Config Editor; the environment variables remain their deployment
fallbacks.

### Archive layout (optional)

| Variable                 | Default | Description                                    |
| ------------------------ | ------- | ---------------------------------------------- |
| `ARCHIVE_DEFAULT_LAYOUT` | `list`  | Layout `/archive` opens with: `list` or `grid` |

`list` renders full posts, the same timeline Latest and Featured use. `grid`
renders the tile catalogue. Readers switch layouts from the page itself, and a
`?layout=` link keeps its layout whatever this is set to.

`?view=grid` was the earlier spelling of that link. It still works — `/archive`
redirects it to `?layout=`, and stored custom archive URLs are read either way.

### Storage

Storage depends on the runtime:

| Runtime            | Default | Supported drivers |
| ------------------ | ------- | ----------------- |
| Cloudflare Workers | `r2`    | `r2`, `s3`        |
| Node and Docker    | `local` | `local`, `s3`     |

Node does not support `r2`, and Cloudflare does not support `local`.

Switch drivers via the `STORAGE_DRIVER` environment variable, e.g. `STORAGE_DRIVER=s3`. When unset, the runtime default is used.

For Node and Docker, `local` is the fastest way to start; `s3` is usually the better long-term production choice.

#### Local storage (fastest start for Node / Docker)

Local storage needs no extra driver configuration.

Use it when:

- You want the simplest possible setup
- Local testing
- A small single-machine install

Defaults:

- `DATA_DIR=./data`
- `LOCAL_STORAGE_PATH=<DATA_DIR>/media`

Override the path when you want media files elsewhere:

```env
LOCAL_STORAGE_PATH=/absolute/path/to/jant-media
```

Set `LOCAL_PUBLIC_URL` only when another web server will serve those files directly.

#### R2 (default)

Cloudflare Workers use R2 by default.

| Variable        | Description                           |
| --------------- | ------------------------------------- |
| `R2_PUBLIC_URL` | Public URL that serves media directly |

R2 itself is configured through the `[[r2_buckets]]` binding in `wrangler.toml`.

Setting `R2_PUBLIC_URL` is strongly recommended. It still works without it, but Jant has to proxy every media request through the Worker.

```toml
[vars]
R2_PUBLIC_URL = "https://media.yourdomain.com"
```

#### S3-compatible storage

Use S3-compatible storage when:

- You want the recommended long-term storage option on Node or Docker
- You want the same storage backend on Cloudflare and Node
- You prefer S3, Backblaze B2, MinIO, DigitalOcean Spaces, or another compatible service
- You need browser direct uploads with presigned URLs

| Variable               | Description                                |
| ---------------------- | ------------------------------------------ |
| `STORAGE_DRIVER`       | Set to `s3`                                |
| `S3_ENDPOINT`          | S3 API endpoint                            |
| `S3_BUCKET`            | Bucket name                                |
| `S3_REGION`            | Bucket region, defaults to `auto`          |
| `S3_PUBLIC_URL`        | Public URL where uploaded files are served |
| `S3_ACCESS_KEY_ID`     | Access key, keep secret                    |
| `S3_SECRET_ACCESS_KEY` | Secret key, keep secret                    |

Example:

```toml
[vars]
STORAGE_DRIVER = "s3"
S3_ENDPOINT = "https://s3.us-east-1.amazonaws.com"
S3_BUCKET = "my-bucket"
S3_REGION = "us-east-1"
S3_PUBLIC_URL = "https://cdn.example.com"
```

Put these credentials in secrets storage. Don't commit them to version control.

### CORS for browser direct uploads

If you use `STORAGE_DRIVER=s3`, the bucket must enable CORS for the actual upload origin.

Recommended CORS policy:

```json
[
  {
    "AllowedOrigins": ["https://your-site.example"],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": [
      "Content-Type",
      "Content-Disposition",
      "Cache-Control",
      "x-amz-checksum-sha256"
    ],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

If you upload from multiple origins, list each origin explicitly.

### Image transformations (optional)

| Variable              | Description                                   |
| --------------------- | --------------------------------------------- |
| `IMAGE_TRANSFORM_URL` | Base URL for the image transformation service |

When using Cloudflare image transformations, point this at the domain that actually serves the images, plus `/cdn-cgi/image`.

Example:

```toml
[vars]
R2_PUBLIC_URL = "https://media.yourdomain.com"
IMAGE_TRANSFORM_URL = "https://media.yourdomain.com/cdn-cgi/image"
```

Or, when images are still proxied through the site domain:

```toml
[vars]
IMAGE_TRANSFORM_URL = "https://yourdomain.com/cdn-cgi/image"
```

### Static asset CDN (optional)

| Variable         | Description                                                    |
| ---------------- | -------------------------------------------------------------- |
| `ASSET_BASE_URL` | Absolute URL serving built JS/CSS assets (e.g. a separate CDN) |

By default Jant serves bundled assets from the same origin as the site under `/_assets/`. Set `ASSET_BASE_URL` only when you want those assets to live on a different domain.

```toml
[vars]
ASSET_BASE_URL = "https://cdn.yourdomain.com"
```

**The CDN must allow cross-origin requests.** Jant ships its client bundle as ES modules (`<script type="module">`), and browsers enforce CORS on cross-origin module scripts — even though they look like ordinary JS. If the CDN doesn't return `Access-Control-Allow-Origin`, the browser drops the response and the site won't boot.

Two ways to configure the asset host — pick whichever fits your setup:

**Option A — allow any origin (simplest):**

```
Access-Control-Allow-Origin: *
```

Bundle files are content-hashed and publicly cacheable, so `*` is safe. The CDN can cache a single response and serve it to every visitor.

**Option B — restrict to your site origin:**

```
Access-Control-Allow-Origin: https://yourdomain.com
Vary: Origin
```

Use this when the same CDN serves several sites and you want each one isolated. `Vary: Origin` is required so the CDN doesn't return the wrong allow-origin header to a different caller. If your CDN doesn't support varying on `Origin`, prefer Option A.

Same-origin deployments (no `ASSET_BASE_URL` set) don't need any CORS configuration.

#### Cloudflare R2 / S3 (JSON CORS rules)

If the CDN is a bucket exposed directly to the public (R2 with a public bucket, or S3 + CloudFront), set the bucket's CORS rules to:

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 86400
  }
]
```

Or, to restrict to your site origin:

```json
[
  {
    "AllowedOrigins": ["https://yourdomain.com"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 86400
  }
]
```

- R2: Dashboard → your bucket → Settings → CORS policy → paste JSON
- S3: AWS Console → bucket → Permissions → Cross-origin resource sharing (CORS), or `aws s3api put-bucket-cors`

#### Caddy / nginx (reverse-proxied CDN)

```caddy
# Caddy
header /_assets/* Access-Control-Allow-Origin "*"
```

```nginx
# nginx
location /_assets/ {
    add_header Access-Control-Allow-Origin "*" always;
}
```

### Slug (optional)

| Variable         | Default | Description                                                 |
| ---------------- | ------- | ----------------------------------------------------------- |
| `SLUG_ID_LENGTH` | `5`     | Length of the random slug auto-generated for untitled posts |

### Upload size limits (optional)

| Variable                  | Default | Description                             |
| ------------------------- | ------- | --------------------------------------- |
| `UPLOAD_MAX_FILE_SIZE_MB` | `1024`  | Maximum size for non-image uploads (MB) |

Images have their own tighter limits. This setting mainly affects video, audio, and PDF uploads.

### Content summaries and RSS limits (optional)

| Variable                 | Default | Description                                    |
| ------------------------ | ------- | ---------------------------------------------- |
| `SUMMARY_MAX_PARAGRAPHS` | `5`     | Maximum paragraphs in auto-generated summaries |
| `SUMMARY_MAX_CHARS`      | `500`   | Maximum characters in auto-generated summaries |
| `RSS_FEED_LIMIT`         | `50`    | Maximum number of posts included in RSS feeds  |

These values can also be changed at runtime in Config Editor. Paragraphs accept
`1–50`, summary characters accept `1–1500`, and RSS feed items accept `1–200`.
The environment variables remain the fallback after a runtime override is
reset.

### Telegram bot (optional)

Lets you publish Notes by messaging a Telegram bot. Connect an account on the
**Settings → Telegram** page, then any text you send the bot is published.

| Variable                  | Default | Description                                                                    |
| ------------------------- | ------- | ------------------------------------------------------------------------------ |
| `TELEGRAM_BOT_TOKENS`     | _none_  | Comma-separated `<bot_id>:<secret>` bot tokens for a platform-managed bot pool |
| `TELEGRAM_WEBHOOK_SECRET` | _none_  | Shared `secret_token` used when registering each pool bot's webhook            |

Leave both unset to run your own bot: the Telegram settings page then shows a
token field, and Jant registers the webhook for you when you save the token.

Set them to run a managed pool (the hosted setup, or a self-hoster who prefers
one fixed bot): the token field is hidden and users connect via a binding code.
The first token is the public-facing bot; extra tokens let one Telegram account
connect to more than one site.

In hosted mode (`HOSTED_CONTROL_PLANE_BASE_URL` set), the Node server
registers the pool's webhooks on startup — pointed at the control-plane host —
so no extra step is needed. The check is idempotent: a restart only re-registers
a bot whose webhook drifted or was newly added.

Otherwise (e.g. a Workers deployment, or to register against a custom URL),
register them manually:

```sh
jant telegram register-webhooks --base-url https://your-site.example
```

## Settings page options

These settings can be changed on Jant's Settings page after setup. Each one can also be seeded from an environment variable of the same name — values changed in Settings take precedence over the environment variable.

| Setting                      | What it does                                     |
| ---------------------------- | ------------------------------------------------ |
| `SITE_NAME`                  | Site display name                                |
| `SITE_DESCRIPTION`           | Meta description and feed description            |
| `SITE_LANGUAGE`              | Primary language code                            |
| `DASHBOARD_LANGUAGE`         | Private dashboard language                       |
| `CJK_SERIF_FONT`             | CJK serif fallback                               |
| `TIME_ZONE`                  | Display time zone, e.g. `UTC` or `Asia/Shanghai` |
| `MAIN_RSS_FEED`              | What `/feed` returns                             |
| `ARCHIVE_DEFAULT_LAYOUT`     | Layout `/archive` opens with                     |
| `PAGE_SIZE`                  | Default items per page (`1–100`)                 |
| `SEARCH_PAGE_SIZE`           | Search results per page (`1–100`)                |
| `ARCHIVE_PAGE_SIZE`          | Archive posts per page (`1–100`)                 |
| `SUMMARY_MAX_PARAGRAPHS`     | Summary paragraph limit (`1–50`)                 |
| `SUMMARY_MAX_CHARS`          | Summary character limit (`1–1500`)               |
| `RSS_FEED_LIMIT`             | Posts included in each RSS feed (`1–200`)        |
| `RSS_PUBLISH_DELAY_SECONDS`  | Feed publication delay in seconds (`0–7200`)     |
| `SITE_FOOTER`                | Custom footer text                               |
| `SHOW_JANT_BRANDING_ON_HOME` | Show or hide Jant branding on the home page      |
| `NOINDEX`                    | Ask search engines not to index the site         |
| `PUBLIC_API_ENABLED`         | Allow JSON reads without a session or API token  |
| `RSS_FEEDS_ENABLED`          | Publish Atom feeds and built-in feed links       |

Multilingual sites carry two more settings, `ADDITIONAL_LANGUAGES` and `MULTILINGUAL_ENABLED`. Both are written by the Language page rather than set by hand, because their values have to stay consistent with the language stamped on your posts — see [Multilingual content](multilingual.md).

Color theme, font theme, custom CSS, avatar, and other appearance details are also managed in Settings.

### Config Editor

Open **Settings → Advanced → Config Editor** or go to `/settings/config` to
search runtime-safe settings in one place. Simple boolean, text, number, and
enum values can be edited there. Content language and time zone use the same
constrained option sources as General settings, so the editor cannot save an
invalid free-form value. Boolean and enum changes save immediately; text and
number changes save on Enter or when leaving the field, while Escape restores
the last saved value. Use **Reset to default** to remove a database override and
restore the environment or built-in fallback. On desktop, the reset action
appears when its row is hovered or focused; it remains visible on touch devices.

Site identity and multi-line values such as `SITE_NAME`, `SITE_DESCRIPTION`,
and `SITE_FOOTER` appear as links to their authoritative controls in General
settings. Config Editor shows only a safe value or configured state, so it does
not duplicate the primary form or force long prose and Markdown into a
single-line field.

Safe settings that need a preview, upload, code editor, or multi-field workflow
also appear in search as a current-value link to their dedicated Settings page
instead of duplicating that specialized UI inside Config Editor. Safe scalar
links such as theme, font theme, theme mode, and header-avatar visibility can
also be reset from Config Editor. Files and custom code stay under their
specialized cleanup flows. GitHub Sync and Telegram expose only safe connection
status entries that open their dedicated integration pages; repository tokens,
bot tokens, webhook secrets, and transient sync state stay hidden.

Config Editor is intentionally allowlisted. Deployment infrastructure,
credentials, integration tokens, generated asset metadata, and transient
internal state never appear there. Linked rows expose only a safe status or
display value, never custom code or storage keys.

## Reserved paths

These top-level paths are reserved and can't be used as a post or custom page slug:

```text
featured, latest, collections, signin, signout, setup, settings, dash,
api, feed, search, archive, media, pages, reset, compose, preview, new, static, assets,
_assets, healthz, readyz
```

## Config files

### wrangler.toml

Put non-sensitive Cloudflare configuration in `wrangler.toml`:

```toml
name = "my-jant-site"
main = "index.js"

[vars]
SITE_ORIGIN = "https://myblog.com"
# SITE_PATH_PREFIX = "/blog"
# R2_PUBLIC_URL = "https://media.myblog.com"
# IMAGE_TRANSFORM_URL = "https://media.myblog.com/cdn-cgi/image"

[[d1_databases]]
binding = "DB"
database_name = "my-jant-site-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

[[r2_buckets]]
binding = "R2"
bucket_name = "my-jant-site-media"
```

### .env (Node and Docker)

For Node and Docker, put these values in `.env`, or have your process manager inject them:

```env
AUTH_SECRET=your-32-plus-character-secret
SITE_ORIGIN=https://your-jant.example
DATABASE_URL=file:./data/jant.sqlite
# SITE_PATH_PREFIX=/blog
# TRUST_PROXY=true
```

Useful templates:

- Repo-root Docker / Node example: [`.env.example`](https://github.com/jant-me/jant/blob/main/.env.example)
- Package-internal Node example: [`packages/core/.env.node.example`](https://github.com/jant-me/jant/blob/main/packages/core/.env.node.example)

### .dev.vars (local development)

Put local Cloudflare secrets in `.dev.vars`:

```env
AUTH_SECRET=your-32-plus-character-secret
DEV_API_TOKEN=local-debug-token
DEMO_EMAIL=debug@jant.test
DEMO_PASSWORD=jant-dev-debug-login
DEMO_MODE=false
```

`DEV_API_TOKEN`, `DEMO_EMAIL`, and `DEMO_PASSWORD` are local debugging helpers — they aren't part of a normal production setup.

### Demo Mode

Set `DEMO_MODE=true` only for a publicly shared demo environment.

Effects:

- Forces `noindex` on
- Disables account deletion, password changes, and some account-management actions
- Setting `DEMO_EMAIL` or `DEMO_PASSWORD` alone does not turn on demo mode

### Production secrets

For Cloudflare production, set secrets through Wrangler or the dashboard:

```bash
openssl rand -base64 32
npx wrangler secret put AUTH_SECRET
```

## What's next

- [Writing and organizing](writing-and-organizing.md) — start using Jant
- [Theming](theming.md) — adjust the appearance
- [Backups and recovery](backups.md) — get ready to run long-term
