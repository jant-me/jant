# Deploy with Docker

The official image [`owenyoung/jant`](https://hub.docker.com/r/owenyoung/jant) runs the Node version of Jant and applies database migrations automatically before the app starts.

## Before you begin

You need:

- [Docker](https://docs.docker.com/engine/install/) and [Docker Compose](https://docs.docker.com/compose/install/)
- A long, random `AUTH_SECRET`. Generate one with `openssl rand -base64 32`.

## Quick start with Docker Compose

Create a directory for your site's config and data, then download the official Compose file:

```bash
mkdir jant-site && cd jant-site
curl -O https://raw.githubusercontent.com/jant-me/jant/main/compose.yml
curl -o .env https://raw.githubusercontent.com/jant-me/jant/main/.env.example
```

Edit `.env` and set `AUTH_SECRET` to the secret you generated:

```env
AUTH_SECRET=<auth-secret>
```

Start the stack:

```bash
docker compose up -d
```

Open `http://127.0.0.1:3000`. The first visit walks you through creating the admin account. If the port is taken, set `HOST_PORT=8080` (or another value) in `.env`.

## What the default Compose includes

`compose.yml` starts two services that share the same `./data:/var/lib/jant` volume:

- **`jant-migrate`** — runs `jant migrate` once on every `docker compose up`. If migrations fail, `jant` doesn't start.
- **`jant`** — the long-running app container, listening on port `3000`.

After it's running, the host's `./data/` will contain:

- `jant.sqlite` — the SQLite database
- `media/` — uploaded media files

The image and Compose file ship with a few defaults. Normally you don't need to change them:

| Variable      | Default         | Source  | Purpose                               |
| ------------- | --------------- | ------- | ------------------------------------- |
| `HOST`        | `0.0.0.0`       | image   | In-container listen address           |
| `PORT`        | `3000`          | image   | In-container listen port              |
| `HOST_PORT`   | `3000`          | Compose | Port mapped to the host               |
| `DATA_DIR`    | `/var/lib/jant` | image   | Root for the database and local media |
| `TRUST_PROXY` | `true`          | Compose | Trust `X-Forwarded-*` headers         |
| `TZ`          | `UTC`           | Compose | Container time zone                   |

To override any of them, set the value in `.env`.

## Database

Jant chooses the database driver from the `DATABASE_URL` scheme:

- `file:` — SQLite (default)
- `postgres:` or `postgresql:` — Postgres

### SQLite (default)

The image already sets `DATA_DIR=/var/lib/jant`. If `DATABASE_URL` is empty, Jant derives the SQLite path from `DATA_DIR`. That's equivalent to:

```env
DATA_DIR=/var/lib/jant
DATABASE_URL=file:/var/lib/jant/jant.sqlite
```

Because these defaults are already wired together, the default Compose setup doesn't need any database variables in `.env` — `/var/lib/jant` inside the container maps to `./data/` on the host through the volume, so the file ends up at `./data/jant.sqlite`.

Set the variable explicitly only when you want a different path:

```env
DATABASE_URL=file:/var/lib/jant/custom.sqlite
```

### Switching to Postgres

Override with a `postgres:` URL:

```env
DATABASE_URL=postgres://<user>:<password>@<host>:5432/<db>
```

After switching, the SQLite file is no longer read or written, but the local media directory (`./data/media/`) still belongs to the local storage driver unless you also switch to S3.

## Media storage

The default is local storage, with files under `./data/media/`. Good enough and quick to start. The downside: media is tied to the app host, so migrating or rebuilding the container means dragging those files along.

For longer-running setups, S3-compatible storage (AWS S3, Backblaze B2, MinIO, DigitalOcean Spaces, etc.) is the better choice:

```env
STORAGE_DRIVER=s3
S3_ENDPOINT=https://s3.us-east-1.amazonaws.com
S3_BUCKET=my-bucket
S3_REGION=us-east-1
S3_PUBLIC_URL=https://cdn.example.com
S3_ACCESS_KEY_ID=<access-key-id>
S3_SECRET_ACCESS_KEY=<secret-access-key>
```

For each field's meaning and CORS setup, see [Configuration § Storage](configuration.md#storage).

## Reverse proxy and public URL

Putting Jant behind a reverse proxy like Caddy, Nginx, or Traefik is common. Compose already sets `TRUST_PROXY=true`, so forwarded headers are honored — under the standard setup you don't need to touch any variable.

Two cases need explicit settings:

- **The reverse proxy doesn't forward `X-Forwarded-Host` / `X-Forwarded-Proto` correctly**: absolute URLs in RSS, sitemap, exports, and auth callbacks will use the wrong host. Pin it with `SITE_ORIGIN=https://<your-domain>` in `.env`.
- **Mounted under a subpath** (e.g. `example.com/blog`): set `SITE_PATH_PREFIX=/blog`. `SITE_ORIGIN` is a separate variable that only accepts an origin (scheme + host + port); the path part is ignored — decide whether you also need it based on the previous bullet.

For the full list of variables, see [Configuration](configuration.md).

## Running without Compose

To start a single container, run migrations manually first, then start the app:

```bash
# Run migrations first
docker run --rm \
  -e AUTH_SECRET=<auth-secret> \
  -v "$(pwd)/data:/var/lib/jant" \
  owenyoung/jant:latest \
  node bin/jant.js migrate

# Then start the app
docker run -d \
  --name jant \
  -p 3000:3000 \
  -e AUTH_SECRET=<auth-secret> \
  -e TRUST_PROXY=false \
  -v "$(pwd)/data:/var/lib/jant" \
  owenyoung/jant:latest
```

If the container sits behind your own reverse proxy, set `TRUST_PROXY=true`.

## Creating the admin account from the command line

To set up without the browser, such as from a deploy script, run `jant setup` after migrations. It creates the admin account and the site, and finishes onboarding. The password is read from standard input:

```bash
printf '%s' "$OWNER_PASSWORD" | docker run --rm -i \
  -v "$(pwd)/data:/var/lib/jant" \
  owenyoung/jant:latest \
  node bin/jant.js setup --email you@example.com --password-stdin --site-name "My Blog"
```

`--language` defaults to `en` and `--time-zone` to `UTC`; `node bin/jant.js setup --help` lists every option. A site that is already set up is left unchanged, so running the command on every start never puts back a password changed since.

## Updating the site

Pull the latest image and restart:

```bash
docker compose pull
docker compose up -d
```

Every `up` runs `jant-migrate` first and only starts `jant` after migrations succeed. New migrations bundled in the image apply automatically. If migrations fail, `jant` won't start, so the database never sits in a schema-mismatched state.

For repeatable deploys, pin the image tag:

```env
IMAGE=owenyoung/jant:<version>
```

## Common commands

```bash
docker compose logs -f       # follow logs
docker compose ps            # show service status
docker compose down          # stop the whole stack
```

## Backups

Under the default Docker setup, a complete backup must include at least:

- `./data/jant.sqlite` — the database
- `./data/media/` — uploaded media

For details, see [Backups and recovery](backups.md).

## What's next

- [Configuration](configuration.md) — every environment variable and site behavior
- [Writing and organizing](writing-and-organizing.md) — start writing once the site is up
- [Backups and recovery](backups.md) — recovery planning for long-running setups
