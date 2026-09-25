# Export and import

## Choosing the right tool

| You want to                                                 | Use                                               |
| ----------------------------------------------------------- | ------------------------------------------------- |
| Move an old blog from another platform into Jant            | An AI assistant (see below)                       |
| Move content between Jant sites, or keep a portable archive | `site export` and `site import`                   |
| Restore a site with the same internal IDs and storage keys  | `site snapshot export` and `site snapshot import` |
| Dump the database as SQL                                    | `db export`                                       |

`site export` and `site snapshot` produce different things:

| Aspect                        | `site export`                                         | `site snapshot`                                 |
| ----------------------------- | ----------------------------------------------------- | ----------------------------------------------- |
| Output format                 | Hugo site directory (Markdown + front matter + media) | SQL dump + object storage dump (binary archive) |
| Human-readable                | Yes, edit the Markdown in any editor                  | No, only Jant can read it                       |
| Builds with Hugo directly     | Yes                                                   | No                                              |
| Internal IDs (post id, media) | Discarded; reassigned on import                       | Preserved as-is                                 |
| Drafts and private posts      | Included; front matter sets `draft: true`             | Included                                        |
| users / sessions / tokens     | Not included                                          | Not included                                    |
| Media storage keys            | Regenerated                                           | Preserved as-is                                 |

Changing domains, switching hosts, building with Hugo yourself, or archiving for the long term: use `site export`. Restoring the same site, cloning it to staging, or moving between deployments of the same shape: use `site snapshot`.

These are one-shot commands. For regular backups, see [Backups and recovery](backups.md). [GitHub sync](github-sync.md) keeps a repository up to date in the same format as `site export`.

## Coming from another blog or CMS

There is no importer for other platforms, because WordPress, Tumblr, Ghost, and the rest each export differently. An AI assistant does the migration instead.

Once your Jant site exists, send this line to an AI assistant that can run commands, such as Claude Code or Codex, with your site's address in place of `example.com`:

```text
Read https://example.com/skill.md and help me move my old blog here.
```

`/skill.md` is a guide to your site written for AI assistants. It tells the assistant how to run the migration: ask where the old blog is, help you export it, and ask for an [API token](automation-and-api.md) before the first write.

## Site export (`site export`)

`site export` writes the site as a Hugo site, in a ZIP or a directory. It works through the site's HTTP API, as `site import` and `site pull-media` do, so it runs from any machine that can reach the site, without the site's `wrangler.toml` or `DATABASE_URL`. Run it from a Jant project directory where `@jant/core` is installed (for a site created with `create-jant`, the project root), with an API token from **Settings → API Tokens** in `JANT_API_TOKEN` or passed with `--token`:

```bash
JANT_API_TOKEN=jnt_your_token npx jant site export https://your-site.example --output ./jant-site-export.zip
```

To look at the result, export to a directory and run Hugo:

```bash
npx jant site export https://your-site.example --directory ./jant-site
cd ./jant-site && hugo serve
```

### What's included and excluded

Included:

- Every post, Thread replies included. Drafts and private posts carry `draft: true` in front matter; Hugo builds them only with `hugo --buildDrafts`.
- Media used by posts and avatars, downloaded into `static/media/` so the archive stands on its own. `--no-pull-media` skips the download.
- Collections, the Collections directory (order, dividers, custom links), and header navigation, in `data/jant.toml`.
- Each post's `featured_at` and `pinned_at`, and each Thread's Collection membership on the root bundle, in front matter.
- The current slug, plus old slugs and aliases in the root post's `aliases:` field. A custom `alias.html` template keeps the old links working.
- Display settings: `SITE_NAME`, `SITE_DESCRIPTION`, `SITE_LANGUAGE`, theme, type style, custom CSS, favicon, and so on, in `data/jant.toml` and `hugo.toml`.

Not included:

- Users, sessions, accounts, verifications, and API tokens. Account data doesn't move between sites.
- Runtime config: `wrangler.toml`, environment variables, bindings.
- Smart Collections. Their membership is a query, and a Hugo site has no database to run it against. Every post they gathered is exported; recreate the Smart Collection on the target site.

### Export structure

The export is a standard Hugo site. Templates and static assets are packaged as the `themes/jant/` theme, and `hugo.toml` sets `theme = "jant"`:

