# Command line

The `jant` command ships with `@jant/core`. In a Jant project directory, run it with `npx jant <command>`; in the Docker image, `jant` is on the path. `jant --help` lists the commands, and `jant <command> --help` lists a command's options.

The commands and options on this page change only in a major release. `jant` also runs a few build and operations commands that `--help` leaves out; those are internal and can change in any release.

## How a command reaches the site

A command works in one of two ways.

**Through the database.** `migrate`, `reset-password`, `db export`, and the `site snapshot` commands read or write the database directly. They choose the database this way:

| Option         | Use                                                            |
| -------------- | -------------------------------------------------------------- |
| `--local`      | Local D1, the database `npm run dev` uses                      |
| `--remote`     | The D1 database in `wrangler.toml`                             |
| `--node`       | The Node runtime's database, from `DATABASE_URL` or `DATA_DIR` |
| `--config`     | Wrangler config file (default: `wrangler.toml`)                |
| `--env`        | Wrangler environment name                                      |
| `--database`   | D1 binding name (default: `DB`)                                |
| `--persist-to` | Local D1 state directory                                       |

With no runtime flag, a command uses the Node runtime when `DATABASE_URL` or `DATA_DIR` is set, and local D1 otherwise. `.env.node` in the project directory is read first.

A database that holds several sites (the hosted setup) needs the site named: `--site` takes a site key or ID, `--host` a host (with `--path-prefix` for a site under a subpath), and `--url` the site's URL.

**Over HTTP.** `site export`, `site import`, and the maintenance commands call the site's API, so they run from any machine that can reach it. `--url` names the site. `site export` and `site import` take an API token from **Settings → API Tokens**, in `JANT_API_TOKEN` or `--token`. The maintenance commands take the server's `INTERNAL_ADMIN_TOKEN`, in that variable or `--token`, and fall back to `SITE_ORIGIN` and `SITE_PATH_PREFIX` from the environment or `wrangler.toml` when `--url` is left out.

## Set up and run

### `jant setup`

Creates the owner account and the site without a browser, the same as the two `/setup` screens. It reads the password from standard input. An install that has finished setup is left unchanged, so running it on every start is safe. Node runtime in single-site mode only.

```bash
printf '%s' "$OWNER_PASSWORD" | npx jant setup --email owner@example.com --password-stdin
```

| Option             | Use                                                             |
| ------------------ | --------------------------------------------------------------- |
| `--email`          | The owner's sign-in address (required)                          |
| `--password-stdin` | Read the owner's password from standard input (required)        |
| `--site-name`      | The site's name                                                 |
| `--language`       | Language the site publishes in, as a BCP 47 tag (default: `en`) |
| `--time-zone`      | The site's IANA time zone (default: `UTC`)                      |
| `--site-id`        | Create the site with this ID instead of a random one            |
| `--node`           | Use the Node runtime even if `DATABASE_URL` is unset            |

### `jant start`

Starts the Node.js server. It takes no options; everything comes from the environment, described in [Configuration](configuration.md).

### `jant migrate`

Applies database migrations and data backfills. `jant deploy` and the Docker Compose setup run it for you.

