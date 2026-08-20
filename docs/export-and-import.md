# Export and import

Run every command in this guide from a Jant project directory where `@jant/core` is installed. Sites created with `create-jant` usually use the project root.

## Choosing the right tool

| Need                                                 | Use                                               |
| ---------------------------------------------------- | ------------------------------------------------- |
| Move content between Jant sites                      | `site export` and `site import`                   |
| Generate a portable static archive                   | `site export`                                     |
| Restore the same internal IDs and storage keys as-is | `site snapshot export` and `site snapshot import` |
| Export raw database SQL                              | `db export`                                       |
| Import content from a non-Jant blog or CMS           | An AI assistant (see below)                       |

The difference between `site export` and `site snapshot` is not what they're for — it's what they produce:

| Aspect                        | `site export`                                         | `site snapshot`                                 |
| ----------------------------- | ----------------------------------------------------- | ----------------------------------------------- |
| Output format                 | Hugo site directory (Markdown + front matter + media) | SQL dump + object storage dump (binary archive) |
| Human-readable                | Yes — edit Markdown in any editor                     | No — needs Jant to parse                        |
| Builds with Hugo directly     | Yes                                                   | No                                              |
| Internal IDs (post id, media) | Discarded; reassigned on import                       | Preserved as-is                                 |
| Drafts and private posts      | Included; front matter sets `draft: true`             | Included                                        |
| users / sessions / tokens     | Not included                                          | Not included                                    |
| Media storage keys            | Regenerated                                           | Preserved as-is                                 |

Rule of thumb: changing domains, switching hosts, building with Hugo yourself, or long-term archival — use `site export`. Restoring the same site, cloning to staging, or moving between deployments with the same shape — use `site snapshot`.

This page covers one-shot commands. For ongoing backups, see [Backups and recovery](backups.md). For long-term sync to a GitHub repository, see [GitHub sync](github-sync.md), which reuses the same `site export` format.

## Coming from another blog or CMS

The tools above move content between Jant sites. There's no fixed importer for non-Jant sources — WordPress, Tumblr, Ghost, an RSS dump — because every platform exports differently.

Instead, hand your site's `/skill.md` URL (for example, `https://example.com/skill.md`) to an AI assistant. It's a site-bound guide for working with Jant and includes a dedicated import workflow covering the data model, source-format mapping, resumable writes, and verification. Give the assistant your export file and an [API token](automation-and-api.md), and let it run the migration.

## Runtime targets

The commands in this guide fall into two categories with very different environment requirements. Confirm which category you're in before running.

### HTTP API commands

`site export <url>`, `site import <url>`, `site pull-media`

These call the site's public HTTP API and **never touch the database or object storage directly**, so they run from any machine against any reachable Jant site. No `wrangler.toml` or `DATABASE_URL` required.

You need an API token:

```bash
export JANT_API_TOKEN=jnt_your_token
```

Generate the token under **Settings → API Tokens**, or pass it explicitly with `--token`.

### Direct data-storage commands

`site snapshot export/import`, `db export`

These read and write Jant's database and media storage directly, so they must run inside the deployment environment for that site (with that site's `wrangler.toml`, or sharing its `DATABASE_URL`, `LOCAL_STORAGE_PATH`, `S3_*`, and other runtime variables).

The runtime target resolves like this:

| Flag       | Target                  | Required environment                                 |
| ---------- | ----------------------- | ---------------------------------------------------- |
| `--remote` | Remote Cloudflare D1/R2 | `wrangler.toml`, wrangler authenticated              |
| `--local`  | Local D1 (wrangler)     | `wrangler.toml`                                      |
| `--node`   | Node runtime            | `DATABASE_URL` and matching storage config variables |

With no flag, the target is auto-selected:

1. If `DATABASE_URL` or `DATA_DIR` is set in the shell → Node runtime.
2. Otherwise → local D1 (requires `wrangler.toml` in the working directory).