```
hugo.toml
wrangler.jsonc            Cloudflare Workers deploy config
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

### Deploying to Cloudflare Workers

`wrangler.jsonc` names the Worker, builds the site with `hugo --gc --minify`, and uploads `public/`, so `npx wrangler deploy` is the whole deploy. Cloudflare finds no `package.json` in a Hugo site and offers an empty build command when you connect the repository. Leave it empty; filling it in runs Hugo twice. `HUGO_VERSION` needs no value, because the theme builds on the Hugo in Cloudflare's build image.

The `name` has to match the Worker's name in the Cloudflare dashboard. When they differ, Workers Builds fails the build, and a deploy run by hand goes to a different Worker. Cloudflare names a Worker imported from a repository after the repository, so a repository pushed by [GitHub Sync](github-sync.md) uses the repository name (`My_Blog` becomes `my-blog`). A downloaded export has no repository and uses the name GitHub Sync suggests when it creates one for the site (`www.example.com` becomes `example-jant-sync`). If your Worker has another name, change `name` to match. Cloudflare calls the Worker's build token `<worker-name> build token`, which is one place to read the name.

`wrangler.jsonc` is written once. GitHub Sync leaves it alone on later pushes, so a corrected name stays.

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

Page size follows Jant's **Settings → Posts per page**.

When **Settings → Feeds** is on, the export also writes Atom feeds:

| URL                            | Carries           |
| ------------------------------ | ----------------- |
| `/index.xml`                   | The home timeline |
| `/featured/index.xml`          | Featured          |
| `/archive/index.xml`           | The full archive  |
| `/{collection-slug}/index.xml` | One collection    |

### Feed addresses change

Jant serves its feeds at `/feed`, `/latest/feed`, `/featured/feed`, `/archive/feed`, and `/{collection-slug}/feed`. Hugo writes the same feeds as `index.xml` inside each section, so none of the addresses your subscribers use exist on the exported site.

The export writes `static/_redirects`, which sends each old address to its new one with a 301. Cloudflare Pages and Netlify read that file as published, so subscribers follow a move to either host. Other hosts ignore it; copy its rules into the host's own redirect config before you point the domain at the export.

The `aliases:` pages that keep old post links working can't do this for feeds. They redirect with a meta refresh and a script, and feed readers run neither.

The Jant `/subscribe` page doesn't exist on the exported site. The **Subscribe** navigation entry links to the main feed file instead.

### Round-trip fidelity

`site import` restores what `site export` wrote:

- `featured_at` and `pinned_at` are ISO timestamps, so a re-import brings back the moment a post was Featured or pinned.
- A Thread's Collection membership sits in the root's `collections` array, each entry with `collected_at`, `position`, and a per-Collection `pinned_at`. Replies don't repeat it. Older exports that wrote `collections` on every post still import.
- A reply published with **Reply quietly** carries `quiet_reply: true`. For older exports without the field, import reads the root's `last_activity_at` so that quiet replies don't bump the Thread.
- Each reply's `weight` is its position in the Thread, and import creates replies in that order. Posts that share a publish second keep their order too.
- `created` and `updated` hold when a post was written and last edited, written where they differ from `date`. After a move, feeds and the sitemap report the original times.
- Video and audio keep `duration_seconds`.

Front-matter fields not listed on this page are internal to Jant. Don't edit them by hand: the next import writes them back to the database as they are, over anything you changed in Jant since.

### Pull media separately

`site pull-media` runs the media download on an existing export, directory or ZIP. Use it after a `--no-pull-media` export, after new media was added, or when an earlier pull stopped partway.

```bash
# Against an unpacked directory
npx jant site pull-media --path ./jant-site

# Against a ZIP (overwrites input by default)
npx jant site pull-media --path ./jant-site-export.zip

