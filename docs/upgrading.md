# Upgrading

A site installed with 0.3.39 (March 2026) or later upgrades in place to any later version, and can skip versions: migrations run in order on deploy. They only go forward, so the way back from an upgrade is a backup taken before it. [Compatibility](compatibility.md) lists what each kind of release can change.

## Before you upgrade

1. Back up the database and media. [Backups and recovery](backups.md) has the steps for each deployment.
2. On a 0.x release, work through [Upgrading from 0.x](#upgrading-from-0x).

## Upgrade

### Cloudflare

```bash
npm install @jant/core@latest
```

Commit `package.json` and the lockfile and push to `main`. The deploy workflow, or Cloudflare itself for a one-click deploy, deploys the new version and runs its migrations. Without either, deploy with `npm run deploy`.

Install with `@latest`. `npm update` stays inside the range in `package.json`, such as `^0.11.0`, and never reaches the next major version.

`jant deploy` runs the migrations before it uploads the new Worker, and the old Worker keeps serving in between. When the release notes say a migration replaces a table, don't write to the site until the deploy has finished: writes in that window aren't safe.

### Docker Compose

```bash
docker compose pull
docker compose up -d
```

`up` runs the migrations in `jant-migrate` before it starts the site. If `.env` pins `IMAGE` to a version, change it first.

### Docker without Compose

Pull the image and run the migrations with the same data directory:

```bash
docker pull owenyoung/jant:latest
docker run --rm \
  -e AUTH_SECRET=<auth-secret> \
  -v "$(pwd)/data:/var/lib/jant" \
  owenyoung/jant:latest \
  jant migrate
```

Then stop and remove the old container, and start one from the new image with the command in [Deploy with Docker](deployment-docker.md#running-without-compose). The container doesn't run migrations itself.

### Node

Install the new `@jant/core`, run `jant migrate`, then restart `jant start`.

### Hosted Jant

The service upgrades your site.

## Upgrading from 0.x

Each item says what a site looks like on the current version, so it holds whichever 0.x release you start from. Skip the groups that aren't about you.

### Do these first

- **Back up with a method your old version supports.** Before 0.11, `jant db export --remote` fails on D1, so use D1 Time Travel. On Postgres, use `pg_dump`: no version restores a `site snapshot` taken there before 0.11. On SQLite, copy every `jant.sqlite*` file, not only `jant.sqlite`.
- **Convert old text attachments on 0.7.1.** A site with text attachments added before 0.3.42 (April 2026) that never ran `jant migrate-text-attachments` runs it before going further, since 0.8.0 removed the command. Install `@jant/core@0.7.1` and deploy it, set `INTERNAL_ADMIN_TOKEN` on the site and in your shell, run `npx jant migrate-text-attachments --url https://<your-site>`, then upgrade to the latest version.
- **Check your environment against [Everyone](#everyone).** From 0.11, a value a setting doesn't take stops the site at startup.

### Everyone

| Variable                                                                                                             | On the current version                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_SECRET`                                                                                                        | At least 32 characters, without `replace-me`                                                                                                                |
| Switches, such as `NOINDEX`, `PUBLIC_API_ENABLED`, `RSS_FEEDS_ENABLED`, `TRUST_PROXY`                                | `true` or `false`. `1`, `0`, `yes`, and `on` stop the site                                                                                                  |
| `RATE_LIMIT_DISABLED`                                                                                                | No longer read. Set `RATE_LIMIT_ENABLED=false` instead                                                                                                      |
| `RATE_LIMIT_SEARCH_PER_MIN`                                                                                          | `0` means no limit. It used to mean 30                                                                                                                      |
| `CORS_ORIGINS`                                                                                                       | Empty turns cross-origin access off; unset or `*` allows every origin. A cross-origin write that carries the session cookie needs its origin listed by name |
| `STORAGE_DRIVER`                                                                                                     | `r2`, `s3`, or `local`, in lowercase                                                                                                                        |
| `DISCOVER`                                                                                                           | `latest` or `off`. A site that offered Discover its featured posts is now off; turn Discover on again under Settings → General to stay listed               |
| `SITE_ORIGIN`                                                                                                        | Scheme, host, and port only, such as `https://example.com`. A subpath goes in `SITE_PATH_PREFIX`                                                            |
| `SITE_LANGUAGE`                                                                                                      | A language tag such as `zh-CN`, not `zh_CN`                                                                                                                 |
| `PAGE_SIZE`, `ARCHIVE_PAGE_SIZE`, `RSS_FEED_LIMIT`, `SUMMARY_MAX_CHARS`, `UPLOAD_MAX_FILE_SIZE_MB`, `SLUG_ID_LENGTH` | Within the ranges in [Configuration](configuration.md). `PAGE_SIZE` defaults to 25; set `50` for the old page size                                          |
| `DEV_API_TOKEN`                                                                                                      | Not set in production. It's a local debugging aid                                                                                                           |

Data backfills run with the migrations, in `jant deploy` and in Docker Compose. If your deploy calls `wrangler deploy` or `wrangler d1 migrations apply` itself, run `jant migrate` once (`npx jant migrate --remote` on Cloudflare).

### Cloudflare sites

Make these changes in the same commit as the new `@jant/core`.

- **`.github/workflows/deploy.yml`**: replace the whole file with the current one. Older copies skip every deploy, or deploy without the backfills:

  ```bash
  curl -fsSL -o .github/workflows/deploy.yml https://raw.githubusercontent.com/jant-me/jant-starter/main/.github/workflows/deploy.yml
  ```

  That file installs with npm. For a project made with pnpm or Yarn, create a new project with the same package manager, such as `pnpm create jant jant-new`, and copy its `.github/workflows/deploy.yml`.

- **`wrangler.toml`**: `keep_vars = true` at the top level, before the first `[section]`. Without it, every deploy deletes the variables you set in the Cloudflare dashboard. Check that `R2_PUBLIC_URL` and `IMAGE_TRANSFORM_URL` are still there, and set them again or move them into `[vars]`.
- **`package.json`**: the scripts are `dev`, `deploy`, and `reset-password`, as in a new project. Remove an `export` script; `npx jant db export` replaces it. `tailwindcss` can go too.
- **`AGENTS.md`**: replace it with the current one, and delete `.agents/skills/` and `.claude/skills/`:

  ```bash
  curl -fsSL -o AGENTS.md https://raw.githubusercontent.com/jant-me/jant-starter/main/AGENTS.md
  rm -rf .agents/skills .claude/skills
  ```

### Docker and Node

- **`compose.yml`**: replace it with the current one. A copy from before April 2026 never runs the migrations on `docker compose up`:

  ```bash
  curl -O https://raw.githubusercontent.com/jant-me/jant/main/compose.yml
  ```

- **`TRUST_PROXY=true`** behind a reverse proxy, or every visitor shares one sign-in rate limit. `compose.yml` sets it; with `docker run`, pass it yourself.
- **`.env`**: `jant start` and the `jant` commands read `.env` in the working directory. Rename `.env.node` to `.env`, or set `JANT_ENV_FILE=.env.node`. `jant start` didn't read `.env` before, so check what it holds.
- **Health checks**: `/healthz` and `/readyz`. `/health` is gone.
- **`@jant/core/node`** is gone; start the server with `jant start`.

### API clients

| Before                                                                                       | Now                                                                                                  |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET /api/upload`, and `GET`, `PATCH`, or `DELETE /api/upload/:id`                           | `GET /api/media`, and `GET`, `PUT`, or `DELETE /api/media/:id`                                       |
| `PATCH /api/media/:id`                                                                       | `PUT /api/media/:id`                                                                                 |
| `GET /api/posts/:id/content`                                                                 | `GET /api/posts/:id?content=markdown`, then read `bodyMarkdown`                                      |
| `GET /api/public/posts` (the list)                                                           | `GET /api/public/threads`. `GET /api/public/posts/:slug` stays                                       |
| `GET /api/public/archive`                                                                    | `GET /api/public/threads?visibility=any&sort=published`                                              |
| `/api/upload/multipart`                                                                      | Upload sessions at `/api/uploads`, or one `POST /api/upload`                                         |
| `POST /api/collections/:id/posts` with `postId`, `DELETE /api/collections/:id/posts/:postId` | `POST /api/collections/:id/threads` with `threadId`, `DELETE /api/collections/:id/threads/:threadId` |
| `/api/collections/sidebar-items`                                                             | `/api/collections/directory-items`                                                                   |
| `POST /api/export/zola`                                                                      | `POST /api/export/hugo`                                                                              |
| Appearance settings sent to `PUT /api/settings/import`                                       | `PUT /api/settings`                                                                                  |

- **Sign-in**: `GET /api/search`, `GET /api/collections`, `GET /api/collections/:id`, and `GET /api/nav-items` need a session or an API token. Search results include private posts; readers search on the `/search` page.
- **Paging**: pass `nextCursor` back as it is. A post or media ID as `cursor` answers `400`. `GET /api/custom-urls` pages with `limit` and `cursor`, and answers `{ customUrls, nextCursor }`.
- **Order**: `GET /api/posts` lists by `publishedAt`, newest first. Pinned posts no longer come first.
- **Errors**: `{ error, code }`, plus `details` for a validation error. Branch on `code`.
- **Removed fields**: `siteId`, everywhere. On posts, `previewImageKey`, `previewKind`, `previewProvider`, and `translationGroupId`. On media, `filename` (read `originalName`), `provider`, and `position` (read the order of a post's `attachments`).
- **Uploads**: `POST /api/upload` and `POST /api/uploads/:id/complete` answer `201` with the media object. A `mediaId` already attached to another post answers `409`; upload the file again for the second post.
- **Values**: `pinnedAt` and `featuredAt` take Unix seconds or `null`, and `rating` takes a number. `PUT /api/posts/:id` refuses a field the post's format doesn't take, such as `url` on a note.
- **Smart collections**: `sort` is `sortOrder`, and a single read or write returns the smart collection itself, not `{ smartCollection }`.
- **Custom URLs**: `path` starts with `/`, and `redirectType` is a number.
- **Text attachments** in public posts: the file is at `url`. `contentUrl` is gone.
- **Settings**: `DELETE /api/settings/:key` answers like `GET /api/settings`, and `PUT /api/settings/import` answers `{ settings, rejectedKeys }`.

A request field the API doesn't know is ignored, not refused, so check responses rather than waiting for an error.

### MCP clients

| Before                                                                 | Now                                                                          |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `jant_search_posts` with `query`                                       | `jant_posts_search` with `q`                                                 |
| `jant_media_update_alt`                                                | `jant_media_update`                                                          |
| `jant_posts_get_content`                                               | `jant_posts_get` with `content: "markdown"`, then read `bodyMarkdown`        |
| `jant_collections_add_post`, `jant_collections_remove_post` (`postId`) | `jant_collections_add_thread`, `jant_collections_remove_thread` (`threadId`) |

A failed call's `structuredContent` is `{ error, code, details }`. Cursors, `mediaId`, and the number fields follow the API rules above.

### Custom CSS

| Before                                          | Now                                                 |
| ----------------------------------------------- | --------------------------------------------------- |
| `--site-elevated-bg`                            | `--site-page-bg`                                    |
| `--site-nav-hover-bg`                           | `--site-subtle-bg`                                  |
| `--search-mark-bg`, `--search-mark-color`       | `--site-search-mark-bg`, `--site-search-mark-color` |
| `--site-accent` for links                       | `--site-content-link`                               |
| `--foreground` for post text                    | `--site-reading-body`                               |
| `--site-width`, `--content-max-width`           | `--layout-body-max-width`                           |
| `--site-padding`, `--content-gap` between posts | `--site-feed-rhythm`                                |

`--card-radius`, `--card-padding`, `--card-border-width`, `--card-shadow`, `--site-accent-text`, `--fw-light`, and `--fw-extrabold` are gone; a `var()` that reads one gets its fallback.

- **Dark mode**: write overrides for `:root[data-theme-mode="dark"]`, or for `:root:not([data-theme-mode="light"])` inside `@media (prefers-color-scheme: dark)`. A plain `:root` rule in custom CSS wins over the theme, so `:root:root` isn't needed.
- **`data-page`** is on `<body>`. A selector that joined it with another attribute needs a space: `[data-page="post"] article[data-post]`.
- **Quotes**: the quoted text is `[data-post-quote]`. Nested `[data-post-media] [data-post-media]` is now `[data-post-media]`.

[Theming](theming.md) lists every variable and attribute.

### Exports and Hugo templates

- On Collection pages, `.Params.summary_text` is `.Params.description`.
- Media entries carry `src` and `poster`. `provider`, `storage_key`, and `poster_key` are gone.
- A copy of `featured-thread.html` in your own `layouts/` needs the theme's current version: gaps link to the first hidden post.
- An export from 0.11 or later doesn't import into 0.10 or earlier. Upgrade the receiving site first.
- `jant site import` reads `jant-site-export.zip` by default. To import a directory, pass `--path <dir>`.
- An export from before 0.7.0 may not import. Export again after upgrading.

### Addresses

- A post or Collection with several custom URLs lives at the oldest one. To move it to a newer one, delete the older.
- A custom URL whose first segment starts with `_` or `.` answers `404`. Give the post a new custom URL and delete the old one.
- A redirect to another site gets its `//` back after the upgrade, but stays in lowercase. Edit any whose letter case matters.

### Command line

| Before                                             | Now                                                   |
| -------------------------------------------------- | ----------------------------------------------------- |
| `jant export`                                      | `jant db export`                                      |
| `jant import-site`                                 | `jant site import`                                    |
| `jant search-reindex`                              | `jant search reindex`                                 |
| `jant site localize-media`                         | `jant site pull-media`                                |
| `jant site export <url>`, `jant site import <url>` | `--url <url>`                                         |
| `jant site export --directory <dir>`               | `--output <dir>`                                      |
| `jant telegram register-webhooks --base-url`       | `--url`                                               |
| `jant deploy --site-path-prefix`                   | `--path-prefix`                                       |
| `jant --remote migrate`                            | `jant migrate --remote`: options go after the command |
| `jant uploads cleanup` for one batch               | `jant uploads cleanup --once`                         |

[Command line](cli.md) lists every command and option.

## Release notes

Every release's notes are on [GitHub](https://github.com/jant-me/jant/releases): the `@jant/core@<version>` release has the full list, and the `v<version>` release only links to it. A change that asks you to do something carries **Upgrade notes**. From 1.0, a change to anything [Compatibility](compatibility.md) promises comes only in a major release, and this page collects its upgrade notes before the release ships.