The CLI prints a `[jant] target = ...` line at startup so you can confirm which target was chosen.

`--remote` runs through the local `wrangler` CLI, so you need `wrangler login` or `CLOUDFLARE_API_TOKEN` first. Use `--config` to point at a non-default wrangler config.

The CLI auto-loads `<cwd>/.env.node` at startup, but variables already exported in the shell take precedence and won't be overwritten. Drop your variables into `.env.node` once and skip the manual `source` step.

For the full environment variable list, see [Configuration](configuration.md).

## Site export (`site export`)

`site export` produces a Hugo-compatible export, either as a ZIP archive or a directory. Typical uses: migrating content between Jant sites, building a local Hugo preview, or keeping a portable long-term archive.

By default the export downloads referenced media into `static/media/` so the archive is self-contained. When the export comes from Jant, `data/jant.toml` also carries the metadata needed for round-trip imports — header navigation and the collections directory structure (order, dividers, custom links).

### What's included and excluded

Included:

- **Every post** (including Thread replies). Drafts and private posts are also archived with `draft: true` in front matter; Hugo skips them by default and only renders them with `hugo --buildDrafts`.
- Media referenced by posts and avatars, downloaded into `static/media/` by default. Pass `--no-pull-media` to skip.
- Collections, the collections directory (order, dividers, custom links), and header navigation — written to `data/jant.toml`.
- Per-post `featured_at` and `pinned_at`, plus per-Thread collection membership on the root bundle, written to front matter for round-trip restore.
- **Current slug plus historical aliases and redirects**: when a post's slug changes, the old slug stays in `path_registry` as a `redirect` row. On export, both `redirect` and `alias` rows are written to the root post's `aliases:` field. Hugo's custom `alias.html` template keeps the old links working.
- Site display settings: `SITE_NAME`, `SITE_DESCRIPTION`, `SITE_LANGUAGE`, theme, type style, custom CSS, favicon, and so on — written to `data/jant.toml` and `hugo.toml`.

Not included:

- users, sessions, accounts, verifications, API tokens — account and auth data isn't portable across sites.
- Site-level runtime config (`wrangler.toml`, environment variables, bindings).
- **Smart Collections.** Membership is a query, and an exported Hugo site has no database to run it against. The two honest options were to leave them out or to freeze today's matches under a name that promises to keep updating; the export leaves them out. The posts themselves are all there — a Smart Collection gathers posts, it does not own them — so nothing is lost but the gathering, which you recreate on the target site.

### Export structure

The export is a standard Hugo site. Templates and static assets are packaged as a `themes/jant/` theme, and `hugo.toml` sets `theme = "jant"`:

```
hugo.toml
content/                  posts, collections, sections
  {slug}/
    _index.md             thread root (branch bundle)
    {reply-slug}/
      index.md            reply (leaf bundle, build.render = "never")
data/
  jant.toml               nav items, branding, display preferences, collections directory
themes/jant/              packaged Jant theme (layouts + static)
README.md
.gitignore
layouts/                  user overrides (optional)
static/                   user static files + downloaded media
```

The root `layouts/` and `static/` directories are yours to maintain. Hugo loads root `layouts/<name>.html` ahead of `themes/jant/layouts/<name>.html`, so you can override any single template without forking the theme.

### URL scheme

| URL                   | Renders                                                           |
| --------------------- | ----------------------------------------------------------------- |
| `/`                   | Home: pinned posts first, then the first page of non-pinned posts |
| `/page/N/`            | Non-pinned post pagination (N ≥ 2)                                |
| `/archive/`           | Archive: every published post, newest first                       |
| `/archive/page/N/`    | Archive pagination (N ≥ 2)                                        |
| `/featured/`          | Featured: posts marked Featured, newest first                     |
| `/{slug}/`            | A single Thread (root post with inline replies)                   |
| `/{reply-slug}/`      | Alias that redirects to `/{root-slug}/#{reply-slug}`              |
| `/{collection-slug}/` | A collection of complete Threads                                  |
| `/collections/`       | Collections directory                                             |

