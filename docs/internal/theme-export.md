# Theme Export Model

Internal reference for how `site export` and GitHub Sync shape the
filesystem layout of an exported Jant site.

Audience: contributors working on `packages/core/src/services/export.ts`
or `packages/core/src/services/github-sync.ts`.

## Layout

Every Jant export is a Zola site with a packaged theme at `themes/jant/`:

```
config.toml
content/
  _index.md
  archive/_index.md
  collections/_index.md
  featured/_index.md          # only when "featured" slug is free
  posts/{slug}.md
  {collection-slug}/_index.md
themes/
  jant/
    theme.toml
    templates/
      base.html
      index.html              # /          (manual render + pinned)
      archive.html             # /archive/
      feed/
        list.html             # /feed/
        single.html           # /feed/{term}/ and /feed/{term}/page/N/
      taxonomy_list.html
      taxonomy_single.html
      section.html
      page.html
      collection.html
      featured.html
      macros.html
      atom.xml
    static/
      tokens.css
      style.css
      theme.css                # color theme
      custom.css               # user's Custom CSS from Settings
      favicon.ico
      apple-touch-icon.png
README.md
.gitignore
```

Root `templates/` and root `static/` are not emitted by the export
service. They are user territory: Zola's override rule picks any file
under root `templates/<name>.html` over
`themes/jant/templates/<name>.html`, so users get per-template overrides
without forking the theme. The CLI may populate `static/media/` when
`--localize-media` is on, but that is a CLI-level concern — the core
export service produces nothing at the repo root outside the
`JANT_MANAGED_GLOBS` list.

## config.toml

Two pieces are load-bearing for the theme model:

- `theme = "jant"` — tells Zola to load `themes/jant/`.
- `[[taxonomies]] name = "feed"`, `paginate_by = pageSize`, `feed = true`
  — drives the home and archive pagination.

The `feed` taxonomy replaces the old `latest_hidden` template-time
filter. Every non-draft post is assigned at least one feed term. The
terms are:

| Term       | Post set                                                     |
| ---------- | ------------------------------------------------------------ |
| `public`   | `visibility = public`, not pinned                            |
| `pinned`   | `visibility = public` **and** `pinnedAt` is set              |
| `archive`  | `visibility = latest_hidden` (visible but excluded from `/`) |
| `unlisted` | `visibility = unlisted` (reachable by URL only)              |

A post can be in exactly one feed per visibility bucket. Pinned posts go
to `feed=pinned`, **not** `feed=public`, so Zola's paginator for
`/feed/public/page/N/` doesn't double-count them. Home page 1 (`/`) then
manually prepends the pinned set before the first slice of `feed=public`.

## URL scheme

| URL                           | Rendered by                                                          |
| ----------------------------- | -------------------------------------------------------------------- |
| `/`                           | `index.html` — manual render of pinned + first page of `feed=public` |
| `/feed/public/page/N/`        | Zola's native paginator on the feed taxonomy (N ≥ 2)                 |
| `/archive/`                   | `archive.html` — manual render of first page of `feed=archive`       |
| `/feed/archive/page/N/`       | Zola's native paginator on the feed taxonomy (N ≥ 2)                 |
| `/feed/unlisted/`             | `taxonomy_single.html`; rendered with `<meta name="robots" ...>`     |
| `/{post-slug}/`               | `page.html`                                                          |
| `/{collection-slug}/`         | collection taxonomy term page                                        |
| `/collections/`               | collections directory section                                        |
| `/collections/{slug}/page/N/` | collection paginator                                                 |

