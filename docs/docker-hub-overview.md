# Jant

Jant is a self-hosted, single-author microblog for notes, links, and quotes, without followers, likes, or algorithmic feeds.

The official Docker image is `owenyoung/jant`. It runs the Node runtime. The Compose file applies schema migrations and data backfills before it starts the app; the image on its own refuses to start on a database that hasn't been migrated.

## Quick Start with Docker Compose

Download the official Compose files:

```bash
curl -O https://raw.githubusercontent.com/jant-me/jant/main/compose.yml
curl -o .env https://raw.githubusercontent.com/jant-me/jant/main/.env.example
mkdir -p data/media
```

The container runs as the user with ID 1000. On Linux, give it the data directory first: `sudo chown -R 1000:1000 data`.

Set `AUTH_SECRET` in `.env`, then start Jant:

```bash
docker compose up -d
```

Open `http://127.0.0.1:3000`.

## Run the Official Image Directly

Use `docker run` when you want a single container without Compose. Apply migrations first, and again after every image update:

```bash
docker run --rm \
  -e AUTH_SECRET=<auth-secret> \
  -v "$(pwd)/data:/var/lib/jant" \
  owenyoung/jant:latest \
  node bin/jant.js migrate

docker run -d \
  --name jant \
  -p 3000:3000 \
  -e AUTH_SECRET=<auth-secret> \
  -e TRUST_PROXY=false \
  -v "$(pwd)/data:/var/lib/jant" \
  owenyoung/jant:latest
```

Set `TRUST_PROXY=true` when the container sits behind Caddy, Nginx, Traefik, or another reverse proxy you control.

## Pin a Version

Use an exact image tag when you want a repeatable deploy:

```bash
IMAGE=owenyoung/jant:<version> docker compose up -d
```

## Required Configuration

- `AUTH_SECRET` is required
- `SITE_ORIGIN` is optional and sets canonical URLs, RSS links, and sitemap URLs
- `SITE_PATH_PREFIX` is optional when you mount Jant under a subpath such as `/blog`

Generate a secret with:

```bash
openssl rand -base64 32
```

## Data Storage

The official image stores app data under `/var/lib/jant` inside the container.

With the default Compose file, that maps to `./data` on the host and includes:

- `./data/jant.sqlite`
- `./data/media/`

## Documentation

- Full Docker deployment guide: https://jant.me/docs/deployment-docker
- Configuration reference: https://jant.me/docs/configuration
- Backups and recovery: https://jant.me/docs/backups
- Export and import: https://jant.me/docs/export-and-import
- Source repository: https://github.com/jant-me/jant