Page size is controlled by Jant's **Settings → Posts per page**.

### Round-trip fidelity

A `site export` → `site import` round-trip preserves every post's Featured and pinned state, plus every Thread's collection membership:

- `featured_at` and `pinned_at` are written to front matter as ISO timestamps, not booleans, so re-importing restores the precise moment a post was Featured or pinned.
- The Thread root's top-level `collections` array carries `collected_at`, `position`, and per-collection `pinned_at` for every entry. Reply leaf bundles do not repeat Thread membership.
- Imports remain compatible with older exports that wrote `collections` on each post. The importer unions root and reply memberships by Thread, taking the latest `collected_at`, latest `pinned_at`, and smallest `position` for duplicates.
- Thread root `last_activity_at` preserves the effect of replies published with **Reply quietly**. Quietness is not a per-reply field in the export; import uses the root activity timestamp to avoid bumping replies that originally landed quietly.

Fields not documented here are Jant-internal — don't hand-edit them. They get written back to the database verbatim on the next import and will overwrite any later changes you made in Jant.

### Export the site

You need `JANT_API_TOKEN` (or `--token`); see [Runtime targets § HTTP API commands](#http-api-commands).

```bash
JANT_API_TOKEN=jnt_your_token npx jant site export https://your-site.example --output ./jant-site-export.zip
```

To inspect the generated site, export to a directory:

```bash
npx jant site export https://your-site.example --directory ./jant-site
cd ./jant-site && hugo serve
```

### Pull media separately

`site export` downloads media by default, but the pull step also runs on its own against an existing export — directory or ZIP. Use it when you exported with `--no-pull-media`, when new media was added after an earlier export, or when a previous pull was interrupted.

```bash
# Against an unpacked directory
npx jant site pull-media --path ./jant-site

# Against a ZIP (overwrites input by default)
npx jant site pull-media --path ./jant-site-export.zip

# Against a ZIP, write the result to a new file
npx jant site pull-media --path ./jant-site-export.zip --output ./pulled.zip
```

The command scans every markdown file plus `hugo.toml`, downloads each remote media reference into `static/media/`, and rewrites references to local paths. It's idempotent: files already present in `static/media/` are reused rather than re-downloaded. Anything that fails to download keeps its original URL so the Hugo build still works.

### Customizing the export

`themes/jant/` is the packaged Jant theme. If the export is bidirectionally synced to a GitHub repository, every Jant push updates the repo using these rules:

- **Overwrite and clean** (managed paths): `themes/jant/**`, `content/**`, `data/jant.toml`, `hugo.toml`, `.gitignore`, `README.md`. Files Jant no longer generates in these paths are deleted — for example, the directory of a deleted post.
- **Preserve** (unmanaged paths): root `layouts/`, root `static/`, your own Hugo data files under `data/`, and anything not in the managed list above.

Custom theme work and added static assets belong in unmanaged paths. Don't edit `themes/jant/**` directly.

Supported customization paths:

- **Override a single template**: copy `themes/jant/layouts/<name>.html` to root `layouts/<name>.html` and edit the root copy. Hugo loads root templates first, so you don't need to fork the entire theme.
- **Add static files**: drop them in root `static/`. They're served at the matching URL and take precedence over same-named files in `themes/jant/static/`.
- **Tweak colors, fonts, or layout details**: use **Settings → Custom CSS** in Jant. The value is written to `themes/jant/static/custom.css` on every export. Edit it in Settings, not in the repo.

Editing `themes/jant/**` directly isn't supported — the next sync or export overwrites it. For site-wide configuration, use Jant's **Settings**; don't hand-edit `hugo.toml`.

## Site import (`site import`)

`site import` reads a site export directory or ZIP and imports it into Jant. Typical uses: migrating between Jant sites, restoring content from a portable export, and previewing an import before writing.

### Conflicts and constraints

Import does not merge, overwrite, or roll back transactions — it walks the inbound posts and collections one at a time, comparing slugs against the target site's `path_registry`:

- If a slug is already taken by an existing post, collection, alias, or redirect, the command halts immediately. Anything written before the halt **stays** in the target site (you'll need to clean up partial state by hand).
- The target site doesn't have to be completely empty, but in practice you'll only import a single export into a clean site — overlap with the source almost guarantees slug collisions.
- If a single export contains duplicate slugs internally (for example, after hand-editing several markdown files), the same conflict triggers and the command exits.
- `--dry-run` runs the full validation pass without writing anything. Always dry-run before a real import.

### Clearing the target site

When migration hits field conflicts or a previous import didn't complete cleanly, there's currently no lightweight "wipe content but keep the account" entry point. The fastest path is to use **Settings → Account & Data → Delete Account** to remove the account along with all its content, then re-register — a common shortcut during first-time migration. The flow forces a `site export` download as a final backup, then asks for a confirmation phrase.

On hosted sites, **Delete Account** removes the same content and account but leaves billing, domain bindings, and the jant.me instance itself intact. After re-registering you can re-initialize the same instance.

### Dry-run first

Dry-run never connects to the target site, but the URL is still required so the argument shape stays consistent:

```bash
npx jant site import https://your-site.example --path ./jant-site-export.zip --dry-run
```

### Import into a site

Same as `site export`, you need `JANT_API_TOKEN` (or `--token`):

```bash
JANT_API_TOKEN=jnt_your_token npx jant site import https://your-site.example --path ./jant-site-export.zip
```

### Skip remote images in the body

By default, import re-hosts every piece of media on the target site: assets declared in front matter `media:`, images referenced from body markdown via `![](...)` (including remote URLs), and avatars are all fetched and uploaded. URLs in the body get rewritten to the new locations. The target site is then fully independent of the source — taking the source offline doesn't break image availability.

If you don't want body images **pointing at third-party URLs** (imgur, Wikipedia, any https link) mirrored into your storage — for bandwidth, copyright, or necessity reasons — pass `--skip-remote-media`:

```bash
npx jant site import https://your-site.example --path ./jant-site-export.zip --skip-remote-media
```

With this flag:

- **Relative paths** (`/media/...`, `./foo.png`): still uploaded — these are the source site's own files.
- **Absolute URLs** (any `https://...`, `//cdn...`): not fetched, not uploaded, original URL kept in the body.

Front-matter `media:` declarations, avatars, and text attachments are unaffected and always migrate.

> **Note**: if the source site serves media from a separate storage domain (an R2 public domain like `media.yourdomain.com`, an S3 CDN, etc.), body images on that domain are also classified as absolute URLs. Only enable this flag when that domain is durable — for example, when source and target share the same storage bucket. Otherwise the images break once the source's R2 goes away.

## Site snapshot (`site snapshot`)

`site snapshot export` and `site snapshot import` preserve Jant's internal IDs, storage keys, and the underlying object files. Use snapshots when you want round-trip-safe recovery rather than content migration.

### What's included and excluded

A snapshot includes:

- Posts (including drafts and private posts, with `status` and `visibility` preserved as-is).
- Collections, collection directory items, navigation items.
- Media records and path registry entries.
- The storage objects referenced by those records (downloaded in full by default — archive size ≈ total media; pass `--skip-objects` to skip).
- A set of site display settings (site name, description, language, theme, type style, favicon, custom CSS, timezone, etc.).

A snapshot **does not include** (excluded at export time, never written to the archive):

- users, sessions, accounts, verifications.
- API tokens.
- Site runtime config (`wrangler.toml`, environment variables).

In other words: distributing a snapshot doesn't leak login credentials, but the importer needs to register their own account afterwards.

The archive is three pieces:

```
jant-site-snapshot.zip
├── meta.json                  // { format, version, site }
├── db.sql                     // full SQL, including the favicon.ico base64
└── objects/<storage-key>/...  // every object referenced by media rows
```

### Export a snapshot

Default target (auto-selected per [Runtime targets](#runtime-targets) — local D1 or Node):

```bash
npx jant site snapshot export --output ./jant-site-snapshot.zip
```

Explicit Node runtime (e.g. SQLite or Postgres deployments):

```bash
DATABASE_URL=postgres://... npx jant site snapshot export --node --output ./jant-site-snapshot.zip
```

Remote Cloudflare D1:

```bash
npx jant site snapshot export --remote --config ./wrangler.toml --output ./jant-site-snapshot.zip
```

### Skip media file download

When source and target share the same R2 / S3 bucket — for example, when you're migrating database state to another Worker but the media is already in the target bucket — pass `--skip-objects` to leave the `objects/` directory out of the archive:

```bash
npx jant site snapshot export --output ./jant-site-snapshot.zip --skip-objects
```

The archive shrinks to just `meta.json` + `db.sql`.

> **Prerequisite**: the target storage already contains every storage key referenced by `db.sql` (typically because source and target share the same R2 / S3 bucket). Otherwise every media reference 404s after import.
>
> Pair this with `--allow-missing-objects` on import (see below). Without that flag, import stops at the preflight stage and lists the missing keys.

### Import a snapshot

Snapshot import requires explicit `--replace`. With `--replace`, the snapshot's content tables in the target database are wiped (`post`, `collection`, `nav_item`, `collection_directory_item`, `thread_collection`, `media`, `path_registry`), then rewritten from the snapshot. Tables outside that scope — users, sessions, tokens — are left alone. Without `--replace`, import refuses to run, preventing accidental overwrites.

Current exports use snapshot format v2. Imports also accept v1 snapshots: their legacy `post_collection` rows are upgraded in memory to the Thread-level union before any target content is cleared.

Default target:

```bash
npx jant site snapshot import --path ./jant-site-snapshot.zip --replace
```

Remote Cloudflare D1:

```bash
npx jant site snapshot import --remote --config ./wrangler.toml --path ./jant-site-snapshot.zip --replace
```

### Allow missing objects

By default, import runs a preflight: it extracts every `storage_key` and `poster_key` from `db.sql` and compares them against the files in the `objects/` directory. Any missing key aborts the import and prints the full missing list.

If you've confirmed the target storage already has those files (for instance, importing a `--skip-objects` archive into a Worker that shares its R2 bucket with the source), pass `--allow-missing-objects` to skip the check:

```bash
npx jant site snapshot import \
  --path ./jant-site-snapshot.zip \
  --replace \
  --allow-missing-objects
```

Even with the flag set, the missing list still prints to stderr — redirect it to a file if you want an audit trail.

## Database export (`db export`)

`db export` writes the current database to raw SQL. It **doesn't include media files**. Use it to inspect table contents, keep a SQL dump alongside other backups, or feed your own operational tooling. **Don't use it as a complete backup** — media has to be handled separately. See [Backups and recovery](backups.md). Postgres deployments can also use `pg_dump` directly; see [Backups and recovery § Node + Postgres](backups.md#node--postgres).

Default target (auto-selected per [Runtime targets](#runtime-targets)):

```bash
npx jant db export --output ./jant-export.sql
```

Explicit Node runtime:

```bash
DATABASE_URL=postgres://... npx jant db export --node --output ./jant-export.sql
```

Remote Cloudflare D1:

```bash
npx jant db export --remote --config ./wrangler.toml --output ./jant-remote.sql
```

## What's next

- [Backups and recovery](backups.md) — full backup and recovery strategy
- [GitHub sync](github-sync.md) — content backup and bidirectional editing through a GitHub repository
- [Automation and API](automation-and-api.md) — scripting the operations above
- [API Reference](API.md)