The home page is rendered manually (not via Zola's paginator) because it
has to combine two sources: pinned posts on top, then the first
`pageSize` entries from `feed=public`. Page 2+ hands off to Zola's
native paginator at `/feed/public/page/N/`. The manual slice for page 1
must match the paginator's boundary exactly — see
`buildIndexTemplate()` in `export.ts`.

## pageSize vs archivePageSize

Both come from the Jant site config (`SITE_CONFIG` via `packages/core/bin/commands/site/export.js`).

- `pageSize` is Zola's `paginate_by` for the `feed` taxonomy. It controls
  `/feed/public/page/N/` and `/feed/archive/page/N/` page size.
- `archivePageSize` is threaded through `SiteConfig` for Node-side
  rendering on the live site and is not used by the exported Zola
  templates directly.

Keeping both in `SiteConfig` avoids a drift where the Node-rendered
archive and the exported Zola archive disagree on page size.

## Managed paths (hard list)

GitHub Sync keeps a single source of truth for which paths Jant owns:

```ts
// packages/core/src/services/github-sync.ts
export const JANT_MANAGED_GLOBS = [
  "content/**",
  "themes/jant/**",
  "config.toml",
  ".gitignore",
  "README.md",
  ".jant-sync",
] as const;
```

Everything inside these globs is overwritten on every full sync.
Everything outside is user territory and preserved via Git's `base_tree`
on the push commit. There are no tiers (no "init-only" files, no
"seed-on-first-push" exceptions) — the rule is binary.

Corollary: a user who wants to edit Jant output must fork into root
(`templates/{name}.html` shadowing `themes/jant/templates/{name}.html`)
or override via `static/custom.css`. Editing anything under
`themes/jant/**` is pointless because the next push will revert it.

## .jant-sync marker

`.jant-sync` at the repo root identifies the repo as managed by a Jant
site and carries the schema version plus the site ID:

```json
{
  "schema_version": 2,
  "site_id": "sit_...",
  "site_host": "blog.example.com",
  "created_at": 1713225600,
  "managed_globs": [
    "content/**",
    "themes/jant/**",
    "config.toml",
    ".gitignore",
    "README.md",
    ".jant-sync"
  ]
}
```

`managed_globs` is duplicated into the marker so future schema bumps can
diff the old set against the new set and decide what to clean up. On v1
markers this field is absent; the classifier still accepts them as
`"owned"` so existing connections don't break, and the next full push
migrates the repo to v2.

The export service does **not** emit `.jant-sync`. Only `github-sync.ts`
writes it — it is the one component that knows the site ID.

## v1 → v2 layout migration

v1 exports wrote templates and static assets at the repo root. Under v2,
the root versions must disappear or they will shadow the new
`themes/jant/` theme (Zola's override rule: root wins). On the first v2
push against a v1-marked repo, `pushFullSync` appends a fixed list of
null-sha tree entries to delete the legacy root files:

```
templates/base.html, templates/archive.html, templates/index.html,
templates/page.html, templates/section.html, templates/taxonomy_list.html,
templates/taxonomy_single.html, templates/collection.html,
templates/featured.html, templates/atom.xml, templates/macros.html,
static/tokens.css, static/style.css, static/theme.css,
static/custom.css, static/favicon.ico, static/apple-touch-icon.png
```

`static/custom.css` is on the deletion list because v1 wrote the
Settings → Custom CSS value there; v2 writes it to
`themes/jant/static/custom.css`. Leaving the legacy file would cause
stale custom CSS to win over the current value.

The migration is one-shot: once the marker reads `schema_version: 2`,
subsequent pushes skip the legacy-deletion step.

## Customization paths for users

Documented in `docs/export-and-import.md` for site owners. The
implementation contract:

- Anything under root `templates/<name>.html` replaces the matching theme
  template. Partial overrides work — users can override
  `templates/page.html` without touching anything else.
- Anything under root `static/<name>` is served at `/<name>` exactly like
  Zola's regular static output; root `static/` wins against
  `themes/jant/static/` when filenames collide.
- Users editing `themes/jant/**` will lose their changes on the next
  push. The recommended path is always root-level override.
- `config.toml` is managed: user edits will be overwritten. Site-wide
  config belongs in Jant's **Settings**, which is the source the export
  reads from.

## Testing

- `packages/core/src/__tests__/export-service.test.ts` asserts every
  theme path lives under `themes/jant/` and root `templates/` is empty.
- `packages/core/src/services/__tests__/github-sync-classify.test.ts`
  asserts v1 markers still classify as `"owned"` and v2 markers carry
  `managed_globs`.
- The canonical fixture at `sites/demo-source/canonical/site-export/`
  must be regenerated any time the export layout changes — run
  `mise run demo-source-export-canonical-site-export` and commit the
  diff.
