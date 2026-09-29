# Compatibility

Jant makes three levels of promise. Some things keep working in every release, major ones included. Some change only in a major release, whose upgrade notes say what to do. The rest can change in any release. Version numbers follow [semantic versioning](https://semver.org/) from 1.0. Until then, a minor release can still change what the second level covers, and its release notes say how.

## Kept in every release

| Surface               | What's kept                                                                                   | Reference                                           |
| --------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Upgrades              | A site installed with 0.3.39 (March 2026) or later upgrades in place to any later version     | [Upgrading](#upgrading)                             |
| Exports and snapshots | A site export or snapshot from 0.7.0 or later imports into that release or any later one      | [Export and import](export-and-import.md)           |
| Addresses             | Post and Collection URLs, custom URLs and their redirects, and the archive's query parameters | [Writing and organizing](writing-and-organizing.md) |
| Feeds                 | Every feed address, and each entry's `<id>` and `<jant:id>`                                   | [Feeds](feeds.md)                                   |

Older spellings of an address keep working too: links and feed subscriptions such as `?hasMedia=1`, `?visibility=latest_hidden`, or `/feed/latest`. New links use the current spelling.

An entry's `<id>` is the post's address, so it changes when the address does; [Feeds](feeds.md) lists what moves it. `<jant:id>` never changes.

No release adds a top-level path that takes an address your content already has. A first path segment that starts with `_` or `.` belongs to Jant, since every address of yours starts with a letter or digit, so new system addresses go there: `/_assets` and `/__sso` already do, and `/.well-known/` is kept for standard ones. A new top-level path anywhere else comes in only where your content at that address keeps it.

## Changed only in a major release

| Surface        | What's covered                                                                                                                                                         | Reference                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| HTTP API       | Endpoints, request and response fields, and behavior, except `/api/internal/*`                                                                                         | [API Reference](API.md)                     |
| MCP            | Tool names and parameters at `/api/mcp`, and the protocol versions it accepts: a minor release can add one, only a major release drops one                             | [Automation and API](automation-and-api.md) |
| Feed contents  | The Atom elements and the `https://jant.me/ns` extension, as documented                                                                                                | [Reading a Jant feed](feed-reading.md)      |
| Command line   | The commands `jant --help` lists, and their options                                                                                                                    | [Command line](cli.md)                      |
| Configuration  | Environment variables and settings, the values they take, theme IDs included, the reserved paths, and what `DATA_DIR` holds: `jant.sqlite` and `media/`                | [Configuration](configuration.md)           |
| Export format  | The site export's front-matter fields, except those marked theme only, and `data/jant.toml`                                                                            | [Export and import](export-and-import.md)   |
| Docker         | The `owenyoung/jant` image name, the `/var/lib/jant` data directory and its `jant.sqlite` and `media/`, and the `jant-migrate` service                                 | [Deploy with Docker](deployment-docker.md)  |
| JavaScript     | `createApp` from `@jant/core`, which takes no arguments and returns an object whose `fetch` serves the site                                                            | —                                           |
| Project layout | The paths a `create-jant` project's `wrangler.toml` reads inside `@jant/core`, `dist/client` and `src/db/migrations`, and the binding names it declares, `DB` and `R2` | [Deploy on Cloudflare](deployment.md)       |

A major release that changes one of these says what to change in its upgrade notes. It may deprecate the old form in a minor release first, but it doesn't have to.

Additions come in minor releases: new endpoints, fields, options, feed elements, and settings, and new values for a field that takes one of a fixed set, such as a post's `format` or an error's `code`. A client should ignore a field or element it doesn't recognize, read a `format` it doesn't recognize as `note`, and handle an error `code` it doesn't recognize by the HTTP status.

Requests get the same tolerance: the HTTP API and MCP ignore a request field or parameter they don't recognize, so a client written for a later release still works against an earlier one wherever it doesn't depend on the new field. The one exception is a smart collection's `selection`, where an unknown condition answers `400`, since ignoring it would publish a wider page than asked for.

## Not promised

These can change in any release. Jant keeps them stable where it can, and a release that changes one says so in its release notes:

- The CSS variables, data attributes, and classes on the [Theming](theming.md) page.
- What an MCP tool returns. Its name and parameters are covered above.
- What's inside a post's `body`, which is the editor's own document format, and the HTML in `bodyHtml`. `bodyMarkdown` is the form to read and write.
- An error's `details`, apart from the settings endpoint's `rejectedKeys`, and the wording of its `error` message. That an error has `error` and `code`, and what each code means, are covered.
- The TypeScript types `@jant/core` publishes, `createApp`'s included.
- The exported site's Hugo templates and partials.

These can change in any release without notice:

- `/api/internal/*`, which connects core to the hosted service. Both are released together.
- Endpoints, fields, and parameters that the reference pages don't document, even where a response carries them. `/api/palette`, which feeds the dashboard's command palette, is one.
- `SITE_RESOLUTION_MODE` and the `HOSTED_CONTROL_PLANE_*` variables, which configure the hosted service, and the command-line options `--site`, `--host`, and `--path-prefix` where they pick one site from a database that holds several.
- `DEV_API_TOKEN` and the `DEMO_*` variables, which serve local debugging and the public demo.
- Commands that `jant --help` leaves out: build and operations tooling.
- Running `search reindex`, `uploads cleanup`, or `posts rebuild-html` against a server on another Jant version. They call `/api/internal/*`, so run them from the version the server runs.
- Everything in `@jant/core` besides `createApp`, including `@jant/core/i18n` and the modules under `src/`.
- CSS custom properties and classes that the theming page doesn't list, and the HTML structure around the documented hooks.
- Front-matter fields that [Export and import](export-and-import.md) marks theme only.
- The database schema. Migrations change tables and columns in any release; read and change data through the API, the command line, or an export.
- Interface text and translations.
- Default values. A minor release can change a default, such as `PAGE_SIZE`, and its release notes say so and name the setting that restores the old behavior. The exceptions are `PUBLIC_API_ENABLED`, `MAIN_RSS_FEED`, `RSS_FEEDS_ENABLED`, and `CORS_ORIGINS`: their defaults decide what a kept address answers, so they change only in a major release.

## Upgrading

- A site installed with 0.3.39 (March 2026) or later upgrades in place to any later version, skipping versions: migrations run in order on deploy. An installation older than that predates the current database baseline. Don't upgrade it in place, since the migration that set up the baseline drops existing data; export its content and import it into a new site.
- Migrations only go forward. To go back to an earlier version, restore a backup taken before the upgrade; see [Backups and recovery](backups.md).
- A site export in a newer format than the importing Jant reads, or a snapshot from a newer Jant, stops before anything is written and asks you to upgrade `@jant/core`. The format version rises whenever `site import` starts reading something new, so an older Jant never imports a newer export while dropping what it doesn't know.
- A snapshot restores into the kind of database it came from: SQLite, D1 included, or Postgres. To move between them, use a site export.
- Fixes go into the latest release only.
- Hosted sites are upgraded by the service.
