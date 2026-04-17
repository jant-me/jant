# Export and Import

Run these commands from a Jant project directory where `@jant/core` is installed. In a site created with `create-jant`, that usually means the project root.

## Choose the Right Tool

| Need                                                        | Use this                                          |
| ----------------------------------------------------------- | ------------------------------------------------- |
| Move content into another Jant site                         | `site export` and `site import`                   |
| Create a portable static archive                            | `site export`                                     |
| Restore content with the same internal IDs and storage keys | `site snapshot export` and `site snapshot import` |
| Export raw database SQL                                     | `db export`                                       |

`site export` is for portability.

`site snapshot` is for recovery.

They are not the same thing.

## Site Export

`site export` produces a Zola-compatible export as a ZIP file or directory.

Use it when you want to:

- move content to another Jant site
- inspect a static export locally
- keep a portable archive of your published structure

By default, Jant localizes referenced media into the export so the archive is more self-contained.

When the export comes from Jant, `config.toml` also keeps Jant-specific metadata for round-trip imports, including header navigation and the collections directory structure (collection order, dividers, and custom links).

### Export Layout

A Jant export is a standard Zola site. Templates and static assets are packaged as a theme at `themes/jant/`, and `config.toml` sets `theme = "jant"`:

```
config.toml
content/                  your posts, collections, sections
themes/jant/              the packaged Jant theme (templates + static)
README.md
.gitignore
templates/                your overrides (optional)
static/                   your static files + downloaded media
```

Root `templates/` and root `static/` are your territory. Zola picks any file under root `templates/<name>.html` over `themes/jant/templates/<name>.html`, so you can override a single page without forking the theme. With `--localize-media` (the default), referenced media is downloaded into `static/media/` so the export is self-contained.

### URL Scheme

The exported site uses a Zola `feed` taxonomy for pagination instead of filtering posts at template time. The main paths are:

| URL                     | What it renders                                               |
| ----------------------- | ------------------------------------------------------------- |
| `/`                     | Home — pinned posts, then the first page of non-pinned public |
| `/feed/public/page/N/`  | Older non-pinned public posts, paginated (N ≥ 2)              |
| `/archive/`             | Archive — every published post in one chronological list      |
| `/feed/archive/page/N/` | Older published posts, paginated (N ≥ 2)                      |
| `/{slug}/`              | A single post                                                 |
| `/{collection-slug}/`   | A single collection                                           |
| `/collections/`         | The collections directory                                     |
| `/feed/unlisted/`       | Posts hidden from the home feed; listing page is `noindex`    |

Page size is controlled by your Jant site's **Posts per page** setting.

### Export the Local Site

```bash
npx jant site export --output ./jant-site-export.zip
```

Export directly to a directory when you want to inspect the generated site:

```bash
npx jant site export --directory ./jant-site
cd ./jant-site && zola serve
```

### Export a Remote Site

Create an API token in **Settings > API Tokens**, then:

```bash
export JANT_API_TOKEN=jnt_your_token
npx jant site export --url https://your-site.example --output ./jant-site-export.zip
```

You can also pass `--token`, but `JANT_API_TOKEN` is easier to reuse.

### Customizing an Export

The `themes/jant/` directory is the packaged Jant theme. If you sync the export to GitHub, Jant will overwrite everything under `themes/jant/**`, `content/**`, `config.toml`, `.gitignore`, and `README.md` on every push. Everything else in the repo is yours and is preserved.

The supported ways to customize an exported site:

- **Override a single template.** Copy the file you want to change from `themes/jant/templates/<name>.html` to `templates/<name>.html` at the project root, then edit the root copy. Zola loads root templates before theme templates, so your version wins without forking the whole theme.
- **Add static files.** Drop files into the root `static/` directory. They are served at the matching URL and take precedence over anything of the same name in `themes/jant/static/`.
- **Change colors, fonts, or layout tweaks.** Use **Settings > Custom CSS** in Jant. The value is written to `themes/jant/static/custom.css` on every export, so it is safe to edit from the Jant dashboard but not from the repo.

Editing `themes/jant/**` directly in the repo is not supported — the next sync or export replaces it. For site-wide configuration, use Jant's **Settings** rather than editing `config.toml` by hand.

## Site Import

`site import` reads a site export directory or ZIP and imports it into Jant.

Use it when you want to:

- migrate from one Jant site to another
- restore content from a portable export
- preview an import before touching a real site

Important rules:

- import expects an empty target site
- slug or alias conflicts stop the import
- `--dry-run` validates the archive without writing anything

### Dry Run an Import

```bash
npx jant site import --path ./jant-site-export.zip --dry-run
```

### Import into the Local Site

```bash
npx jant site import --path ./jant-site-export.zip
```

### Import into a Remote Site

```bash
export JANT_API_TOKEN=jnt_your_token
npx jant site import --url https://your-site.example --path ./jant-site-export.zip
```

Skip media transfer when you only want post and collection data:

```bash
npx jant site import --path ./jant-site-export.zip --skip-media
```

## Site Snapshots

`site snapshot export` and `site snapshot import` preserve Jant's internal IDs, storage keys, and object files.

Use snapshots when you want round-trip-safe recovery rather than content migration.

### What a Snapshot Includes

A snapshot includes the content and presentation data Jant needs to restore a site's published structure, including:

- posts
- collections
- collection directory items
- navigation items
- media records
- path registry entries
- the referenced storage objects themselves

Snapshot import does not replace auth and shell data such as users, sessions, and API tokens.

### Export a Snapshot

Local:

```bash
npx jant site snapshot export --output ./jant-site-snapshot.zip
```

Remote Cloudflare D1:

```bash
npx jant site snapshot export --remote --config ./wrangler.toml --output ./jant-site-snapshot.zip
```

### Import a Snapshot

Snapshot import currently requires `--replace`.

Local:

```bash
npx jant site snapshot import --path ./jant-site-snapshot.zip --replace
```

Remote Cloudflare D1:

```bash
npx jant site snapshot import --remote --config ./wrangler.toml --path ./jant-site-snapshot.zip --replace
```

### Remapping Site IDs

In `single-site` mode, Jant automatically remaps a snapshot to the only initialized site.

If you intentionally want to load one site's content into another existing site container, use:

```bash
npx jant site snapshot import --path ./jant-site-snapshot.zip --replace --remap-site
```

Use `--remap-site` only in trusted workflows where you understand the consequences.

## Database Export

`db export` writes raw SQL for the current database.

Use it when you want to:

- inspect the database contents
- keep a SQL dump alongside other backups
- move data into your own operational tooling

Local:

```bash
npx jant db export --output ./jant-export.sql
```

Remote Cloudflare D1:

```bash
npx jant db export --remote --output ./jant-remote.sql
```

A raw SQL export is not a full Jant backup by itself. You still need your media files.

## Related Reading

- [GitHub Sync](github-sync.md) — automatic content backup and bidirectional editing via a GitHub repository
- [Backups and Recovery](backups.md)
- [API Reference](API.md)