| Option                                                                             | Use                                                          |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `--local`, `--remote`, `--node`, `--config`, `--env`, `--database`, `--persist-to` | Which database, see [above](#how-a-command-reaches-the-site) |

### `jant deploy`

Applies remote migrations, then deploys to Cloudflare Workers with the right static asset directory. Arguments after `--` go to `wrangler deploy`.

| Option           | Use                                                                   |
| ---------------- | --------------------------------------------------------------------- |
| `--config`, `-c` | Wrangler config file (default: `wrangler.toml`)                       |
| `--env`, `-e`    | Wrangler environment name                                             |
| `--output`, `-o` | Publish directory for a site under a subpath (default: `dist/public`) |
| `--path-prefix`  | Use this subpath instead of `SITE_PATH_PREFIX` from the config        |
| `--database`     | D1 binding name for migrations (default: `DB`)                        |
| `--skip-migrate` | Deploy without running migrations                                     |

### `jant reset-password`

Prints a password reset token that expires in 15 minutes.

| Option                                                                             | Use                                                          |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `--local`, `--remote`, `--node`, `--config`, `--env`, `--database`, `--persist-to` | Which database, see [above](#how-a-command-reaches-the-site) |
| `--site`, `--host`, `--path-prefix`, `--url`                                       | Which site, when the database holds several                  |

## Move and back up content

[Export and import](export-and-import.md) explains when to use each of these.

### `jant site export`

Exports a site as a Hugo site, to a ZIP archive or a directory.

```bash
npx jant site export --url https://your-site.example --output ./jant-site-export.zip
```

| Option            | Use                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------- |
| `--url`           | The site's URL (required)                                                             |
| `--output`, `-o`  | A `.zip` path, or an empty directory to export into (default: `jant-site-export.zip`) |
| `--pull-media`    | Download the media the export refers to into `static/media/` (default: on)            |
| `--no-pull-media` | Keep the original media URLs                                                          |
| `--token`         | API token, instead of `JANT_API_TOKEN`                                                |

### `jant site import`

Imports a Hugo site export, a directory or a ZIP, into a site. The target site has to be empty.

```bash
npx jant site import --url https://your-site.example --path ./jant-site-export.zip --dry-run
```

| Option                | Use                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------- |
| `--url`               | The site's URL (required)                                                             |
| `--path`              | The export directory or ZIP (default: the current directory)                          |
| `--dry-run`           | Read and check the export without calling the site                                    |
| `--skip-remote-media` | Leave absolute image URLs in post bodies as they are, instead of uploading the images |
| `--token`             | API token, instead of `JANT_API_TOKEN`                                                |

### `jant site pull-media`

Downloads the media an existing export refers to, and rewrites the export to use the local copies.

| Option     | Use                                                                             |
| ---------- | ------------------------------------------------------------------------------- |
| `--path`   | The export ZIP or directory (default: `jant-site-export.zip`)                   |
| `--output` | Where to write the result when `--path` is a ZIP (default: overwrite the input) |

### `jant site snapshot export`

Exports a snapshot: the database content with its IDs and storage keys, and the files they point to. It restores a site; it doesn't migrate content between setups.

| Option                                                                             | Use                                                                                      |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `--output`, `-o`                                                                   | A directory or a `.zip` path (default: `jant-site-snapshot`)                             |
| `--force`                                                                          | Overwrite an existing output path                                                        |
| `--skip-objects`                                                                   | Leave the files out, for a target that already has the same storage keys                 |
| `--bucket`, `--bucket-binding`                                                     | The R2 bucket to read files from, by name or by Wrangler binding (default binding: `R2`) |
| `--local`, `--remote`, `--node`, `--config`, `--env`, `--database`, `--persist-to` | Which database, see [above](#how-a-command-reaches-the-site)                             |
| `--site`, `--host`, `--path-prefix`, `--url`                                       | Which site, when the database holds several                                              |

### `jant site snapshot import`

Restores a snapshot into a site, replacing its posts, collections, navigation, media, and custom URLs. Accounts and API tokens stay.

```bash
npx jant site snapshot import --path ./jant-site-snapshot.zip --replace
```

| Option                                                                             | Use                                                                                     |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `--path`                                                                           | The snapshot directory or ZIP (default: the current directory)                          |
| `--replace`                                                                        | Replace the site's content (required)                                                   |
| `--remap-site`                                                                     | Rewrite the snapshot's site ID and storage keys to the target site                      |
| `--allow-missing-objects`                                                          | Import even when files the database refers to are missing from the snapshot             |
| `--bucket`, `--bucket-binding`                                                     | The R2 bucket to write files to, by name or by Wrangler binding (default binding: `R2`) |
| `--local`, `--remote`, `--node`, `--config`, `--env`, `--database`, `--persist-to` | Which database, see [above](#how-a-command-reaches-the-site)                            |
| `--site`, `--host`, `--path-prefix`, `--url`                                       | Which site, when the database holds several                                             |

### `jant db export`

Writes the whole database to a SQL file.

| Option                                                                             | Use                                                          |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `--output`, `-o`                                                                   | The SQL file (default: `jant-export.sql`)                    |
| `--local`, `--remote`, `--node`, `--config`, `--env`, `--database`, `--persist-to` | Which database, see [above](#how-a-command-reaches-the-site) |

## Maintenance

These commands call the site with `INTERNAL_ADMIN_TOKEN`. Each works in batches and can be run again safely.

### `jant search reindex`

Rebuilds the search index from the stored post bodies.

| Option              | Use                                                     |
| ------------------- | ------------------------------------------------------- |
| `--url`             | The site's URL                                          |
| `--limit`           | Posts per batch (default: 50, at most 500)              |
| `--once`            | Run one batch and stop                                  |
| `--token`           | Internal admin token, instead of `INTERNAL_ADMIN_TOKEN` |
| `--config`, `--env` | The Wrangler config to read `SITE_ORIGIN` from          |

### `jant posts rebuild-html`

Rebuilds the stored HTML of every post at the current HTML format. Pages render stale posts correctly without it; the rebuild saves the work on every read.

| Option              | Use                                                     |
| ------------------- | ------------------------------------------------------- |
| `--url`             | The site's URL                                          |
| `--site`            | The site's ID, for a server that hosts several sites    |
| `--limit`           | Posts per batch (default: 50, at most 100)              |
| `--dry-run`         | Report what would change without writing                |
| `--once`            | Run one batch and stop                                  |
| `--token`           | Internal admin token, instead of `INTERNAL_ADMIN_TOKEN` |
| `--config`, `--env` | The Wrangler config to read `SITE_ORIGIN` from          |

### `jant uploads cleanup`

Clears upload sessions that expired, and purges deleted media whose [recycle window](backups.md#deleted-media-recycle-window) has passed.

| Option              | Use                                                     |
| ------------------- | ------------------------------------------------------- |
| `--url`             | The site's URL                                          |
| `--limit`           | Sessions per batch (default: 20, at most 500)           |
| `--token`           | Internal admin token, instead of `INTERNAL_ADMIN_TOKEN` |
| `--config`, `--env` | The Wrangler config to read `SITE_ORIGIN` from          |

### `jant telegram register-webhooks`

Registers a webhook for every bot in `TELEGRAM_BOT_TOKENS`. See [Telegram](configuration.md#telegram-bot-optional) for when you need it.

| Option  | Use                                                                                        |
| ------- | ------------------------------------------------------------------------------------------ |
| `--url` | The site's public URL (default: `SITE_ORIGIN` and `SITE_PATH_PREFIX` from the environment) |
