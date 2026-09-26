# Compatibility

From 1.0, Jant follows [semantic versioning](https://semver.org/). A patch release fixes bugs, a minor release adds things, and only a major release changes or removes what this page lists. Until 1.0, a minor release can still change these, and its release notes say how.

## What the promise covers

| Surface             | What's covered                                                                                                       | Reference                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| HTTP API            | Endpoints, request and response fields, and behavior, except `/api/internal/*`                                       | [API Reference](API.md)                                                      |
| MCP                 | Tool names and parameters at `/api/mcp`                                                                              | [Automation and API](automation-and-api.md)                                  |
| Feeds               | Feed addresses, the Atom output, and every name in the `https://jant.me/ns` namespace                                | [Feeds](feeds.md), [Reading a Jant feed](feed-reading.md)                    |
| Addresses           | Post and Collection URLs, custom URLs and redirects, the archive's query parameters                                  | [Writing and organizing](writing-and-organizing.md), [API Reference](API.md) |
| Command line        | The commands `jant --help` lists, and their options                                                                  | [Command line](cli.md)                                                       |
| Configuration       | Environment variables and settings, and the reserved paths                                                           | [Configuration](configuration.md)                                            |
| Theme hooks         | The CSS variables, data attributes, and classes on the theming page                                                  | [Theming](theming.md)                                                        |
| Export and snapshot | The site export's front-matter fields and `data/jant.toml`, and the snapshot archive                                 | [Export and import](export-and-import.md)                                    |
| JavaScript          | `createApp` from `@jant/core`                                                                                        | —                                                                            |
| Project layout      | The paths a `create-jant` project's `wrangler.toml` reads inside `@jant/core`: `dist/client` and `src/db/migrations` | [Deploy on Cloudflare](deployment.md)                                        |
| Docker              | The `owenyoung/jant` image, the `/var/lib/jant` data directory, and the `jant-migrate` service                       | [Deploy with Docker](deployment-docker.md)                                   |

## What it doesn't cover

These can change in any release:

- `/api/internal/*`, which connects core to the hosted service. Both are released together.
- Commands that `jant --help` leaves out: build and operations tooling.
- Everything in `@jant/core` besides `createApp`, including `@jant/core/i18n` and the modules under `src/`.
- CSS custom properties and classes that the theming page doesn't list, and the HTML structure around the documented hooks.
- The exported site's Hugo templates and partials, and front-matter fields that [Export and import](export-and-import.md) doesn't list.
- The database schema. Migrations change tables and columns in any release; read and change data through the API, the command line, or an export.
- Interface text and translations.
- Default values. A minor release can change a default, such as `PAGE_SIZE`, and its release notes say so and name the setting that restores the old behavior.

## Changes and removals

- Additions come in minor releases: new endpoints, fields, options, feed elements, and CSS variables. A client should ignore a field or element it doesn't recognize.
- Before a major release removes something covered, a minor release deprecates it: the release notes and the docs name the replacement, and it keeps working until the major release.
- Old spellings in addresses people keep never stop working: links and feed subscriptions such as `?hasMedia=1`, `?visibility=latest_hidden`, or `/feed/latest`. They aren't deprecated, and new links use the current spelling.
- A new top-level path that could take an address your content already has, the way `/subscribe` did, comes only in a major release. A minor release adds a top-level path only when your content at that address keeps it.

## Upgrading

- A site installed with 0.3.39 (March 2026) or later upgrades in place to any later version, skipping versions: migrations run in order on deploy. An installation older than that predates the current database baseline. Don't upgrade it in place, since the migration that set up the baseline drops existing data; export its content and import it into a new site.
- Migrations only go forward. To go back to an earlier version, restore a backup taken before the upgrade; see [Backups and recovery](backups.md).
- A snapshot or site export from any 1.x release imports into that release or a later 1.x. One written by a newer Jant than the one importing it stops before anything is written and asks you to upgrade `@jant/core`.
- Fixes go into the latest 1.x release only.
- Hosted sites are upgraded by the service.