# Against a ZIP, write the result to a new file
npx jant site pull-media --path ./jant-site-export.zip --output ./pulled.zip
```

It scans every Markdown file and `hugo.toml`, downloads each remote media file into `static/media/`, and rewrites the references to local paths. Files already in `static/media/` are reused, so a second run is safe. A file that fails to download keeps its original URL, and the Hugo build still works.

### Customizing the export

The next export or [GitHub Sync](github-sync.md) push overwrites `themes/jant/**`, so don't edit it. On a synced repository, each push also rewrites `content/**`, `data/jant.toml`, `hugo.toml`, `.gitignore`, and `README.md`, and deletes files in those paths that Jant no longer generates. Root `layouts/`, root `static/`, your own files under `data/`, and everything else are left alone. To customize:

- To change one template, copy `themes/jant/layouts/<name>.html` to root `layouts/<name>.html` and edit the copy. Hugo loads root templates first.
- Put extra static files in root `static/`. They win over files of the same name in `themes/jant/static/`.
- Change colors, fonts, or layout details in Jant under **Settings → Custom CSS**. Each export writes it to `themes/jant/static/custom.css`.
- Change site-wide configuration in Jant's **Settings**, not in `hugo.toml`.

## Site import (`site import`)

`site import` reads an export, directory or ZIP, into a Jant site. Run it with `--dry-run` first: it checks everything and writes nothing. A dry run never contacts the site, but the URL is still required.

```bash
npx jant site import https://your-site.example --path ./jant-site-export.zip --dry-run
```

Then import for real, with `JANT_API_TOKEN` or `--token`:

```bash
JANT_API_TOKEN=jnt_your_token npx jant site import https://your-site.example --path ./jant-site-export.zip
```

### Conflicts and constraints

Import writes posts and Collections one at a time. It doesn't merge, overwrite, or roll back.

- When a slug is already taken on the target site by a post, Collection, alias, or redirect, the import stops. Everything written before that stays, and you clean it up by hand.
- Duplicate slugs inside the export itself, for example after hand-editing Markdown files, stop it the same way.
- The target site doesn't have to be empty, but an export overlaps its source so much that in practice you import into a clean site.

### Clearing the target site

Jant has no single action yet that deletes a site's content and keeps the account. After a failed or partial import, the fastest reset is **Settings → Account & Data → Delete Account**, then registering again. The flow makes you download a `site export` as a last backup, then asks for a confirmation phrase.

On a hosted site, **Delete Account** removes the same content and account, but billing, domain bindings, and the jant.me instance itself stay. After registering again you can set up the same instance.

### Skip remote images in the body

By default, import copies all media to the target site: files declared in front matter `media:`, images in the body (`![](...)`, remote URLs included), and avatars. Body URLs are rewritten to the copies, so the target keeps working after the source goes offline.

To leave images that point at third-party URLs (imgur, Wikipedia, any `https://` link) out of your storage, for bandwidth, copyright, or other reasons, pass `--skip-remote-media`:

```bash
npx jant site import https://your-site.example --path ./jant-site-export.zip --skip-remote-media
```

With the flag, relative paths (`/media/...`, `./foo.png`) are the source site's own files and still upload. Absolute URLs (`https://...`, `//cdn...`) stay in the body as they are. Front-matter `media:`, avatars, and text attachments always migrate.

If the source site serves media from its own storage domain, such as an R2 public domain like `media.yourdomain.com` or an S3 CDN, its body images count as absolute URLs too. Use the flag only when that domain will stay up, for example when source and target share a bucket. Otherwise the images break once the source's storage goes away.

## Runtime targets

`site snapshot export/import` and `db export` read and write the database and media storage directly. Run them inside the site's deployment environment: from its project directory with its `wrangler.toml`, or with the same `DATABASE_URL`, `LOCAL_STORAGE_PATH`, `S3_*`, and other runtime variables.

| Flag       | Target                  | Required environment                                 |
| ---------- | ----------------------- | ---------------------------------------------------- |
| `--remote` | Remote Cloudflare D1/R2 | `wrangler.toml`, wrangler authenticated              |
| `--local`  | Local D1 (wrangler)     | `wrangler.toml`                                      |
| `--node`   | Node runtime            | `DATABASE_URL` and matching storage config variables |

With no flag, the CLI picks the Node runtime when `DATABASE_URL` or `DATA_DIR` is set in the shell, and local D1 otherwise, which needs `wrangler.toml` in the working directory. It prints `[jant] target = ...` at startup so you can check the choice.

`--remote` goes through the local `wrangler` CLI, so run `wrangler login` or set `CLOUDFLARE_API_TOKEN` first. `--config` points at a non-default wrangler config.

The CLI loads `<cwd>/.env.node` at startup. Variables already exported in the shell take precedence. `JANT_ENV_FILE` loads a different file, which helps when one machine manages several deployments; set it to an empty value to skip the file, as automated runs do to keep a local `.env.node` out. The full variable list is in [Configuration](configuration.md).

## Site snapshot (`site snapshot`)

A snapshot keeps Jant's internal IDs, storage keys, and media files exactly as they are. Use it to restore a site, not to migrate content. It reads the database directly (see [Runtime targets](#runtime-targets)), so it doesn't work on hosted sites.

### What's included and excluded

A snapshot includes:

- Posts, drafts and private posts included, with `status` and `visibility` as they were.
- Collections, Collections directory items, and navigation items.
- Media records and path registry entries.
- The storage objects those records point to. The archive is about as large as all your media; `--skip-objects` leaves them out.
- Display settings: site name, description, theme, type style, favicon, custom CSS, timezone, and so on.
- The language setup: the primary language, the languages served under a prefix, and whether [multilingual content](multilingual.md) is on. Each post's language and translation links come with the post.

A snapshot leaves out, at export time:

- Users, sessions, accounts, verifications, and API tokens.
- Runtime config (`wrangler.toml`, environment variables).
- Code injection (**Settings → Code injection**). Custom CSS is included; custom head and body HTML are not, so importing an archive can't run script on the importing site.
- GitHub Sync and Telegram connections, with their tokens and sync state. They point at a repository or chat the target site doesn't own.

A snapshot carries no login credentials, so the person importing it registers their own account afterwards.

The archive has three parts:

```
jant-site-snapshot.zip
├── meta.json                  // { format, version, site }
├── db.sql                     // full SQL, including the favicon.ico base64
└── objects/<storage-key>/...  // every object referenced by media rows
```

### Export a snapshot

With no flag, the target follows [Runtime targets](#runtime-targets) (local D1 or Node):

```bash
npx jant site snapshot export --output ./jant-site-snapshot.zip
```

Node runtime, for SQLite or Postgres deployments:

```bash
DATABASE_URL=postgres://... npx jant site snapshot export --node --output ./jant-site-snapshot.zip
```

Remote Cloudflare D1:

```bash
npx jant site snapshot export --remote --config ./wrangler.toml --output ./jant-site-snapshot.zip
```

### Skip media file download

When source and target share an R2 or S3 bucket, for example when you move the database to another Worker and the media is already in the target bucket, `--skip-objects` leaves `objects/` out. The archive is then only `meta.json` and `db.sql`.

```bash
npx jant site snapshot export --output ./jant-site-snapshot.zip --skip-objects
```

The target storage must already hold every storage key in `db.sql`, or every media reference returns 404 after import. Import with `--allow-missing-objects` (below); without it, import stops at its preflight check and lists the missing keys.

### Import a snapshot

Snapshot import needs `--replace`. It clears the snapshot's content tables in the target database (`post`, `collection`, `nav_item`, `collection_directory_item`, `thread_collection`, `media`, `path_registry`) and writes the snapshot in their place. Users, sessions, and tokens stay. Without `--replace`, import refuses to run.

Media files go into the target site's own storage, so a snapshot from a site on R2 imports into one that keeps media in S3 or on local disk. Exports use snapshot format v2; import also accepts v1.

```bash
npx jant site snapshot import --path ./jant-site-snapshot.zip --replace
```

Remote Cloudflare D1:

```bash
npx jant site snapshot import --remote --config ./wrangler.toml --path ./jant-site-snapshot.zip --replace
```

### Allow missing objects

Before writing, import checks every `storage_key` and `poster_key` in `db.sql` against the files in `objects/`, and stops with the full list if any are missing. When the target storage already has those files, as with a `--skip-objects` archive going into a Worker that shares the source's R2 bucket, `--allow-missing-objects` skips the check:

```bash
npx jant site snapshot import \
  --path ./jant-site-snapshot.zip \
  --replace \
  --allow-missing-objects
```

The missing list still goes to stderr. Redirect it to a file to keep a record.

## Database export (`db export`)

`db export` writes the database as raw SQL, without media files. Use it to inspect tables, keep a SQL dump next to other backups, or feed your own tools. It is not a complete backup; [Backups and recovery](backups.md) covers media. Postgres deployments can also use `pg_dump`; see [Backups and recovery § Node + Postgres](backups.md#node--postgres).

With no flag, the target follows [Runtime targets](#runtime-targets):

```bash
npx jant db export --output ./jant-export.sql
```

Node runtime:

```bash
DATABASE_URL=postgres://... npx jant db export --node --output ./jant-export.sql
```

Remote Cloudflare D1:

```bash
npx jant db export --remote --config ./wrangler.toml --output ./jant-remote.sql
```

## What's next

- [Backups and recovery](backups.md): a full backup and recovery plan
- [GitHub sync](github-sync.md): back up content to a GitHub repository and edit it there
- [Automation and API](automation-and-api.md): script the operations above
- [API Reference](API.md)
